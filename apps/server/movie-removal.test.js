import { test } from "node:test";
import assert from "node:assert/strict";
import { MovieRemoval } from "./movie-removal.js";
function fixture() {
  const calls = [],
    values = new Map();
  let movie = {
    id: 8,
    tmdbId: 42,
    title: "Testfilm",
    path: "/data/media/movies/Test",
    qualityProfileId: 1,
    monitored: true,
    hasFile: true,
    movieFile: { id: 9, size: 24000000000, relativePath: "Test.mkv" },
  };
  let resetStatus = 1;
  let failRequest = false,
    failDelete = false;
  const torrent = {
    hash: "a".repeat(40),
    name: "Testfilm.Remux",
    size: 24000000000,
    category: "stackpilot-movies",
    content_path: "/data/downloads/Test",
    save_path: "/data/downloads",
  };
  const request = {
    id: 7,
    serverId: 0,
    media: { id: 12, tmdbId: 42, mediaType: "movie" },
  };
  const plan = {
    id: "p",
    rootId: "root",
    spec: { selected: ["Seerr", "Radarr", "Jellyfin", "qBittorrent"] },
  };
  const s = {
    arr: async (name, route, options) => {
      calls.push([name, route, options]);
      if (route.startsWith("/queue"))
        return {
          records: [{ movieId: 8, downloadId: torrent.hash }],
          totalRecords: 1,
        };
      if (route.startsWith("/history/"))
        return [{ movieId: 8, downloadId: torrent.hash }];
      if (options?.method === "DELETE") {
        if (failDelete) {
          failDelete = false;
          throw Error("offline");
        }
        movie = null;
        return null;
      }
      if (options?.method === "PUT") {
        movie = options.body;
        return movie;
      }
      if (!movie) throw Error("HTTP 404");
      return structuredClone(movie);
    },
    qbit: async (route, body) => {
      calls.push(["qbit", route, body]);
      return route === "/torrents/info" ? [torrent] : null;
    },
    additional: {
      seerr: async (route, options) => {
        calls.push(["Seerr", route, options]);
        if (
          route === "/request/7" &&
          options?.method === "DELETE" &&
          failRequest
        ) {
          failRequest = false;
          throw Error("offline");
        }
        if (route.endsWith("/unknown")) return { status: resetStatus };
        return request;
      },
    },
  };
  const hub = {
    engine: {
      vault: {
        get: (k) => structuredClone(values.get(k)),
        set: (k, v) => values.set(k, structuredClone(v)),
      },
    },
    context: async () => ({ s, plan }),
    mutate: async (names, fn) => fn({ s, plan }),
    library: { cache: new Map(), run: async () => ({}) },
  };
  const diagnostics = {
    target: async () => ({
      kind: "movie",
      request,
      item: movie ? structuredClone(movie) : null,
    }),
  };
  const removal = new MovieRemoval(hub, diagnostics);
  return {
    removal,
    hub,
    calls,
    torrent,
    request,
    setMovie: (f) => (movie = f(movie)),
    setResetStatus: (v) => {
      resetStatus = v;
    },
    setFailRequest: () => (failRequest = true),
    setFailDelete: () => (failDelete = true),
  };
}
test("Löschvorschau ist nur lesend, dedupliziert zugeordnete Torrents und gibt keine Pfade zurück", async () => {
  const f = fixture(),
    p = await f.removal.preview(7);
  assert.equal(p.size, 24000000000);
  assert.equal(p.downloads.length, 1);
  assert.equal(p.chosen, null);
  assert.equal(JSON.stringify(p).includes("/data/"), false);
  assert.equal(
    f.calls.some((c) => c[2]?.method || c[1] === "/torrents/delete"),
    false,
  );
});
test("Löschen benötigt OK, bindet Datei und Stack an den Plan und behält nicht ausgewählte Downloads", async () => {
  const f = fixture(),
    p = await f.removal.preview(7);
  await assert.rejects(() =>
    f.removal.execute({ planId: p.id, confirmation: "NO", downloads: [] }),
  );
  await assert.rejects(() =>
    f.removal.execute({
      planId: p.id,
      confirmation: "OK",
      downloads: ["b".repeat(40)],
    }),
  );
  const result = await f.removal.execute({
    planId: p.id,
    confirmation: "OK",
    downloads: [],
  });
  assert.equal(result.complete, true);
  assert.equal(
    f.calls.some((c) => c[1] === "/torrents/delete"),
    false,
  );
  assert.ok(
    f.calls.some(
      (c) =>
        c[1] === "/movie/8?deleteFiles=true&addImportExclusion=false" &&
        c[2].method === "DELETE",
    ),
  );
  assert.ok(
    f.calls.some((c) => c[1] === "/request/7" && c[2]?.method === "DELETE"),
  );
});
test("Veränderte Filmdateien und Torrentpfade verhindern die Löschung", async () => {
  for (const change of ["movie", "torrent"]) {
    const f = fixture(),
      p = await f.removal.preview(7);
    if (change === "movie")
      f.setMovie((m) => ({ ...m, movieFile: { ...m.movieFile, id: 99 } }));
    else f.torrent.content_path = "/different";
    const result = await f.removal.execute({
      planId: p.id,
      confirmation: "OK",
      downloads: p.downloads.map((t) => t.hash),
    });
    assert.equal(result.complete, false);
    assert.equal(
      f.calls.some(
        (c) => c[2]?.method === "DELETE" || c[1] === "/torrents/delete",
      ),
      false,
    );
  }
});
test("Nur ausdrücklich gewählte Torrents werden samt Dateien gelöscht; Teilfehler sind fortsetzbar", async () => {
  const f = fixture(),
    p = await f.removal.preview(7),
    body = {
      planId: p.id,
      confirmation: "OK",
      downloads: p.downloads.map((t) => t.hash),
    };
  f.setFailRequest();
  assert.equal((await f.removal.execute(body)).complete, false);
  const pending = await f.removal.preview(7);
  assert.equal(pending.id, p.id);
  assert.deepEqual(pending.chosen, body.downloads);
  assert.equal(pending.started, true);
  assert.equal((await f.removal.execute(body)).complete, true);
  assert.equal(f.calls.filter((c) => c[1] === "/torrents/delete").length, 1);
  assert.deepEqual(f.calls.find((c) => c[1] === "/torrents/delete")[2], {
    hashes: "a".repeat(40),
    deleteFiles: "true",
  });
  assert.equal(
    f.calls.filter((c) => c[1].includes("deleteFiles=true")).length,
    1,
  );
});
test("Nach Teilfehler wird eine neu importierte Datei auch beim Fortsetzen nicht gelöscht", async () => {
  const f = fixture(),
    p = await f.removal.preview(7),
    body = { planId: p.id, confirmation: "OK", downloads: [] };
  f.setFailDelete();
  assert.equal((await f.removal.execute(body)).complete, false);
  f.setMovie((m) => ({ ...m, movieFile: { ...m.movieFile, id: 999 } }));
  assert.equal((await f.removal.execute(body)).complete, false);
  assert.equal(
    f.calls.filter((c) => c[1].includes("deleteFiles=true")).length,
    1,
  );
});

test("Bibliothekswurzel und Pfade außerhalb der verwalteten Filmbibliothek sind nicht löschbar", async () => {
  for (const path of [
    "/data/media/movies",
    "/data/media/movies/../other",
    "/other/movie",
  ]) {
    const f = fixture();
    f.setMovie((m) => ({ ...m, path }));
    await assert.rejects(() => f.removal.preview(7), /Filmpfad/);
    assert.equal(f.calls.length, 0);
  }
});

test("Ein erfolgreicher HTTP-Aufruf ohne Statusänderung beendet die Löschung nicht", async () => {
  const f = fixture(),
    p = await f.removal.preview(7),
    body = { planId: p.id, confirmation: "OK", downloads: [] };
  f.setResetStatus(5);
  assert.equal((await f.removal.execute(body)).complete, false);
  assert.equal(
    f.calls.some((c) => c[1] === "/request/7" && c[2]?.method === "DELETE"),
    false,
  );
  f.setResetStatus(1);
  assert.equal((await f.removal.execute(body)).complete, true);
});
