// Qualität & Quellen: gemeinsame Größenregeln (Filmstandard) und Suchquellen (Prowlarr).
// Quellen-Aktionen (Test, Ein/Aus, Entfernen) prüfen ihre Bestätigung im Fachteil.
export function qualityRoutes({ sources, sizeLimits, subtitles, sourceHealth, qualityDefaults, qualityProfiles, subtitleTitles }) {
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
    // Profile bearbeiten (Paket 7.3)
    { method: "GET", path: "/api/quality/profiles", guard: "session", handler: () => qualityProfiles.read() },
    { method: "POST", path: "/api/quality/profiles", guard: "ok", confirm: "Profiländerung mit OK bestätigen.",
      handler: ({ body }) => qualityProfiles.change(body) },
    // Untertitel je Titel (Paket 7.3): Suchen ohne OK, Ersetzen/Löschen prüft OK im Modul
    { method: "GET", path: "/api/subtitles/titles", guard: "session", handler: ({ url }) => subtitleTitles.search(url.searchParams.get("q")) },
    { method: "GET", path: "/api/subtitles/title", guard: "session",
      handler: ({ url }) => subtitleTitles.detail(url.searchParams.get("kind"), url.searchParams.get("id")) },
    { method: "POST", path: "/api/subtitles/title", guard: "session", handler: ({ body }) => subtitleTitles.act(body) },
    // Untertitel (Bazarr, 7.3a)
    { method: "GET", path: "/api/subtitles", guard: "session", handler: () => subtitles.read() },
    { method: "POST", path: "/api/subtitles", guard: "ok", confirm: "Untertitel-Einstellungen mit OK bestätigen.",
      handler: ({ body }) => subtitles.save(body) },
  ];
}
