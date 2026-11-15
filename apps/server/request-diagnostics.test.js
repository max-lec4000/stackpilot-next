import { test } from "node:test";
import assert from "node:assert/strict";
import { MediaHub } from "./media-hub.js";
import { RequestDiagnostics } from "./request-diagnostics.js";
import { activeSearch } from "../../packages/domain/search-status.js";
function fixture() {
  const values = new Map(),
    calls = [];
  let lock = false;
  const plan = {
    id: "plan",
    rootId: "root",
    spec: {
      selected: ["Seerr", "Radarr", "Sonarr", "Prowlarr", "qBittorrent"],
      vpn: true,
    },
  };
  const engine = {
    current: () => ({ plan, job: { status: "completed" } }),
    relay: async () => "relay",
    vault: { get: (k) => values.get(k), set: (k, v) => values.set(k, v) },
    store: {
      claim: () => {
        if (lock) return false;
        lock = true;
        return true;
      },
      release: () => {
        lock = false;
      },
    },
  };
  const request = {
      id: 7,
      status: 2,
      media: { mediaType: "movie", tmdbId: 42, tvdbId: 77 },
      seasons: [{ seasonNumber: 1 }, { seasonNumber: 3 }],
    },
    item = {
      id: 11,
      tmdbId: 42,
      tvdbId: 77,
      monitored: true,
      hasFile: false,
      status: "released",
    };
  let items = [item],
    indexers = [
      {
        id: 1,
        name: "My Source",
        enableAutomaticSearch: true,
        enableInteractiveSearch: true,
        fields: [{ name: "apiKey", value: "private-key" }],
      },
    ],
    health = [],
    queue = { records: [], totalRecords: 0 },
    episodes = [],
    commands = [],
    clients = [
      {
        name: "qBittorrent",
        enable: true,
        implementation: "QBittorrent",
        fields: [{ name: "password", value: "private-password" }],
      },
    ];
  const s = {
    additional: {
      seerr: async (route) => {
        calls.push(["seerr", route]);
        if (route.startsWith("/settings/")) {
          const movie = route.endsWith("radarr");
          return [
            {
              id: 1,
              isDefault: true,
              is4k: false,
              hostname: movie ? "radarr" : "sonarr",
              port: movie ? 7878 : 8989,
              useSsl: false,
              baseUrl: "",
            },
          ];
        }
        if (route.startsWith("/request/")) return request;
        if (route.startsWith("/request?"))
          return { results: [request], pageInfo: { results: 1 } };
        return { id: 42, title: "Testfilm", externalIds: { tvdbId: 77 } };
      },
    },
    arr: async (name, route, options) => {
      calls.push([name, route, options]);
      if (route.startsWith("/movie?") || route.startsWith("/series?"))
        return items;
      if (route.startsWith("/episode?")) return episodes;
      if (route === "/indexer") return indexers;
      if (route === "/health") return health;
      if (route === "/downloadclient") return clients;
      if (route === "/command") {
        if (options?.method === "POST") {
          const cmd = {
            id: commands.length + 1,
            name: options.body.name,
            status: "queued",
            body: options.body,
          };
          commands.push(cmd);
          return cmd;
        }
        return commands;
      }
      if (route.startsWith("/history"))
        return [
          {
            movieId: 11,
            seriesId: 11,
            eventType: "grabbed",
            sourceTitle: "Test release",
            date: "2026-11-08T10:00:00Z",
            data: {
              indexer: "My Source",
              downloadUrl: "https://tracker/?passkey=private-key",
            },
          },
        ];
      if (route.startsWith("/release?"))
        return [
          {
            title: "Test release",
            indexer: "My Source",
            quality: { quality: { name: "1080p" } },
            rejected: true,
            rejections: [
              "Wrong quality profile",
              "Indexer https://tracker/?apikey=private-key failed",
            ],
            downloadUrl: "https://tracker/?passkey=private-key",
          },
        ];
      if (route.startsWith("/queue")) return queue;
      return [];
    },
    qbit: async () => ({ dl_info_speed: 0, up_info_speed: 0 }),
  };
  const guard = {
      check: async () => ({ state: "connected", reason: "Mullvad verified" }),
      checkedPlanId: plan.id,
    },
    hub = new MediaHub(engine, guard, { services: () => s });
  return {
    engine,
    plan,
    s,
    guard,
    hub,
    diagnosis: new RequestDiagnostics(hub),
    calls,
    values,
    request,
    item,
    commands,
    setItems: (v) => (items = v),
    setIndexers: (v) => (indexers = v),
    setHealth: (v) => (health = v),
    setQueue: (v) => (queue = v),
    setEpisodes: (v) => (episodes = v),
    setClients: (v) => (clients = v),
  };
}
test("Diagnose zeigt Quellen der tatsächlichen ARR-App und den letzten Release ohne URLs oder Zugangsdaten", async () => {
  const f = fixture(),
    r = await f.diagnosis.inspect(7, true);
  assert.equal(r.canSearch, true);
  assert.equal(r.service, "Radarr");
  assert.equal(r.library.present, true);
  assert.equal(r.sources[0].name, "My Source");
  assert.equal(r.lastGrab.title, "Test release");
  assert.equal(r.releases.results[0].rejected, true);
  assert.match(r.releases.results[0].reasons[0], /Qualität/);
  const json = JSON.stringify(r);
  assert.ok(!json.includes("private-key"));
  assert.ok(!json.includes("private-password"));
  assert.ok(!json.includes("https://tracker"));
});
test("Erneute Filmsuche braucht VPN, Quelle und antwortenden Downloadclient; identischer laufender Auftrag wird nicht doppelt gestartet", async () => {
  const f = fixture();
  f.guard.check = async () => ({ state: "blocked" });
  await assert.rejects(
    f.diagnosis.search({ requestId: 7 }),
    /Downloads gesperrt/,
  );
  assert.equal(f.calls.length, 0);
  f.guard.check = async () => ({ state: "connected" });
  f.setIndexers([]);
  await assert.rejects(
    f.diagnosis.search({ requestId: 7 }),
    /Keine aktive Quelle/,
  );
  f.setIndexers([{ id: 1, enableAutomaticSearch: true }]);
  f.s.qbit = async () => {
    throw Error("offline");
  };
  assert.equal((await f.diagnosis.inspect(7)).canSearch, false);
  await assert.rejects(
    f.diagnosis.search({ requestId: 7 }),
    /qBittorrent ist nicht erreichbar/,
  );
  f.s.qbit = async () => ({ dl_info_speed: 0, up_info_speed: 0 });
  await f.diagnosis.search({ requestId: 7 });
  const posts = f.calls.filter(
    (v) => v[1] === "/command" && v[2]?.method === "POST",
  );
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0][2].body, { name: "MoviesSearch", movieIds: [11] });
  assert.equal((await f.diagnosis.inspect(7)).search.active, true);
  assert.equal((await f.hub.requests()).results[0].state, "search-queued");
  await f.diagnosis.search({ requestId: 7 });
  assert.equal(
    f.calls.filter((v) => v[1] === "/command" && v[2]?.method === "POST")
      .length,
    1,
  );
});
test("Seriensuche betrifft nur angefragte Staffeln und berücksichtigt verfügbare Quellen", async () => {
  const f = fixture();
  f.request.media.mediaType = "tv";
  f.setHealth([{ source: "IndexerStatusCheck", type: "error" }]);
  assert.equal((await f.diagnosis.inspect(7)).canSearch, false);
  await assert.rejects(
    f.diagnosis.search({ requestId: 7 }),
    /kritische Probleme/,
  );
  f.setHealth([]);
  await f.diagnosis.search({ requestId: 7 });
  assert.deepEqual(
    f.calls
      .filter((v) => v[1] === "/command" && v[2]?.method === "POST")
      .map((v) => v[2].body),
    [
      { name: "SeasonSearch", seriesId: 11, seasonNumber: 1 },
      { name: "SeasonSearch", seriesId: 11, seasonNumber: 3 },
    ],
  );
});
test("Fehlendes oder nicht freigegebenes Medium startet keine Suche; aktive Befehle werden eindeutig zugeordnet", async () => {
  const f = fixture();
  f.setItems([]);
  let r = await f.diagnosis.inspect(7);
  assert.equal(r.library.present, false);
  assert.equal(r.canSearch, false);
  await assert.rejects(
    f.diagnosis.search({ requestId: 7 }),
    /nicht suchbereit/,
  );
  f.setItems([f.item]);
  f.request.status = 1;
  await assert.rejects(
    f.diagnosis.search({ requestId: 7 }),
    /nicht suchbereit/,
  );
  assert.equal(
    activeSearch(
      { name: "MoviesSearch", status: "completed", body: { movieIds: [11] } },
      "movie",
      11,
    ),
    false,
  );
  assert.equal(
    activeSearch(
      { name: "MoviesSearch", status: "started", body: { movieIds: [12] } },
      "movie",
      11,
    ),
    false,
  );
  assert.equal(
    activeSearch({ name: "RssSync", status: "started" }, "movie", 11),
    false,
  );
});

