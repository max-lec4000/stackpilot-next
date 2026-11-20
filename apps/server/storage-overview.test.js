import { test } from "node:test";
import assert from "node:assert/strict";
import { StorageOverview, hostPath, orphanVerdict } from "./storage-overview.js";

const plan = { id: "p", appdata: "/srv/sp-appdata", spec: { path: "/srv/sp", selected: ["Radarr", "Sonarr", "qBittorrent"] } };

test("Pfade und Urteil", () => {
  assert.equal(hostPath(plan, "/data/downloads/complete/movies"), "/srv/sp/downloads/complete/movies");
  assert.equal(hostPath(plan, "/data/../etc"), null);
  assert.equal(hostPath(plan, "/etc/passwd"), null);
  assert.equal(orphanVerdict({ progress: 0.5, inQueue: false, links: [1] }), "incomplete");
  assert.equal(orphanVerdict({ progress: 1, inQueue: true, links: [1] }), "importing");
  assert.equal(orphanVerdict({ progress: 1, inQueue: false, links: [1, null] }), "unknown");
  assert.equal(orphanVerdict({ progress: 1, inQueue: false, links: [2, 1] }), "library");
  assert.equal(orphanVerdict({ progress: 1, inQueue: false, links: [1, 1] }), "orphan");
});

function setup() {
  const torrents = [
    { hash: "a".repeat(40), name: "Verwaist", size: 5e9, progress: 1, save_path: "/data/downloads/complete/movies", state: "stalledUP", ratio: 1.2, category: "stackpilot-movies", completion_on: 1790000000 },
    { hash: "b".repeat(40), name: "In Bibliothek", size: 3e9, progress: 1, save_path: "/data/downloads/complete/tv", state: "pausedUP" },
    { hash: "c".repeat(40), name: "Wartet auf Import", size: 2e9, progress: 1, save_path: "/data/downloads/complete/movies", state: "pausedUP" },
    { hash: "d".repeat(40), name: "Lädt", size: 1e9, progress: 0.3, save_path: "/data/downloads/incomplete", state: "downloading" },
  ];
  const files = { ["a".repeat(40)]: [{ name: "Verwaist/film.mkv" }], ["b".repeat(40)]: [{ name: "Serie/s01e01.mkv" }], ["c".repeat(40)]: [{ name: "Neu/neu.mkv" }] };
  const nlink = { "/srv/sp/downloads/complete/movies/Verwaist/film.mkv": 1, "/srv/sp/downloads/complete/tv/Serie/s01e01.mkv": 2, "/srv/sp/downloads/complete/movies/Neu/neu.mkv": 1 };
  const removed = [];
  const s = {
    qbit: async (route, form) => {
      if (route === "/torrents/info") return structuredClone(torrents);
      if (route.startsWith("/torrents/info?hashes=")) return torrents.filter((t) => t.hash === route.split("=")[1]);
      if (route.startsWith("/torrents/files")) return files[route.split("=")[1]];
      if (route === "/torrents/delete") { removed.push(form); torrents.splice(torrents.findIndex((t) => t.hash === form.hashes), 1); return ""; }
    },
    arr: async (service, route) => {
      if (route.startsWith("/queue")) return { records: service === "Radarr" ? [{ downloadId: "C".repeat(40) }] : [], totalRecords: service === "Radarr" ? 1 : 0 };
      if (route === "/movie") return [{ hasFile: true, sizeOnDisk: 7e9 }, { hasFile: false, sizeOnDisk: 0 }];
      if (route === "/series") return [{ statistics: { sizeOnDisk: 9e9, episodeFileCount: 12 } }];
    },
  };
  const hub = { engine: { current: () => ({ job: { status: "completed" }, plan }) }, context: async () => ({ s, plan }), mutate: async (_n, fn) => fn({ s, plan }) };
  const o = new StorageOverview(hub, {
    stat: async (p) => { if (p in nlink) return { nlink: nlink[p], dev: 1 }; if (p === "/" ) return { dev: 2 }; return { dev: 1 }; },
    statfs: async () => ({ blocks: 1000, bsize: 1e9, bavail: 250 }),
    du: async () => ({ bytes: 4e9, partial: true }),
  });
  return { o, removed, nlink };
}

test("Belegung und verwaiste Downloads", async () => {
  const { o } = setup();
  const r = await o.read();
  assert.deepEqual(r.disks.map((d) => d.labels), [["Medien und Downloads", "App-Daten"], ["System"]]);
  assert.deepEqual(r.library.movies, { bytes: 7e9, items: 1 });
  assert.deepEqual(r.library.series, { bytes: 9e9, items: 12 });
  assert.deepEqual(r.appdata, { bytes: 4e9, partial: true });
  assert.deepEqual(r.downloads.orphans.map((x) => x.name), ["Verwaist"]);
  assert.equal(r.downloads.orphanBytes, 5e9);
  assert.equal(r.downloads.incomplete, 1);
});

test("Verwaisten Download löschen nur nach erneuter Prüfung", async () => {
  const { o, removed, nlink } = setup();
  await assert.rejects(o.removeOrphan({ hash: "a".repeat(40) }), /mit OK/);
  await assert.rejects(o.removeOrphan({ hash: "c".repeat(40), confirmation: "OK" }), /nicht \(mehr\) verwaist/);
  await assert.rejects(o.removeOrphan({ hash: "b".repeat(40), confirmation: "OK" }), /nicht \(mehr\) verwaist/);
  nlink["/srv/sp/downloads/complete/movies/Verwaist/film.mkv"] = 2; // inzwischen importiert
  await assert.rejects(o.removeOrphan({ hash: "a".repeat(40), confirmation: "OK" }), /nicht \(mehr\) verwaist/);
  nlink["/srv/sp/downloads/complete/movies/Verwaist/film.mkv"] = 1;
  const r = await o.removeOrphan({ hash: "a".repeat(40), confirmation: "OK" });
  assert.equal(r.freed, 5e9);
  assert.deepEqual(removed, [{ hashes: "a".repeat(40), deleteFiles: "true" }]);
});
