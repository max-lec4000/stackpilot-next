import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { StateStore } from "./state.js";
import { Vault } from "./vault.js";
import { RemovedMovies } from "./removed-movies.js";
test("Bereits abgeschlossene Löschungen werden ohne erneutes Löschen aus dem verschlüsselten Journal übernommen", async () => {
  const dir = await mkdtemp("/tmp/sp-removal-upgrade-"),
    store = new StateStore(dir),
    vault = new Vault(store);
  try {
    store.savePlan({ id: "old", rootId: "root" });
    vault.set("movie-removal:older", {
      planId: "old",
      tmdbId: 42,
      requestId: 7,
      mediaRecordId: 12,
      steps: { done: true },
    });
    vault.set("movie-removal:newer", {
      planId: "old",
      tmdbId: 42,
      requestId: 8,
      mediaRecordId: 12,
      steps: { done: true },
    });
    vault.set("movie-removal:unfinished", {
      planId: "old",
      tmdbId: 99,
      requestId: 9,
      steps: { movie: true },
    });
    const monitor = new RemovedMovies({ engine: { vault, store } });
    assert.equal(
      monitor.marker({ id: "new", rootId: "root" }, 42).requestId,
      8,
    );
    assert.equal(monitor.marker({ id: "new", rootId: "root" }, 99), null);
    assert.equal(monitor.marker({ id: "other" }, 42), null);
    assert.equal(
      new RemovedMovies({ engine: { vault, store } }).marker(
        { id: "new", rootId: "root" },
        42,
      ).requestId,
      8,
    );
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
