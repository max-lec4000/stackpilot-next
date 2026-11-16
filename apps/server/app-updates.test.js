import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AppUpdates } from "./app-updates.js";
import { catalog } from "./catalog.js";
import { StateStore } from "./state.js";

test("App-Updates werden täglich je Quelle geprüft und überstehen einen Neustart", async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "stackpilot-app-updates-"));
  const store = new StateStore(directory);
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const { Seerr, Sonarr, Radarr } = catalog.services;
  const plan = { spec: { selected: ["Seerr", "Sonarr"] } };
  const job = { status: "running" };
  const engine = { store, current: () => ({ job, plan }) };
  const latest = "sha256:" + "a".repeat(64);
  const platform = "sha256:" + "b".repeat(64);
  const calls = [];
  let offline = true;
  const lookup = async (source) => {
    calls.push(source);
    if (offline && source === Sonarr.source) throw Error("Registry offline");
    return [latest, platform];
  };
  const checker = new AppUpdates(engine, lookup);
  await checker.check();
  assert.deepEqual(calls, []);

  job.status = "completed";
  await Promise.all([checker.check(), new AppUpdates(engine, lookup).check()]);
  assert.deepEqual(calls, [Seerr.source, Sonarr.source]);
  const restarted = new AppUpdates(engine, lookup);
  assert.equal(restarted.available("Seerr", Seerr.image), true);
  assert.equal(restarted.available("Sonarr", Sonarr.image), false);
  assert.equal(restarted.available("Seerr", undefined), false);
  assert.equal(restarted.available("Seerr", Sonarr.image), false);
  for (const installed of [latest, platform])
    assert.equal(restarted.available("Seerr", Seerr.source.replace(/:latest$/, "@" + installed)), false);

  plan.spec.selected.push("Radarr");
  await restarted.check();
  assert.deepEqual(calls, [Seerr.source, Sonarr.source, Radarr.source]);
  offline = false;
  store.db.prepare("UPDATE app_update_checks SET attempted = ?").run(Date.now() - 24 * 60 * 60 * 1000);
  await restarted.check();
  assert.deepEqual(calls, [Seerr.source, Sonarr.source, Radarr.source, Seerr.source, Sonarr.source, Radarr.source]);
  assert.equal(restarted.available("Sonarr", Sonarr.image), true);
});
