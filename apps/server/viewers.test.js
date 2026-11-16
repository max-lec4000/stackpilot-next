import test from "node:test";
import assert from "node:assert/strict";
import { Viewers } from "./identity/viewers.js";

function fixture(reply, status = "local-ready") {
  const sent = [];
  const identity = {
    verify: async () => ({ status, input: { hostname: "host.example.ts.net" } }),
    containers: async () => [
      { Id: "w1", Config: { Labels: { "com.docker.compose.service": "worker" } }, State: { Running: true } },
    ],
  };
  const input = async (args, stdin) => {
    sent.push({ args, request: JSON.parse(stdin).request });
    return typeof reply === "function" ? reply(JSON.parse(stdin).request) : reply;
  };
  return { viewers: new Viewers(identity, input), sent };
}
const line = (value) => "log noise\nSTACKPILOT_VIEWERS=" + JSON.stringify(value) + "\n";

test("Einladen erzeugt ein zufälliges Startpasswort und zeigt es genau in dieser Antwort", async () => {
  const f = fixture(line({ created: true, viewers: [{ username: "eltern", name: "Eltern", active: true, mfa: false, lastLogin: null }] }));
  const a = await f.viewers.invite(" Eltern ", "Eltern");
  assert.equal(a.invitation.username, "eltern");
  assert.equal(a.invitation.loginUrl, "https://host.example.ts.net/sso/OID/start/stackpilot");
  assert.ok(a.invitation.password.length >= 20);
  assert.equal(f.sent[0].request.password, a.invitation.password);
  assert.deepEqual(a.viewers, [{ username: "eltern", name: "Eltern", active: true, mfa: false,
    hasPasskey: false, passkeyPending: false, profileId: null, lastLogin: null }]);
  const b = await f.viewers.invite("eltern2");
  assert.notEqual(a.invitation.password, b.invitation.password);
  // Die Liste selbst enthält nie ein Passwort.
  assert.ok(!JSON.stringify(await f.viewers.list()).includes(a.invitation.password));
});

test("Ungültige Namen erreichen Authentik nicht; bekannte Fehler werden verständlich", async () => {
  const f = fixture(line({ error: "exists", viewers: [] }));
  for (const bad of ["", "ab", "1abc", "max mustermann", "a".repeat(40), "../x"])
    await assert.rejects(f.viewers.invite(bad), /Benutzername/);
  assert.equal(f.sent.length, 0);
  await assert.rejects(f.viewers.invite("eltern"), /gibt es in Authentik schon/);
  await assert.rejects(fixture("kein ergebnis").viewers.list(), /nicht bestätigt/);
  await assert.rejects(fixture(line({ viewers: [] }), "prepared").viewers.list(), /noch nicht eingerichtet/);
});

test("Entfernen und Zurücksetzen schicken nur feste Aktionen", async () => {
  const f = fixture((request) => line({ viewers: [], [request.action]: true }));
  await f.viewers.remove("eltern");
  const reset = await f.viewers.reset("eltern");
  assert.deepEqual(f.sent.map((s) => s.request.action), ["remove", "reset"]);
  assert.ok(!("password" in f.sent[0].request));
  assert.ok(reset.invitation.password);
  assert.deepEqual(f.sent[0].args.slice(0, 3), ["exec", "-i", "w1"]);
});
