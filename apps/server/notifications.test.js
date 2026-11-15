import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { StateStore } from "./state.js";
import { Notifications } from "./notifications.js";
test("Lokale Meldungen deduplizieren, überleben Neustart und wiederholen neue Problemphasen", async () => {
  const dir = mkdtempSync("/tmp/sp-notices-");
  const store = new StateStore(dir);
  let tasks = [{ id: "vpn", state: "attention", title: "VPN prüfen", reason: "Schutz nicht bestätigt", target: "manage" }];
  const ops = { inspect: async () => ({ tasks }) }, hub = { engine: { current: () => null } };
  try {
    const inbox = new Notifications(store, ops, hub);
    await inbox.collect(); await inbox.collect();
    assert.equal(inbox.list().unread, 1);
    inbox.mark(inbox.list().results.map((notice) => notice.id));
    assert.equal(inbox.list().unread, 0);
    tasks = []; await inbox.collect();
    tasks = [{ id: "vpn", state: "attention", title: "VPN prüfen", reason: "Schutz nicht bestätigt", target: "manage" }];
    await inbox.collect();
    assert.equal(new Notifications(store, ops, hub).list().results.length, 2);
    ops.inspect = async () => { throw Error("private endpoint error"); };
    await inbox.collect();
    assert.ok(inbox.list().error);
    assert.equal(inbox.list().results.length, 2);
    assert.ok(!JSON.stringify(inbox.list()).includes("private endpoint"));
    assert.throws(() => inbox.mark(["invalid"]), /Ungültige/);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
test("Bereits verfügbare Medien werden nicht neu gemeldet; echte Statuswechsel schon", async () => {
  const dir = mkdtempSync("/tmp/sp-notices-"); const store = new StateStore(dir);
  let state = "downloading";
  const hub = { engine: { current: () => ({ job: { status: "completed" }, plan: { id: "p", spec: { selected: ["Seerr"] } } }) }, requests: async () => ({ results: [{ id: 1, title: "Testfilm", state }], pages: 1 }) };
  try {
    const inbox = new Notifications(store, { inspect: async () => ({ tasks: [] }) }, hub);
    await inbox.collect(); assert.equal(inbox.list().unread, 0);
    state = "available"; await inbox.collect(); await inbox.collect();
    assert.equal(inbox.list().unread, 1); assert.equal(inbox.list().results[0].target, "#/anfragen");
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
