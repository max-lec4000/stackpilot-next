// Qualität & Quellen: gemeinsame Größenregeln (Filmstandard) und Suchquellen (Prowlarr).
// Quellen-Aktionen (Test, Ein/Aus, Entfernen) prüfen ihre Bestätigung im Fachteil.
export function qualityRoutes({ sources, sizeLimits }) {
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
  ];
}
