// System → Updates: StackPilot selbst und die Mediencontainer.
export function updateRoutes({ serviceUpdates, containerMaintenance, couchdeck, updateWindow }) {
  return [
    { method: "GET", path: "/api/updates/job", guard: "session", handler: () => serviceUpdates.job() },
    { method: "POST", path: "/api/updates/preview", guard: "session", handler: () => serviceUpdates.preview() },
    { method: "POST", path: "/api/updates/start", guard: "ok", confirm: "Update mit OK bestätigen.",
      handler: ({ body }) => serviceUpdates.start(body) },
    { method: "GET", path: "/api/container-maintenance", guard: "session", handler: () => containerMaintenance.list() },
    { method: "POST", path: "/api/container-maintenance/update", guard: "ok", confirm: "Dienst und Bestätigung fehlen.",
      handler: ({ body }) => containerMaintenance.apply(body, false) },
    { method: "POST", path: "/api/container-maintenance/rollback", guard: "ok", confirm: "Dienst und Bestätigung fehlen.",
      handler: ({ body }) => containerMaintenance.apply(body, true) },
    { method: "POST", path: "/api/container-maintenance/batch", guard: "ok",
      confirm: "Anwendungen und Bestätigung fehlen oder sind ungültig.",
      handler: ({ body }) => containerMaintenance.applyBatch(body, couchdeck) },
    // Verwaltete Verbindungen mit den Tresorschlüsseln abgleichen (nach Rückkehr automatisch)
    { method: "POST", path: "/api/container-maintenance/reconcile", guard: "ok", confirm: "Abgleich mit OK bestätigen.",
      handler: ({ body }) => containerMaintenance.reconcile(body) },
    // Wartungsfenster für automatische App-Updates (Paket 7.5)
    { method: "GET", path: "/api/update-window", guard: "session", handler: () => updateWindow.status() },
    { method: "POST", path: "/api/update-window", guard: "ok", confirm: "Wartungsfenster mit OK bestätigen.", handler: ({ body }) => updateWindow.save(body) },
  ];
}
