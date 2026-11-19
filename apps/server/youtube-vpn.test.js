import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, stat, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { YouTubeVpnRelay, tunnelTarget, proxyToken } from "./youtube-vpn.js";

const probeId = "a".repeat(64);
function hub({ vpn = true, probe = true } = {}) {
  const store = new Map();
  return {
    engine: {
      vault: { ensure: (k, f) => (store.has(k) ? store.get(k) : (store.set(k, f()), store.get(k))) },
      current: () => ({ job: { status: "completed" }, plan: { spec: { vpn } } }),
      validate: async () => (probe ? [{ service: "vpn-probe", id: probeId }, { service: "gluetun", id: "b".repeat(64) }] : []),
    },
  };
}
// Statt docker exec: kleiner Echo-Prozess, der das Ziel zurückmeldet
const fakeExec = (calls) => (container, host) => {
  calls.push([container, host]);
  return spawn(process.execPath, ["-e", "process.stdin.pipe(process.stdout)"], { stdio: ["pipe", "pipe", "ignore"] });
};
function connect(port, target, token) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method: "CONNECT", path: target,
      headers: token ? { "Proxy-Authorization": "Basic " + Buffer.from("couchdeck:" + token).toString("base64") } : {} });
    req.once("connect", (res, sock) => resolve({ status: res.statusCode, sock }));
    req.once("response", (res) => resolve({ status: res.statusCode }));
    req.once("error", reject);
    req.end();
  });
}

test("VPN-Weiterleitung erlaubt nur YouTube-/Google-Ziele auf 443", () => {
  assert.equal(tunnelTarget("rr2---sn-x.googlevideo.com:443"), "rr2---sn-x.googlevideo.com");
  assert.equal(tunnelTarget("WWW.YouTube.com:443"), "www.youtube.com");
  for (const bad of ["www.youtube.com:80", "evil.com:443", "youtube.com.evil.com:443", "127.0.0.1:443", "gluetun:8000", "qbittorrent:8080", ""])
    assert.equal(tunnelTarget(bad), null, bad);
  assert.equal(proxyToken("Basic " + Buffer.from("x:geheim").toString("base64"), "geheim"), true);
  assert.equal(proxyToken("Basic " + Buffer.from("x:falsch").toString("base64"), "geheim"), false);
  assert.equal(proxyToken(undefined, "geheim"), false);
});

test("VPN-Weiterleitung: Übergabe an Couchdeck und Tunnel über vpn-probe", async () => {
  const oldMask = process.umask(0o077); // wie der StackPilot-Dienst
  const linkDir = await mkdtemp(path.join(tmpdir(), "sp-ytvpn-"));
  const calls = [];
  const relay = new YouTubeVpnRelay(hub(), { linkDir, port: 0, exec: fakeExec(calls), tunnel: null });
  relay.start();
  await new Promise((r) => setTimeout(r, 200));
  try {
    const port = relay.server.address().port;
    relay.port = port;
    assert.equal(await relay.publish(), true);
    const file = path.join(linkDir, "youtube-vpn.json");
    const data = JSON.parse(await readFile(file, "utf8"));
    assert.equal(data.proxy, `http://127.0.0.1:${port}`);
    assert.match(data.token, /^[a-f0-9]{48}$/);
    assert.equal((await stat(file)).mode & 0o777, 0o640);
    const ok = await connect(port, "www.youtube.com:443", data.token);
    assert.equal(ok.status, 200);
    const echoed = await new Promise((r) => { ok.sock.once("data", (d) => r(d.toString())); ok.sock.write("ping"); });
    assert.equal(echoed, "ping");
    ok.sock.destroy();
    assert.deepEqual(calls, [[probeId, "www.youtube.com"]]);
    assert.equal((await connect(port, "www.youtube.com:443", "falsch")).status, 407);
    assert.equal((await connect(port, "evil.com:443", data.token)).status, 403);
    assert.equal(calls.length, 1);
  } finally {
    process.umask(oldMask);
    relay.stop();
  }
});

