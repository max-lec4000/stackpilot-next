import {
  mkdtemp,
  mkdir,
  readdir,
  lstat,
  readFile,
  writeFile,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { dockerInput } from "../docker-io.js";
import { localDocker } from "../retirement.js";
import { identityCompose } from "./config.js";
import {
  encryptBackup,
  decryptBackup,
  validateBackup,
  sha256,
  backupLimit,
} from "./backup-format.js";
const uuid = /^[a-f0-9-]{36}$/;
export class IdentityBackups {
  constructor(identity) {
    this.identity = identity;
    this.hub = identity.hub;
  }
  key() {
    const r = this.identity.current();
    if (!r) throw Error("Authentik zuerst einrichten.");
    return "identity-backups:" + r.id;
  }
  list() {
    return this.hub.engine.vault.get(this.key()) || [];
  }
  save(rows) {
    this.hub.engine.vault.set(this.key(), rows);
  }
  directory() {
    return path.join(this.hub.engine.store.directory, "identity-backups");
  }
  maintenance() {
    const r = this.identity.current();
    return r
      ? this.hub.engine.vault.get("identity-maintenance:" + r.id) || {
          needsResume: false,
        }
      : { needsResume: false };
  }
  markMaintenance(record, needsResume) {
    this.hub.engine.vault.set("identity-maintenance:" + record.id, {
      needsResume,
      at: new Date().toISOString(),
    });
  }
  /**
   * Authentik-Server und -Worker starten und danach das Identitäts-Gateway neu laden: Der
   * Server kann beim Start eine neue interne Adresse bekommen, nginx löst „server“ aber nur
   * beim Laden auf. Ohne Neuladen lief die Anmeldung danach ins Leere (Discovery 404).
   */
  async startAuthentication(projectArgs, docker = localDocker) {
    await docker([...projectArgs, "start", "server", "worker"], { timeout: 60000 });
    await docker([...projectArgs, "exec", "-T", "gateway", "nginx", "-s", "reload"], { timeout: 30000 });
  }
  async resume(body) {
    if (body.confirmation !== "OK")
      throw Error("Lokales Fortsetzen mit OK bestätigen.");
    return this.hub.mutate(["Jellyfin"], async () => {
      const r = await this.identity.verify();
      await this.startAuthentication(["compose", "-f", path.join(r.directory, "compose.json")]);
      this.markMaintenance(r, false);
      return {
        ok: true,
        message:
          "Lokaler Authentik-Start angefordert. Bereitschaft anschließend prüfen.",
      };
    });
  }
  async ready() {
    const r = await this.identity.verify();
    if (r.status !== "local-ready" || this.identity.pending)
      throw Error("Authentik muss lokal eingerichtet sein.");
    const rows = await this.identity.containers(r, true);
    if (rows.some((v) => !v.State.Running || v.State.Restarting))
      throw Error("Identitätsdienste sind nicht bereit.");
    await this.identity.networks(r);
    return { r, rows };
  }
  async create(body) {
    if (body.confirmation !== "OK")
      throw Error(
        "Sicherung und kurze Authentik-Unterbrechung mit OK bestätigen.",
      );
    return this.hub.mutate(["Jellyfin"], async () => {
      const { r, rows } = await this.ready();
      if (this.list().length >= 100)
        throw Error(
          "Maximal 100 Sicherungseinträge unterstützt. Bestehende Sicherungen werden nicht automatisch gelöscht.",
        );
      const projectArgs = [
        "compose",
        "-f",
        path.join(r.directory, "compose.json"),
      ];
      const id = randomUUID();
      let stopped = false;
      // Validate passphrase before stopping authentication.
      const { requirePassphrase } = await import("./backup-format.js");
      requirePassphrase(body.passphrase);
      if (body.password && body.password === body.passphrase)
        throw Error(
          "Sicherungspassphrase und StackPilot-Passwort müssen verschieden sein.",
        );
      try {
        this.markMaintenance(r, true);
        stopped = true;
        await localDocker([...projectArgs, "stop", "server", "worker"], {
          timeout: 60000,
        });
        const db = rows.find(
          (v) => v.Config.Labels["com.docker.compose.service"] === "database",
        );
        const database = await dockerInput(
          [
            "exec",
            "-i",
            db.Id,
            "pg_dump",
            "-U",
            "postgres",
            "-d",
            "authentik",
            "--no-owner",
            "--no-privileges",
          ],
          "",
          { timeout: 60000, maxOutputBytes: 64 * 1024 * 1024 },
        );
        const files = [];
        let total = Buffer.byteLength(database);
        const walk = async (dir, prefix) => {
          for (const entry of await readdir(dir, { withFileTypes: true })) {
            const name = prefix + "/" + entry.name,
              full = path.join(dir, entry.name),
              stat = await lstat(full);
            if (
              stat.isSymbolicLink() ||
              (!stat.isDirectory() && !stat.isFile())
            )
              throw Error(
                "Sicherung enthält einen Link oder Spezialdateien. Nichts wurde ausgelassen.",
              );
            if (stat.isDirectory()) await walk(full, name);
            else {
              total += stat.size;
              if (total > 80 * 1024 * 1024 || files.length >= 10000)
                throw Error(
                  "Identitätsdaten überschreiten die unterstützte Sicherungsgröße. Nichts wurde ausgelassen.",
                );
              const bytes = await readFile(full);
              files.push({
                name,
                data: bytes.toString("base64"),
                sha256: sha256(bytes),
              });
            }
          }
        };
        for (const name of ["config", "blueprints", "secrets", "data", "media"])
          await walk(path.join(r.directory, name), name);
        const compose = JSON.parse(
          await readFile(path.join(r.directory, "compose.json"), "utf8"),
        );
        const images = Object.fromEntries(
          Object.entries(compose.services).map(([k, v]) => [k, v.image]),
        );
        const payload = {
          format: 1,
          createdAt: new Date().toISOString(),
          record: r,
          images,
          files,
          database,
        };
        validateBackup(payload, { id: r.id, images, hashes: r.hashes });
        const bytes = await encryptBackup(payload, body.passphrase);
        await mkdir(this.directory(), { recursive: true, mode: 0o700 });
        await writeFile(path.join(this.directory(), id + ".spbackup"), bytes, {
          mode: 0o600,
          flag: "wx",
        });
        const item = {
          id,
          identityId: r.id,
          createdAt: new Date().toISOString(),
          bytes: bytes.length,
          sha256: sha256(bytes),
          restore: { status: "untested" },
        };
        this.save([...this.list(), item]);
        return item;
      } finally {
        if (stopped) {
          try {
            await this.startAuthentication(projectArgs);
            this.markMaintenance(r, false);
          } catch {
            throw Error(
              "Authentik konnte nach der Sicherung nicht wieder gestartet werden. Gespeicherte Sicherungen bleiben erhalten; lokalen Betrieb fortsetzen.",
            );
          }
        }
      }
    });
  }
  async bytes(id) {
    if (!uuid.test(id || "")) throw Error("Ungültige Sicherungs-ID.");
    const item = this.list().find((v) => v.id === id);
    if (!item) throw Error("Sicherung nicht gefunden.");
    const file = path.join(this.directory(), id + ".spbackup");
    const stat = await lstat(file);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.mode & 0o077 ||
      stat.size > backupLimit
    )
      throw Error("Sicherungsdatei nicht ausreichend geschützt.");
    const bytes = await readFile(file);
    if (sha256(bytes) !== item.sha256)
      throw Error("Sicherungsdatei wurde geändert.");
    return bytes;
  }
  async verifyRestore(body) {
    if (body.confirmation !== "OK")
      throw Error("Isolierten Wiederherstellungstest mit OK bestätigen.");
    return this.hub.mutate(["Jellyfin"], async () => {
      const { r } = await this.ready();
      const original = JSON.parse(
        await readFile(path.join(r.directory, "compose.json"), "utf8"),
      );
      const images = Object.fromEntries(
        Object.entries(original.services).map(([k, v]) => [k, v.image]),
      );
      const value = validateBackup(
        await decryptBackup(await this.bytes(body.id), body.passphrase),
        { id: r.id, images, hashes: r.hashes },
      );
      const testRoot = await mkdtemp(
        path.join(this.hub.engine.store.directory, "identity-restore-"),
      );
      const project = "sp-restore-" + randomUUID().slice(0, 8);
      const file = path.join(testRoot, "compose.json");
      let started = false;
      let verified = false;
      const update = (status, message) => {
        const list = this.list(),
          entry = list.find((v) => v.id === body.id);
        entry.restore = {
          status,
          checkedAt: new Date().toISOString(),
          message,
        };
        this.save(list);
      };
      update("running", "Isolierter Wiederherstellungstest läuft.");
      try {
        for (const folder of [
          "config",
          "blueprints",
          "secrets",
          "data",
          "media",
          "database",
        ])
          await mkdir(path.join(testRoot, folder), { mode: 0o700 });
        for (const f of value.files) {
          const dest = path.join(testRoot, f.name);
          await mkdir(path.dirname(dest), { recursive: true, mode: 0o700 });
          await writeFile(dest, Buffer.from(f.data, "base64"), {
            flag: "wx",
            mode: 0o600,
          });
        }
        const compose = identityCompose(r.input);
        compose.name = project;
        // Separate sandbox: no host ports, no egress, no access to the original files.
        delete compose.networks.ingress;
        compose.networks.identity.ipam.config[0].subnet = "172.30.249.0/28";
        compose.services.gateway.networks = {
          identity: { ipv4_address: "172.30.249.10" },
        };
        delete compose.services.gateway.ports;
        for (const name of ["server", "worker"])
          compose.services[
            name
          ].environment.AUTHENTIK_LISTEN__TRUSTED_PROXY_CIDRS =
            "172.30.249.10/32";
        for (const s of Object.values(compose.services)) s.restart = "no";
        await writeFile(file, JSON.stringify(compose), {
          mode: 0o600,
          flag: "wx",
        });
        const args = ["compose", "-f", file];
        started = true;
        await localDocker(
          [...args, "up", "-d", "--no-build", "--pull", "never", "database"],
          { timeout: 60000 },
        );
        const wait = async (services) => {
          for (let i = 0; i < 90; i++) {
            const ids = (await localDocker([...args, "ps", "-q", ...services]))
              .trim()
              .split(/\s+/)
              .filter(Boolean);
            if (ids.length === services.length) {
              const rows = JSON.parse(await localDocker(["inspect", ...ids]));
              if (
                rows.every(
                  (v) =>
                    v.State.Running && v.State.Health?.Status === "healthy",
                )
              )
                return rows;
            }
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
          throw Error("Wiederhergestellte Dienste wurden nicht bereit.");
        };
        const [database] = await wait(["database"]);
        await dockerInput(
          [
            "exec",
            "-i",
            database.Id,
            "psql",
            "-U",
            "authentik",
            "-d",
            "authentik",
            "-v",
            "ON_ERROR_STOP=1",
          ],
          value.database,
          { timeout: 120000, maxOutputBytes: 8 * 1024 * 1024 },
        );
        await localDocker(
          [...args, "up", "-d", "--no-build", "--pull", "never"],
          { timeout: 60000 },
        );
        const rows = await wait(["server", "worker"]);
        const worker = rows.find(
          (v) => v.Config.Labels["com.docker.compose.service"] === "worker",
        );
        const output = await dockerInput(
          [
            "exec",
            "-i",
            worker.Id,
            "ak",
            "shell",
            "-c",
            "exec(__import__('sys').stdin.read())",
          ],
          await readFile(path.join(testRoot, "config/audit.py"), "utf8"),
          { timeout: 60000 },
        );
        if (!output.includes('"mfaRequired": true'))
          throw Error("Wiederhergestellte Schutzregeln nicht bestätigt.");
        verified = true;
      } catch {
        update(
          "failed",
          "Wiederherstellungstest nicht bestätigt. Originalinstallation wurde nicht ersetzt.",
        );
        throw Error(
          "Isolierter Wiederherstellungstest fehlgeschlagen. Originalinstallation blieb unverändert.",
        );
      } finally {
        try {
          if (started)
            await localDocker(["compose", "-f", file, "down"], {
              timeout: 120000,
            });
          await rm(testRoot, { recursive: true, force: true });
          if (verified)
            update(
              "passed",
              "Datenbank, private Schlüssel und Schutzregeln in separaten Containern wiederhergestellt und geprüft. Original blieb unverändert; Testinstanz entfernt.",
            );
        } catch {
          update(
            "failed",
            "Testinstanz konnte nicht vollständig aufgeräumt werden. Private Testdateien bleiben zur Prüfung erhalten; Original wurde nicht ersetzt.",
          );
          throw Error(
            "Wiederherstellungstest nicht vollständig abgeschlossen: isolierte Testinstanz lokal prüfen.",
          );
        }
      }
      return this.list().find((v) => v.id === body.id);
    });
  }
}
