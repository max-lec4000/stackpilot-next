// System → Zugriff & Netzwerk: Prüfauftrag für VPN und Ausfallsperre (unterbricht kurz
// das VPN und stoppt qBittorrent).
export function safetyRoutes({ safety }) {
  return [
    { method: "GET", path: "/api/safety", guard: "session", handler: () => ({ operations: safety.list() }) },
    { method: "POST", path: "/api/safety/start", guard: "ok",
      confirm: "Der Test unterbricht kurz das VPN und stoppt qBittorrent. Mit OK bestätigen.",
      handler: ({ body }) => safety.start(body) },
  ];
}
