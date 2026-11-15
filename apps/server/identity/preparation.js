import { ssoCompatibility } from "./sso-release.js";
import { dockerInput } from "../docker-io.js";
import {
  parseIdentityStatus,
  identitySecurityChecks,
} from "./security-status.js";
import { localIdentityRequest } from "./local-request.js";
import { localDocker } from "../retirement.js";
import { createServer } from "node:net";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { mkdir, writeFile, readFile, lstat } from "node:fs/promises";
import path from "node:path";
import {
  identityCompose,
  identityStartScript,
  publicLoginGateway,
  releases,
  validateIdentityInput,
} from "./config.js";
import { identityBlueprint } from "./blueprint.js";
const digest = (v) => createHash("sha256").update(v).digest("hex");
export class IdentityPreparation {
  constructor(hub, remote, docker = localDocker) {
    this.hub = hub;
    this.remote = remote;
    this.docker = docker;
    this.pending = null;
  }
  key(plan) {
    return `identity-preparation:${plan.rootId || plan.id}`;
  }
  current() {
    const current = this.hub.engine.current();
    return current ? this.hub.engine.vault.get(this.key(current.plan)) : null;
  }
  summary(record = this.current()) {
    if (!record) return { prepared: false, publicReady: false };
    return {
      prepared: true,
      id: record.id,
      createdAt: record.createdAt,
      status: record.status,
      running:
        !!this.pending ||
        (!!record.leaseOwner && this.hub.engine.store.owns(record.leaseOwner)),
      authentikVersion: releases.authentik.version,
      jellyfinVersion: record.jellyfinVersion,
      pluginCompatible: releases.ssoPlugin.testedJellyfinVersions.includes(
        record.jellyfinVersion,
      ),
      pluginLoadVerified: ssoCompatibility(record.jellyfinVersion).loadVerified,
      publicReady: false,
      hostname: record.input.hostname,
      adminUrl: `http://127.0.0.1:${record.input.adminPort}`,
      gatewayUrl: `http://127.0.0.1:${record.input.gatewayPort}`,
      directory: record.directory,
      blockers: [
        ...(!releases.ssoPlugin.testedJellyfinVersions.includes(
          record.jellyfinVersion,
        )
          ? [
              ssoCompatibility(record.jellyfinVersion).loadVerified
                ? `SSO-Plugin ${releases.ssoPlugin.version}: Ladetest mit Jellyfin ${record.jellyfinVersion} bestanden. Vollständige SSO-Anmeldung und Passwort-Umgehungsschutz sind noch nicht bestätigt; keine automatische Installation.`
                : `SSO-Plugin ${releases.ssoPlugin.version} ist für Jellyfin ${record.jellyfinVersion || "unbekannt"} nicht freigegeben. Keine automatische Plugin-Installation.`,
            ]
          : []),
        "Ein geprüftes Jellyfin-Schutz-Gateway muss direkte Passwortanmeldung auch während der Kontoanlage sperren. Vor öffentlicher Freigabe separat bereitstellen und prüfen.",
        "Aegis/Passkey-Einrichtung und Wiederherstellungscodes müssen privat abgeschlossen werden.",
        "Öffentliche Gateway-, Passwort-Bypass-, Proxy- und Client-Abnahme sowie vollständige Wiederherstellung stehen noch aus.",
      ],
      steps: record.steps || [],
      error: record.error || null,
    };
  }
  async prepare() {
    return this.hub.mutate(["Jellyfin"], async ({ plan }) => {
      const old = this.current();
      if (old) return this.summary(old);
      const report = await this.remote.inspect();
      if (
        !report.tailscaleRunning ||
        !report.hostname ||
        !report.target ||
        !report.jellyfin?.version
      )
        throw Error("Tailscale und Jellyfin zuerst erfolgreich prüfen.");
      if (!report.serveKnown || !report.serve.exclusive || report.serve.public)
        throw Error(
          "Vorhandene Freigaben zuerst prüfen. Für die Vorbereitung wird eine bekannte, nicht öffentliche Ausgangslage benötigt.",
        );
      const input = validateIdentityInput({
        hostname: report.hostname,
        uid: process.getuid(),
        gid: process.getgid(),
      });
      const id = randomUUID(),
        directory = path.join(
          this.hub.engine.store.directory,
          "identity-secrets",
          id,
        ),
        secrets = this.hub.engine.vault.ensure(`identity-secrets:${id}`, () =>
          Object.fromEntries(
            [
              "database_password",
              "database_admin_password",
              "secret_key",
              "admin_password",
              "oidc_secret",
            ].map((k) => [k, randomBytes(48).toString("base64url")]),
          ),
        );
      await mkdir(directory, { recursive: true, mode: 0o700 });
      for (const name of [
        "config",
        "blueprints",
        "secrets",
        "data",
        "media",
        "database",
      ])
        await mkdir(path.join(directory, name), { mode: 0o700 });
      const compose = identityCompose(input);
      compose.name = "sp-identity-" + id.slice(0, 8);
      for (const svc of Object.values(compose.services))
        svc.labels = { "io.stackpilot.identity": id, "io.stackpilot.plan": id };
      const files = {
        "compose.json": JSON.stringify(compose, null, 2),
        "config/start.py": identityStartScript,
        "config/audit.py": await readFile(
          new URL("./audit.py", import.meta.url),
          "utf8",
        ),
        "config/public-login.conf": publicLoginGateway(input),
        "blueprints/stackpilot.yaml": identityBlueprint(input),
        "secrets/initialize.sql": `CREATE ROLE authentik LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${secrets.database_password}';\nALTER DATABASE authentik OWNER TO authentik;\nREVOKE ALL ON DATABASE authentik FROM PUBLIC;\n`,
        ...Object.fromEntries(
          Object.entries(secrets).map(([k, v]) => ["secrets/" + k, v + "\n"]),
        ),
      };
      const hashes = {};
      for (const [name, content] of Object.entries(files)) {
        await writeFile(path.join(directory, name), content, {
          flag: "wx",
          mode: 0o600,
        });
        hashes[name] = digest(content);
      }
      const record = {
        id,
        stackPlanId: plan.id,
        rootId: plan.rootId || plan.id,
        project: compose.name,
        directory,
        input,
        hashes,
        jellyfinVersion: report.jellyfin.version,
        createdAt: new Date().toISOString(),
        status: "prepared",
        steps: [],
        error: null,
      };
      this.hub.engine.vault.set(this.key(plan), record);
      return this.summary(record);
    });
  }
  async verify(record = this.current()) {
    if (!record) throw Error("Zuerst die Konfiguration vorbereiten.");
    for (const [name, hash] of Object.entries(record.hashes)) {
      const file = path.join(record.directory, name),
        stat = await lstat(file);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        (stat.mode & 0o077) !== 0 ||
        digest(await readFile(file)) !== hash
      )
        throw Error(
          "Private Identitätskonfiguration wurde geändert oder ist nicht ausreichend geschützt. Keine automatische Überschreibung.",
        );
    }
    return record;
  }
  async start(body) {
    if (body.confirmation !== "OK")
      throw Error("Lokale Installation mit OK bestätigen.");
    if (this.pending) return this.summary();
    const record = await this.verify();
    const current = this.hub.engine.current();
    if (
      record.id !== body.id ||
      (current?.plan.rootId || current?.plan.id) !== record.rootId ||
      current.job.status !== "completed"
    )
      throw Error(
        "Stack oder Konfiguration wurde geändert. Vorbereiteten Entwurf prüfen.",
      );
    if (record.status === "local-ready") return this.summary(record);
    const owner = "identity:" + randomUUID();
    if (!this.hub.engine.store.claim(owner))
      throw Error("Ein anderer Auftrag läuft. Danach erneut versuchen.");
    record.leaseOwner = owner;
    record.status = "installing";
    record.error = null;
    this.save(record);
    this.pending = this.run(record, owner)
      .catch(() => {})
      .finally(() => {
        this.pending = null;
      });
    return this.summary(record);
  }
  save(record) {
    const current = this.hub.engine.current();
    if (
      !current ||
      this.key(current.plan) !== `identity-preparation:${record.rootId}`
    )
      throw Error("Stack geändert");
    this.hub.engine.vault.set(this.key(current.plan), record);
  }
  async containers(record, complete = false) {
    const ids = (
      await this.docker([
        "ps",
        "-aq",
        "--filter",
        `label=com.docker.compose.project=${record.project}`,
      ])
    )
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (ids.some((v) => !/^[a-f0-9]{12,64}$/.test(v)))
      throw Error("Containerliste ungültig");
    if (!ids.length) {
      if (complete) throw Error("Container fehlen");
      return [];
    }
    const rows = JSON.parse(await this.docker(["inspect", ...ids]));
    const compose = JSON.parse(
      await readFile(path.join(record.directory, "compose.json"), "utf8"),
    );
    if (!Array.isArray(rows) || (complete && rows.length !== 4))
      throw Error("Unvollständige Identitätsdienste");
    for (const row of rows) {
      const service = row.Config?.Labels?.["com.docker.compose.service"],
        expected = compose.services[service];
      if (
        !expected ||
        row.Config.Labels["io.stackpilot.identity"] !== record.id ||
        row.Config.Image !== expected.image ||
        row.Config.User !== expected.user ||
        row.HostConfig.Privileged ||
        !row.HostConfig.ReadonlyRootfs ||
        row.HostConfig.CapAdd?.length ||
        !row.HostConfig.CapDrop?.includes("ALL") ||
        !row.HostConfig.SecurityOpt?.includes("no-new-privileges:true")
      )
        throw Error(
          "Identitätscontainer weicht von geprüfter Konfiguration ab",
        );
      const expectedMounts = new Map(
        expected.volumes.map((v) => {
          const [source, target, mode] = v.split(":");
          return [
            target,
            {
              source: path.resolve(record.directory, source),
              rw: mode !== "ro",
            },
          ];
        }),
      );
      for (const mount of row.Mounts) {
        if (mount.Type === "tmpfs") continue;
        const m = expectedMounts.get(mount.Destination);
        if (!m || m.source !== mount.Source || m.rw !== mount.RW)
          throw Error("Unerwarteter Mount");
        expectedMounts.delete(mount.Destination);
      }
      if (expectedMounts.size) throw Error("Mount fehlt");
      const bindings = row.HostConfig.PortBindings || {},
        expectedPorts = expected.ports || [];
      if (Object.keys(bindings).length !== expectedPorts.length)
        throw Error("Unerwarteter Webport");
      for (const binding of expectedPorts) {
        const [ip, host, container] = binding.split(":"),
          actual = bindings[container + "/tcp"];
        if (
          actual?.length !== 1 ||
          actual[0].HostIp !== ip ||
          actual[0].HostPort !== host
        )
          throw Error("Identitätsport ist nicht ausschließlich lokal");
      }
      for (const [port, bindings] of Object.entries(
        row.HostConfig.PortBindings || {},
      ))
        if (
          bindings?.length &&
          (row.NetworkSettings.Ports?.[port]?.length !== 1 ||
            row.NetworkSettings.Ports[port][0].HostIp !== "127.0.0.1" ||
            row.NetworkSettings.Ports[port][0].HostPort !==
              bindings[0].HostPort)
        )
          throw Error("Lokaler Port wurde nicht effektiv bereitgestellt");
      const networks = Object.keys(row.NetworkSettings.Networks || {}).sort();
      const expectedNetworks = (
        Array.isArray(expected.networks)
          ? expected.networks
          : Object.keys(expected.networks)
      )
        .map((n) => record.project + "_" + n)
        .sort();
      if (JSON.stringify(networks) !== JSON.stringify(expectedNetworks))
        throw Error("Unerwartetes Netzwerk");
      for (const [key, value] of Object.entries(expected.environment || {}))
        if (!row.Config.Env?.includes(key + "=" + value))
          throw Error("Identitätsumgebung verändert");
    }
    return rows;
  }
  async networks(record) {
    const rows = JSON.parse(
      await this.docker([
        "network",
        "inspect",
        record.project + "_identity",
        record.project + "_ingress",
      ]),
    );
    if (!Array.isArray(rows) || rows.length !== 2)
      throw Error("Identitätsnetze nicht bestätigt");
    for (const row of rows) {
      const internal = row.Name === record.project + "_identity";
      if (
        row.Driver !== "bridge" ||
        row.Internal !== internal ||
        row.EnableIPv6 ||
        row.Labels?.["com.docker.compose.project"] !== record.project
      )
        throw Error("Identitätsnetz weicht vom Schutzkonzept ab");
      if (
        internal &&
        (row.IPAM?.Config?.length !== 1 ||
          row.IPAM.Config[0].Subnet !== "172.30.248.0/28")
      )
        throw Error("Internes Identitätsnetz verändert");
    }
    const containers = await this.containers(record, true);
    const gateway = containers.find(
      (r) => r.Config.Labels["com.docker.compose.service"] === "gateway",
    );
    if (
      gateway?.NetworkSettings.Networks[record.project + "_identity"]
        ?.IPAddress !== "172.30.248.10"
    )
      throw Error("Vertrauenswürdiger Proxy hat eine andere Adresse");
  }
  async checkGateway(record) {
    const base = `http://127.0.0.1:${record.input.gatewayPort}`;
    for (const route of [
      "/if/admin/",
      "/api/v3/core/users/",
      "/api/v3/core/tokens/",
      "/if/flow/default-authentication-flow/",
      "/api/v3/flows/executor/stackpilot-admin-login/",
      "/if/flow/stackpilot-admin-login/",
    ]) {
      const response = await localIdentityRequest(base + route, {
        headers: { Host: record.input.hostname },
        signal: AbortSignal.timeout(5000),
      });
      await response.arrayBuffer();
      if (response.status !== 404)
        throw Error("Verwaltungspfad öffentlich erreichbar");
    }
    for (const [route, host, status] of [
      ["/api/v3/root/config/", record.input.hostname, 200],
      ["/healthz", "untrusted.invalid", 421],
    ]) {
      const response = await localIdentityRequest(base + route, {
        headers: { Host: host },
        signal: AbortSignal.timeout(5000),
      });
      await response.arrayBuffer();
      if (response.status !== status)
        throw Error("Login-Gateway nicht bestätigt");
    }
  }
  async inspectSecurity({ alreadyLocked = false } = {}) {
    const inspect = async ({ plan }) => {
      const record = await this.verify();
      if (
        // Authentik gehört zum Stack, nicht zu einer einzelnen Planfassung: Spätere Pläne
        // (Erweiterung, Netztrennung) behalten dieselbe rootId.
        record.rootId !== (plan.rootId || plan.id) ||
        record.status !== "local-ready" ||
        this.pending
      )
        throw Error("Authentik zuerst lokal fertig einrichten.");
      try {
        await this.networks(record);
        const rows = await this.containers(record, true);
        if (
          rows.some(
            (r) =>
              !r.State.Running ||
              r.State.Restarting ||
              (r.Config.Labels["com.docker.compose.service"] !== "gateway" &&
                r.State.Health?.Status !== "healthy"),
          )
        )
          throw Error("Identitätsdienst nicht bereit");
        await this.checkGateway(record);
        const worker = rows.find(
          (r) => r.Config.Labels["com.docker.compose.service"] === "worker",
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
          await readFile(
            new URL("./security-status.py", import.meta.url),
            "utf8",
          ),
          { timeout: 60000 },
        );
        const status = parseIdentityStatus(output);
        return {
          checkedAt: new Date().toISOString(),
          publicReady: false,
          checks: [
            {
              name: "Lokale Abschottung",
              state: "ok",
              message:
                "Container, interne Netzgrenze und Gateway wurden gerade geprüft.",
            },
            ...identitySecurityChecks(status),
          ],
        };
      } catch {
        throw Error(
          "Aktueller Sicherheitsstand konnte nicht bestätigt werden. Dienste, private Dateien und lokale Konfiguration prüfen. Öffentliche Freigabe bleibt gesperrt.",
        );
      }
    };
    return alreadyLocked
      ? inspect(await this.hub.context(["Jellyfin"]))
      : this.hub.mutate(["Jellyfin"], inspect);
  }
  async run(record, owner) {
    let leaseLost = false;
    const timer = setInterval(() => {
      try {
        if (!this.hub.engine.store.claim(owner)) leaseLost = true;
      } catch {
        leaseLost = true;
      }
    }, 10000);
    timer.unref?.();
    const args = ["compose", "-f", path.join(record.directory, "compose.json")];
    const phase = async (id, label, fn) => {
      if (leaseLost || !this.hub.engine.store.owns(owner))
        throw Error("Auftragssperre verloren");
      record.steps.push({ id, label, status: "running" });
      this.save(record);
      await fn();
      if (leaseLost || !this.hub.engine.store.owns(owner))
        throw Error("Auftragssperre verloren");
      record.steps.at(-1).status = "completed";
      this.save(record);
    };
    try {
      await phase(
        "verify",
        "Private Dateien und bestehende Container prüfen",
        async () => {
          await this.verify(record);
          const rows = await this.containers(record);
          if (!rows.length)
            for (const port of [
              record.input.adminPort,
              record.input.gatewayPort,
            ])
              await new Promise((resolve, reject) => {
                const server = createServer();
                server.once("error", () =>
                  reject(Error("Lokaler Port belegt")),
                );
                server.listen(port, "127.0.0.1", () => server.close(resolve));
              });
        },
      );
      await phase("pull", "Festgelegte Identitäts-Images laden", () =>
        this.docker([...args, "pull"], { timeout: 300000 }),
      );
      await phase("start", "Authentik ausschließlich lokal starten", () =>
        this.docker([...args, "up", "-d", "--no-build", "--pull", "never"], {
          timeout: 120000,
        }),
      );
      await phase(
        "health",
        "Container und lokale Bereitschaft prüfen",
        async () => {
          for (let i = 0; i < 90; i++) {
            const rows = await this.containers(record, true);
            if (
              rows.every((r) => r.State.Running && !r.State.Restarting) &&
              rows
                .filter(
                  (r) =>
                    r.Config.Labels["com.docker.compose.service"] !== "gateway",
                )
                .every((r) => r.State.Health?.Status === "healthy")
            )
              return;
            await new Promise((r) => setTimeout(r, 2000));
          }
          throw Error("Identitätsdienste werden nicht bereit");
        },
      );
      await phase("bootstrap", "Authentik-Grundobjekte abwarten", async () => {
        for (let i = 0; i < 20; i++) {
          try {
            await this.docker(
              [
                ...args,
                "exec",
                "-T",
                "worker",
                "python",
                "/stackpilot/start.py",
                "prerequisites",
              ],
              { timeout: 30000 },
            );
            return;
          } catch {
            await new Promise((r) => setTimeout(r, 2000));
          }
        }
        throw Error("Authentik-Grundobjekte fehlen");
      });
      await phase(
        "blueprint",
        "Verpflichtende MFA- und OIDC-Regeln anwenden",
        async () => {
          for (const action of ["blueprint-check", "blueprint-apply"])
            await this.docker(
              [
                ...args,
                "exec",
                "-T",
                "worker",
                "python",
                "/stackpilot/start.py",
                action,
              ],
              { timeout: 120000 },
            );
        },
      );
      await phase(
        "audit",
        "Tatsächliche Sicherheitsregeln zurücklesen",
        async () => {
          await this.containers(record, true);
          await this.networks(record);
          const output = await this.docker(
            [
              ...args,
              "exec",
              "-T",
              "worker",
              "ak",
              "shell",
              "-c",
              "exec(open('/stackpilot/audit.py').read())",
            ],
            { timeout: 60000 },
          );
          if (
            !output.includes('"mfaRequired": true') ||
            !output.includes('"publicReady": false')
          )
            throw Error("MFA-Regeln nicht bestätigt");
        },
      );
      await phase(
        "gateway",
        "Öffentliche Login-Grenze lokal prüfen",
        async () => {
          await this.docker([...args, "exec", "-T", "gateway", "nginx", "-t"], {
            timeout: 10000,
          });
          await this.checkGateway(record);
        },
      );
      record.status = "local-ready";
      record.error = null;
      this.save(record);
    } catch {
      record.status = "failed";
      if (record.steps.at(-1)?.status === "running")
        record.steps.at(-1).status = "failed";
      record.error =
        "Lokale Einrichtung konnte in diesem Schritt nicht bestätigt werden. Keine öffentliche Freigabe wurde erzeugt. Unveränderten Auftrag gezielt fortsetzen; Konfiguration und Daten werden nicht gelöscht.";
      this.save(record);
    } finally {
      clearInterval(timer);
      this.hub.engine.store.release(owner);
    }
  }
  credentials() {
    const record = this.current();
    if (!record || record.status !== "local-ready")
      throw Error("Authentik zuerst lokal fertig einrichten.");
    const secrets = this.hub.engine.vault.get(`identity-secrets:${record.id}`);
    return {
      username: "akadmin",
      password: secrets.admin_password,
      url: `http://127.0.0.1:${record.input.adminPort}`,
    };
  }
}
