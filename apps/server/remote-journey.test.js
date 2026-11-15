import { test } from "node:test";
import assert from "node:assert/strict";
import { RemoteJourney } from "./remote-journey.js";
function fixture({
  job = "completed",
  identityStatus = "local-ready",
  protectionStatus = "ready",
  ssoStatus = "configured",
  httpsStatus = "ready",
  plan = true,
  foreignIdentity = false,
} = {}) {
  const secret = "NEVER_EXPORT_PRIVATE_DATA";
  const values = new Map([
    [
      "identity-sso:identity",
      ssoStatus ? { status: ssoStatus, expected: { OidSecret: secret } } : null,
    ],
    [
      "private-serve:root",
      httpsStatus ? { status: httpsStatus, original: { secret } } : null,
    ],
  ]);
  const hub = {
    engine: {
      current: () =>
        plan
          ? {
              plan: {
                id: "extension",
                rootId: "root",
                spec: { selected: ["Jellyfin"], username: secret },
              },
              job: { status: job, secret },
            }
          : null,
      vault: {
        get: (k) => values.get(k),
        set: () => {
          throw Error("No writes allowed");
        },
      },
      store: {
        claim: () => {
          throw Error("No mutation allowed");
        },
      },
    },
  };
  const identity = {
    current: () =>
      identityStatus
        ? {
            id: "identity",
            rootId: foreignIdentity ? "foreign" : "root",
            status: identityStatus,
            input: { secret },
          }
        : null,
    verify: () => {
      throw Error("No live probes allowed");
    },
  };
  const protection = {
    current: () =>
      protectionStatus
        ? { rootId: "root", status: protectionStatus, secret }
        : null,
    verify: () => {
      throw Error("No live probes allowed");
    },
  };
  const sso = {
    key: (r) => "identity-sso:" + r.id,
    plan: () => {
      throw Error("No heavy probes allowed");
    },
  };
  return {
    journey: new RemoteJourney(hub, identity, protection, sso),
    values,
    secret,
  };
}
test("Gespeicherter Fernzugriff ist Navigationsevidenz und keine Geräte-/MFA-/öffentliche Abnahme", () => {
  const { journey, values, secret } = fixture();
  const before = structuredClone([...values]);
  const r = journey.snapshot();
  assert.equal(r.evidence, "saved-configuration");
  assert.equal(r.publicReady, false);
  assert.equal(r.nextSuggested, "accounts");
  for (const id of ["server", "identity", "protection", "sso", "https"]) {
    assert.equal(r.steps.find((s) => s.id === id).status, "configured");
    assert.equal(r.steps.find((s) => s.id === id).requiresFreshCheck, true);
  }
  for (const id of ["access", "accounts", "public"])
    assert.equal(r.steps.find((s) => s.id === id).configured, false);
  assert.equal(r.steps.find((s) => s.id === "public").status, "blocked");
  assert.deepEqual([...values], before);
  assert.ok(!JSON.stringify(r).includes(secret));
});
test("Unvollständiger Medienauftrag führt zum Server-Schritt und sperrt davon abhängige Einrichtung", () => {
  const r = fixture({ job: "paused" }).journey.snapshot();
  assert.equal(r.nextSuggested, "server");
  assert.equal(r.steps[0].resumable, true);
  assert.equal(r.steps[1].status, "blocked");
  assert.deepEqual(r.steps[1].missingPrerequisites, ["server"]);
});
test("Unterbrochene eigene Konfiguration wird als fortsetzbar statt fertig eingeordnet", () => {
  const r = fixture({
    ssoStatus: "applying",
    httpsStatus: "connection-blocked",
  }).journey.snapshot();
  assert.equal(r.nextSuggested, "sso");
  assert.equal(r.steps.find((s) => s.id === "sso").resumable, true);
  assert.equal(r.steps.find((s) => s.id === "https").resumable, true);
  assert.equal(r.steps.find((s) => s.id === "https").status, "blocked");
});
test("Leere oder fremde Ausgangslage wird nicht als konfigurierte Einrichtung ausgegeben", () => {
  const empty = fixture({
    plan: false,
    identityStatus: null,
    protectionStatus: null,
    ssoStatus: null,
    httpsStatus: null,
  }).journey.snapshot();
  assert.equal(empty.steps[0].status, "not-configured");
  assert.equal(empty.nextSuggested, "server");
  const foreign = fixture({ foreignIdentity: true }).journey.snapshot();
  assert.equal(
    foreign.steps.find((s) => s.id === "identity").status,
    "unknown",
  );
  assert.equal(foreign.steps.find((s) => s.id === "sso").configured, false);
});
test("Lesefehler bleiben unbekannt und werden nicht als Erfolg oder neue Schreibaktion ersetzt", () => {
  const { journey } = fixture();
  journey.identity.current = () => {
    throw Error("PRIVATE_READ_ERROR");
  };
  const r = journey.snapshot();
  assert.equal(r.steps.find((s) => s.id === "identity").status, "unknown");
  assert.ok(!JSON.stringify(r).includes("PRIVATE_READ_ERROR"));
});
