import { test } from "node:test";
import assert from "node:assert/strict";
import { ssoPluginState, ssoCompatibility } from "./identity/sso-release.js";
import { releases } from "./identity/config.js";
const plugin = {
  Id: releases.ssoPlugin.id.replaceAll("-", ""),
  Version: "4.0.0.4",
  Status: "Active",
  Name: "SSO-Auth",
};
test("SSO-Erkennung benötigt eindeutige Plugin-ID und aktiven Status statt eines Namens", () => {
  assert.equal(ssoPluginState([plugin]).releaseMatches, true);
  for (const status of ["Disabled", "Malfunctioned", "NotSupported", undefined])
    assert.equal(ssoPluginState([{ ...plugin, Status: status }]).active, false);
  assert.equal(
    ssoPluginState([{ Name: "SSO-Auth", Status: "Active", Id: "other" }])
      .present,
    false,
  );
  assert.equal(ssoPluginState([plugin, plugin]).active, false);
  assert.equal(
    ssoPluginState([{ ...plugin, Version: "4.0.0.3" }]).releaseMatches,
    false,
  );
});
test("Ladetest ist keine Freigabe für Anmeldung oder automatische Installation", () => {
  const result = ssoCompatibility("12.4.0");
  assert.equal(result.loadVerified, true);
  assert.equal(result.automaticInstallation, false);
  assert.equal(ssoCompatibility("unverified-version").loginVerified, false);
  assert.match(releases.ssoPlugin.sha256, /^[a-f0-9]{64}$/);
});

test("SSO-Profil sperrt direkte Passwortanbieter, validiert TLS/Issuer und erteilt keine Administratorrechte", async () => {
  const { secureSsoProfile, denyPasswordProvider } = await import(
    "./identity/sso-profile.js"
  );
  const input = { hostname: "identity.example.ts.net", uid: 1000, gid: 1000 };
  const p = secureSsoProfile(input, "fixture-secret-".repeat(4), [
    "a".repeat(32),
  ]);
  assert.equal(p.DefaultProvider, denyPasswordProvider);
  assert.equal(p.PortOverride, -1);
  assert.equal(p.EnableAuthorization, true);
  assert.deepEqual(p.AdminRoles, []);
  assert.deepEqual(p.Roles, ["stackpilot-viewers"]);
  assert.equal(p.EnableAllFolders, false);
  assert.equal(p.DisableHttps, false);
  assert.equal(p.DoNotValidateIssuerName, false);
  assert.equal(p.DoNotValidateEndpoints, false);
  assert.throws(() => secureSsoProfile(input, "short"), /Schlüssel/);
  assert.throws(
    () => secureSsoProfile(input, "x".repeat(48), ["../unsafe"]),
    /Bibliothek/,
  );
});
