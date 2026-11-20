// Couchdeck: Zustand, Starten/Schließen, Verbindung erneuern, Installieren, Aktualisieren,
// Entfernen. (Der lokale Medienzugang /api/couchdeck/media bleibt in der Middleware, weil er
// eine eigene Anmeldung über das Wohnzimmer-Konto hat.)
export function couchdeckRoutes({ couchdeck }) {
  return [
    { method: "GET", path: "/api/couchdeck", guard: "session", handler: () => couchdeck.status() },
    // Bedienung und Diagnose vom Sofa (7.6): Zustandsbericht, Audioausgang, Testton, Lautstärke, Prüfen, Neustart
    { method: "GET", path: "/api/couchdeck/remote", guard: "session", handler: () => couchdeck.remoteStatus() },
    { method: "POST", path: "/api/couchdeck/remote", guard: "session", handler: ({ body }) => {
      if (body.action === "restart" && body.confirmation !== "OK")
        throw Object.assign(new Error("Neustart mit OK bestätigen."), { userFacing: true });
      const args = body.action === "volume" ? { percent: body.percent } : ["set-sink", "tone"].includes(body.action) ? { name: body.name } : {};
      return couchdeck.remoteCommand(body.action, args);
    } },
    { method: "POST", path: "/api/couchdeck/action", guard: "session", handler: async ({ body }) => {
      const actions = {
        start: () => couchdeck.start(),
        stop: () => couchdeck.stop(),
        link: () => couchdeck.link(),
        install: () => couchdeck.install(false),
        update: async () => {
          await couchdeck.update(body.version);
          return couchdeck.status();
        },
        "install-youtube": () => couchdeck.install(true),
        remove: () => couchdeck.remove(),
      };
      if (!Object.hasOwn(actions, body.action)) throw new Error("Unbekannte Couchdeck-Aktion.");
      return actions[body.action]();
    } },
  ];
}
