// YouTube über den VPN-Tunnel für Couchdeck – Ausweg, wenn YouTube die eigenen Internetadressen
// des Servers sperrt. Couchdeck bietet ihn im Bot-Dialog an; nichts läuft automatisch darüber.
//
// Ein CONNECT-Weiterleiter nur auf 127.0.0.1, nur mit Schlüssel, nur zu YouTube-/Google-Namen
// auf Port 443. Bevorzugt läuft YouTube über einen eigenen Tunnel (youtube-tunnel.js,
// wireproxy mit einem eigenen VPN-Profil, wechselbar per POST /next). Gibt es kein eigenes
// Profil, läuft jede Verbindung als `docker exec -i <vpn-probe> node -e …` im Netz des
// qBittorrent-Tunnels; Gluetun, seine Firewall und qBittorrent bleiben unverändert. Den
// Schlüssel und die Adresse legt StackPilot in den Übergabeordner von Couchdeck.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { writeFile, rename, unlink, access, chmod, constants } from "node:fs/promises";
import path from "node:path";
import { YouTubeTunnel } from "./youtube-tunnel.js";

export const YOUTUBE_VPN_PORT = 4417;
const ALLOWED = /(^|\.)(youtube\.com|googlevideo\.com|ytimg\.com|ggpht\.com|google\.com|googleapis\.com|gstatic\.com|youtube-nocookie\.com|youtu\.be)$/i;
const MAX_TUNNELS = 32;
// Fest, Daten nur über stdin/stdout; der Zielname kommt geprüft als einziges Argument.
const TUNNEL =
  "const net=require('net');const s=net.connect({host:process.argv[1],port:443});s.setNoDelay(true);" +
  "process.stdin.pipe(s);s.pipe(process.stdout);s.on('error',()=>process.exit(1));s.on('close',()=>process.exit(0));" +
  "process.stdin.on('end',()=>s.end());";

export function tunnelTarget(authority) {
  const m = /^([a-z0-9.-]+):(\d+)$/i.exec(String(authority || ""));
  if (!m || Number(m[2]) !== 443 || m[1].length > 253 || !ALLOWED.test(m[1])) return null;
  return m[1].toLowerCase();
}

export function proxyToken(header, token) {
  const m = /^Basic\s+([A-Za-z0-9+/=]+)$/.exec(String(header || ""));
  if (!m || !token) return false;
  const pass = Buffer.from(Buffer.from(m[1], "base64").toString().split(":").slice(1).join(":"));
  const want = Buffer.from(token);
  // Bytelänge vergleichen: bei Sonderzeichen würde timingSafeEqual sonst werfen
  return pass.length === want.length && timingSafeEqual(pass, want);
}

function dockerExec(container, host) {
  const env = { ...process.env, LC_ALL: "C" };
  for (const key of ["DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"])
    delete env[key];
  return spawn(
    "docker",
    ["--host=unix:///var/run/docker.sock", "exec", "-i", container, "node", "-e", TUNNEL, host],
    { env, stdio: ["pipe", "pipe", "ignore"] },
  );
}

