// System → Apps & Container: Einrichtung/Erweiterung des Stacks und Ablösung eines Altstacks.
// (Die Zuordnung operationId → Auftragsart prüft die Middleware vorab.)
export function setupRoutes({ installer, executor }) {
  const post = (path, handler) => ({ method: "POST", path, guard: "session", handler });
  return [
    post("/api/deployment/plan", ({ body }) => installer().createPlan(body)),
    post("/api/deployment/confirm", ({ body }) => installer().confirm(body.planId, body.confirmation)),
    post("/api/deployment/pause", ({ body }) => installer().pause(body.operationId)),
    post("/api/deployment/resume", ({ body }) => installer().resume(body.operationId)),
    post("/api/deployment/end", ({ body }) => installer().end(body.operationId, body.confirmation)),
    post("/api/retirement/plan", ({ body }) => executor().createPlan(body.project)),
    post("/api/retirement/confirm", ({ body }) => executor().confirm(body.planId, body.confirmation, body.autostartAcknowledged)),
    post("/api/retirement/pause", ({ body }) => executor().pause(body.operationId)),
    post("/api/retirement/end", ({ body }) => executor().end(body.operationId, body.confirmation)),
    post("/api/retirement/resume", ({ body }) => executor().resume(body.operationId)),
  ];
}