test("Ohne VPN im Stack gibt es keine Übergabe und keinen Tunnel", async () => {
  const linkDir = await mkdtemp(path.join(tmpdir(), "sp-ytvpn-"));
  const calls = [];
  const relay = new YouTubeVpnRelay(hub({ vpn: false }), { linkDir, port: 0, exec: fakeExec(calls), tunnel: null });
  relay.start();
  await new Promise((r) => setTimeout(r, 200));
  try {
    assert.equal(await relay.publish(), false);
    await assert.rejects(access(path.join(linkDir, "youtube-vpn.json")));
    const token = relay.token();
    assert.equal((await connect(relay.server.address().port, "www.youtube.com:443", token)).status, 502);
    assert.equal(calls.length, 0);
  } finally {
    relay.stop();
  }
});

test("Eigener YouTube-Tunnel hat Vorrang; /next und /status nur mit Schlüssel", async () => {
  const linkDir = await mkdtemp(path.join(tmpdir(), "sp-ytvpn-"));
  // Gegenstück zu wireproxy: CONNECT mit Zugangsdaten, danach Echo
  const upstream = http.createServer();
  upstream.on("connect", (req, sock) => {
    if (req.headers["proxy-authorization"] !== "Basic " + Buffer.from("sp:pw").toString("base64")) return sock.end("HTTP/1.1 407 x\r\n\r\n");
    sock.write("HTTP/1.1 200 OK\r\n\r\n");
    sock.pipe(sock);
  });
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
  const { YouTubeTunnel } = await import("./youtube-tunnel.js");
  const tunnel = Object.assign(Object.create(YouTubeTunnel.prototype), {
    rotations: 0,
    available: async () => true,
    ensure: async () => ({ profileId: "p1", name: "Wien", httpPort: upstream.address().port, user: "sp", pass: "pw" }),
    status: () => ({ profiles: 2, active: { name: "Wien", position: 1 } }),
    next: async function () { this.rotations++; return { rotated: true, profiles: 2, name: "Frankfurt" }; },
    stop: () => {},
  });
  const calls = [];
  const relay = new YouTubeVpnRelay(hub({ probe: false }), { linkDir, port: 0, exec: fakeExec(calls), tunnel });
  relay.start();
  await new Promise((r) => setTimeout(r, 200));
  try {
    const port = relay.server.address().port;
    relay.port = port;
    assert.equal(await relay.publish(), true, "eigener Tunnel genügt für die Übergabe");
    const token = relay.token();
    const ok = await connect(port, "rr1.googlevideo.com:443", token);
    assert.equal(ok.status, 200);
    const echoed = await new Promise((r) => { ok.sock.once("data", (d) => r(d.toString())); ok.sock.write("hallo"); });
    assert.equal(echoed, "hallo");
    ok.sock.destroy();
    assert.equal(calls.length, 0, "kein docker exec, wenn der eigene Tunnel läuft");
    const auth = { Authorization: "Basic " + Buffer.from("couchdeck:" + token).toString("base64") };
    assert.equal((await fetch(`http://127.0.0.1:${port}/next`, { method: "POST" })).status, 401);
    const next = await (await fetch(`http://127.0.0.1:${port}/next`, { method: "POST", headers: auth })).json();
    assert.deepEqual(next, { rotated: true, profiles: 2, name: "Frankfurt" });
    assert.equal(tunnel.rotations, 1);
    const st = await (await fetch(`http://127.0.0.1:${port}/status`, { headers: auth })).json();
    assert.equal(st.tunnel.profiles, 2);
  } finally {
    relay.stop();
    upstream.close();
  }
});

test("Schlüsselvergleich lehnt Sonderzeichen sauber ab", () => {
  const b = (s) => "Basic " + Buffer.from(s).toString("base64");
  assert.equal(proxyToken(b("x:" + "ä".repeat(24)), "a".repeat(48)), false);
  assert.equal(proxyToken(b("x:" + "a".repeat(48)), "a".repeat(48)), true);
});
