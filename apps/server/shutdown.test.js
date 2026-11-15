import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { StateStore } from "./state.js";
import { inventoryMiddleware } from "./middleware.js";
test("Beenden fordert Auftragspause an und gibt eine noch belegte Sperre nicht vorzeitig frei", async () => {
  const root = await mkdtemp("/tmp/sp-shutdown-"),
    store = new StateStore(root);
  try {
    store.savePlan({ id: "p", spec: { selected: [] } });
    store.createOperation({
      id: "job",
      planId: "p",
      kind: "deployment",
      status: "queued",
      steps: [],
    });
    store.claim("existing-worker");
    const api = inventoryMiddleware({ store });
    const result = await api.shutdown(0);
    assert.equal(result.idle, false);
    assert.equal(store.operation("job").pauseRequested, true);
    assert.equal(store.owns("existing-worker"), true);
    store.release("existing-worker");
    assert.equal((await api.shutdown(0)).idle, true);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("Eigenständiger Berichtkontext beendet keine laufenden Installationsaufträge", async () => {
  const dir = await mkdtemp("/tmp/stackpilot-report-close-");
  try {
    const store = new StateStore(dir);
    const api = inventoryMiddleware({ store, background: false });
    store.operations = () => {
      throw Error("Bericht darf Aufträge nicht pausieren");
    };
    api.closeReportContext();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
