import { test } from "node:test";
import assert from "node:assert/strict";
import { RemoteAccess, checkServeConfig } from "./remote-access.js";
const target = "http://127.0.0.1:8096";
const valid = {
  TCP: { 443: { HTTPS: true } },
  Web: { "media.example.ts.net:443": { Handlers: { "/": { Proxy: target } } } },
};
test("Serve-Prüfung akzeptiert nur Jellyfin auf HTTPS 443 und erkennt Funnel", () => {
  assert.deepEqual(checkServeConfig(valid, target), {
    exclusive: true,
    routes: 1,
    public: false,
  });
  assert.equal(
    checkServeConfig(
      { ...valid, AllowFunnel: { "media.example.ts.net:443": true } },
      target,
    ).public,
    true,
  );
  for (const config of [
    { ...valid, TCP: { 22: { TCPForward: "127.0.0.1:22" } } },
    {
      ...valid,
      Web: {
        "media.example.ts.net:443": {
          Handlers: { "/": { Proxy: "http://127.0.0.1:5173" } },
        },
      },
    },
    { ...valid, Services: { "svc:other": {} } },
    {
      ...valid,
      Foreground: {
        x: {
          Web: {
            "media.example.ts.net:443": {
              Handlers: { "/arr": { Proxy: "http://127.0.0.1:7878" } },
            },
          },
        },
      },
    },
    { ...valid, Web: [] },
    { ...valid, TCP: true },
  ])
    assert.equal(checkServeConfig(config, target).exclusive, false);
});
function fixture() {
  const calls = [];
  const hub = {
    context: async () => ({ s: {}, plan: { ports: { Jellyfin: 8096 } } }),
    library: {
      request: async (s, p, route) => {
        calls.push(route);
        if (route === "/System/Info")
          return { Version: "10.11", LocalAddress: "secret" };
        if (route === "/System/Configuration/network")
          return { EnableRemoteAccess: false, KnownProxies: ["private"] };
        if (route === "/QuickConnect/Enabled") return true;
        if (route === "/Users")
          return [
            {
              Name: "secret-user",
              Policy: { IsAdministrator: true, EnableRemoteAccess: true },
            },
            { Name: "viewer", Policy: { IsAdministrator: false } },
          ];
        if (route === "/Plugins") return [{ Name: "SSO-Auth" }];
        throw Error("unknown");
      },
    },
  };
  const run = async (name, args) => {
    calls.push([name, ...args]);
    return {
      ok: true,
      output: JSON.stringify(
        args[0] === "status"
          ? {
              BackendState: "Running",
              Self: {
                Online: true,
                DNSName: "media.example.ts.net.",
                TailscaleIPs: ["secret-ip"],
              },
              User: { email: "secret-email" },
            }
          : valid,
      ),
    };
  };
  return { hub, run, calls };
}
test("Vorbereitung führt nur lesende Befehle aus, projiziert keine Nutzer/IPs und bestätigt keine MFA", async () => {
  const f = fixture(),
    r = await new RemoteAccess(f.hub, f.run).inspect();
  assert.equal(r.publicReady, false);
  assert.equal(r.privateCommand, null);
  assert.equal(r.jellyfin.remoteAdmins, 1);
  assert.equal(r.checks.find((c) => c.name === "SSO/MFA").state, "todo");
  assert.equal(JSON.stringify(r).includes("secret"), false);
  assert.deepEqual(f.calls.filter(Array.isArray), [
    ["tailscale", "status", "--json"],
    ["tailscale", "serve", "status", "--json"],
    ["tailscale", "debug", "prefs"],
  ]);
});
test("Unbekannte Konfiguration oder eine fremde Serve-Route erzeugt keine Freigabevorlage", async () => {
  for (const output of [
    "not-json",
    JSON.stringify({
      ...valid,
      Web: {
        "media.example.ts.net:443": {
          Handlers: { "/": { Proxy: "http://127.0.0.1:5173" } },
        },
      },
    }),
  ]) {
    const f = fixture();
    const r = await new RemoteAccess(f.hub, async (name, args) =>
      args[0] === "status" ? f.run(name, args) : { ok: true, output },
    ).inspect();
    assert.equal(r.privateCommand, null);
    assert.equal(r.publicReady, false);
  }
});

test("Bei aktivem SSO wird keine direkte Serve-Vorlage am Schutz-Gateway vorbei ausgegeben", async () => {
  const f = fixture(),
    original = f.hub.library.request;
  f.hub.library.request = async (s, p, route) =>
    route === "/Plugins"
      ? [
          {
            Name: "SSO-Auth",
            Id: "505ce9d1d91642fa86ca673ef241d7df",
            Version: "4.0.0.4",
            Status: "Active",
          },
        ]
      : original(s, p, route);
  const r = await new RemoteAccess(f.hub, f.run).inspect();
  assert.equal(r.jellyfin.ssoReleaseMatches, true);
  assert.equal(r.privateCommand, null);
});

test("Bekannte Schutz-Routen bleiben bei unterbrochenem Auftrag erkennbar und erzeugen keine Backend-Umgehung", async () => {
  for (const state of ["ready", "failed"]) {
    const f = fixture();
    f.hub.engine = {
      current: () => ({ plan: { id: "root" } }),
      vault: {
        get: (key) =>
          key.startsWith("jellyfin-protection:")
            ? {
                id: "protection",
                status: state,
                hostname: "media.example.ts.net",
              }
            : {
                input: { hostname: "media.example.ts.net", gatewayPort: 19080 },
              },
      },
    };
    const config = {
      TCP: { 443: { HTTPS: true }, 8443: { HTTPS: true } },
      Web: {
        "media.example.ts.net:443": {
          Handlers: { "/": { Proxy: "http://127.0.0.1:19096" } },
        },
        "media.example.ts.net:8443": {
          Handlers: { "/": { Proxy: "http://127.0.0.1:19080" } },
        },
      },
    };
    const report = await new RemoteAccess(f.hub, async (name, args) =>
      args[0] === "status"
        ? f.run(name, args)
        : { ok: true, output: JSON.stringify(config) },
    ).inspect();
    assert.equal(report.serve.exclusive, true);
    assert.equal(report.serve.public, false);
    assert.equal(report.privateCommand, null);
  }
});

test("Aktuelle Geräteadressen und eingehende Sperre werden ohne rohe Preferences projiziert", async () => {
  const f = fixture();
  for (const blocked of [true, false]) {
    const report = await new RemoteAccess(f.hub, async (name, args) =>
      args[0] === "status"
        ? {
            ok: true,
            output: JSON.stringify({
              BackendState: "Running",
              Self: {
                Online: true,
                DNSName: "media.example.ts.net.",
                TailscaleIPs: [
                  "100.89.1.2",
                  "fd7a:115c:a1e0::1234",
                  "192.168.1.2",
                ],
              },
            }),
          }
        : args[0] === "debug"
          ? {
              ok: true,
              output: JSON.stringify({
                ShieldsUp: blocked,
                PrivateKey: "SECRET",
                other: "SECRET",
              }),
            }
          : f.run(name, args),
    ).inspect();
    assert.deepEqual(report.serverAddresses, [
      "100.89.1.2",
      "fd7a:115c:a1e0::1234",
    ]);
    assert.equal(report.incomingAllowed, !blocked);
    assert.equal(
      report.checks.find((c) => c.name === "Tailscale-Verbindungsannahme")
        .state,
      blocked ? "blocked" : "ok",
    );
    assert.ok(!JSON.stringify(report).includes("SECRET"));
  }
});