test("Eine Anfrage für einen anderen Seerr-Server wird nicht im verwalteten Radarr gesucht", async () => {
  const f = fixture();
  f.request.serverId = 99;
  await assert.rejects(f.diagnosis.inspect(7), /anderen Server/);
  await assert.rejects(f.diagnosis.search({ requestId: 7 }), /anderen Server/);
  assert.equal(
    f.calls.filter((c) => c[1] === "/command" && c[2]?.method === "POST")
      .length,
    0,
  );
});

test("Ein abgeschlossener Suchauftrag wird nicht als laufende Suche dargestellt", async () => {
  const f = fixture();
  f.commands.push({
    id: 1,
    name: "MoviesSearch",
    status: "completed",
    body: { movieIds: [11] },
  });
  const r = await f.diagnosis.inspect(7);
  assert.equal(r.search.active, false);
  assert.equal(r.search.lastStatus, "completed");
  assert.equal((await f.hub.requests()).results[0].state, "waiting");
});

test("Seerrs Server-ID null ist von der gültigen Server-ID 0 zu unterscheiden", async () => {
  const f = fixture();
  f.request.serverId = 0;
  const original = f.s.additional.seerr;
  f.s.additional.seerr = async (route) =>
    route.startsWith("/settings/")
      ? [
          { id: 0, hostname: "foreign", port: 7878 },
          { id: 1, hostname: "radarr", port: 7878, isDefault: true },
        ]
      : original(route);
  await assert.rejects(f.diagnosis.inspect(7), /anderen Server/);
});


