import { test } from "node:test";
import assert from "node:assert/strict";
import { IdentitySettings } from "./identity/settings.js";
const identity = {
  verify: async () => ({
    input: { hostname: "device.example.ts.net", uid: 1000, gid: 1000 },
  }),
  containers: async () => [
    {
      Id: "a".repeat(64),
      Config: { Labels: { "com.docker.compose.service": "worker" } },
      State: { Running: true },
    },
  ],
};
test("Authentik-Einstellungen verwenden nur verwalteten Worker und geben keine fremden Daten zurück", async () => {
  let request;
  const settings = new IdentitySettings(identity, async (args, input) => {
    request = JSON.parse(input);
    return (
      "noise\nSTACKPILOT_SETTINGS=" +
      JSON.stringify({
        supported: true,
        baseUrl: "missing",
        avatars: "other",
        changed: false,
        password: "SECRET",
      })
    );
  });
  assert.deepEqual(await settings.inspect(), {
    supported: true,
    baseUrl: "missing",
    avatars: "other",
    changed: false,
  });
  assert.equal(request.request.expected, "https://device.example.ts.net:8443");
  assert.equal(request.request.apply, false);
  await settings.inspect(true);
  assert.equal(request.request.apply, true);
});
test("Mehrdeutiger Authentik-Worker oder beschädigte Statusdaten gelten nicht als eingerichtet", async () => {
  await assert.rejects(
    new IdentitySettings({ ...identity, containers: async () => [] }).inspect(),
    /Worker/,
  );
  await assert.rejects(
    new IdentitySettings(
      identity,
      async () => "STACKPILOT_SETTINGS={}",
    ).inspect(),
    /unvollständig/,
  );
});
