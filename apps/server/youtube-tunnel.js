// Eigener VPN-Tunnel nur für YouTube (Couchdeck), getrennt vom qBittorrent-Tunnel (Gluetun).
// wireproxy ist ein WireGuard-Client ganz im Benutzerraum: kein root, kein NET_ADMIN, keine
// Änderung an Routen oder Firewall des Servers. Er bietet nur einen lokalen HTTP-Proxy
// (127.0.0.1, mit Zugangsdaten) an – über den Tunnel geht ausschließlich, was StackPilots
// YouTube-Weiterleitung ausdrücklich dorthin schickt.
//
// Genutzt werden alle importierten VPN-Profile außer dem von qBittorrent (derselbe
// WireGuard-Schlüssel darf nicht zweimal gleichzeitig verbunden sein). Sperrt YouTube die
// Adresse eines Profils, schaltet next() zum nächsten Profil weiter.
import { spawn as nodeSpawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile, chmod, rm, access, constants } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { listVpnProfiles } from "./vpn.js";

export const WIREPROXY = process.env.STACKPILOT_WIREPROXY || "/opt/stackpilot/bin/wireproxy";
const MULLVAD_DNS = "10.64.0.1"; // Resolver im Mullvad-Tunnel: auch Namen gehen durch den Tunnel
const READY_TIMEOUT = 15000;

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

/** wireproxy-Konfiguration aus einem gespeicherten (bereits geprüften) Profil. */
export function wireproxyConfig(profile, { httpPort, user, pass }) {
  const iface = profile.config.replace(/^\[Interface\]\n/, `[Interface]\nDNS = ${MULLVAD_DNS}\nCheckAlive = ${MULLVAD_DNS}\nCheckAliveInterval = 5\n`);
  if (iface === profile.config) throw new Error("VPN-Profil hat kein gültiges Format.");
  return `${iface}\n[http]\nBindAddress = 127.0.0.1:${httpPort}\nUsername = ${user}\nPassword = ${pass}\n`;
}

export class YouTubeTunnel {
  constructor(engine, { binary = WIREPROXY, dir = null, spawn = nodeSpawn, fetchImpl = fetch } = {}) {
    this.engine = engine;
    this.binary = binary;
    this.dir = dir || path.join(engine.store?.directory || "/tmp", "youtube-tunnel");
    this.spawn = spawn;
    this.fetch = fetchImpl;
    this.current = null; // { profileId, name, httpPort, user, pass, child }
    this.index = 0;
    this.starting = null;
  }

  /**
   * Auswahl für YouTube: "auto" = alle Profile außer dem von qBittorrent (wechselt bei Sperre),
   * "profile" = genau ein Profil, "shared" = den qBittorrent-Tunnel mitnutzen (kein eigener).
   */
  settings() {
    const s = this.engine.vault.get("youtube-vpn-settings") || {};
    return { mode: ["auto", "profile", "shared"].includes(s.mode) ? s.mode : "auto", profileId: s.profileId || null };
  }

  saveSettings({ mode, profileId } = {}) {
    if (!["auto", "profile", "shared"].includes(mode)) throw Object.assign(Error("Unbekannte Auswahl."), { userFacing: true });
    const free = this.free();
    if (mode === "profile" && !free.some((p) => p.id === profileId))
      throw Object.assign(Error("Dieses Profil steht für YouTube nicht zur Verfügung."), { userFacing: true });
    this.engine.vault.set("youtube-vpn-settings", { mode, profileId: mode === "profile" ? profileId : null });
    this.stop(); // startet beim nächsten Abruf mit der neuen Auswahl
    this.index = 0;
    return this.settings();
  }

  /** Profile, die YouTube überhaupt nutzen darf: alle außer dem von qBittorrent. */
  free() {
    const current = this.engine.current?.();
    const plan = current?.job?.status === "completed" ? current.plan : null;
    return listVpnProfiles(this.engine.vault, plan).filter((p) => !p.qbittorrent);
  }

  /** Profile für den eigenen YouTube-Tunnel gemäß Auswahl. */
  pool() {
    const { mode, profileId } = this.settings();
    if (mode === "shared") return [];
    const free = this.free();
    if (mode === "profile") {
      const one = free.filter((p) => p.id === profileId);
      if (one.length) return one;
    }
    return free;
  }

