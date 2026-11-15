// Cheap, read-only navigation evidence. Saved configuration is never a live
// connection, MFA, device playback or public-access acceptance test.
const definitions = [
  { id: "server", prerequisites: [] },
  { id: "identity", prerequisites: ["server"] },
  { id: "accounts", prerequisites: ["identity"], manual: true },
  { id: "protection", prerequisites: ["identity"] },
  { id: "sso", prerequisites: ["protection"] },
  { id: "https", prerequisites: ["sso"] },
  { id: "access", prerequisites: ["https"], manual: true },
  { id: "public", prerequisites: ["access", "accounts"], manual: true },
];
const read = (fn) => {
  try {
    return { known: true, value: fn() };
  } catch {
    return { known: false, value: null };
  }
};
const fact = (source, ready, owned = true) => ({
  known: source.known && owned,
  saved: source.known && owned && !!ready,
  resumable: source.known && owned && !!source.value && !ready,
});
export class RemoteJourney {
  constructor(hub, identity, protection, sso) {
    Object.assign(this, { hub, identity, protection, sso });
  }
  snapshot() {
    const current = read(() => this.hub.engine.current());
    const plan = current.value?.plan;
    const root = plan?.rootId || plan?.id;
    const validPlan =
      !!plan && typeof root === "string" && Array.isArray(plan.spec?.selected);
    const selected = validPlan && plan.spec.selected.includes("Jellyfin");
    const identity = read(() => this.identity.current());
    const protection = read(() => this.protection.current());
    const ownIdentity = !identity.value || identity.value.rootId === root;
    const ownProtection = !protection.value || protection.value.rootId === root;
    const sso = read(() =>
      identity.value && ownIdentity
        ? this.hub.engine.vault.get(this.sso.key(identity.value))
        : null,
    );
    const https = read(() =>
      root ? this.hub.engine.vault.get("private-serve:" + root) : null,
    );
    const serverKnown = current.known && (!plan || validPlan);
    const facts = {
      server: {
        known: serverKnown,
        saved: selected && current.value?.job?.status === "completed",
        resumable:
          !!plan && selected && current.value?.job?.status !== "completed",
      },
      identity: fact(
        identity,
        identity.value?.status === "local-ready",
        ownIdentity,
      ),
      protection: fact(
        protection,
        protection.value?.status === "ready",
        ownProtection,
      ),
      sso: fact(sso, sso.value?.status === "configured", ownIdentity),
      https: fact(https, https.value?.status === "ready"),
    };
    const steps = [];
    for (const definition of definitions) {
      const f = facts[definition.id];
      const missingPrerequisites = definition.prerequisites.filter(
        (id) => !steps.find((s) => s.id === id)?.configured,
      );
      const configured = !!f?.saved && missingPrerequisites.length === 0;
      let status = configured
        ? "configured"
        : f?.known
          ? "not-configured"
          : "unknown";
      if (missingPrerequisites.length || definition.id === "public")
        status = "blocked";
      let message = configured
        ? "Konfiguration gespeichert. Aktuellen Zustand im Schritt erneut prüfen."
        : status === "blocked"
          ? "Voraussetzungen zuerst einrichten oder prüfen."
          : f?.resumable
            ? "Begonnene Einrichtung im Schritt gezielt prüfen und fortsetzen."
            : status === "unknown"
              ? "Zustand noch nicht bestätigt."
              : "Einrichtung steht noch aus.";
      if (definition.id === "access")
        message =
          "Erreichbarkeit vom eigenen Gerät prüfen. Ein erfolgreicher Server-Test bestätigt diesen Zugriff nicht.";
      if (definition.id === "accounts")
        message =
          "Zuschauer, persönliche MFA und Gerätesitzungen prüfen. Gespeicherte Konfiguration ersetzt diese Abnahme nicht.";
      if (definition.id === "public")
        message =
          "Öffentliche Freigabe bleibt eine gesonderte Abnahme. Dieser Ablauf aktiviert keinen Funnel.";
      steps.push({
        id: definition.id,
        status,
        configured,
        hasSavedConfiguration: !!f?.saved,
        resumable: !!f?.resumable,
        prerequisites: [...definition.prerequisites],
        missingPrerequisites,
        requiresManualCheck: !!definition.manual,
        requiresFreshCheck: !definition.manual,
        message,
      });
    }
    return {
      observedAt: new Date().toISOString(),
      evidence: "saved-configuration",
      publicReady: false,
      nextSuggested:
        steps.find((s) => !s.configured && !s.requiresManualCheck)?.id ||
        steps.find((s) => !s.configured)?.id ||
        "access",
      steps,
    };
  }
}
