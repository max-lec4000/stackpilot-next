// System → Updates & Sicherungen → Gesamtsicherung (7.5).
export function stackBackupRoutes({ stackBackup, stackRestore }) {
  return [
    { method: "GET", path: "/api/stack-backup", guard: "session", handler: () => stackBackup.status() },
    { method: "GET", path: "/api/stack-backup/download", guard: "session", handler: ({ url }) => stackBackup.download(url.searchParams.get("name")) },
    { method: "POST", path: "/api/stack-backup/setup", guard: "ok", confirm: "Sicherungsordner mit OK bestätigen.", handler: ({ body }) => stackBackup.setup(body) },
    { method: "POST", path: "/api/stack-backup/run", guard: "ok", confirm: "Gesamtsicherung mit OK bestätigen.", handler: ({ body }) => stackBackup.run(body) },
    { method: "POST", path: "/api/stack-backup/resume", guard: "ok", confirm: "Wiederanlauf mit OK bestätigen.", handler: ({ body }) => stackBackup.resume(body) },
    // Wiederherstellung per Knopf (Paket 7.5)
    { method: "GET", path: "/api/stack-restore", guard: "session", handler: () => stackRestore.status() },
    { method: "POST", path: "/api/stack-restore/check", guard: "session", handler: ({ body }) => stackRestore.check(body) },
    { method: "POST", path: "/api/stack-restore/start", guard: "ok", confirm: "Wiederherstellung mit OK bestätigen.", handler: ({ body }) => stackRestore.restore(body) },
    { method: "POST", path: "/api/stack-restore/recover", guard: "ok", confirm: "Zurückrollen mit OK bestätigen.", handler: ({ body }) => stackRestore.recover(body) },
    { method: "POST", path: "/api/stack-restore/previous/remove", guard: "ok", confirm: "Löschen mit OK bestätigen.", handler: ({ body }) => stackRestore.removePrevious(body) },
  ];
}
