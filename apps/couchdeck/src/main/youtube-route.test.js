'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const net = require('net');
const http = require('http');
const path = require('path');

process.env.COUCHDECK_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-route-'));
process.env.COUCHDECK_LINK_DIR = process.env.COUCHDECK_CONFIG_DIR;
const { RouteProxy, parseTarget, parseAuth } = require('./youtube-route');
const { YouTube } = require('./youtube');

const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
const echoServer = () => net.createServer((s) => s.pipe(s));

/** CONNECT über den Weiterleiter senden; liefert Statuszeile und offenen Socket. */
function connectVia(port, target, auth) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'CONNECT', path: target,
      headers: auth ? { 'Proxy-Authorization': 'Basic ' + Buffer.from(auth).toString('base64') } : {} });
    req.once('connect', (res, sock) => resolve({ status: res.statusCode, sock }));
    req.once('response', (res) => resolve({ status: res.statusCode, sock: null }));
    req.once('error', reject);
    req.end();
  });
}
const roundtrip = (sock, text) => new Promise((r) => { sock.once('data', (d) => r(d.toString())); sock.write(text); });

test('Ziele: nur YouTube/Google auf Port 443', () => {
  for (const ok of ['www.youtube.com:443', 'rr3---sn-abc.googlevideo.com:443', 'i.ytimg.com:443', 'www.google.com:443', 'jnn-pa.googleapis.com:443'])
    assert.ok(parseTarget(ok), ok);
  for (const bad of ['www.youtube.com:80', 'evil.com:443', 'youtube.com.evil.com:443', '127.0.0.1:443', 'localhost:443', 'x', ''])
    assert.equal(parseTarget(bad), null, bad);
});

test('Anmeldung: Weg als Benutzername, Schlüssel muss stimmen', () => {
  const t = 'a'.repeat(36);
  const b = (s) => 'Basic ' + Buffer.from(s).toString('base64');
  assert.equal(parseAuth(b(`v4:${t}`), t), 'v4');
  assert.equal(parseAuth(b(`vpn:${t}`), t), 'vpn');
  assert.equal(parseAuth(b(`v5:${t}`), t), null);
  assert.equal(parseAuth(b(`v4:${'b'.repeat(36)}`), t), null);
  assert.equal(parseAuth(null, t), null);
});

test('Weiterleiter: IPv4/IPv6 direkt, VPN über StackPilot, Sperren', async () => {
  const echo = echoServer();
  const echoPort = await listen(echo);
  const families = [];
  // StackPilot-Gegenstück: prüft Schlüssel, leitet zum Echo weiter
  const upstream = http.createServer();
  const vpnToken = 'c'.repeat(48);
  upstream.on('connect', (req, sock) => {
    const ok = req.headers['proxy-authorization'] === 'Basic ' + Buffer.from('couchdeck:' + vpnToken).toString('base64');
    if (!ok) return sock.end('HTTP/1.1 407 x\r\n\r\n');
    const e = net.connect(echoPort, '127.0.0.1', () => { sock.write('HTTP/1.1 200 OK\r\n\r\n'); sock.pipe(e); e.pipe(sock); });
  });
  const upPort = await listen(upstream);
  const proxy = new RouteProxy({
    vpn: () => ({ proxy: `http://127.0.0.1:${upPort}`, token: vpnToken }),
    connectDirect: (host, port, family) => { families.push([host, family]); return net.connect(echoPort, '127.0.0.1'); },
  });
  await proxy.start();
  try {
    const url = (r) => new URL(proxy.url(r));
    const auth = (r) => `${url(r).username}:${url(r).password}`;
    for (const r of ['v4', 'v6', 'vpn']) {
      const { status, sock } = await connectVia(proxy.port, 'rr1.googlevideo.com:443', auth(r));
      assert.equal(status, 200, r);
      assert.equal(await roundtrip(sock, 'hallo-' + r), 'hallo-' + r);
      sock.destroy();
    }
    assert.deepEqual(families, [['rr1.googlevideo.com', 4], ['rr1.googlevideo.com', 6]]);
    assert.equal((await connectVia(proxy.port, 'evil.com:443', auth('v4'))).status, 403);
    assert.equal((await connectVia(proxy.port, 'www.youtube.com:443', 'v4:falsch')).status, 407);
    assert.equal((await connectVia(proxy.port, 'www.youtube.com:443', null)).status, 407);
    // VPN-Gegenstelle lehnt ab → 502 an yt-dlp/mpv
    const bad = new RouteProxy({ vpn: () => ({ proxy: `http://127.0.0.1:${upPort}`, token: 'd'.repeat(48) }) });
    await bad.start();
    const u = new URL(bad.url('vpn'));
    assert.equal((await connectVia(bad.port, 'www.youtube.com:443', `vpn:${u.password}`)).status, 502);
    bad.stop();
  } finally {
    proxy.stop(); echo.close(); upstream.close();
  }
});

test('VPN-Weg nur, wenn StackPilot lokal anbietet', () => {
  assert.equal(new RouteProxy({ vpn: () => null }).vpnAvailable, false);
  assert.equal(new RouteProxy({ vpn: () => ({ proxy: 'http://127.0.0.1:1', token: 'x' }) }).vpnAvailable, false);
  assert.equal(new RouteProxy({ vpn: () => ({ proxy: 'http://127.0.0.1:1', token: 'x'.repeat(16) }) }).vpnAvailable, true);
});

