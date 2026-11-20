// Downloads: Liste, Aktionen (Pause, Fortsetzen, Priorität, Entfernen) und geschütztes
// Fortsetzen nach einem VPN-Ausfall. „Entfernen“ verlangt im Fachteil zusätzlich „OK“.
export function downloadRoutes({ hub, guard, downloadIssues, downloadSettings }) {
  return [
    { method: "GET", path: "/api/downloads/status", guard: "session", handler: () => guard.check() },
    { method: "GET", path: "/api/downloads/list", guard: "session", handler: ({ url }) => hub.downloads({
      page: url.searchParams.get("page") || 1,
      filter: url.searchParams.get("filter") || "all",
      query: url.searchParams.get("query") || "",
    }) },
    { method: "POST", path: "/api/downloads/action", guard: "session", handler: ({ body }) => hub.downloadAction(body) },
    { method: "POST", path: "/api/downloads/resume", guard: "session", handler: () => guard.resume() },
    // Braucht Aufmerksamkeit (7.2a): Probleme aus Radarr/Sonarr, erneut prüfen, anderen Treffer suchen
    { method: "GET", path: "/api/downloads/issues", guard: "session", handler: () => downloadIssues.list() },
    { method: "POST", path: "/api/downloads/issues/retry", guard: "session", handler: () => downloadIssues.act({ action: "retry" }) },
    // Seeding und Geschwindigkeit (7.2b)
    { method: "GET", path: "/api/downloads/settings", guard: "session", handler: () => downloadSettings.read() },
    { method: "POST", path: "/api/downloads/settings", guard: "ok", confirm: "Einstellungen mit OK bestätigen.",
      handler: ({ body }) => downloadSettings.change(body) },
    { method: "GET", path: "/api/downloads/issues/import", guard: "session", handler: ({ url }) => downloadIssues.importPreview(url.searchParams.get("id")) },
    { method: "POST", path: "/api/downloads/issues/import", guard: "ok", confirm: "Import mit OK bestätigen.", handler: ({ body }) => downloadIssues.importApply(body) },
    { method: "POST", path: "/api/downloads/issues/replace", guard: "ok",
      confirm: "Anderen Treffer suchen mit OK bestätigen.", handler: ({ body }) => downloadIssues.act({ ...body, action: "replace" }) },
  ];
}
