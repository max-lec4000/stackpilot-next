// Couchdeck: Zustand, Starten/Schließen, Verbindung erneuern, Installieren, Aktualisieren,
// Entfernen. (Der lokale Medienzugang /api/couchdeck/media bleibt in der Middleware, weil er
// eine eigene Anmeldung über das Wohnzimmer-Konto hat.)
export function couchdeckRoutes({ couchdeck }) {
  return [
    { method: "GET", path: "/api/couchdeck", guard: "session", handler: () => couchdeck.status() },
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