  async programInstalled() {
    try {
      await access(this.binary, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  async available() {
    return (await this.programInstalled()) && this.pool().length > 0;
  }

  status() {
    const pool = this.pool();
    return {
      ...this.settings(),
      profiles: pool.length,
      poolIds: pool.map((p) => p.id),
      active: this.current ? { name: this.current.name, position: pool.findIndex((p) => p.id === this.current.profileId) + 1 } : null,
    };
  }

  /** Laufenden Tunnel liefern bzw. starten; null, wenn kein eigenes Profil oder kein wireproxy. */
  async ensure() {
    if (this.current?.child && this.current.child.exitCode === null) {
      // Profil inzwischen gelöscht oder für qBittorrent gewählt? Dann neu wählen.
      if (this.pool().some((p) => p.id === this.current.profileId)) return this.current;
      this.stop();
    }
    if (this.starting) return this.starting;
    this.starting = (async () => {
      if (!(await this.available())) return null;
      const pool = this.pool();
      for (let tries = 0; tries < pool.length; tries++) {
        const profile = pool[this.index % pool.length];
        try {
          return await this.start(profile);
        } catch {
          this.index = (this.index + 1) % pool.length; // Profil kommt nicht hoch → nächstes
        }
      }
      return null;
    })().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  /** Zum nächsten Profil wechseln (YouTube sperrt die aktuelle Adresse). */
  async next() {
    const pool = this.pool();
    if (!pool.length) return { rotated: false, profiles: 0 };
    const before = this.current?.profileId;
    const at = pool.findIndex((p) => p.id === before);
    this.index = (at < 0 ? this.index : at) + 1;
    this.stop();
    const now = await this.ensure();
    return { rotated: !!now && now.profileId !== before, profiles: pool.length, name: now?.name || null };
  }

  async start(meta) {
    const profile = this.engine.vault.get(`vpn-profile:${meta.id}`);
    if (!profile?.config) throw new Error("VPN-Profil fehlt.");
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await chmod(this.dir, 0o700);
    const httpPort = await freePort(),
      infoPort = await freePort();
    const user = "sp",
      pass = randomBytes(18).toString("hex");
    const file = path.join(this.dir, "wireproxy.conf");
    await writeFile(file, wireproxyConfig(profile, { httpPort, user, pass }), { mode: 0o600 });
    await chmod(file, 0o600);
    const child = this.spawn(this.binary, ["-s", "-c", file, "-i", `127.0.0.1:${infoPort}`], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    child.on?.("error", () => {});
    const run = { profileId: meta.id, name: meta.name, httpPort, user, pass, child };
    // Bereit, sobald über den Tunnel eine Antwort vom Mullvad-Resolver kommt (/readyz = 200)
    const deadline = Date.now() + READY_TIMEOUT;
    while (Date.now() < deadline) {
      if (child.exitCode !== null && child.exitCode !== undefined) break;
      try {
        const r = await this.fetch(`http://127.0.0.1:${infoPort}/readyz`, { signal: AbortSignal.timeout(2000) });
        if (r.status === 200) {
          await rm(file, { force: true }); // Schlüssel liegt nur noch im Prozess
          this.current = run;
          return run;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    child.kill?.("SIGTERM");
    await rm(file, { force: true });
    throw new Error("YouTube-Tunnel kommt nicht hoch.");
  }

  stop() {
    this.current?.child?.kill?.("SIGTERM");
    this.current = null;
  }

  /** CONNECT host:443 über den laufenden Tunnel; liefert den offenen Socket. */
  connect(run, host) {
    return new Promise((resolve, reject) => {
      const sock = net.connect(run.httpPort, "127.0.0.1");
      const fail = (e) => {
        sock.destroy();
        reject(e);
      };
      const timer = setTimeout(() => fail(new Error("Zeitüberschreitung")), 15000);
      let buf = "";
      sock.once("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      sock.on("connect", () =>
        sock.write(
          `CONNECT ${host}:443 HTTP/1.1\r\nHost: ${host}:443\r\nProxy-Authorization: Basic ${Buffer.from(`${run.user}:${run.pass}`).toString("base64")}\r\n\r\n`,
        ),
      );
      const onData = (chunk) => {
        buf += chunk.toString("latin1");
        const end = buf.indexOf("\r\n\r\n");
        if (end < 0) {
          if (buf.length > 8192) fail(new Error("Ungültige Antwort"));
          return;
        }
        clearTimeout(timer);
        sock.off("data", onData);
        if (!/^HTTP\/1\.[01] 200/.test(buf)) return fail(new Error("Tunnel lehnt ab"));
        const rest = Buffer.from(buf.slice(end + 4), "latin1");
        if (rest.length) sock.unshift(rest);
        resolve(sock);
      };
      sock.on("data", onData);
    });
  }
}
