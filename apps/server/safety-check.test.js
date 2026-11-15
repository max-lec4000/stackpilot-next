import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { StateStore } from "./state.js";
import { Vault } from "./vault.js";
import { SafetyCheck } from "./safety-check.js";
import { DownloadGuard } from "./download-guard.js";
test("Schutztest speichert Schritte, hält Downloads an, verriegelt bei Fehler und lässt sich nach Prozessneustart gezielt wiederholen", async () => {
  const root = await mkdtemp("/tmp/sp-safety-");
  let store = new StateStore(root);
  const plan = {
      id: "plan",
      project: "stackpilot",
      spec: { vpn: true, selected: ["qBittorrent"] },
      images: { qBittorrent: "image" },
    },
    calls = [];
  const qbit = {
      id: "a".repeat(64),
      service: "qbittorrent",
      status: "running",
      project: "stackpilot",
      managedPlan: "plan",
      image: "image",
    },
    relay = { id: "b".repeat(64), service: "api-relay" };
  let fail = true;
  let vault = new Vault(store);
  let engine;
  const make = () =>
    (engine = {
      store,
      vault,
      current: () => ({ plan, job: { status: "completed" } }),
      list: () => store.operations(),
      validate: async () => [qbit, relay],
      docker: async (args) => {
        calls.push(args);
        if (args[0] === "stop") qbit.status = "exited";
        if (args[0] === "start") qbit.status = "running";
      },
      vpnCheck: async (p, action) => {
        calls.push(["vpn", action]);
        if (action === "isolation" && fail) throw Error("leak");
      },
    });
  let paused = false;
  const services = {
    qbit: async (route, body) => {
      calls.push([route, body]);
      if (route === "/torrents/stop") paused = true;
      return [
        { hash: "c".repeat(40), state: paused ? "stoppedDL" : "downloading" },
        { hash: "d".repeat(40), state: "stoppedDL" },
      ];
    },
    wait: async () => {},
  };
  try {
    make();
    let guard = new DownloadGuard(engine, {
      scan: async () => [qbit, relay],
      proof: async () => {},
      services: () => services,
    });
    let check = new SafetyCheck(engine, guard, { services: () => services });
    await assert.rejects(check.start({ confirmation: "NO" }));
    const job = await check.start({ confirmation: "OK" });
    await check.pending;
    assert.equal(store.operation(job.id).status, "failed");
    assert.equal(qbit.status, "exited");
    assert.ok(vault.get("safety-latch:plan"));
    assert.equal((await guard.check(true)).state, "blocked");
    await assert.rejects(guard.resume(), /gesperrt/);
    assert.ok(!calls.some((c) => c[0] === "start"));
    store.close();
    store = new StateStore(root);
    vault = new Vault(store);
    make();
    fail = false;
    guard = new DownloadGuard(engine, {
      scan: async () => [qbit, relay],
      proof: async () => {},
      services: () => services,
    });
    check = new SafetyCheck(engine, guard, { services: () => services });
    await check.start({ confirmation: "OK", operationId: job.id });
    await check.pending;
    const completed = store.operation(job.id);
    assert.equal(completed.status, "completed");
    assert.ok(completed.steps.every((s) => s.status === "completed"));
    assert.equal(vault.get("safety-latch:plan"), null);
    assert.deepEqual(vault.get("download-policy:plan:paused"), [
      "c".repeat(40),
    ]);
    assert.equal((await guard.check(true)).state, "connected");
  } finally {
    store.close();
    await rm(root, { recursive: true });
  }
});
