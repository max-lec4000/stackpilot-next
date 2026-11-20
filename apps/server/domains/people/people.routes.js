// Personen: Zuschauer (Einladen, Zurücksetzen, Entfernen, Passkeys, Anmeldeverbesserung),
// Zuschauerprofile und die Einrichtung „Zugriff von unterwegs“ mit erstem Zuschauer.
export function peopleRoutes({ viewers, viewerProfiles, viewerRatings, remoteSetup }) {
  return [
    { method: "GET", path: "/api/viewers", guard: "session", handler: () => viewers.list() },
    { method: "GET", path: "/api/viewer-profiles", guard: "session", handler: () => viewerProfiles.list() },
    { method: "POST", path: "/api/viewer-profiles", guard: "session", handler: ({ body }) => viewerProfiles.change(body) },
    // Altersfreigabe je Zuschauer (Jellyfin-Richtlinie)
    { method: "GET", path: "/api/viewer-ratings", guard: "session", handler: () => viewerRatings.list() },
    { method: "POST", path: "/api/viewer-ratings", guard: "ok", confirm: "Altersfreigabe mit OK bestätigen.",
      handler: ({ body }) => viewerRatings.change(body) },
    // Zwei Aktionen ändern die Anmeldung aller Zuschauer und verlangen das Passwort.
    { method: "POST", path: "/api/viewers/action", guard: "session", handler: async ({ body, manager, remoteAddress }) => {
      if (body.action === "invite") return viewers.invite(body.name, body.displayName);
      // Zurücksetzen und Entfernen beenden Anmeldungen – nur mit ausdrücklichem OK.
      if (["reset", "remove"].includes(body.action) && body.confirmation !== "OK")
        throw Object.assign(new Error(body.action === "remove" ? "Entfernen mit OK bestätigen." : "Neu einladen mit OK bestätigen."), { userFacing: true });
      if (body.action === "reset") return viewers.reset(body.name);
      if (body.action === "remove") return viewers.remove(body.name);
      if (["add-passkey", "cancel-passkey"].includes(body.action)) return viewers.passkey(body.action, body.name);
      if (["enable-recovery", "improve-login"].includes(body.action)) {
        await manager.reauthenticate(body.password, remoteAddress);
        return viewers.updateLogin(body.action);
      }
      throw new Error("Unbekannte Zuschauer-Aktion.");
    } },
    { method: "GET", path: "/api/remote-setup", guard: "session", handler: () => remoteSetup.summary() },
    { method: "POST", path: "/api/remote-setup/start", guard: "session",
      handler: ({ body }) => remoteSetup.start({ viewer: typeof body.viewer === "string" ? body.viewer : "" }) },
    { method: "POST", path: "/api/remote-setup/acknowledge", guard: "session", handler: () => remoteSetup.acknowledge() },
  ];
}
