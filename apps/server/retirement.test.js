import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import { StateStore } from "./state.js";
import {
  buildRetirementPlan,
  fingerprint,
  RetirementEngine,
} from "./retirement.js";
function fixture(id = "a".repeat(64)) {
  return {
    id,
    name: "old-sonarr",
    imageId: "sha256:fixture",
    image: "sonarr",
    status: "running",
    restart: "unless-stopped",
    network: "bridge",
    project: "old",
    service: "sonarr",
    workingDir: "/fixture",
    configFiles: "/fixture/compose.yml",
    component: "sonarr",
    mounts: [
      {
        type: "volume",
        name: "fixture",
        source: "/fixture-data",
        destination: "/config",
        writable: true,
      },
    ],
  };
}
function fakeDocker(items) {
  const calls = [];
  return {
    calls,
    run: async (args) => {
      calls.push(args);
      if (args[0] === "ps") return items.map((c) => c.id).join("\n");
      if (args[0] === "inspect")
        return items
          .map((c) =>
            JSON.stringify({
              ...c,
              name: "/" + c.name,
              mounts: c.mounts.map((m) => ({
                Type: m.type,
                Name: m.name,
                Source: m.source,
                Destination: m.destination,
                RW: m.writable,
              })),
            }),
          )
          .join("\n");
      const c = items.find((c) => c.id === args.at(-1));
      if (args[0] === "update") c.restart = "no";
      if (args[0] === "stop") c.status = "exited";
      if (args[0] === "rm") items.splice(items.indexOf(c), 1);
      return "";
    },
  };
}
async function wait(engine, store, id) {
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 5));
    if (!engine.running) return store.operation(id);
  }
  assert.fail("Executor did not finish");
}
test("Ablöseplan blockiert unbekannte Dienste, fehlende Persistenz und Namespace-Abhängigkeiten", () => {
  assert.throws(() => buildRetirementPlan([fixture()], "stackpilot"));
  assert.throws(() =>
    buildRetirementPlan([{ ...fixture(), component: null }], "old"),
  );
  assert.throws(() =>
    buildRetirementPlan([{ ...fixture(), mounts: [] }], "old"),
  );
  assert.throws(() =>
    buildRetirementPlan(
      [
        fixture(),
        {
          ...fixture("b".repeat(64)),
          project: "other",
          network: "container:" + "a".repeat(64),
        },
      ],
      "old",
    ),
  );
  assert.equal(buildRetirementPlan([fixture()], "old").preserveData, true);
});
test("Containerdrift verändert den Fingerprint; Neustartregel ist ein erlaubter Auftragsschritt", () => {
  const c = fixture();
  assert.notEqual(fingerprint(c), fingerprint({ ...c, imageId: "changed" }));
  assert.equal(
    fingerprint(c),
    fingerprint({ ...c, restart: "no", status: "exited" }),
  );
});
test("Persistenz, doppelte Bestätigung und Daten-erhaltende Ausführung", async () => {
  const dir = await mkdtemp(os.tmpdir() + "/stackpilot-state-");
  let store = new StateStore(dir);
  try {
    const f = fakeDocker([fixture()]);
    const engine = new RetirementEngine(store, f.run);
    const plan = await engine.createPlan("old");
    await assert.rejects(engine.confirm(plan.id, "wrong", true));
    const op = await engine.confirm(plan.id, plan.confirmation, true);
    const done = await wait(engine, store, op.id);
    assert.equal(done.status, "completed");
    assert.equal(
      (await engine.confirm(plan.id, plan.confirmation, true)).id,
      op.id,
    );
    assert.deepEqual(
      f.calls
        .filter((a) => ["update", "stop", "rm"].includes(a[0]))
        .map((a) => a[0]),
      ["update", "stop", "rm"],
    );
    assert.ok(!f.calls.some((a) => a.includes("-v") || a.includes("--force")));
    store.close();
    store = new StateStore(dir);
    assert.equal(store.operation(op.id).status, "completed");
  } finally {
    store.close();
    await rm(dir, { recursive: true });
  }
});
test("Drift nach Planung verhindert jede Änderung", async () => {
  const dir = await mkdtemp(os.tmpdir() + "/stackpilot-drift-");
  const store = new StateStore(dir);
  try {
    const items = [fixture()];
    const f = fakeDocker(items);
    const engine = new RetirementEngine(store, f.run);
    const plan = await engine.createPlan("old");
    items[0].imageId = "changed";
    await assert.rejects(engine.confirm(plan.id, plan.confirmation, true));
    assert.ok(!f.calls.some((a) => a[0] === "update"));
  } finally {
    store.close();
    await rm(dir, { recursive: true });
  }
});
test("Abbruch nach bereits erfolgtem Entfernen wird idempotent fortgesetzt", async () => {
  const dir = await mkdtemp(os.tmpdir() + "/stackpilot-resume-");
  const store = new StateStore(dir);
  try {
    const f = fakeDocker([fixture()]);
    let failOnce = true;
    const engine = new RetirementEngine(store, async (args) => {
      const result = await f.run(args);
      if (args[0] === "rm" && failOnce) {
        failOnce = false;
        throw new Error("Abbruch nach externer Änderung");
      }
      return result;
    });
    const plan = await engine.createPlan("old");
    const op = await engine.confirm(plan.id, plan.confirmation, true);
    assert.equal((await wait(engine, store, op.id)).status, "failed");
    await engine.resume(op.id);
    assert.equal((await wait(engine, store, op.id)).status, "completed");
    assert.equal(f.calls.filter((a) => a[0] === "rm").length, 1);
  } finally {
    store.close();
    await rm(dir, { recursive: true });
  }
});
test("Zwei Executor-Instanzen erhalten keine gleichzeitige Sperre", async () => {
  const dir = await mkdtemp(os.tmpdir() + "/stackpilot-lease-");
  const a = new StateStore(dir);
  const b = new StateStore(dir);
  try {
    assert.equal(a.claim("first"), true);
    assert.equal(b.claim("second"), false);
    a.release("first");
    assert.equal(b.claim("second"), true);
  } finally {
    a.close();
    b.close();
    await rm(dir, { recursive: true });
  }
});
test("Nach Neustart wird ein unterbrochener Auftrag pausiert und kann wieder aufgenommen werden", async () => {
  const dir = await mkdtemp(os.tmpdir() + "/stackpilot-restart-");
  let store = new StateStore(dir);
  try {
    const f = fakeDocker([fixture()]);
    let engine = new RetirementEngine(store, f.run);
    const plan = await engine.createPlan("old");
    const op = store.createOperation({
      id: "interrupted",
      planId: plan.id,
      project: "old",
      kind: "retirement",
      status: "running",
      pauseRequested: false,
      steps: plan.steps.map((s) => ({ ...s, status: "pending", attempts: 0 })),
    });
    store.close();
    store = new StateStore(dir);
    engine = new RetirementEngine(store, f.run);
    assert.equal(engine.list()[0].status, "paused");
    await engine.resume(op.id);
    assert.equal((await wait(engine, store, op.id)).status, "completed");
  } finally {
    store.close();
    await rm(dir, { recursive: true });
  }
});
test("Pause wartet auf laufenden Schritt und Fortsetzen wiederholt keinen abgeschlossenen Schritt", async () => {
  const dir = await mkdtemp(os.tmpdir() + "/stackpilot-pause-");
  const store = new StateStore(dir);
  try {
    const f = fakeDocker([fixture()]);
    let release;
    const gate = new Promise((r) => (release = r));
    let entered = false;
    const engine = new RetirementEngine(store, async (args) => {
      if (args[0] === "update") {
        entered = true;
        await gate;
      }
      return f.run(args);
    });
    const plan = await engine.createPlan("old");
    const op = await engine.confirm(plan.id, plan.confirmation, true);
    for (let i = 0; i < 100 && !entered; i++)
      await new Promise((r) => setTimeout(r, 2));
    assert.ok(entered);
    engine.pause(op.id);
    release();
    assert.equal((await wait(engine, store, op.id)).status, "paused");
    assert.equal(f.calls.filter((a) => a[0] === "stop").length, 0);
    await engine.resume(op.id);
    assert.equal((await wait(engine, store, op.id)).status, "completed");
    assert.equal(f.calls.filter((a) => a[0] === "update").length, 1);
  } finally {
    store.close();
    await rm(dir, { recursive: true });
  }
});
test("Beenden eines pausierten Auftrags führt keine Aktion aus und ist endgültig", async () => {
  const dir = await mkdtemp(os.tmpdir() + "/stackpilot-end-");
  const store = new StateStore(dir);
  try {
    const f = fakeDocker([fixture()]);
    const engine = new RetirementEngine(store, f.run);
    const plan = await engine.createPlan("old");
    const op = store.createOperation({
      id: "end-fixture",
      planId: plan.id,
      project: "old",
      kind: "retirement",
      status: "paused",
      steps: plan.steps.map((s) => ({ ...s, status: "pending", attempts: 0 })),
    });
    assert.throws(() => engine.end(op.id, "wrong"));
    assert.equal(engine.end(op.id, "AUFTRAG BEENDEN").status, "cancelled");
    await assert.rejects(engine.resume(op.id));
    assert.ok(!f.calls.some((a) => ["update", "stop", "rm"].includes(a[0])));
  } finally {
    store.close();
    await rm(dir, { recursive: true });
  }
});
