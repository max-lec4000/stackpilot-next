import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, chmod } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { StateStore } from "./state.js";
import { Vault } from "./vault.js";
import { importVpn, listVpnProfiles, removeVpnProfile, profileName } from "./vpn.js";
import { YouTubeTunnel, wireproxyConfig } from "./youtube-tunnel.js";

const wg = (n) => `[Interface]\nPrivateKey = ${randomBytes(32).toString("base64")}\nAddress = 10.64.1.${n}/32\nDNS = 10.64.0.1\n[Peer]\nPublicKey = ${randomBytes(32).toString("base64")}\nAllowedIPs = 0.0.0.0/0,::0/0\nEndpoint = 185.213.154.${n}:51820\n`;

async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), "sp-yttunnel-"));
  const store = new StateStore(dir + "/state");
  const vault = new Vault(store);
  return { dir, store, vault };
}

test("VPN-Profile: Liste mit Namen, Verwendung und Schutz vor Doppelungen", async () => {
  const { vault } = await setup();
  const text = wg(1);
  const a = importVpn(vault, text, "mullvad-at-vie-wg-001.conf");
  const b = importVpn(vault, wg(2), "");
  assert.equal(a.name, "mullvad-at-vie-wg-001");
  assert.equal(b.name, "Mullvad 185.213.154.2:51820");
  assert.throws(() => importVpn(vault, text, "nochmal"), /schon importiert/);
  const plan = { spec: { vpn: true }, vpnProfileId: a.id };
  const list = listVpnProfiles(vault, plan);
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((p) => [p.name, p.qbittorrent, p.youtube]), [["mullvad-at-vie-wg-001", true, false], [b.name, false, true]]);
  assert.ok(!JSON.stringify(list).includes("PrivateKey"));
  assert.throws(() => removeVpnProfile(vault, plan, a.id), /qBittorrent/);
  removeVpnProfile(vault, plan, b.id);
  assert.equal(listVpnProfiles(vault, plan).length, 1);
  assert.equal(profileName("<script>x</script>.conf", "1.2.3.4:5"), "scriptxscript");
});

test("wireproxy-Konfiguration: Mullvad-DNS, Prüfung über den Tunnel, Proxy nur lokal mit Zugang", async () => {
  const { vault } = await setup();
  const { id } = importVpn(vault, wg(3), "x");
  const conf = wireproxyConfig(vault.get(`vpn-profile:${id}`), { httpPort: 4100, user: "sp", pass: "geheim" });
  assert.match(conf, /^\[Interface\]\nDNS = 10\.64\.0\.1\nCheckAlive = 10\.64\.0\.1\n/);
  assert.match(conf, /\[http\]\nBindAddress = 127\.0\.0\.1:4100\nUsername = sp\nPassword = geheim\n$/);
  assert.match(conf, /AllowedIPs = 0\.0\.0\.0\/0/);
});

test("YouTube-Tunnel: nie das qBittorrent-Profil, Wechsel zum nächsten, Schlüsseldatei wird gelöscht", async () => {
  const { dir, store, vault } = await setup();
  const q = importVpn(vault, wg(4), "qbit");
  const y1 = importVpn(vault, wg(5), "yt-1");
  const y2 = importVpn(vault, wg(6), "yt-2");
  const bin = path.join(dir, "wireproxy");
  await writeFile(bin, "#!/bin/sh\n");
  await chmod(bin, 0o755);
  const engine = { store, vault, current: () => ({ job: { status: "completed" }, plan: { spec: { vpn: true }, vpnProfileId: q.id } }) };
  const started = [];
  const spawn = (binary, args) => {
    const conf = args[args.indexOf("-c") + 1];
    started.push(readFile(conf, "utf8"));
    const child = Object.assign(new EventEmitter(), { exitCode: null, kill() { this.exitCode = 0; } });
    return child;
  };
  const tunnel = new YouTubeTunnel(engine, { binary: bin, dir: path.join(dir, "t"), spawn, fetchImpl: async () => ({ status: 200 }) });
  assert.deepEqual(tunnel.pool().map((p) => p.id), [y1.id, y2.id]);
  const run = await tunnel.ensure();
  assert.equal(run.profileId, y1.id);
  const conf1 = await started[0];
  assert.ok(!conf1.includes(vault.get(`vpn-profile:${q.id}`).config.split("\n")[1]), "qBittorrent-Schlüssel nie im YouTube-Tunnel");
  await assert.rejects(readFile(path.join(dir, "t", "wireproxy.conf")), "Konfigurationsdatei nach dem Start entfernt");
  assert.equal((await tunnel.ensure()).profileId, y1.id, "läuft weiter ohne Neustart");
  const next = await tunnel.next();
  assert.deepEqual([next.rotated, next.name], [true, "yt-2"]);
  assert.equal((await tunnel.next()).name, "yt-1", "nach dem letzten wieder das erste");
  assert.equal(tunnel.status().profiles, 2);
});

test("YouTube-Tunnel: ohne eigenes Profil oder ohne wireproxy nicht verfügbar", async () => {
  const { dir, store, vault } = await setup();
  const q = importVpn(vault, wg(7), "qbit");
  const engine = { store, vault, current: () => ({ job: { status: "completed" }, plan: { spec: { vpn: true }, vpnProfileId: q.id } }) };
  const t = new YouTubeTunnel(engine, { binary: path.join(dir, "fehlt"), dir: path.join(dir, "t") });
  assert.equal(await t.available(), false);
  assert.equal(await t.ensure(), null);
  importVpn(vault, wg(8), "yt");
  assert.equal(await t.available(), false, "ohne wireproxy-Programm");
});
