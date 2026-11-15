// Opt-in, isolated fake accounts only. Uses existing browser tools and cached images; no SDK.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSsoFixture } from "./identity/testing/sso-fixture.js";
import { verifyJellyfinSso } from "./identity/testing/sso-browser.js";
import { localIdentityRequest } from "./identity/local-request.js";
test(
  "Jellyfin 12.4: Authentik-MFA, gesperrte Passwörter, begrenzte Bibliotheken, Quick Connect und Widerruf",
  { timeout: 900000 },
  async () => {
    let f;
    try {
      f = await createSsoFixture();
      assert.equal((await f.connection.plan()).configured, true);
      const report = await verifyJellyfinSso(
        f.identity,
        f.requestAsAdmin,
        19096,
        f.selectedLibraryIds,
      );
      assert.equal(report.jellyfinSso, true);
      assert.equal(report.quickConnect, true);
      assert.equal(report.deviceRevoke, true);
      assert.equal(
        (await f.connection.plan()).configured,
        true,
        "Automatische Kontoverknüpfung darf nicht als manuelle Konfigurationsänderung gelten",
      );
      await f.requestAsAdmin("/Users/New", {
        method: "POST",
        body: { Name: "fixture-password-window", Password: "" },
      });
      const body = JSON.stringify({
          Username: "fixture-password-window",
          Pw: "",
        }),
        headers = {
          Host: "identity.example.ts.net",
          "Content-Type": "application/json",
          Authorization:
            'MediaBrowser Client="Fixture", Device="Fixture", DeviceId="fixture-window", Version="1.0"',
        };
      const raw = await localIdentityRequest(
        "http://127.0.0.1:28096/Users/AuthenticateByName",
        { method: "POST", headers, body },
      );
      assert.ok(
        (await raw.json()).AccessToken,
        "Fixture muss die absichtlich ungesicherte Kontoanlage nachweisen",
      );
      for (const path of [
        "/Users/AuthenticateByName",
        "/users/authenticatebyname",
        "/%55sers/AuthenticateByName",
        "//Users/AuthenticateByName",
        "/emby/Users/AuthenticateByName",
        "/Users/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/Authenticate",
        "/Users/Password",
        "/Users/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/Password",
        "/Users/ForgotPassword/Pin",
        "/%2555sers/AuthenticateByName",
        "/sso/OID/States",
        "/sso/OID/p/stackpilot",
        "/sso/Unregister/fixture",
        "/sso/SAML/start/other",
      ]) {
        const r = await localIdentityRequest("http://127.0.0.1:19096" + path, {
          method: "POST",
          headers,
          body,
        });
        await r.arrayBuffer();
        assert.ok([400, 403].includes(r.status), path + " " + r.status);
      }
      const plan = await f.connection.plan();
      assert.equal(
        JSON.stringify(plan).includes(
          f.vault.get("identity-secrets:" + f.identity.id).oidc_secret,
        ),
        false,
      );
      const config = (await f.requestAsAdmin("/sso/OID/Get")).stackpilot;
      config.Enabled = false;
      await f.requestAsAdmin("/sso/OID/Add/stackpilot", {
        method: "POST",
        body: config,
      });
      const after = await f.connection.plan();
      assert.equal(after.canApply, false);
      assert.equal(after.configured, false);
      assert.ok(after.blockers.some((v) => v.includes("geänderte")));
      await assert.rejects(
        () =>
          f.connection.apply({
            review: after.review,
            libraryIds: f.selectedLibraryIds,
            confirmation: "OK",
          }),
        /Übernahme/,
      );
      assert.equal(
        (await f.requestAsAdmin("/sso/OID/Get")).stackpilot.Enabled,
        false,
      );
      console.log(
        "Reale private SSO-Verbindung: MFA, Bibliotheksrechte, Passwort-/Rollen-Umgehung, Gateway-Aliasse, Quick Connect, Widerruf und Konfigurationsschutz geprüft.",
      );
    } finally {
      if (f) await f.close();
    }
  },
);