test("Neue Suche schützt den vorhandenen Transfer und verlangt eine vollständige Warteschlange", async () => {
  const f = fixture();
  f.setQueue({ records: [{ movieId: 11 }], totalRecords: 1 });
  await assert.rejects(f.diagnosis.search({ requestId: 7 }), /bereits ein Download oder Import/);
  f.setQueue({ records: [{ movieId: 12 }], totalRecords: 2 });
  await assert.rejects(f.diagnosis.search({ requestId: 7 }), /nicht vollständig/);
  assert.equal(f.commands.length, 0);
  f.setQueue({ records: [{ movieId: 12 }], totalRecords: 1 });
  await f.diagnosis.search({ requestId: 7 });
  assert.equal(f.commands.length, 1);
});


test("Folgensuche bleibt auf genau eine fehlende Folge der angefragten Staffel begrenzt", async () => {
  const f = fixture();
  f.request.media.mediaType = "tv";
  const episode = { id: 14, seriesId: 11, seasonNumber: 1, episodeNumber: 2,
    title: "Testfolge", airDateUtc: "2020-01-01T00:00:00Z", monitored: true, hasFile: false };
  f.setEpisodes([episode, { ...episode, id: 15, seriesId: 99 }]);
  f.item.seasons = [{ seasonNumber: 1, monitored: false }];
  assert.equal((await f.diagnosis.episodes(7, 1)).episodes[0].canSearch, false);
  await assert.rejects(f.diagnosis.search({ requestId: 7, season: 1, episodeId: 14 }), /wird nicht überwacht/);
  f.item.seasons[0].monitored = true;
  assert.deepEqual((await f.diagnosis.episodes(7, 1)).episodes.map((row) => row.id), [14]);
  await assert.rejects(f.diagnosis.search({ requestId: 7, season: 1, episodeId: 15 }), /nicht als fehlende/);
  await f.diagnosis.search({ requestId: 7, season: 1, episodeId: 14 });
  assert.deepEqual(f.commands[0].body, { name: "EpisodeSearch", episodeIds: [14] });
  f.values.get("request-search:root:7").startedAt = "2020-01-01T00:00:00Z";
  assert.equal((await f.diagnosis.search({ requestId: 7, season: 1, episodeId: 14 })).alreadyRunning, true);
  assert.equal(f.commands.length, 1);
});

test("Dateilöschung prüft Zuordnung über alle Staffeln und löscht genau die bestätigte Datei", async () => {
  const f = fixture();
  f.request.media.mediaType = "tv";
  const target = { id: 14, seriesId: 11, seasonNumber: 1, episodeFileId: 6, hasFile: true };
  const other = { ...target, id: 16, seasonNumber: 3 };
  const body = { requestId: 7, season: 1, episodeId: 14, fileId: 6, confirmation: "OK" };
  let deleted = false;
  const arr = f.s.arr;
  f.s.arr = async (service, route, options) => {
    if (route === "/episode/14") return { ...target, hasFile: !deleted };
    if (route === "/episodefile/6") {
      if (options?.method === "DELETE") deleted = true;
      return { id: 6, seriesId: 11 };
    }
    return arr(service, route, options);
  };
  f.setEpisodes([target, other]);
  assert.equal((await f.diagnosis.episodes(7, 1)).episodes[0].removableFileId, null);
  await assert.rejects(f.diagnosis.deleteEpisodeFile(body), /mehreren Folgen/);
  assert.equal(deleted, false);
  f.setEpisodes([target, { ...other, episodeFileId: 7 }]);
  await assert.rejects(f.diagnosis.deleteEpisodeFile({ ...body, fileId: 7 }), /Datei wurde geändert/);
  f.request.requestedBy = { id: 5 };
  const owner = "0123456789abcdef0123456789abcdef";
  const seerr = f.s.additional.seerr;
  let requests = [{ id: 99, status: 2, seasons: [{ seasonNumber: 1 }] }];
  f.s.additional.seerr = async (route) => route === "/user/5" ? { jellyfinUserId: owner } :
    route.startsWith("/tv/42?") ? { mediaInfo: { requests } } : seerr(route);
  await assert.rejects(f.diagnosis.deleteEpisodeFile(body, owner), /weiteren Anfrage/);
  requests = [];
  f.request.status = 1;
  await assert.rejects(f.diagnosis.deleteEpisodeFile(body, owner), /nicht genehmigt/);
  f.request.status = 2;
  assert.equal(deleted, false);
  await f.diagnosis.deleteEpisodeFile(body, owner);
  assert.equal(deleted, true);
});

