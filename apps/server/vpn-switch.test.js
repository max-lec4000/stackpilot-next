import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { VpnSwitch, gluetunAuth } from "./vpn-switch.js";

const OLD = "00000000-0000-4000-8000-000000000001";
const NEW = "00000000-0000-4000-8000-000000000002";

async function fixture({ failIdentityFor = null } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "sp-vpnswitch-"));
  const appdata = path.join(dir, "appdata");
  await mkdir(path.join(appdata, "gluetun"), { recursive: true });
  const vault = new Map([
    [`vpn-profile:${OLD}`, { config: "[Interface]\nPrivateKey = ALT\n", controlKey: "k-old", name: "Wien" }],
    [`vpn-profile:${NEW}`, { config: "[Interface]\nPrivateKey = NEU\n", controlKey: "k-new", name: "Zürich" }],
  ]);
  await writeFile(path.join(appdata, "gluetun", "wg0.conf"), vault.get(`vpn-profile:${OLD}`).config);
  await writeFile(path.join(appdata, "gluetun", "auth.toml"), gluetunAuth(vault.get(`vpn-profile:${OLD}`)));
  let plan = { id: "p1", rootId: "r1", appdata, spec: { vpn: true }, vpnProfileId: OLD };
  const log = [];
  const engine = {
    store: { directory: path.join(dir, "state"), replacePlan: (p) => { plan = p; log.push(["plan", p.vpnProfileId]); } },
    vault: { get: (k) => vault.get(k) ?? null },
    current: () => ({ plan }),
    docker: async (args) => log.push(["docker", args.slice(-3).join(" "), await readFile(path.join(appdata, "gluetun", "wg0.conf"), "utf8")]),
    vpnCheck: async (p, action) => {
      log.push(["check", p.vpnProfileId, action]);
      if (p.vpnProfileId === failIdentityFor) throw Error("kein Mullvad");
    },
  };
  const s = { verifyQbit: async () => log.push(["qbit"]) };
  const hub = { engine, mutate: async (_n, fn) => fn({ s, plan }) };
  let stopped = 0;
  const sw = new VpnSwitch(hub, { tunnel: { stop: () => stopped++ } });
  return { sw, log, appdata, vault, getPlan: () => plan, stopped: () => stopped };
}

test("Profilwechsel für qBittorrent: neue Dateien, Neuaufbau, Prüfungen, dann Plan", async () => {
  const f = await fixture();
  const r = await f.sw.apply({ profileId: NEW, confirmation: "OK" });
  assert.deepEqual(r, { profileId: NEW, name: "Zürich" });
  assert.equal(await readFile(path.join(f.appdata, "gluetun", "wg0.conf"), "utf8"), "[Interface]\nPrivateKey = NEU\n");
  assert.match(await readFile(path.join(f.appdata, "gluetun", "auth.toml"), "utf8"), /apikey = "k-new"/);
  assert.equal(f.getPlan().vpnProfileId, NEW);
  assert.equal(f.stopped(), 1, "YouTube-Tunnel vorher angehalten");
  assert.deepEqual(f.log.map((e) => e.slice(0, 3)), [
    ["docker", "gluetun qbittorrent vpn-probe", "[Interface]\nPrivateKey = NEU\n"],
    ["check", NEW, "identity"],
    ["check", NEW, "isolation"],
    ["qbit"],
    ["plan", NEW],
  ]);
});

test("Profilwechsel scheitert → altes Profil zurück und geprüft, Plan unverändert", async () => {
  const f = await fixture({ failIdentityFor: NEW });
  await assert.rejects(f.sw.apply({ profileId: NEW, confirmation: "OK" }), /bisherige Profil ist wieder aktiv/);
  assert.equal(await readFile(path.join(f.appdata, "gluetun", "wg0.conf"), "utf8"), "[Interface]\nPrivateKey = ALT\n");
  assert.match(await readFile(path.join(f.appdata, "gluetun", "auth.toml"), "utf8"), /apikey = "k-old"/);
  assert.equal(f.getPlan().vpnProfileId, OLD);
  assert.ok(!f.log.some((e) => e[0] === "plan"));
  assert.deepEqual(f.log.filter((e) => e[0] === "check").map((e) => e.slice(1)), [[NEW, "identity"], [OLD, "identity"], [OLD, "isolation"]]);
});

test("Profilwechsel: Bestätigung, gleiches Profil, offene Ausfallsperre", async () => {
  const f = await fixture();
  await assert.rejects(f.sw.apply({ profileId: NEW }), /Bestätigung/);
  await assert.rejects(f.sw.apply({ profileId: OLD, confirmation: "OK" }), /schon aktiv/);
  f.vault.set("safety-latch:r1", { at: 1 });
  await assert.rejects(f.sw.apply({ profileId: NEW, confirmation: "OK" }), /VPN-Prüfung/);
  assert.equal(f.log.length, 0);
});

test("Profilwechsel nur mit gültiger Profilkennung", async () => {
  const f = await fixture();
  await assert.rejects(f.sw.apply({ profileId: "../../x", confirmation: "OK" }), /Unbekanntes VPN-Profil/);
  await assert.rejects(f.sw.apply({ profileId: { id: 1 }, confirmation: "OK" }), /Unbekanntes VPN-Profil/);
});
