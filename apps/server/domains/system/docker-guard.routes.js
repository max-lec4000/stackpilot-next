// System → Updates & Sicherungen: Docker-Wächter anzeigen und (nur) scharf schalten.
export function dockerGuardRoutes({ dockerGuard }) {
  return [
    { method: "GET", path: "/api/docker-guard", guard: "session", handler: () => dockerGuard.status() },
    { method: "POST", path: "/api/docker-guard/enforce", guard: "ok",
      confirm: "Sperren mit OK bestätigen. StackPilot startet dabei neu.",
      handler: () => dockerGuard.enforce() },
  ];
}
