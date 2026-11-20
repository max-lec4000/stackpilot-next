// System → Updates & Sicherungen → Gesamtsicherung (7.5).
export function stackBackupRoutes({ stackBackup }) {
  return [
    { method: "GET", path: "/api/stack-backup", guard: "session", handler: () => stackBackup.status() },
    { method: "GET", path: "/api/stack-backup/download", guard: "session", handler: ({ url }) => stackBackup.download(url.searchParams.get("name")) },
    { method: "POST", path: "/api/stack-backup/setup", guard: "ok", confirm: "Sicherungsordner mit OK bestätigen.", handler: ({ body }) => stackBackup.setup(body) },
    { method: "POST", path: "/api/stack-backup/run", guard: "ok", confirm: "Gesamtsicherung mit OK bestätigen.", handler: ({ body }) => stackBackup.run(body) },
    { method: "POST", path: "/api/stack-backup/resume", guard: "ok", confirm: "Wiederanlauf mit OK bestätigen.", handler: ({ body }) => stackBackup.resume(body) },
  ];
}
