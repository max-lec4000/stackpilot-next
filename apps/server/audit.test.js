import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { StateStore } from "./state.js";
import { AuditLog } from "./audit.js";
test("Änderungsverlauf speichert nur bekannte Aktionsnamen und keine Anfrageinhalte", async () => {
  const dir = await mkdtemp("/tmp/sp-audit-"),
    store = new StateStore(dir);
  try {
    const log = new AuditLog(store);
    assert.equal(log.begin("/unknown?password=secret", "admin"), null);
    const id = log.begin("/api/media/request", "admin");
    log.finish(id, true);
    const failed = log.begin("/api/media/request/cancel", "admin");
    log.finish(failed, false);
    const rows = log.list().events;
    assert.equal(rows.length, 2);
    assert.equal(rows[0].status, "failed");
    assert.equal(rows[1].status, "completed");
    assert.equal(rows[1].action, "Medienanfrage erstellt");
    assert.doesNotMatch(JSON.stringify(rows), /secret|password/);
    assert.throws(() => log.list(-1), /Ungültige/);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
