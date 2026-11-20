// Anfragen: Liste, Archiv, Diagnose („Warum passiert nichts?“), Freigeben, Abbrechen,
// titelbezogene Qualität und Größenlimits, Staffel- und Folgenaktionen, manuelle Suche.
const q = (url, name) => url.searchParams.get(name);

export function requestRoutes({ hub, records, requestDiagnostics, requestLifecycle, qualitySettings }) {
  const get = (path, handler) => ({ method: "GET", path, guard: "session", handler });
  const post = (path, handler) => ({ method: "POST", path, guard: "session", handler });
  const ok = (path, confirm, handler) => ({ method: "POST", path, guard: "ok", confirm, handler });
  return [
    get("/api/media/requests", ({ url }) => hub.requests({
      force: q(url, "force") === "1", page: q(url, "page") || 1,
      filter: q(url, "filter") || "all", type: q(url, "type") || "all",
    })),
    get("/api/media/requests/pending", () => hub.pendingRequests()),
    get("/api/media/archive", async ({ url }) => {
      const { plan } = await hub.context(["Seerr"]);
      return records.history(plan, { page: q(url, "page") || 1, type: q(url, "type") || "all" });
    }),
    get("/api/media/diagnosis", ({ url }) => requestDiagnostics.inspect(q(url, "requestId"))),
    get("/api/media/request-action", ({ url }) => requestLifecycle.preview(q(url, "requestId"))),
    get("/api/media/quality", ({ url }) => qualitySettings.read(q(url, "requestId"))),
    get("/api/media/replace-download", ({ url }) => requestDiagnostics.replacePreview(q(url, "requestId"))),
    get("/api/media/season-transfer", ({ url }) => requestDiagnostics.seasonTransferPreview({
      requestId: q(url, "requestId"), season: q(url, "season"), remove: q(url, "remove") === "1",
    })),
    get("/api/media/episode-seasons", ({ url }) => requestDiagnostics.episodeSeasons(q(url, "requestId"))),
    get("/api/media/episodes", ({ url }) => requestDiagnostics.episodes(q(url, "requestId"), q(url, "season"))),

    post("/api/media/request", ({ body }) => hub.request(body)),
    ok("/api/media/request/approve", "Freigabe mit OK bestätigen.", ({ body }) => requestLifecycle.approve(body)),
    ok("/api/media/request/decline", "Ablehnen mit OK bestätigen.", ({ body }) => requestLifecycle.decline(body)),
    ok("/api/media/request/batch", "Mit OK bestätigen.", ({ body }) => requestLifecycle.batch(body)),
    post("/api/media/request/archive", ({ body }) => requestLifecycle.archive(body)),
    ok("/api/media/request/cancel-season", "Staffelabbruch mit OK bestätigen.", ({ body }) => requestLifecycle.cancelSeason(body)),
    ok("/api/media/request/cancel", "Abbrechen mit OK bestätigen.", ({ body }) => requestLifecycle.cancel(body)),
    ok("/api/media/film-limit", "Filmgrößenlimit bestätigen.", ({ body }) => qualitySettings.filmLimit(body)),
    ok("/api/media/quality", "Profiländerung bestätigen.", ({ body }) => qualitySettings.apply(body)),
    ok("/api/media/season-transfer/replace", "Austausch zuerst bestätigen.", ({ body }) => requestDiagnostics.replaceSeasonPackage(body)),
    ok("/api/media/season-transfer/remove", "Entfernen bestätigen.", ({ body }) => requestDiagnostics.pauseSeasonTransfer(body, undefined, true)),
    ok("/api/media/season-transfer/pause", "Pausieren bestätigen.", ({ body }) => requestDiagnostics.pauseSeasonTransfer(body)),
    ok("/api/media/episodes/delete-file", "Dateilöschung mit OK bestätigen.", ({ body }) => requestDiagnostics.deleteEpisodeFile(body)),
    ok("/api/media/series-limits", "Größenlimits bestätigen.", ({ body }) => requestDiagnostics.saveSeriesLimits(body)),
    post("/api/media/research", ({ body }) => requestDiagnostics.search(body)),
    post("/api/media/releases", ({ body }) => requestDiagnostics.inspect(body.requestId, true)),
  ];
}
