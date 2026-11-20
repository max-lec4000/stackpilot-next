import { test } from "node:test";
import assert from "node:assert/strict";
import { UpdateWindow, inWindow, nextWindow } from "./update-window.js";

test("Fenster und nächster Termin", () => {
  const s = { enabled: true, day: 0, hour: 5 };
  assert.equal(inWindow(new Date(2026, 10, 22, 5, 10), s), true, "Sonntag 05:10");
  assert.equal(inWindow(new Date(2026, 10, 22, 6, 0), s), false);
  assert.equal(inWindow(new Date(2026, 10, 23, 5, 10), s), false, "Montag");
  assert.equal(inWindow(new Date(2026, 10, 23, 5, 10), { ...s, day: "daily" }), true);
  assert.equal(nextWindow(new Date(2026, 10, 20, 12, 0), s).getTime(), new Date(2026, 10, 22, 5, 0).getTime());
  assert.equal(nextWindow(new Date(2026, 10, 22, 5, 30), s).getTime(), new Date(2026, 10, 29, 5, 0).getTime());
  assert.equal(nextWindow(new Date(2026, 10, 20, 3, 0), { ...s, day: "daily" }).getTime(), new Date(2026, 10, 20, 5, 0).getTime());
  assert.equal(nextWindow(new Date(), { enabled: false }), null);
});

function setup({ playing = false, lease = false } = {}) {
  const vault = new Map();
  let now = new Date(2026, 10, 22, 5, 1);
  const applied = [];
  const maintenance = {
    list: async () => ({ services: [{ name: "Radarr", update: true, review: "r1" }, { name: "Sonarr", update: false, review: "r2" }] }),
    applyBatch: async (body) => { applied.push(body); return { results: body.targets.map((t) => ({ name: t.name, phase: "updated" })) }; },
  };
  const hub = {
    engine: { current: () => ({ plan: { spec: { selected: ["Jellyfin", "Radarr"] } } }), vault: { get: (k) => vault.get(k), set: (k, v) => vault.set(k, v) },
      store: { activeLease: () => lease } },
    context: async () => ({ s: {}, plan: {} }),
    library: { request: async () => (playing ? [{ NowPlayingItem: { Name: "x" } }] : [{}]) },
  };
  const w = new UpdateWindow(hub, maintenance, { now: () => now });
  return { w, applied, vault, setNow: (d) => { now = d; } };
}

test("Einstellungen speichern mit OK", async () => {
  const { w } = setup();
  assert.throws(() => w.save({ enabled: true, day: 0, hour: 5 }), /mit OK/);
  assert.throws(() => w.save({ enabled: true, day: 9, hour: 5, confirmation: "OK" }), /Tag und Stunde/);
  const st = await w.save({ enabled: true, day: "daily", hour: 4, confirmation: "OK" });
  assert.deepEqual([st.enabled, st.day, st.hour, st.pending], [true, "daily", 4, ["Radarr"]]);
});

test("Im Fenster werden bereitstehende Updates einmal eingespielt", async () => {
  const { w, applied } = setup();
  w.save({ enabled: true, day: 0, hour: 5, confirmation: "OK" });
  const r = await w.tick();
  assert.deepEqual(applied[0].targets, [{ name: "Radarr", review: "r1" }]);
  assert.deepEqual([r.failed, r.results[0].phase], [0, "updated"]);
  assert.equal(await w.tick(), null, "nur einmal je Tag");
});

test("Wiedergabe läuft: später erneut, am Ende der Stunde übersprungen", async () => {
  const { w, applied, setNow } = setup({ playing: true });
  w.save({ enabled: true, day: 0, hour: 5, confirmation: "OK" });
  assert.equal(await w.tick(), null);
  setNow(new Date(2026, 10, 22, 5, 56));
  const r = await w.tick();
  assert.match(r.skipped, /abgespielt/);
  assert.equal(applied.length, 0);
  assert.equal(await w.tick(), null);
});

test("Außerhalb des Fensters oder ausgeschaltet passiert nichts", async () => {
  const { w, applied, setNow } = setup();
  assert.equal(await w.tick(), null, "aus");
  w.save({ enabled: true, day: 1, hour: 5, confirmation: "OK" });
  assert.equal(await w.tick(), null, "falscher Tag");
  setNow(new Date(2026, 10, 23, 7, 0));
  assert.equal(await w.tick(), null, "falsche Stunde");
  assert.equal(applied.length, 0);
});
