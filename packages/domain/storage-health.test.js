import { test } from "node:test";
import assert from "node:assert/strict";
import { storageHealth } from "./storage-health.js";
const gib = 1024 ** 3;
test("Speicherwarnungen unterscheiden unbekannt, knapp und kritisch ohne große Pools pauschal zu blockieren", () => {
  assert.equal(storageHealth(null).state, "unknown");
  assert.equal(
    storageHealth({ freeBytes: NaN, totalBytes: 1 }).state,
    "unknown",
  );
  assert.equal(
    storageHealth({ freeBytes: 0, totalBytes: 100 * gib }).state,
    "critical",
  );
  assert.equal(
    storageHealth({ freeBytes: 3 * gib, totalBytes: 100 * gib }).state,
    "warning",
  );
  assert.equal(
    storageHealth({ freeBytes: 100 * gib, totalBytes: 8000 * gib }).state,
    "ok",
  );
});
