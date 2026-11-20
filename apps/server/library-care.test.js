import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LibraryCare, duplicateGroups } from "./library-care.js";

async function setup({ now = Date.parse("2026-11-20T00:00:00Z") } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "care-"));
  const plan = { id: "p", spec: { path: root, selected: ["Jellyfin", "Radarr", "Sonarr"] } };
  await mkdir(path.join(root, "media/movies/Film (2020)"), { recursive: true });
  await writeFile(path.join(root, "media/movies/Film (2020)/Film.mkv"), "x".repeat(10));
  await writeFile(path.join(root, "media/movies/Film (2020)/Film.alt.mkv"), "y".repeat(20));
  const cfg = { Radarr: { id: 1, recycleBin: "", recycleBinCleanupDays: 7, other: true }, Sonarr: { id: 1, recycleBin: "/irgendwo", recycleBinCleanupDays: 7 } };
  const calls = [];
  const s = { arr: async (svc, route, o = {}) => {
    calls.push([svc, o.method || "GET", route]);
    if (route.startsWith("/config/mediamanagement") && o.method === "PUT") { cfg[svc] = o.body; return o.body; }
    if (route === "/config/mediamanagement") return structuredClone(cfg[svc]);
    if (route === "/movie") return [{ movieFile: { path: "/data/media/movies/Film (2020)/Film.mkv" } }];
    if (route === "/series") return [];
    return [];
  } };
  const movie = { Id: "m1", Name: "Film", ProductionYear: 2020, ProviderIds: { Tmdb: "5" }, DateCreated: "2025-01-01T00:00:00Z",
    MediaSources: [{ Path: "/data/media/movies/Film (2020)/Film.mkv", Size: 10 }, { Path: "/data/media/movies/Film (2020)/Film.alt.mkv", Size: 20 }] };
  const jcalls = [];
  const hub = {
    engine: { current: () => ({ job: { status: "completed" }, plan }) },
    context: async () => ({ s, plan }), mutate: async (_n, fn) => fn({ s, plan }),
    library: { request: async (_s, _p, route, o = {}) => {
      jcalls.push([o.method || "GET", route]);
      if (route.startsWith("/Items?Recursive=true&IncludeItemTypes=Movie")) return { Items: [movie] };
      if (route.startsWith("/Items?Recursive=true&IncludeItemTypes=Episode")) return { Items: [] };
      if (route === "/Users") return [{ Id: "a".repeat(32) }, { Id: "b".repeat(32), Policy: { IsDisabled: true } }];
      if (route.startsWith("/Users/")) return { Items: [
        { ...movie, UserData: { Played: false } },
        { Id: "m2", Name: "Gesehen", DateCreated: "2024-01-01T00:00:00Z", MediaSources: [{ Size: 99 }], UserData: { Played: true, LastPlayedDate: "2026-11-01T00:00:00Z" } },
        { Id: "m3", Name: "Neu", DateCreated: "2026-11-10T00:00:00Z", UserData: {} },
      ] };
      return null;
    } },
  };
  return { care: new LibraryCare(hub, { now: () => now }), root, cfg, calls, jcalls };
}

test("Doppelte: gleicher Film mehrfach bzw. mehrere Dateien", () => {
  const g = duplicateGroups([
    { Id: "1", Name: "A", ProviderIds: { Tmdb: "9" }, Path: "/data/media/movies/A/a.mkv" },
    { Id: "2", Name: "A", ProviderIds: { Tmdb: "9" }, Path: "/data/media/movies/A2/a.mkv" },
    { Id: "3", Name: "B", ProviderIds: { Tmdb: "8" }, Path: "/data/media/movies/B/b.mkv" },
    { Id: "4", Name: "X", Path: "/anderswo/x.mkv", MediaSources: [{ Path: "/anderswo/x.mkv" }, { Path: "/anderswo/y.mkv" }] },
  ], "movie");
  assert.deepEqual(g.map((x) => [x.title, x.versions.length]), [["A", 2]]);
  const e = duplicateGroups([
    { Id: "e1", SeriesId: "s", SeriesName: "S", ParentIndexNumber: 1, IndexNumber: 2, Path: "/data/media/tv/S/a.mkv" },
    { Id: "e2", SeriesId: "s", SeriesName: "S", ParentIndexNumber: 1, IndexNumber: 2, Path: "/data/media/tv/S/b.mkv" },
  ], "tv");
  assert.equal(e[0].title, "S · S01E02");
});

test("Doppelte Fassung: verwaltete bleibt, zusätzliche wird mit OK gelöscht", async () => {
  const { care, root, jcalls } = await setup();
  const d = await care.duplicates();
  assert.equal(d.total, 1);
  const [main, extra] = d.groups[0].versions;
  assert.deepEqual([main.managed, extra.managed, extra.file], [true, false, "movies/Film (2020)/Film.alt.mkv"]);
  await assert.rejects(care.removeDuplicate({ token: extra.token }), /mit OK/);
  await assert.rejects(care.removeDuplicate({ token: main.token, confirmation: "OK" }), /verwaltet Radarr/);
  const r = await care.removeDuplicate({ token: extra.token, confirmation: "OK" });
  assert.match(r.message, /Film \(2020\)/);
  assert.deepEqual(await readdir(path.join(root, "media/movies/Film (2020)")), ["Film.mkv"]);
  assert.ok(jcalls.some(([m, route]) => m === "POST" && route === "/Library/Media/Updated"));
  assert.equal((await care.duplicates()).total, 0, "gelöschte Datei zählt nicht mehr, auch wenn Jellyfin sie noch meldet");
});

test("Papierkorb: einschalten legt Ordner an, fremder Pfad wird angezeigt, leeren", async () => {
  const { care, root, cfg } = await setup();
  let r = await care.recycleBin();
  assert.deepEqual(r.services.map((x) => [x.service, x.enabled, x.foreign]), [["Radarr", false, null], ["Sonarr", true, "/irgendwo"]]);
  await assert.rejects(care.setRecycleBin({ service: "Radarr", enabled: true, days: 30 }), /mit OK/);
  await assert.rejects(care.setRecycleBin({ service: "Radarr", enabled: true, days: 3, confirmation: "OK" }), /Aufbewahrungsdauer/);
  await care.setRecycleBin({ service: "Radarr", enabled: true, days: 30, confirmation: "OK" });
  assert.deepEqual([cfg.Radarr.recycleBin, cfg.Radarr.recycleBinCleanupDays, cfg.Radarr.other], ["/data/papierkorb/filme", 30, true]);
  assert.ok((await stat(path.join(root, "papierkorb/filme"))).isDirectory());
  await writeFile(path.join(root, "papierkorb/filme/alt.mkv"), "z");
  r = await care.recycleBin();
  assert.deepEqual(r.services[0].usage, { bytes: 1, files: 1 });
  const e = await care.emptyRecycleBin({ service: "Radarr", confirmation: "OK" });
  assert.match(e.message, /1 Dateien/);
  assert.deepEqual(await readdir(path.join(root, "papierkorb/filme")), []);
  await care.setRecycleBin({ service: "Radarr", enabled: false, confirmation: "OK" });
  assert.equal(cfg.Radarr.recycleBin, "");
});

test("Aufbewahrung: lange nicht gesehen, Neues und kürzlich Gesehenes bleiben", async () => {
  const { care } = await setup();
  await assert.rejects(care.retention(5), /Zeitraum/);
  const r = await care.retention(180);
  assert.deepEqual(r.candidates.map((c) => [c.title, c.viewers, c.lastPlayed]), [["Film (2020)", 0, null]]);
  assert.equal(r.bytes, 30);
});
