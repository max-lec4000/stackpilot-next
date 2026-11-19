// Downloads: Liste, Aktionen (Pause, Fortsetzen, Priorität, Entfernen) und geschütztes
// Fortsetzen nach einem VPN-Ausfall. „Entfernen“ verlangt im Fachteil zusätzlich „OK“.
export function downloadRoutes({ hub, guard }) {
  return [
    { method: "GET", path: "/api/downloads/status", guard: "session", handler: () => guard.check() },
    { method: "GET", path: "/api/downloads/list", guard: "session", handler: ({ url }) => hub.downloads({
      page: url.searchParams.get("page") || 1,
      filter: url.searchParams.get("filter") || "all",
      query: url.searchParams.get("query") || "",
    }) },
    { method: "POST", path: "/api/downloads/action", guard: "session", handler: ({ body }) => hub.downloadAction(body) },
    { method: "POST", path: "/api/downloads/resume", guard: "session", handler: () => guard.resume() },
  ];
}
