import { test } from "node:test";
import assert from "node:assert/strict";
import { LibraryOverview } from "./library-overview.js";

const FILME = "7a2175bccb1f1a94152cbd2b2bae8f6d", SERIEN = "43cfe12fe7d9d8d21251e0964e0232e2";
function setup() {
  const calls = [];
  const request = async (_s, _p, route, o = {}) => {
    calls.push([o.method || "GET", route]);
    if (route === "/Library/VirtualFolders") return [
      { Name: "Filme", CollectionType: "movies", Locations: ["/data/media/movies"], ItemId: FILME, RefreshStatus: "Idle" },
      { Name: "Serien", CollectionType: "tvshows", Locations: ["/data/media/tv"], ItemId: SERIEN, RefreshStatus: "Running", RefreshProgress: 42.4 },
    ];
    if (route === "/ScheduledTasks") return [{ Key: "RefreshLibrary", State: "Idle", LastExecutionResult: { EndTimeUtc: "2026-11-20T04:27:34Z", Status: "Completed" } }];
    if (route.startsWith("/Items?SortBy=DateCreated")) return { Items: [
      { Type: "Episode", Name: "Pilot", SeriesName: "Eine Serie", ParentIndexNumber: 1, IndexNumber: 1, DateCreated: "2026-11-19T10:00:00Z" },
      { Type: "Movie", Name: "Big Buck Bunny", DateCreated: "2026-11-17T09:42:05Z" },
    ] };
    const m = route.match(/ParentId=(\w+).*IncludeItemTypes=(\w+)$/);
    if (m) return { TotalRecordCount: { [`${FILME}Movie`]: 7, [`${SERIEN}Series`]: 2, [`${SERIEN}Episode`]: 31 }[m[1] + m[2]] ?? 0 };
    if (o.method === "POST") return null;
  };
  const plan = { id: "p", spec: { selected: ["Jellyfin"] } };
  const hub = {
    engine: { current: () => ({ job: { status: "completed" }, plan }) },
    context: async () => ({ s: {}, plan }), mutate: async (_n, fn) => fn({ s: {}, plan }),
    library: { request, status: () => ({ state: "completed" }) },
  };
  return { lib: new LibraryOverview(hub), calls };
}

test("Bibliotheken mit Anzahl, Scanstatus und Neuzugängen", async () => {
  const { lib } = setup();
  const r = await lib.read();
  assert.deepEqual(r.libraries.map((l) => [l.name, l.scanning, l.counts.map((c) => `${c.count} ${c.label}`).join(", ")]),
    [["Filme", false, "7 Filme"], ["Serien", true, "2 Serien, 31 Folgen"]]);
  assert.equal(r.libraries[1].progress, 42);
  assert.deepEqual(r.scan, { running: false, progress: null, lastEnd: "2026-11-20T04:27:34Z", lastStatus: "Completed" });
  assert.deepEqual(r.latest.map((x) => x.title), ["Eine Serie · S01E01 – Pilot", "Big Buck Bunny"]);
});

test("Eine Bibliothek scannen: nur bekannte IDs", async () => {
  const { lib, calls } = setup();
  await assert.rejects(lib.scan({ libraryId: "../x" }), /Ungültige Bibliothek/);
  await assert.rejects(lib.scan({ libraryId: "f".repeat(32) }), /nicht gefunden/);
  const r = await lib.scan({ libraryId: FILME });
  assert.match(r.message, /„Filme“ wird eingelesen/);
  assert.ok(calls.some(([m, route]) => m === "POST" && route.startsWith(`/Items/${FILME}/Refresh?Recursive=true`) && route.includes("ReplaceAllMetadata=false")));
});
