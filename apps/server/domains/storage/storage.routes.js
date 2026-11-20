// Speicher: Belegung und verwaiste Downloads (7.4a).
export function storageRoutes({ storageOverview, libraryCare }) {
  return [
    { method: "GET", path: "/api/storage/overview", guard: "session", handler: () => storageOverview.read() },
    { method: "POST", path: "/api/storage/orphans/remove", guard: "ok", confirm: "Löschen mit OK bestätigen.",
      handler: ({ body }) => storageOverview.removeOrphan(body) },
    // Papierkorb, doppelte Fassungen, Aufbewahrung (Paket 7.4)
    { method: "GET", path: "/api/storage/recycle-bin", guard: "session", handler: () => libraryCare.recycleBin() },
    { method: "POST", path: "/api/storage/recycle-bin", guard: "ok", confirm: "Papierkorb-Einstellung mit OK bestätigen.",
      handler: ({ body }) => libraryCare.setRecycleBin(body) },
    { method: "POST", path: "/api/storage/recycle-bin/empty", guard: "ok", confirm: "Leeren mit OK bestätigen.",
      handler: ({ body }) => libraryCare.emptyRecycleBin(body) },
    { method: "GET", path: "/api/storage/duplicates", guard: "session", handler: () => libraryCare.duplicates() },
    { method: "POST", path: "/api/storage/duplicates/remove", guard: "ok", confirm: "Löschen mit OK bestätigen.",
      handler: ({ body }) => libraryCare.removeDuplicate(body) },
    { method: "GET", path: "/api/storage/retention", guard: "session", handler: ({ url }) => libraryCare.retention(url.searchParams.get("days")) },
  ];
}