test('Wegwahl: bei Bot-Sperre automatisch IPv6, beide gesperrt → Bot-Meldung', async () => {
  const yt = new YouTube();
  yt.routes.start = async () => {};
  const bot = () => Object.assign(new Error('bot'), { code: 'YOUTUBE_BOT_CHECK' });
  const tried = [];
  let r = await yt.withRoute(async (route) => { tried.push(route); if (route === 'v4') throw bot(); return 'ok'; });
  assert.deepEqual(tried, ['v4', 'v6']);
  assert.deepEqual(r, { result: 'ok', route: 'v6' });
  assert.equal(yt.preferred, 'v6');
  // v4 ruht jetzt; nächster Abruf geht direkt über v6
  tried.length = 0;
  r = await yt.withRoute(async (route) => { tried.push(route); return 'ok'; });
  assert.deepEqual(tried, ['v6']);
  // v6 jetzt auch gesperrt → Bot-Fehler, ohne weitere Versuche danach
  await assert.rejects(yt.withRoute(async () => { throw bot(); }), { code: 'YOUTUBE_BOT_CHECK' });
  tried.length = 0;
  await assert.rejects(yt.withRoute(async (route) => { tried.push(route); return 'ok'; }), { code: 'YOUTUBE_BOT_CHECK' });
  assert.deepEqual(tried, []);
  assert.equal(yt.vpnStatus().directBlocked, true);
  // Kein VPN eingerichtet → kein VPN-Angebot
  assert.equal(yt.vpnStatus().available, false);
  assert.throws(() => yt.useVpn(), /nicht eingerichtet/);
  // VPN eingerichtet und gewählt → nur noch über VPN
  fs.writeFileSync(path.join(process.env.COUCHDECK_LINK_DIR, 'youtube-vpn.json'), JSON.stringify({ version: 1, proxy: 'http://127.0.0.1:4417', token: 'e'.repeat(48) }));
  assert.equal(yt.vpnStatus().available, true);
  yt.useVpn();
  tried.length = 0;
  r = await yt.withRoute(async (route) => { tried.push(route); return 'ok'; });
  assert.deepEqual(tried, ['vpn']);
  assert.equal(yt.preferred, 'v6', 'VPN ändert den bevorzugten direkten Weg nicht');
  yt.stopVpn();
  yt.resetBotCheck();
  assert.equal(yt.vpnStatus().directBlocked, false);
});

test('Nicht erreichbarer Weg (z. B. kein IPv6) ist keine Sperre', async () => {
  const yt = new YouTube();
  yt.routes.start = async () => {};
  const r = await yt.withRoute(async (route) => { if (route === 'v4') throw new Error('Unable to connect to proxy'); return route; });
  assert.equal(r.route, 'v6');
  assert.equal(yt.lastBotCheck, -Infinity);
  await assert.rejects(yt.withRoute(async () => { throw new Error('Video nicht verfügbar'); }), /nicht verfügbar/);
});

test('Vorabladen: höchstens 4 je 5 min, Warteschlange hat Vorrang', () => {
  const yt = new YouTube();
  const calls = [];
  yt.resolve = (e) => { calls.push(e.id); return Promise.resolve(null); };
  yt.inflight = new Map();
  for (let i = 0; i < 7; i++) yt.prefetch({ kind: 'video', id: 'vid' + i });
  assert.equal(calls.length, 4);
  yt.prefetch({ kind: 'video', id: 'next' }, { queued: true });
  assert.equal(calls.length, 5);
  yt.lastBotCheck = Date.now();
  yt.prefetch({ kind: 'video', id: 'gesperrt' }, { queued: true });
  assert.equal(calls.length, 5);
});

test('VPN gesperrt: nächstes Profil von StackPilot, jedes höchstens einmal', async () => {
  const yt = new YouTube();
  yt.routes.start = async () => {};
  fs.writeFileSync(path.join(process.env.COUCHDECK_LINK_DIR, 'youtube-vpn.json'), JSON.stringify({ version: 1, proxy: 'http://127.0.0.1:4417', token: 'e'.repeat(48) }));
  yt.useVpn();
  const bot = () => Object.assign(new Error('bot'), { code: 'YOUTUBE_BOT_CHECK' });
  let rotations = 0;
  yt.routes.rotateVpn = async () => { rotations++; return { rotated: true, profiles: 3 }; };
  let calls = 0;
  const r = await yt.withRoute(async () => { calls++; if (calls < 3) throw bot(); return 'ok'; });
  assert.equal(r.route, 'vpn');
  assert.equal(rotations, 2);
  // Alle drei Profile gesperrt → Bot-Meldung nach höchstens 3 Versuchen
  calls = 0; rotations = 0;
  await assert.rejects(yt.withRoute(async () => { calls++; throw bot(); }), { code: 'YOUTUBE_BOT_CHECK' });
  assert.equal(calls, 3);
  assert.equal(yt.vpnStatus().blocked, true);
  yt.stopVpn(); yt.resetBotCheck();
});
