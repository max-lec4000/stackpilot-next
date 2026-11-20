// Speicher: Belegung und verwaiste Downloads (7.4a).
export function storageRoutes({ storageOverview }) {
  return [
    { method: "GET", path: "/api/storage/overview", guard: "session", handler: () => storageOverview.read() },
    { method: "POST", path: "/api/storage/orphans/remove", guard: "ok", confirm: "Löschen mit OK bestätigen.",
      handler: ({ body }) => storageOverview.removeOrphan(body) },
  ];
}
