// Qualität & Quellen: gemeinsame Größenregeln (Filmstandard) und Suchquellen (Prowlarr).
// Quellen-Aktionen (Test, Ein/Aus, Entfernen) prüfen ihre Bestätigung im Fachteil.
export function qualityRoutes({ sources, sizeLimits, subtitles, sourceHealth, qualityDefaults }) {
  return [
    { method: "GET", path: "/api/media/size-settings", guard: "session", handler: () => sizeLimits.settings() },
    { method: "POST", path: "/api/media/size-settings", guard: "ok", confirm: "Größenregel mit OK bestätigen.",
      handler: ({ body }) => sizeLimits.save(body) },
    { method: "GET", path: "/api/sources", guard: "session", handler: () => sources.list() },
    { method: "GET", path: "/api/sources/detail", guard: "session", handler: ({ url }) => sources.detail(url.searchParams.get("id")) },
    { method: "POST", path: "/api/sources/test", guard: "session", handler: ({ body }) => sources.test(body) },
    { method: "POST", path: "/api/sources/save", guard: "ok", confirm: "Geprüfte Quelle mit OK bestätigen.",
      handler: ({ body }) => sources.save(body) },
    { method: "POST", path: "/api/sources/action", guard: "session", handler: ({ body }) => sources.action(body) },
    // Zustand der Quellen (7.3b): lesen, alle testen, an die Apps übertragen
    { method: "GET", path: "/api/sources/health", guard: "session", handler: () => sourceHealth.read() },
    { method: "POST", path: "/api/sources/test-all", guard: "session", handler: () => sourceHealth.testAll() },
    { method: "POST", path: "/api/sources/sync", guard: "session", handler: () => sourceHealth.sync() },
    // Standardqualität für neue Anfragen (7.3c)
    { method: "GET", path: "/api/quality/defaults", guard: "session", handler: () => qualityDefaults.read() },
    { method: "POST", path: "/api/quality/defaults", guard: "ok", confirm: "Standardqualität mit OK bestätigen.",
      handler: ({ body }) => qualityDefaults.setDefault(body) },
    // Untertitel (Bazarr, 7.3a)
    { method: "GET", path: "/api/subtitles", guard: "session", handler: () => subtitles.read() },
    { method: "POST", path: "/api/subtitles", guard: "ok", confirm: "Untertitel-Einstellungen mit OK bestätigen.",
      handler: ({ body }) => subtitles.save(body) },
  ];
}
