// Ist die öffentliche Freigabe die eigene, von StackPilot bestätigte Funnel-Freigabe?
// Dann gilt der Zustand nicht als "fremde öffentliche Ausgangslage". Ob die Routen
// tatsächlich genau die eigenen sind, prüft der Funnel-Ablauf selbst (validate()).
export function ownFunnel(hub, plan) {
  if (!plan) return false;
  const saved = hub.engine.vault.get("public-funnel:" + (plan.rootId || plan.id));
  return (
    !!saved &&
    saved.rootId === (plan.rootId || plan.id) &&
    ["applying", "active"].includes(saved.status)
  );
}