test("Filmtransfer-Austausch bestätigt Profil und Hash, erhält Dateien und sucht erst nach Entfernen", async () => {
  const f = fixture(), hash = "a".repeat(40);
  const entry = { id: 12, movieId: 11, downloadId: hash.toUpperCase() };
  f.setQueue({ records: [entry], totalRecords: 1 });
  f.setClients([{ enable: true, implementation: "QBittorrent", name: "StackPilot qBittorrent", removeFailedDownloads: false }]);
  let blocklisted = false;
  let torrent = { hash, name: "Testfilm", category: "stackpilot-movies", progress: 0.5, state: "downloading" };
  const transferCalls = [];
  const arr = f.s.arr;
  f.s.arr = async (name, route, options) => {
    if (route.startsWith("/history/movie")) return [{ eventType: "grabbed", sourceTitle: "Testfilm", downloadId: hash }];
    if (route.startsWith("/blocklist/movie")) return blocklisted ? [{ movieId: 11, sourceTitle: "Testfilm", id: 1 }] : [];
    if (options?.method === "DELETE") {
      transferCalls.push([route, options.method]);
      blocklisted = true;
    }
    if (route === "/command" && options?.method === "POST") transferCalls.push([route, options.method]);
    return arr(name, route, options);
  };
  f.s.qbit = async (route, body) => {
    if (route === "/transfer/info") return { dl_info_speed: 0, up_info_speed: 0 };
    if (route === "/torrents/info") return torrent ? [torrent] : [];
    transferCalls.push([route, body]);
    if (route === "/torrents/stop") torrent.state = "stoppedDL";
    if (route === "/torrents/delete") torrent = null;
  };
  const preview = await f.diagnosis.replacePreview(7);
  const body = { requestId: 7, replaceReview: preview.review, confirmation: "OK" };
  f.item.qualityProfileId = 4;
  await assert.rejects(f.diagnosis.search(body), /geändert/);
  assert.deepEqual(transferCalls, []);
  f.item.qualityProfileId = undefined;
  const duplicate = { ...entry, id: 13, movieId: 22 };
  f.setQueue({ records: [entry, duplicate], totalRecords: 2 });
  await assert.rejects(f.diagnosis.search(body), /eindeutig/);
  assert.deepEqual(transferCalls, []);
  f.setQueue({ records: [entry], totalRecords: 1 });
  await f.diagnosis.search(body);
  assert.deepEqual(transferCalls, [
    ["/torrents/stop", { hashes: hash }],
    ["/queue/12?removeFromClient=false&blocklist=true&skipRedownload=true", "DELETE"],
    ["/torrents/delete", { hashes: hash, deleteFiles: "false" }],
    ["/command", "POST"],
  ]);
});

test("Staffelsuche überspringt fremde aktive Transfers und verändert nur die gewählte Staffel", async () => {
  const f = fixture();
  f.request.media.mediaType = "tv";
  f.setQueue({ records: [{ seriesId: 11, seasonNumber: 3 }], totalRecords: 1 });
  await assert.rejects(f.diagnosis.search({ requestId: 7, season: 2 }), /nicht zugeordnet/);
  await assert.rejects(f.diagnosis.search({ requestId: 7, season: 3 }), /bereits ein Download/);
  const ownerId = "0123456789abcdef0123456789abcdef";
  f.request.requestedBy = { id: 5 };
  const seerr = f.s.additional.seerr;
  f.s.additional.seerr = async (route) => route === "/user/5" ? { jellyfinUserId: ownerId } : seerr(route);
  await assert.rejects(f.diagnosis.search({ requestId: 7, season: 1 }, "other"), /Nur eigene/);
  await f.diagnosis.search({ requestId: 7, season: 1 }, ownerId);
  assert.deepEqual(f.commands.map((command) => command.body), [
    { name: "SeasonSearch", seriesId: 11, seasonNumber: 1 },
  ]);
});
