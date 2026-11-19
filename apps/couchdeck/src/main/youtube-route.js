'use strict';
// YouTube-Abrufe über einen wählbaren Weg: IPv4, IPv6 oder – falls StackPilot es anbietet –
// den VPN-Tunnel. YouTube sperrt bei der Bot-Prüfung einzelne Internetadressen; Stream-Adressen
// gelten außerdem nur für die Adresse, über die sie abgefragt wurden. Deshalb laufen yt-dlp,
// mpv und das Laden der Segmentlisten für ein Video über denselben Weg.
//
// Umgesetzt als kleiner CONNECT-Weiterleiter nur auf 127.0.0.1 mit zufälligem Schlüssel
// (Proxy-Anmeldung: Benutzername = Weg). Erlaubt sind nur YouTube-/Google-Adressen auf Port 443.
const net = require('net');
const http = require('http');
const tls = require('tls');
const crypto = require('crypto');

const ROUTES = ['v4', 'v6', 'vpn'];
const ALLOWED = /(^|\.)(youtube\.com|googlevideo\.com|ytimg\.com|ggpht\.com|google\.com|googleapis\.com|gstatic\.com|youtube-nocookie\.com|youtu\.be)$/i;
const CONNECT_TIMEOUT = 10000;
const MAX_TUNNELS = 48;

/** Ziel einer CONNECT-Anfrage prüfen: nur erlaubte Namen, nur Port 443. */
function parseTarget(authority) {
  const m = /^([a-z0-9.-]+):(\d+)$/i.exec(String(authority || ''));
  if (!m || Number(m[2]) !== 443 || !ALLOWED.test(m[1]) || m[1].length > 253) return null;
  return { host: m[1].toLowerCase(), port: 443 };
}

function parseAuth(header, token) {
  const m = /^Basic\s+([A-Za-z0-9+/=]+)$/.exec(String(header || ''));
  if (!m) return null;
  const [user, pass = ''] = Buffer.from(m[1], 'base64').toString().split(':');
  if (!ROUTES.includes(user) || pass.length !== token.length) return null;
  return crypto.timingSafeEqual(Buffer.from(pass), Buffer.from(token)) ? user : null;
}

class RouteProxy {
  /** vpn(): { proxy: 'http://127.0.0.1:PORT', token } von StackPilot oder null. */
  constructor({ vpn = () => null, connectDirect = null } = {}) {
    this.vpn = vpn;
    this.token = crypto.randomBytes(18).toString('hex');
    this.port = 0;
    this.server = null;
    this.starting = null;
    this.tunnels = 0;
    this.connectDirect = connectDirect || ((host, port, family) => net.connect({ host, port, family, timeout: CONNECT_TIMEOUT }));
  }

  get vpnAvailable() {
    const v = this.vpn();
    return !!(v && typeof v.proxy === 'string' && typeof v.token === 'string' && v.token.length >= 16);
  }

  start() {
    if (this.port) return Promise.resolve();
    if (this.starting) return this.starting;
    this.starting = new Promise((resolve, reject) => {
      const srv = http.createServer((_req, res) => { res.writeHead(405); res.end(); });
      srv.on('connect', (req, socket, head) => this.handleConnect(req, socket, head));
      srv.on('clientError', (_e, socket) => socket.destroy());
      srv.on('error', reject);
      srv.listen(0, '127.0.0.1', () => { this.server = srv; this.port = srv.address().port; resolve(); });
    }).finally(() => { this.starting = null; });
    return this.starting;
  }

  stop() { this.server?.close(); this.server = null; this.port = 0; }

  /** Proxy-Adresse für yt-dlp/mpv (vorher start() aufrufen). */
  url(route) {
    if (!ROUTES.includes(route) || !this.port) throw new Error('Unbekannter YouTube-Weg');
    return `http://${route}:${this.token}@127.0.0.1:${this.port}`;
  }

