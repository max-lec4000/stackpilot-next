import { test } from "node:test";
import assert from "node:assert/strict";
import { SeriesMonitoring, projectSeries } from "./series-monitoring.js";

const plan = { id: "p", spec: { selected: ["Sonarr"] } };
function setup({ vpn = true, ignore = false } = {}) {
  const db = {
    9: { id: 9, title: "Eine Serie", year: 2020, monitored: true, monitorNewItems: "all", status: "continuing", path: "/data/media/tv/x",
      statistics: { episodeFileCount: 3, episodeCount: 5, totalEpisodeCount: 11 },
      seasons: [{ seasonNumber: 0, monitored: false }, { seasonNumber: 1, monitored: true, statistics: { episodeFileCount: 3, episodeCount: 3, totalEpisodeCount: 3 } },
        { seasonNumber: 2, monitored: false, statistics: { episodeFileCount: 0, episodeCount: 2, totalEpisodeCount: 8 } }] },
    4: { id: 4, title: "Alte Serie", monitored: false, monitorNewItems: "none", status: "ended", seasons: [] },
  };
  const calls = [];
  const s = {
    arr: async (_svc, route, o = {}) => {
      calls.push([o.method || "GET", route, o.body]);
      if (route === "/series") return Object.values(db).map((v) => structuredClone(v));
      const m = route.match(/^\/series\/(\d+)/);
      if (m && o.method === "PUT") { if (!ignore) db[m[1]] = structuredClone(o.body); return o.body; }
      if (m) return structuredClone(db[m[1]] ?? {});
      if (route === "/command") return { id: 5 };
      return null;
    },
  };
  const hub = {
    engine: { current: () => ({ job: { status: "completed" }, plan }) },
    context: async () => ({ s, plan }), mutate: async (_n, fn) => fn({ s, plan }),
    requireVpn: async () => { if (!vpn) throw Error("Downloads gesperrt: zuerst Mullvad verbinden und prüfen."); },
  };
  return { m: new SeriesMonitoring(hub), db, calls };
}

test("Serienliste: sortiert, Staffeln und fehlende Folgen", async () => {
  const { m } = setup();
  const { series } = await m.list();
  assert.deepEqual(series.map((v) => v.title), ["Alte Serie", "Eine Serie"]);
  assert.deepEqual(series[1], { id: 9, title: "Eine Serie", year: 2020, monitored: true, newSeasons: true, ended: false, files: 3, aired: 5, total: 11, missing: 2,
    seasons: [{ number: 0, monitored: false, files: 0, aired: 0, total: 0 }, { number: 1, monitored: true, files: 3, aired: 3, total: 3 }, { number: 2, monitored: false, files: 0, aired: 2, total: 8 }] });
  assert.equal(projectSeries({ id: 1 }).title, "Unbenannte Serie");
});

test("Überwachung ändern: ausschalten ohne OK, einschalten nur mit OK, Rest bleibt", async () => {
  const { m, db, calls } = setup();
  await assert.rejects(m.change({ seriesId: 9 }), /Nichts zu ändern/);
  await assert.rejects(m.change({ seriesId: 9, seasons: { 7: true } }), /Staffel 7 gibt es/);
  await assert.rejects(m.change({ seriesId: 9, seasons: [true] }), /Ungültige Staffelangabe/);
  await assert.rejects(m.change({ seriesId: 9, monitored: "nein" }), /Ungültige Angabe/);
  const off = await m.change({ seriesId: 9, newSeasons: false, seasons: { 1: false } });
  assert.deepEqual([off.newSeasons, off.seasons[1].monitored, off.monitored], [false, false, true]);
  assert.equal(db[9].path, "/data/media/tv/x", "übrige Felder bleiben");
  assert.ok(calls.some(([meth, r]) => meth === "PUT" && r === "/series/9?moveFiles=false"));
  await assert.rejects(m.change({ seriesId: 9, seasons: { 2: true } }), /mit OK/);
  assert.equal(db[9].seasons[2].monitored, false);
  const on = await m.change({ seriesId: 9, seasons: { 2: true }, confirmation: "OK" });
  assert.equal(on.seasons[2].monitored, true);
  await assert.rejects(m.change({ seriesId: 4, monitored: true }), /mit OK/);
  await assert.rejects(m.change({ seriesId: 99, monitored: false }), /nicht gefunden/);
});

test("Änderung ohne Bestätigung durch Sonarr wird gemeldet", async () => {
  const { m } = setup({ ignore: true });
  await assert.rejects(m.change({ seriesId: 9, monitored: false }), /nicht bestätigt/);
});

test("Fehlende Folgen suchen: OK, VPN, nur überwachte Staffeln", async () => {
  const { m, calls } = setup();
  await assert.rejects(m.search({ seriesId: 9 }), /mit OK/);
  await assert.rejects(m.search({ seriesId: 9, season: 2, confirmation: "OK" }), /Staffel 2 wird nicht überwacht/);
  await assert.rejects(m.search({ seriesId: 4, confirmation: "OK" }), /nicht überwacht/);
  const r = await m.search({ seriesId: 9, season: 1, confirmation: "OK" });
  assert.match(r.message, /Eine Serie.*Staffel 1/);
  assert.deepEqual(calls.at(-1), ["POST", "/command", { name: "SeasonSearch", seriesId: 9, seasonNumber: 1 }]);
  await m.search({ seriesId: 9, confirmation: "OK" });
  assert.deepEqual(calls.at(-1)[2], { name: "SeriesSearch", seriesId: 9 });
  const blocked = setup({ vpn: false });
  await assert.rejects(blocked.m.search({ seriesId: 9, confirmation: "OK" }), /Mullvad/);
  assert.ok(!blocked.calls.some(([meth]) => meth === "POST"));
});
