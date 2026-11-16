// Couchdeck als App des Stacks: Zustand lesen, starten/schließen, installieren/entfernen
// und mit Jellyfin und Seerr verbinden.
//
// Start und Schließen brauchen keine Root-Rechte: StackPilot und Couchdeck teilen sich den
// Ordner /var/lib/couchdeck (Gruppe couchdeck-link). Installation und Entfernen laufen über
// die begrenzte Root-Hilfe (deploy/root-helper.sh).
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, writeFile, rename, unlink, chmod, access, constants } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execute = promisify(execFile);
export const livingRoomUser = "wohnzimmer";
const helperJobs = {
  install: "couchdeck-install",
  "install-youtube": "couchdeck-install-youtube",
  remove: "couchdeck-remove",
};
const userFacing = (message) => Object.assign(Error(message), { userFacing: true });

async function systemctl(args) {
  try {
    const { stdout } = await execute("systemctl", args, { timeout: 15000, encoding: "utf8" });
    return { ok: true, output: stdout };
  } catch (e) {
    return { ok: false, output: `${e.stdout || ""}${e.stderr || ""}` };
  }
}

export class Couchdeck {
  constructor(hub, options = {}) {
    this.hub = hub;
    this.linkDir = options.linkDir || process.env.COUCHDECK_LINK_DIR || "/var/lib/couchdeck";
    this.appDir = options.appDir || "/opt/couchdeck/app";
    // Die mit StackPilot ausgelieferte Fassung; weicht die installierte ab, wird aktualisiert.
    this.bundledDir =
      options.bundledDir || fileURLToPath(new URL("../couchdeck/", import.meta.url));
    this.systemctl = options.systemctl || systemctl;
  }
  get controlDir() {
    return path.join(this.linkDir, "control");
  }
  get offFlag() {
    return path.join(this.controlDir, "off");
  }
  get integrationFile() {
    return path.join(this.linkDir, "integration.json");
  }
  async exists(file, mode = constants.F_OK) {
    try {
      await access(file, mode);
      return true;
    } catch {
      return false;
    }
  }
  /** Läuft gerade ein Auftrag der Root-Hilfe, und wie ging der letzte aus? */
  async helper() {
    const result = { available: false, running: null, failed: null };
    for (const [name, job] of Object.entries(helperJobs)) {
      const r = await this.systemctl([
        "show",
        `stackpilot-root@${job}.service`,
        "-p",
        "LoadState,ActiveState,Result",
      ]);
      if (!r.ok) continue;
      const fields = Object.fromEntries(
        r.output
          .trim()
          .split("\n")
          .map((line) => line.split("=")),
      );
      if (fields.LoadState === "loaded") result.available = true;
      if (["activating", "active"].includes(fields.ActiveState)) result.running = name;
      else if (fields.ActiveState === "failed") result.failed = name;
    }
    return result;
  }
  async status() {
    let version = null;
    try {
      version = JSON.parse(await readFile(path.join(this.appDir, "package.json"), "utf8")).version;
    } catch {}
    const installed = typeof version === "string";
    let bundled = null;
    try {
      bundled = JSON.parse(await readFile(path.join(this.bundledDir, "package.json"), "utf8")).version;
    } catch {}
    const outdated = installed && typeof bundled === "string" && bundled !== version;
    const controllable = await this.exists(this.controlDir, constants.W_OK);
    let state = null,
      since = null;
    try {
      const [word, time] = (await readFile(path.join(this.controlDir, "state"), "utf8"))
        .trim()
        .split(/\s+/);
      if (["running", "off", "no-display"].includes(word)) state = word;
      since = time || null;
    } catch {}
    const off = await this.exists(this.offFlag);
    let linked = null;
    try {
      const link = JSON.parse(await readFile(this.integrationFile, "utf8"));
      linked = {
        at: link.writtenAt || null,
        user: link.auth?.userName || null,
        seerr: !!(link.seerr?.apiKey || link.seerr?.personalSession),
      };
    } catch {}
    return {
      installed,
      version,
      outdated,
      controllable,
      // Was die Startschleife zuletzt gemeldet hat; "off" gilt sofort, sobald der Merker liegt.
      state: !installed ? "missing" : off ? "off" : state || "unknown",
      since,
      linked,
      helper: await this.helper(),
    };
  }
  async requireControl() {
    if (!(await this.exists(this.controlDir, constants.W_OK)))
      throw userFacing(
        "Couchdeck ist nicht installiert oder der gemeinsame Steuerordner fehlt.",
      );
  }
  /** Schließen: Die Startschleife beendet Couchdeck sauber und wartet. */
  async stop() {
    await this.requireControl();
    await writeFile(this.offFlag, new Date().toISOString() + "\n", { mode: 0o660 });
    return this.status();
  }
  /** Starten: Merker entfernen; Couchdeck erscheint, sobald ein Bildschirm an ist. */
  async start() {
    await this.requireControl();
    await unlink(this.offFlag).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
    return this.status();
  }
  /** Neu starten, damit Couchdeck eine geänderte Übergabe einliest. */
  async restart() {
    await this.stop();
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const word = await readFile(path.join(this.controlDir, "state"), "utf8")
        .then((text) => text.trim().split(/\s+/)[0])
        .catch(() => null);
      if (word !== "running") break;
    }
    return this.start();
  }
  async runHelper(name) {
    const job = helperJobs[name];
    if (!job) throw userFacing("Unbekannter Auftrag.");
    const helper = await this.helper();
    if (!helper.available)
      throw userFacing(
        "Die Root-Hilfe fehlt. StackPilot einmal mit install.sh einrichten.",
      );
    if (helper.running) throw userFacing("Es läuft bereits ein Couchdeck-Auftrag.");
    await this.systemctl(["reset-failed", `stackpilot-root@${job}.service`]);
    const r = await this.systemctl(["start", "--no-block", `stackpilot-root@${job}.service`]);
    if (!r.ok)
      throw userFacing(
        "Der Auftrag wurde nicht angenommen. Berechtigung der Root-Hilfe prüfen (install.sh erneut ausführen).",
      );
    return this.status();
  }
  /** Für den Installationsauftrag: installieren und warten, bis die Root-Hilfe fertig ist. */
  async ensureInstalled(youtube = false, { timeoutMs = 20 * 60000, pollMs = 3000 } = {}) {
    const before = await this.status();
    if (before.installed && !before.outdated) return;
    await this.runHelper(youtube ? "install-youtube" : "install");
    const end = Date.now() + timeoutMs;
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, pollMs));
      if ((await this.status()).helper.running) {
        if (Date.now() > end) throw Error("Couchdeck-Installation dauert zu lange.");
        continue;
      }
      // Erst nach dem Ende der Hilfe neu lesen, sonst kann das Ergebnis veraltet sein.
      const state = await this.status();
      {
        if (state.installed && !state.outdated && !state.helper.failed) return;
        throw Error(
          "Couchdeck konnte nicht installiert werden. Details am Server: journalctl -u 'stackpilot-root@*' -n 40",
        );
      }
    }
  }
  install(youtube = false) {
    return this.runHelper(youtube ? "install-youtube" : "install");
  }
  async remove() {
    await unlink(this.integrationFile).catch(() => {});
    return this.runHelper("remove");
  }

  /**
   * Couchdeck mit dem Stack verbinden: Adressen, Wohnzimmer-Konto und Seerr-Zugang in die
   * Übergabedatei schreiben. Wiederholbar; ein noch gültiger Zugang wird weiterverwendet.
   */
  async link() {
    if (!(await this.exists(this.linkDir, constants.W_OK)))
      throw userFacing("Couchdeck ist nicht installiert oder der Übergabeordner fehlt.");
    return this.hub.mutate(["Jellyfin"], (context) => this.linkWith(context));
  }
  async mediaOwner(token) {
    if (typeof token !== "string" || !/^[a-f0-9]{32}$/i.test(token)) return null;
    const { plan, s } = await this.hub.context(["Jellyfin"]);
    const link = s.vault.get(`deployment:${plan.rootId || plan.id}:couchdeck`);
    if (!link?.userId || typeof link.token !== "string" || link.token.length !== token.length ||
        !timingSafeEqual(Buffer.from(link.token), Buffer.from(token))) return null;
    const user = await s.request("Jellyfin", "/Users/Me", {
      headers: { Authorization: `MediaBrowser Client="StackPilot", Device="Couchdeck", DeviceId="${link.deviceId}", Version="0.2.1", Token="${token}"` },
    });
    return user?.Id === link.userId && user.Policy?.IsAdministrator === false ? user.Id : null;
  }
  /** Wie link(), aber innerhalb eines Auftrags, der die Sperre schon hält. */
  async linkWith({ plan, s }) {
    if (!(await this.exists(this.linkDir, constants.W_OK)))
      throw userFacing("Couchdeck ist nicht installiert oder der Übergabeordner fehlt.");
    {
      const rootId = plan.rootId || plan.id;
      const key = `deployment:${rootId}:couchdeck`;
      const saved = s.vault.ensure(key, () => ({
        password: randomBytes(24).toString("base64url"),
        deviceId: "couchdeck-" + randomBytes(8).toString("hex"),
      }));
      const admin = await s.additional.jellyfinLogin("couchdeck-setup");
      const adminHeader = {
        Authorization: `MediaBrowser Client="StackPilot", Device="couchdeck-setup", DeviceId="stackpilot-couchdeck-setup", Version="0.1.0", Token="${admin.AccessToken}"`,
      };
      // 1. Wohnzimmer-Konto: normaler Benutzer ohne Verwaltungsrechte
      const users = await s.request("Jellyfin", "/Users", { headers: adminHeader });
      let user = users.find((u) => u.Name?.toLowerCase() === livingRoomUser);
      if (user && !saved.userId)
        throw userFacing(
          `In Jellyfin gibt es schon einen Benutzer „${livingRoomUser}“, den StackPilot nicht angelegt hat. Er wird nicht übernommen.`,
        );
      if (!user) {
        user = await s.request("Jellyfin", "/Users/New", {
          method: "POST",
          headers: adminHeader,
          body: { Name: livingRoomUser, Password: saved.password },
        });
        saved.userId = user.Id;
        delete saved.token;
        s.vault.set(key, saved);
      }
      if (user.Id !== saved.userId || user.Policy?.IsAdministrator)
        throw userFacing("Das Wohnzimmer-Konto wurde verändert. Bitte in Jellyfin prüfen.");
      // 2. Gerätezugang für Couchdeck – vorhandenen weiterverwenden, solange Jellyfin ihn annimmt
      const device = `MediaBrowser Client="Couchdeck", Device="Couchdeck", DeviceId="${saved.deviceId}", Version="0.1.0"`;
      let valid = false;
      if (saved.token)
        valid = await s
          .request("Jellyfin", "/Users/Me", {
            headers: { Authorization: `${device}, Token="${saved.token}"` },
          })
          .then((me) => me?.Id === saved.userId)
          .catch(() => false);
      if (!valid) {
        const login = await s.request("Jellyfin", "/Users/AuthenticateByName", {
          method: "POST",
          headers: { Authorization: device },
          body: { Username: livingRoomUser, Pw: saved.password },
        });
        saved.token = login.AccessToken;
        s.vault.set(key, saved);
      }
      // 3. Seerr: Wohnzimmer-Konto übernehmen und den von Couchdeck unterstützten Zugang wählen
      let seerr = null;
      if (plan.spec.selected.includes("Seerr")) {

        const normalize = (id) => String(id || "").toLowerCase().replaceAll("-", "");
        const list = await s.additional.seerr("/user?take=100&skip=0");
        if (!(list.results || []).some((u) => normalize(u.jellyfinUserId) === normalize(saved.userId)))
          await s.additional.seerr("/user/import-from-jellyfin", {
            method: "POST",
            body: { jellyfinUserIds: [saved.userId] },
          });
        seerr = { url: `http://127.0.0.1:${plan.ports.Seerr}` };
        const { version } = await this.status();
        const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(version || "");
        const supportsPersonalSession = parts && (
          Number(parts[1]) > 0 || Number(parts[2]) > 2 ||
          (Number(parts[2]) === 2 && Number(parts[3]) >= 3)
        );
        if (supportsPersonalSession) seerr.personalSession = true;
        else {
          const main = await s.additional.seerr("/settings/main");
          if (typeof main?.apiKey !== "string" || !main.apiKey)
            throw userFacing("Seerr liefert keinen API-Schlüssel.");
          seerr.apiKey = main.apiKey;
        }
      }
      // 4. Übergabedatei: nur für die Gruppe couchdeck-link lesbar
      const pings = {
        Jellyfin: "/health",
        Seerr: "/api/v1/status",
        Sonarr: "/ping",
        Radarr: "/ping",
        Lidarr: "/ping",
        Prowlarr: "/ping",
        Bazarr: "/",
        qBittorrent: "/",
      };
      const link = {
        version: 1,
        writtenAt: new Date().toISOString(),
        stack: rootId,
        jellyfinUrl: `http://127.0.0.1:${plan.ports.Jellyfin}`,
        deviceId: saved.deviceId,
        auth: { userId: saved.userId, userName: livingRoomUser, token: saved.token },
        seerr,
        services: Object.fromEntries(
          plan.spec.selected
            .filter((name) => pings[name])
            .map((name) => [name, `http://127.0.0.1:${plan.ports[name]}${pings[name]}`]),
        ),
      };
      const temp = `${this.integrationFile}.${randomBytes(6).toString("hex")}.tmp`;
      await writeFile(temp, JSON.stringify(link, null, 2), { mode: 0o640 });
      await chmod(temp, 0o640);
      await rename(temp, this.integrationFile);
      // Ein neuer Zugang wird erst beim nächsten Start von Couchdeck übernommen.
      const before = await this.status();
      if (!valid && before.state === "running") return this.restart();
      return before;
    }
  }
}