export class YouTubeVpnRelay {
  constructor(hub, { linkDir = process.env.COUCHDECK_LINK_DIR || "/var/lib/couchdeck", port = YOUTUBE_VPN_PORT, exec = dockerExec, tunnel } = {}) {
    this.hub = hub;
    this.tunnel = tunnel === undefined ? new YouTubeTunnel(hub.engine) : tunnel;
    this.linkDir = linkDir;
    this.port = port;
    this.exec = exec;
    this.server = null;
    this.tunnels = 0;
    this.probe = null; // { id, at }
    this.timer = null;
  }
  get file() {
    return path.join(this.linkDir, "youtube-vpn.json");
  }
  token() {
    const vault = this.hub.engine.vault;
    return vault.ensure("couchdeck:youtube-vpn", () => ({ token: randomBytes(24).toString("hex") })).token;
  }
  /** Container-ID von vpn-probe, wenn der aktuelle Stack ein VPN hat (1 min zwischengespeichert). */
  async container() {
    if (this.probe && Date.now() - this.probe.at < 60000) return this.probe.id;
    const current = this.hub.engine.current();
    let id = null;
    if (current?.job?.status === "completed" && current.plan.spec.vpn) {
      const containers = await this.hub.engine.validate(current.plan, true);
      const probe = containers.find((c) => c.service === "vpn-probe");
      if (probe && /^[a-f0-9]{64}$/.test(probe.id)) id = probe.id;
    }
    this.probe = { id, at: Date.now() };
    return id;
  }
  start() {
    if (this.server) return;
    const server = createServer((req, res) => void this.request(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }));
    server.on("connect", (req, socket) => this.handle(req, socket).catch(() => socket.destroy()));
    server.on("clientError", (_e, socket) => socket.destroy());
    server.on("error", (e) => {
      this.server = null;
      console.error(`YouTube-VPN-Weiterleitung nicht gestartet (${e.code === "EADDRINUSE" ? `Port ${this.port} belegt` : e.code || "Fehler"}).`);
    });
    // Hält den Prozess nicht allein am Leben (der eigentliche Webserver tut das).
    server.unref();
    server.listen(this.port, "127.0.0.1", () => {
      this.server = server;
      void this.publish().catch((e) => console.error("YouTube-VPN-Übergabe an Couchdeck fehlgeschlagen:", e.message));
    });
    this.timer = setInterval(() => void this.publish().catch(() => {}), 10 * 60000);
    this.timer.unref?.();
  }
  /** Steuerung für Couchdeck: GET /status, POST /next (nächstes VPN-Profil). */
  async request(req, res) {
    const reply = (code, body) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (!proxyToken(req.headers.authorization, this.token())) return reply(401, { error: "Zugang fehlt" });
    if (req.method === "GET" && req.url === "/status")
      return reply(200, { tunnel: this.tunnel && (await this.tunnel.available()) ? this.tunnel.status() : null });
    if (req.method === "POST" && req.url === "/next") {
      if (!this.tunnel || !(await this.tunnel.available())) return reply(200, { rotated: false, profiles: 0 });
      return reply(200, await this.tunnel.next());
    }
    return reply(404, { error: "Unbekannt" });
  }
  stop() {
    this.tunnel?.stop();
    clearInterval(this.timer);
    this.server?.close();
    this.server = null;
  }
  /** Übergabe an Couchdeck schreiben bzw. entfernen, je nachdem ob ein VPN-Tunnel da ist. */
  async publish() {
    try {
      await access(this.linkDir, constants.W_OK);
    } catch {
      return false;
    }
    const own = this.server && this.tunnel ? await this.tunnel.available().catch(() => false) : false;
    const id = own || (this.server ? await this.container().catch(() => null) : null);
    if (!id) {
      await unlink(this.file).catch(() => {});
      return false;
    }
    const data = { version: 1, proxy: `http://127.0.0.1:${this.port}`, token: this.token() };
    const temp = `${this.file}.${randomBytes(6).toString("hex")}.tmp`;
    try {
      await writeFile(temp, JSON.stringify(data, null, 2), { mode: 0o640, flag: "wx" });
      // Ausdrücklich setzen: die umask des Dienstes (0077) würde sonst 0600 ergeben und
      // Couchdeck (Gruppe couchdeck-link) könnte die Datei nicht lesen.
      await chmod(temp, 0o640);
      await rename(temp, this.file);
    } finally {
      await unlink(temp).catch(() => {});
    }
    return true;
  }
  async pipeTunnel(run, host, socket) {
    this.tunnels++;
    let upstream = null;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.tunnels--;
      upstream?.destroy();
      socket.destroy();
    };
    socket.on("close", release);
    try {
      upstream = await this.tunnel.connect(run, host);
    } catch {
      if (!socket.destroyed) socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
      return release();
    }
    if (socket.destroyed) return release();
    upstream.on("error", () => {});
    upstream.on("close", release);
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    socket.pipe(upstream);
    upstream.pipe(socket);
  }
  async handle(req, socket) {
    socket.on("error", () => {});
    if (!proxyToken(req.headers["proxy-authorization"], this.token()))
      return socket.end("HTTP/1.1 407 Proxy Authentication Required\r\n\r\n");
    const host = tunnelTarget(req.url);
    if (!host) return socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    if (this.tunnels >= MAX_TUNNELS) return socket.end("HTTP/1.1 503 Service Unavailable\r\n\r\n");
    // 1. Eigener YouTube-Tunnel (wireproxy), falls ein eigenes Profil vorhanden ist
    const run = this.tunnel ? await this.tunnel.ensure().catch(() => null) : null;
    if (run) return this.pipeTunnel(run, host, socket);
    // 2. Sonst über den qBittorrent-Tunnel (vpn-probe)
    const id = await this.container().catch(() => null);
    if (!id) return socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    this.tunnels++;
    const child = this.exec(id, host);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.tunnels--;
      child.kill("SIGTERM");
      socket.destroy();
    };
    child.on("error", () => {
      if (!socket.destroyed && !socket.writableEnded) socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
      release();
    });
    child.on("close", release);
    socket.on("close", release);
    child.stdin.on("error", () => {});
    child.once("spawn", () => {
      if (socket.destroyed) return release();
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      socket.pipe(child.stdin);
      child.stdout.pipe(socket);
    });
  }
}
