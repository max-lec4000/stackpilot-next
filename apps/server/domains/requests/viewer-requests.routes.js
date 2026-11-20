// Anfragen: Freigabepflicht je Zuschauer (Seerr-Rechte).
export function viewerRequestRoutes({ viewerRequests }) {
  return [
    { method: "GET", path: "/api/viewer-requests", guard: "session", handler: () => viewerRequests.list() },
    { method: "POST", path: "/api/viewer-requests", guard: "ok", confirm: "Freigaberecht bestätigen.",
      handler: ({ body }) => viewerRequests.change(body) },
    // Anfragelimits je Person (7.1)
    { method: "POST", path: "/api/viewer-requests/limits", guard: "ok", confirm: "Limit mit OK bestätigen.",
      handler: ({ body }) => viewerRequests.limits(body) },
  ];
}
