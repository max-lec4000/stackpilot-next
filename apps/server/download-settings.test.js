import { test } from "node:test";
import assert from "node:assert/strict";
import { DownloadSettings, project, toPreferences } from "./download-settings.js";

// qBittorrent-Verhalten nachgebildet: ausgeschaltete Ziele werden als -1 gemeldet
function qbitPrefs(p) {
  return { ...p, max_ratio: p.max_ratio_enabled ? p.max_ratio : -1, max_seeding_time: p.max_seeding_time_enabled ? p.max_seeding_time : -1 };
}
const base = qbitPrefs({ max_ratio_enabled: false, max_seeding_time_enabled: false, max_ratio_act: 0, dl_limit: 0, up_limit: 0,
  scheduler_enabled: false, schedule_from_hour: 8, schedule_from_min: 0, schedule_to_hour: 20, schedule_to_min: 0, scheduler_days: 0,
  alt_dl_limit: 10240, alt_up_limit: 10240, save_path: "/data/downloads/complete" });

const body = (over = {}) => ({
  seeding: { ratio: 2, hours: 72, action: "stop" }, limits: { downKiB: 0, upKiB: 5000 },
  schedule: { enabled: true, from: "18:00", to: "23:30", days: "weekdays", downKiB: 2000, upKiB: 500 }, confirmation: "OK", ...over,
});

test("Darstellung und Eingabeprüfung", () => {
  assert.deepEqual(project(base), {
    seeding: { ratio: null, hours: null, action: "stop" }, limits: { downKiB: 0, upKiB: 0 },
    schedule: { enabled: false, from: "08:00", to: "20:00", days: "all", downKiB: 10, upKiB: 10 },
  });
  assert.equal(project({ ...base, max_ratio_act: 3 }).seeding.action, "other");
  const p = toPreferences(body());
  assert.equal(p.max_ratio, 2); assert.equal(p.max_seeding_time, 4320); assert.equal(p.max_ratio_act, 0);
  assert.equal(p.up_limit, 5000 * 1024); assert.equal(p.scheduler_days, 1); assert.equal(p.schedule_to_min, 30);
  assert.ok(!("save_path" in p), "nur Seeding-, Limit- und Zeitplanschlüssel");
  assert.equal(toPreferences(body({ seeding: { ratio: null, hours: "", action: "remove" } })).max_ratio_enabled, false);
  for (const [over, msg] of [
    [{ seeding: { ratio: 0, hours: null, action: "stop" } }, /Verhältnis/],
    [{ seeding: { ratio: 1, hours: null, action: "delete-files" } }, /anhalten oder entfernen/],
    [{ limits: { downKiB: -1, upKiB: 0 } }, /KiB/],
    [{ schedule: { enabled: true, from: "25:00", to: "23:00", days: "all", downKiB: 0, upKiB: 0 } }, /HH:MM/],
    [{ schedule: { enabled: true, from: "18:00", to: "18:00", days: "all", downKiB: 0, upKiB: 0 } }, /unterscheiden/],
    [{ schedule: { enabled: true, from: "18:00", to: "19:00", days: "montags", downKiB: 0, upKiB: 0 } }, /Tage/],
  ]) assert.throws(() => toPreferences(body(over)), msg);
});

function setup(accept = (p) => p) {
  let prefs = { ...base };
  const posts = [];
  const s = { qbit: async (route, form) => {
    if (route === "/app/preferences") return { ...prefs };
    posts.push(JSON.parse(form.json));
    prefs = qbitPrefs({ ...prefs, ...accept(JSON.parse(form.json)) });
    return "";
  } };
  const hub = {
    engine: { current: () => ({ job: { status: "completed" }, plan: { spec: { selected: ["qBittorrent"] } } }) },
    context: async () => ({ s }), mutate: async (_n, fn) => fn({ s }),
  };
  return { settings: new DownloadSettings(hub), posts };
}

test("Speichern mit OK, zurücklesen, Abweichung melden", async () => {
  const { settings, posts } = setup();
  await assert.rejects(settings.change(body({ confirmation: undefined })), /mit OK/);
  const after = await settings.change(body());
  assert.equal(posts.length, 1);
  assert.deepEqual(after.seeding, { ratio: 2, hours: 72, action: "stop" });
  assert.deepEqual(after.schedule, { enabled: true, from: "18:00", to: "23:30", days: "weekdays", downKiB: 2000, upKiB: 500 });
  const off = await settings.change(body({ seeding: { ratio: null, hours: null, action: "remove" } }));
  assert.deepEqual(off.seeding, { ratio: null, hours: null, action: "remove" });
  const stubborn = setup((p) => ({ ...p, up_limit: 0 }));
  await assert.rejects(stubborn.settings.change(body()), /nicht alle Einstellungen übernommen: up_limit/);
});