  /** Verbindung zu host:443 über den gewählten Weg; liefert einen offenen Socket. */
  connect(route, host, port = 443) {
    return new Promise((resolve, reject) => {
      const done = (err, sock) => { clearTimeout(timer); if (err) { sock?.destroy(); reject(err); } else resolve(sock); };
      const timer = setTimeout(() => done(new Error('Zeitüberschreitung beim Verbinden')), CONNECT_TIMEOUT);
      if (route === 'v4' || route === 'v6') {
        const sock = this.connectDirect(host, port, route === 'v4' ? 4 : 6);
        sock.once('connect', () => { sock.setTimeout(0); done(null, sock); });
        sock.once('timeout', () => done(new Error('Zeitüberschreitung beim Verbinden'), sock));
        sock.once('error', (e) => done(e, sock));
        return;
      }
      if (route !== 'vpn') return done(new Error('Unbekannter YouTube-Weg'));
      const v = this.vpn();
      if (!this.vpnAvailable) return done(new Error('VPN-Weg nicht verfügbar'));
      const up = new URL(v.proxy);
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(up.hostname)) return done(new Error('VPN-Weg nicht lokal'));
      const req = http.request({
        host: up.hostname, port: Number(up.port), method: 'CONNECT', path: `${host}:${port}`,
        headers: { Host: `${host}:${port}`, 'Proxy-Authorization': 'Basic ' + Buffer.from('couchdeck:' + v.token).toString('base64') },
      });
      req.once('connect', (res, sock) => {
        if (res.statusCode !== 200) return done(new Error(`VPN-Weg antwortet ${res.statusCode}`), sock);
        done(null, sock);
      });
      req.once('error', (e) => done(e));
      req.end();
    });
  }

  async handleConnect(req, socket, head) {
    socket.on('error', () => {});
    const route = parseAuth(req.headers['proxy-authorization'], this.token);
    const target = parseTarget(req.url);
    // ffmpeg (mpv) fragt erst ohne Zugang und wiederholt nur bei „Basic realm=…“ mit Zugang.
    if (!route) return socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="couchdeck"\r\nContent-Length: 0\r\n\r\n');
    if (!target) return socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    if (this.tunnels >= MAX_TUNNELS) return socket.end('HTTP/1.1 503 Service Unavailable\r\n\r\n');
    this.tunnels++;
    let upstream = null;
    const release = () => { if (release.done) return; release.done = true; this.tunnels--; upstream?.destroy(); socket.destroy(); };
    socket.once('close', release);
    try {
      upstream = await this.connect(route, target.host, target.port);
    } catch {
      if (!socket.destroyed) socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      return;
    }
    if (socket.destroyed) { upstream.destroy(); return; }
    upstream.on('error', () => {});
    upstream.once('close', release);
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head?.length) upstream.write(head);
    socket.pipe(upstream);
    upstream.pipe(socket);
  }

  /** StackPilot bitten, den YouTube-Tunnel auf das nächste VPN-Profil umzustellen. */
  rotateVpn() {
    const v = this.vpn();
    if (!this.vpnAvailable) return Promise.resolve({ rotated: false, profiles: 0 });
    const up = new URL(v.proxy);
    return new Promise((resolve, reject) => {
      const req = http.request({
        host: up.hostname, port: Number(up.port), method: 'POST', path: '/next', timeout: 40000,
        headers: { Authorization: 'Basic ' + Buffer.from('couchdeck:' + v.token).toString('base64'), 'Content-Length': 0 },
      }, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
        res.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(new Error('Ungültige Antwort')); } });
      });
      req.on('timeout', () => req.destroy(new Error('Zeitüberschreitung')));
      req.on('error', reject);
      req.end();
    });
  }

  /** Text (z. B. HLS-Playlist) über einen Weg laden. */
  async fetchText(route, url, timeoutMs = 10000) {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !parseTarget(`${u.hostname}:443`)) throw new Error('Adresse nicht erlaubt');
    const raw = await this.connect(route, u.hostname, 443);
    const sock = tls.connect({ socket: raw, servername: u.hostname, ALPNProtocols: ['http/1.1'] });
    return new Promise((resolve, reject) => {
      const req = require('https').request(u, { createConnection: () => sock, agent: false, timeout: timeoutMs }, (res) => {
        if (res.statusCode !== 200) { res.resume(); sock.destroy(); return reject(new Error(`HTTP ${res.statusCode}`)); }
        const chunks = [];
        let size = 0;
        res.on('data', (c) => { size += c.length; if (size > 16 * 1024 * 1024) { req.destroy(new Error('Antwort zu groß')); } else chunks.push(c); });
        res.on('end', () => { sock.destroy(); resolve(Buffer.concat(chunks).toString('utf8')); });
        res.on('error', reject);
      });
      req.on('timeout', () => req.destroy(new Error('Zeitüberschreitung')));
      req.on('error', (e) => { sock.destroy(); reject(e); });
      req.end();
    });
  }
}

module.exports = { RouteProxy, parseTarget, parseAuth, ROUTES };
