import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { DownloadGuard } from "./download-guard.js";
import { StateStore } from "./state.js";
import { Vault } from "./vault.js";
function fixture(vpn = true) {
  const values = new Map(),
    calls = [];
  const plan = {
    id: "fixture",
    project: "stackpilot",
    spec: { selected: ["qBittorrent"], vpn },
    images: { qBittorrent: "pinned-qbit" },
  };
  const qbit = {
    id: "a".repeat(64),
    project: plan.project,
    managedPlan: plan.id,
    image: plan.images.qBittorrent,
    service: "qbittorrent",
    status: "running",
  };
  const engine = {
    current: () => ({ plan, job: { status: "completed" } }),
    store: { activeLease: () => false, claim: () => true, release: () => {} },
    vault: { get: (k) => values.get(k), set: (k, v) => values.set(k, v) },
    validate: async () => [qbit],
    docker: async (args) => calls.push(args),
  };
  const client = {
    qbit: async (route, body) => {
      calls.push([route, body]);
      if (route === "/torrents/info")
        return [
          { hash: "a".repeat(40), state: "downloading" },
          { hash: "b".repeat(40), state: "stoppedDL" },
        ];
    },
    wait: async () => {},
  };
  return {
    engine,
    plan,
    qbit,
    calls,
    values,
    guard: new DownloadGuard(engine, {
      scan: async () => [qbit],
      proof: async () => {},
      services: () => client,
    }),
    client,
  };
}
test("VPN-Verlust pausiert nur aktive Torrents; Fortsetzen prüft erneut und startet keine manuell pausierten", async () => {
  const f = fixture();
  f.guard.proof = async () => {
    throw Error("offline");
  };
  assert.equal((await f.guard.check(true)).state, "blocked");
  assert.deepEqual(f.calls.find((c) => c[0] === "/torrents/stop")[1], {
    hashes: "a".repeat(40),
  });
  await assert.rejects(f.guard.resume(), /Fortsetzen gesperrt/);
  assert.ok(!f.calls.some((c) => c[0] === "/torrents/start"));
  f.guard.proof = async () => {};
  await f.guard.resume();
  assert.deepEqual(f.calls.find((c) => c[0] === "/torrents/start")[1], {
    hashes: "a".repeat(40),
  });
});
test("Fremde und veränderte Container werden nicht angehalten; laufende Aufträge haben Vorrang", async () => {
  const f = fixture(false);
  f.qbit.project = "foreign";
  assert.equal((await f.guard.check(true)).state, "blocked");
  assert.equal(f.calls.length, 0);
  f.qbit.project = f.plan.project;
  f.qbit.image = "different";
  await f.guard.check(true);
  assert.equal(f.calls.length, 0);
  f.qbit.image = f.plan.images.qBittorrent;
  f.engine.store.activeLease = () => true;
  assert.equal((await f.guard.check(true)).state, "checking");
  assert.equal(f.calls.length, 0);
});
test("Bei nicht vertrauenswürdigem Netzwerk werden keine API-Zugänge gesendet und nur der eigene Downloadclient gestoppt", async () => {
  const f = fixture();
  f.engine.validate = async () => {
    throw Error("drift");
  };
  f.guard.services = () => {
    assert.fail("No credentials over unvalidated relay");
  };
  assert.equal((await f.guard.check(true)).state, "blocked");
  assert.deepEqual(
    f.calls.map((c) => c[0]),
    ["update", "stop"],
  );
  assert.ok(f.calls.every((c) => c.includes(f.qbit.id)));
});
test("Ungeschützter Altclient wird angehalten, Neustart gesperrt und Konfiguration verschlüsselt erhalten", async () => {
  const dir = await mkdtemp("/tmp/sp-guard-");
  const store = new StateStore(dir + "/state");
  try {
    const f = fixture(false);
    f.engine.vault = new Vault(store);
    f.plan.appdata = dir + "/appdata";
    await mkdir(f.plan.appdata + "/qbittorrent/qBittorrent", {
      recursive: true,
    });
    await writeFile(
      f.plan.appdata + "/.stackpilot-owner.json",
      JSON.stringify({ planId: f.plan.id }),
    );
    await writeFile(
      f.plan.appdata + "/qbittorrent/qBittorrent/qBittorrent.conf",
      "fixture-private-config",
    );
    assert.equal((await f.guard.check(true)).enforced, true);
    assert.deepEqual(
      f.calls.map((c) => c[0]),
      ["update", "stop"],
    );
    assert.equal(
      f.engine.vault.get("download-policy:fixture:legacy-config").config,
      "fixture-private-config",
    );
    assert.ok(
      !(await readFile(dir + "/state/state.sqlite")).includes(
        Buffer.from("fixture-private-config"),
      ),
    );
    await assert.rejects(f.guard.resume(), /gesperrt/);
  } finally {
    store.close();
    await rm(dir, { recursive: true });
  }
});
test("Ein alter gespeicherter Ohne-VPN-Installationsplan kann nicht mehr bestätigt werden", async () => {
  const { DeploymentEngine } = await import("./installer.js");
  const dir = await mkdtemp("/tmp/sp-old-policy-");
  const store = new StateStore(dir);
  try {
    const engine = new DeploymentEngine(store, new Vault(store));
    store.savePlan({
      id: "old",
      kind: "deployment",
      executable: true,
      confirmation: "OK",
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      spec: { selected: ["qBittorrent"], vpn: false },
    });
    await assert.rejects(
      engine.confirm("old", "OK", true),
      /ohne VPN sind gesperrt/,
    );
  } finally {
    store.close();
    await rm(dir, { recursive: true });
  }
});

test("Bereits gestoppter ungeschützter Altclient bleibt auch nach Docker-Neustart gesperrt", async () => {
  const f = fixture(false);
  f.qbit.status = "exited";
  assert.equal((await f.guard.check(true)).enforced, true);
  assert.deepEqual(f.calls, [["update", "--restart=no", f.qbit.id]]);
});
