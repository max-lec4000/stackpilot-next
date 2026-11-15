import { test } from "node:test";
import assert from "node:assert/strict";
import { PrivateServe } from "./identity/private-serve.js";
import { OidcBackchannel } from "./identity/oidc-backchannel.js";

function fixture({ existing = false, code = "tls", hostReady = true } = {}) {
  const host = "device.example.ts.net";
  const values = new Map();
  const state = { repaired: false, ensureCalls: [] };
  const record = existing
    ? {
        id: "owned-helper",
        rootId: "plan",
        status: "preparing",
        stage: "certificate",
      }
    : null;
  const config = {
    TCP: { 443: { HTTPS: true }, 8443: { HTTPS: true } },
    Web: {
      [host + ":443"]: {
        Handlers: { "/": { Proxy: "http://127.0.0.1:19096" } },
      },
      [host + ":8443"]: {
        Handlers: { "/": { Proxy: "http://127.0.0.1:19080" } },
      },
    },
  };
  const hub = {
    context: async () => ({ plan: { id: "plan", ports: { Jellyfin: 8096 } } }),
    mutate: async (names, fn) => fn(),
    engine: {
      vault: {
        get: (key) => values.get(key),
        set: (key, value) => values.set(key, value),
      },
    },
  };
  const service = new PrivateServe(
    hub,
    {
      verify: async () => ({
        id: "identity",
        input: { hostname: host, gatewayPort: 19080 },
      }),
    },
    { verify: async () => ({ target: "http://127.0.0.1:19096" }) },
    {
      plan: async () => ({
        configured: true,
        hostname: host,
        review: "sso-review",
      }),
    },
    async (name, args) => {
      assert.equal(name, "tailscale");
      assert.deepEqual(args, ["serve", "status", "--json"]);
      return { ok: true, output: JSON.stringify(config) };
    },
    async () => new Response("ok"),
    {
      inspect: async () => ({
        ready: state.repaired && hostReady,
        checks: [
          {
            name: "Authentik HTTPS vom Server",
            state: hostReady ? "ok" : "blocked",
          },
          {
            name: "SSO aus Jellyfin",
            state: state.repaired ? "ok" : "blocked",
            code: state.repaired ? "ok" : code,
          },
        ],
      }),
    },
    { inspect: async () => ({ baseUrl: "expected" }) },
    {
      current: () => record,
      inspect: async () => ({
        configured: !!record,
        installed: state.repaired,
        verified: state.repaired,
      }),
      diagnostics: async () => ({
        configured: !!record,
        installed: state.repaired,
        verified: state.repaired,
        stage: state.repaired ? "ready" : "certificate",
      }),
      ensure: async (options) => {
        state.ensureCalls.push(options);
        state.repaired = true;
        return { configured: true, installed: true, verified: true };
      },
    },
  );
  return { service, state };
}

test("Vorhandener eigener OIDC-Auftrag wird bei TLS-, DNS- oder unbekanntem Fehler ausdrücklich fortgesetzt", async () => {
  for (const code of ["tls", "dns", "unknown"]) {
    const { service, state } = fixture({ existing: true, code });
    const preview = await service.preview();
    const result = await service.apply({
      review: preview.review,
      confirmation: "OK",
    });
    assert.deepEqual(state.ensureCalls, [{ explicit: true }], code);
    assert.equal(result.connection.ready, true, code);
    assert.equal(result.ok, true, code);
    assert.equal(result.publicReady, false);
  }
});

test("Ohne bestehenden OIDC-Auftrag wird bei TLS-Fehler kein neuer Hilfsdienst als Ausweichweg angelegt", async () => {
  const { service, state } = fixture({ existing: false, code: "tls" });
  const preview = await service.preview();
  const result = await service.apply({
    review: preview.review,
    confirmation: "OK",
  });
  assert.deepEqual(state.ensureCalls, []);
  assert.equal(result.ok, false);
  assert.equal(result.connection.ready, false);
});

test("Eine Verbindungsablehnung darf nach Bestätigung einen neuen internen OIDC-Weg einrichten", async () => {
  const { service, state } = fixture({ existing: false, code: "refused" });
  const preview = await service.preview();
  const result = await service.apply({
    review: preview.review,
    confirmation: "OK",
  });
  assert.deepEqual(state.ensureCalls, [{ explicit: true }]);
  assert.equal(result.ok, true);
});

test("Fehlender Host-Verbindungsnachweis verhindert auch bei eigenem Auftrag eine automatische OIDC-Reparatur", async () => {
  const { service, state } = fixture({
    existing: true,
    code: "refused",
    hostReady: false,
  });
  const preview = await service.preview();
  const result = await service.apply({
    review: preview.review,
    confirmation: "OK",
  });
  assert.deepEqual(state.ensureCalls, []);
  assert.equal(result.ok, false);
});

test("Gespeicherter Zertifikatsfehler bleibt trotz fehlgeschlagener Live-Prüfung im bereinigten Status erhalten", async () => {
  const record = {
    id: "owned-helper",
    rootId: "plan",
    status: "preparing",
    stage: "certificate",
    lastFailure: {
      code: "permission",
      stage: "certificate",
      at: "2026-11-09T20:00:00.000Z",
      message: "SECRET_RAW_STDERR",
    },
    privateKey: "SECRET_PRIVATE_KEY",
  };
  const backchannel = new OidcBackchannel(
    {
      engine: {
        current: () => ({ plan: { id: "plan" } }),
        vault: { get: () => record },
      },
    },
    null,
    null,
  );
  backchannel.inspect = async () => {
    throw new Error("SECRET_LIVE_EXCEPTION");
  };
  const result = await backchannel.diagnostics();
  assert.equal(result.configured, true);
  assert.equal(result.verified, false);
  assert.equal(result.stage, "certificate");
  assert.equal(result.lastFailure.code, "permission");
  assert.equal(result.lastFailure.stage, "certificate");
  assert.equal(result.lastFailure.at, "2026-11-09T20:00:00.000Z");
  assert.ok(!JSON.stringify(result).includes("SECRET_"));
});
