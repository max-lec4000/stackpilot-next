import { test } from "node:test";
import assert from "node:assert/strict";
import { PrivateServe } from "./identity/private-serve.js";
function fixture() {
  const state = { config: {}, calls: [], values: new Map(), sso: true };
  const host = "device.example.ts.net";
  const hub = {
    context: async () => ({ plan: { id: "plan", ports: { Jellyfin: 8096 } } }),
    mutate: async (n, fn) => fn(),
    engine: {
      vault: {
        get: (k) => state.values.get(k),
        set: (k, v) => state.values.set(k, v),
      },
    },
  };
  const run = async (name, args) => {
    state.calls.push([name, ...args]);
    if (args[1] === "status")
      return { ok: true, output: JSON.stringify(state.config) };
    const port = args.find((a) => a.startsWith("--https=")).split("=")[1];
    if (state.failPort === port) return { ok: false };
    state.config.TCP ||= {};
    state.config.Web ||= {};
    state.config.TCP[port] = { HTTPS: true };
    state.config.Web[host + ":" + port] = {
      Handlers: { "/": { Proxy: args.at(-1) } },
    };
    return { ok: true };
  };
  const identity = {
      verify: async () => ({
        id: "identity",
        input: { hostname: host, gatewayPort: 19080 },
      }),
    },
    protection = { verify: async () => ({ target: "http://127.0.0.1:19096" }) },
    sso = {
      plan: async () => ({
        configured: state.sso,
        hostname: host,
        review: "sso-review",
      }),
    };
  const service = new PrivateServe(
    hub,
    identity,
    protection,
    sso,
    run,
    async () => new Response("ok"),
  );
  return { state, service, host };
}
test("Private Serve setzt nur zwei geprüfte HTTPS-Ziele und bleibt idempotent ohne Funnel/Reset", async () => {
  const f = fixture(),
    p = await f.service.preview();
  assert.equal(p.privateOnly, true);
  assert.equal(p.publicReady, false);
  await f.service.apply({ review: p.review, confirmation: "OK" });
  const commands = f.state.calls.filter((c) => c[2] !== "status");
  assert.deepEqual(
    commands.map((c) => c.at(-1)),
    ["http://127.0.0.1:19096", "http://127.0.0.1:19080"],
  );
  assert.ok(
    commands.every(
      (c) =>
        c[1] === "serve" &&
        c.includes("--bg") &&
        !c.includes("reset") &&
        !c.includes("funnel"),
    ),
  );
  const next = await f.service.preview();
  assert.equal(next.ready, true);
  assert.match(next.routes[0].loginUrl, /sso\/OID\/start\/stackpilot$/);
  await f.service.apply({ review: next.review, confirmation: "OK" });
  assert.equal(f.state.calls.filter((c) => c[2] !== "status").length, 2);
});
test("Private Serve verweigert fremde und öffentliche Routen, fehlendes SSO sowie veraltete Vorschauen", async () => {
  for (const config of [
    { AllowFunnel: { "device.example.ts.net:443": true } },
    {
      Web: {
        "other.example.ts.net:443": {
          Handlers: { "/": { Proxy: "http://127.0.0.1:19096" } },
        },
      },
    },
    { TCP: { 22: { TCPForward: "127.0.0.1:22" } } },
    { Foreground: { x: {} } },
    {
      Web: {
        "device.example.ts.net:443": {
          Handlers: { "/": { Proxy: "http://127.0.0.1:5173" } },
        },
      },
    },
  ]) {
    const f = fixture();
    f.state.config = config;
    await assert.rejects(f.service.preview(), /Fremde/);
    assert.equal(f.state.calls.filter((c) => c[2] !== "status").length, 0);
  }
  const f = fixture();
  f.state.sso = false;
  await assert.rejects(f.service.preview(), /SSO/);
  f.state.sso = true;
  const p = await f.service.preview();
  f.state.config = { ETag: "changed" };
  await assert.rejects(
    f.service.apply({ review: p.review, confirmation: "OK" }),
    /geändert/,
  );
});
test("Unterbrochene private Einrichtung behält bestätigte Route und ergänzt nur die fehlende", async () => {
  const f = fixture();
  f.state.failPort = "8443";
  const p = await f.service.preview();
  await assert.rejects(
    f.service.apply({ review: p.review, confirmation: "OK" }),
    /konnte nicht/,
  );
  assert.equal(
    f.state.config.Web[f.host + ":443"].Handlers["/"].Proxy,
    "http://127.0.0.1:19096",
  );
  assert.equal(f.state.values.get("private-serve:plan").status, "failed");
  f.state.failPort = null;
  const retry = await f.service.preview();
  await f.service.apply({ review: retry.review, confirmation: "OK" });
  assert.equal(
    f.state.calls.filter((c) => c.includes("--https=443")).length,
    1,
  );
  assert.equal((await f.service.preview()).ready, true);
});
test("Gesetzte Serve-Routen werden bei kaputtem Jellyfin-Verbindungsweg nicht als fertige Einrichtung ausgegeben", async () => {
  const f = fixture();
  f.service.diagnostics = {
    inspect: async () => ({
      ready: false,
      checks: [{ name: "SSO aus Jellyfin", state: "blocked", code: "refused" }],
    }),
  };
  f.service.settings = { inspect: async () => ({ baseUrl: "expected" }) };
  const p = await f.service.preview();
  const r = await f.service.apply({ review: p.review, confirmation: "OK" });
  assert.equal(r.ok, false);
  assert.equal(
    f.state.values.get("private-serve:plan").status,
    "connection-blocked",
  );
  const after = await f.service.preview();
  assert.equal(after.routesReady, true);
  assert.equal(after.ready, false);
});
test("Fehlende Basisadresse wird ergänzt, abweichende bleibt ein sichtbarer Konflikt", async () => {
  const f = fixture();
  let changed = false;
  f.service.settings = {
    inspect: async (apply) => {
      if (apply) changed = true;
      return { baseUrl: changed ? "expected" : "missing" };
    },
  };
  let p = await f.service.preview();
  assert.equal(p.systemSettings.baseUrl, "missing");
  assert.equal(
    (await f.service.apply({ review: p.review, confirmation: "OK" })).ok,
    true,
  );
  f.service.settings = { inspect: async () => ({ baseUrl: "different" }) };
  p = await f.service.preview();
  assert.equal(p.ready, false);
  assert.equal(
    (await f.service.apply({ review: p.review, confirmation: "OK" })).ok,
    false,
  );
});
test("Host erfolgreich / Jellyfin abgewiesen löst gezielte interne HTTPS-Reparatur aus und prüft danach erneut", async () => {
  const f = fixture();
  let repaired = false,
    calls = 0;
  f.service.diagnostics = {
    inspect: async () => ({
      ready: repaired,
      checks: [
        { name: "Authentik HTTPS vom Server", state: "ok" },
        {
          name: "SSO aus Jellyfin",
          state: repaired ? "ok" : "blocked",
          code: repaired ? "ok" : "refused",
        },
      ],
    }),
  };
  f.service.backchannel = {
    inspect: async () => ({ installed: false }),
    ensure: async () => {
      calls++;
      repaired = true;
      return { verified: true };
    },
  };
  const p = await f.service.preview();
  const r = await f.service.apply({ review: p.review, confirmation: "OK" });
  assert.equal(calls, 1);
  assert.equal(r.ok, true);
  assert.equal(r.connection.ready, true);
});
test("TLS-Fehler oder fehlende Zertifikatsrechte werden nicht durch unsichere Fallbacks umgangen", async () => {
  const f = fixture();
  let calls = 0;
  f.service.diagnostics = {
    inspect: async () => ({
      ready: false,
      checks: [
        { name: "Authentik HTTPS vom Server", state: "ok" },
        { name: "SSO aus Jellyfin", state: "blocked", code: "tls" },
      ],
    }),
  };
  f.service.backchannel = {
    inspect: async () => ({ installed: false }),
    ensure: async () => {
      calls++;
      throw Error("must not run");
    },
  };
  let p = await f.service.preview();
  assert.equal(
    (await f.service.apply({ review: p.review, confirmation: "OK" })).ok,
    false,
  );
  assert.equal(calls, 0);
  f.service.diagnostics = {
    inspect: async () => ({
      ready: false,
      checks: [
        { name: "Authentik HTTPS vom Server", state: "ok" },
        { name: "SSO aus Jellyfin", state: "blocked", code: "refused" },
      ],
    }),
  };
  p = await f.service.preview();
  const r = await f.service.apply({ review: p.review, confirmation: "OK" });
  assert.equal(r.ok, false);
  assert.equal(r.backchannel.verified, false);
});
