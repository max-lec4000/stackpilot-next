import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { VpnSwitch, gluetunAuth } from "./vpn-switch.js";

async function fixture({ failIdentityFor = null } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "sp-vpnswitch-"));
  const appdata = path.join(dir, "appdata");
  await mkdir(path.join(appdata, "gluetun"), { recursive: true });
  const vault = new Map([
    ["vpn-profile:old", { config: "[Interface]\nPrivateKey = ALT\n", controlKey: "k-old", name: "Wien" }],
    ["vpn-profile:new", { config: "[Interface]\nPrivateKey = NEU\n", controlKey: "k-new", name: "Zürich" }],
  ]);
  await writeFile(path.join(appdata, "gluetun", "wg0.conf"), vault.get("vpn-profile:old").config);
  await writeFile(path.join(appdata, "gluetun", "auth.toml"), gluetunAuth(vault.get("vpn-profile:old")));
  let plan = { id: "p1", rootId: "r1", appdata, spec: { vpn: true }, vpnProfileId: "old" };
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
  const r = await f.sw.apply({ profileId: "new", confirmation: "OK" });
  assert.deepEqual(r, { profileId: "new", name: "Zürich" });
  assert.equal(await readFile(path.join(f.appdata, "gluetun", "wg0.conf"), "utf8"), "[Interface]\nPrivateKey = NEU\n");
  assert.match(await readFile(path.join(f.appdata, "gluetun", "auth.toml"), "utf8"), /apikey = "k-new"/);
  assert.equal(f.getPlan().vpnProfileId, "new");
  assert.equal(f.stopped(), 1, "YouTube-Tunnel vorher angehalten");
  assert.deepEqual(f.log.map((e) => e.slice(0, 3)), [
    ["docker", "gluetun qbittorrent vpn-probe", "[Interface]\nPrivateKey = NEU\n"],
    ["check", "new", "identity"],
    ["check", "new", "isolation"],
    ["qbit"],
    ["plan", "new"],
  ]);
});

test("Profilwechsel scheitert → altes Profil zurück und geprüft, Plan unverändert", async () => {
  const f = await fixture({ failIdentityFor: "new" });
  await assert.rejects(f.sw.apply({ profileId: "new", confirmation: "OK" }), /bisherige Profil ist wieder aktiv/);
  assert.equal(await readFile(path.join(f.appdata, "gluetun", "wg0.conf"), "utf8"), "[Interface]\nPrivateKey = ALT\n");
  assert.match(await readFile(path.join(f.appdata, "gluetun", "auth.toml"), "utf8"), /apikey = "k-old"/);
  assert.equal(f.getPlan().vpnProfileId, "old");
  assert.ok(!f.log.some((e) => e[0] === "plan"));
  assert.deepEqual(f.log.filter((e) => e[0] === "check").map((e) => e.slice(1)), [["new", "identity"], ["old", "identity"], ["old", "isolation"]]);
});

test("Profilwechsel: Bestätigung, gleiches Profil, offene Ausfallsperre", async () => {
  const f = await fixture();
  await assert.rejects(f.sw.apply({ profileId: "new" }), /Bestätigung/);
  await assert.rejects(f.sw.apply({ profileId: "old", confirmation: "OK" }), /schon aktiv/);
  f.vault.set("safety-latch:r1", { at: 1 });
  await assert.rejects(f.sw.apply({ profileId: "new", confirmation: "OK" }), /VPN-Prüfung/);
  assert.equal(f.log.length, 0);
});
