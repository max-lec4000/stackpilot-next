import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ConnectionCheck,
  validDiscovery,
  connectionFailure,
} from "./identity/connection-check.js";
const hostname = "device.example.ts.net";
const base = `https://${hostname}:8443`;
const metadata = {
  issuer: base + "/application/o/stackpilot-jellyfin/",
  authorization_endpoint: base + "/application/o/authorize/",
  token_endpoint: base + "/application/o/token/",
  jwks_uri: base + "/application/o/stackpilot-jellyfin/jwks/",
};
function fixture({
  success = true,
  host = true,
  log = "Connection refused SECRET_TOKEN",
} = {}) {
  return new ConnectionCheck(
    {
      context: async () => ({
        identity: { input: { hostname, uid: 1000, gid: 1000 } },
        container: { Id: "a".repeat(64) },
      }),
    },
    {
      discovery: async () => ({
        ok: host,
        code: host ? "ok" : "tls",
        httpStatus: host ? 200 : null,
      }),
      dns: async () => [{ address: "100.64.0.5" }],
      docker: async (args) =>
        args[0] === "exec"
          ? "100.64.0.5 STREAM device\n100.64.0.5 DGRAM device"
          : log,
      request: async () =>
        success
          ? new Response(null, {
              status: 302,
              headers: {
                location:
                  base +
                  "/application/o/authorize/?state=SECRET_STATE&client_secret=SECRET",
              },
            })
          : new Response("SECRET_ERROR_BODY", { status: 500 }),
    },
  );
}
test("Host HTTP 200 reicht nicht: fehlgeschlagener tatsächlicher Jellyfin-SSO-Einstieg blockiert Bereitschaft", async () => {
  const r = await fixture({ success: false }).inspect();
  assert.equal(r.ready, false);
  assert.equal(r.checks[0].state, "ok");
  assert.equal(r.checks[1].code, "refused");
  assert.ok(!JSON.stringify(r).includes("SECRET"));
  assert.equal(r.publicReady, false);
});
test("Erfolgreicher SSO-Einstieg bestätigt Verbindungsweg ohne Redirect-Secrets zu exportieren", async () => {
  const r = await fixture().inspect();
  assert.equal(r.ready, true);
  assert.ok(!JSON.stringify(r).includes("SECRET"));
  assert.deepEqual(r.network.containerAddresses, ["100.64.0.5"]);
  assert.equal((await fixture({ host: false }).inspect()).ready, false);
});
test("OIDC-Metadaten benötigen richtige Issuer-Adresse und HTTPS-Endpunkte am eigenen Anbieter", () => {
  assert.equal(validDiscovery(metadata, hostname), true);
  for (const extra of [
    { issuer: "http://untrusted/" },
    { token_endpoint: "https://other.example/token" },
    { jwks_uri: base + "/if/admin/" },
    {
      authorization_endpoint:
        "https://user:password@" + hostname + ":8443/application/o/authorize/",
    },
  ])
    assert.equal(validDiscovery({ ...metadata, ...extra }, hostname), false);
  assert.equal(connectionFailure("certificate verify failed"), "tls");
  assert.equal(connectionFailure("Name or service not known"), "dns");
});
