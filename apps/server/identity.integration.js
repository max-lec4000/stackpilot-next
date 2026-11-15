import { IdentityBackups } from "./identity/backups.js";
import { localIdentityRequest } from "./identity/local-request.js";
// Explicit opt-in. Isolated local identity realm; no real users, no Tailscale changes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { StateStore } from "./state.js";
import { Vault } from "./vault.js";
import { IdentityPreparation } from "./identity/preparation.js";
import { localDocker } from "./retirement.js";
import { dockerInput } from "./docker-io.js";
import { verifyMfaFlows } from "./identity/testing/flows.js";
test(
  "Lokale Authentik-Installation erzwingt MFA, lehnt Administratoren ab und hält öffentliche Verwaltung geschlossen",
  { timeout: 900000 },
  async () => {
    const dir = await mkdtemp("/tmp/sp-identity-integration-"),
      store = new StateStore(dir),
      vault = new Vault(store),
      plan = { id: "fixture", rootId: "fixture" };
    const hub = {
      engine: {
        store,
        vault,
        current: () => ({ plan, job: { status: "completed" } }),
      },
      mutate: async (n, fn) => fn({ plan }),
    };
    const remote = {
      inspect: async () => ({
        tailscaleRunning: true,
        hostname: "identity.example.ts.net",
        target: "http://127.0.0.1:8096",
        jellyfin: { version: "12.4.0" },
        serveKnown: true,
        serve: { exclusive: true, public: false },
      }),
    };
    const setup = new IdentityPreparation(hub, remote, localDocker);
    let record;
    try {
      await setup.prepare();
      record = setup.current();
      await setup.start({ id: record.id, confirmation: "OK" });
      await setup.pending;
      record = setup.current();
      assert.equal(
        record.status,
        "local-ready",
        JSON.stringify(setup.summary()),
      );
      assert.equal(setup.summary().publicReady, false);
      assert.equal(setup.summary().pluginCompatible, true);
      const rows = await setup.containers(record, true),
        worker = rows.find(
          (r) => r.Config.Labels["com.docker.compose.service"] === "worker",
        );
      const result = await dockerInput(
        [
          "exec",
          "-i",
          worker.Id,
          "ak",
          "shell",
          "-c",
          "exec(__import__('sys').stdin.read())",
        ],
        await readFile(
          new URL("./identity/testing/fixture.py", import.meta.url),
          "utf8",
        ),
        { timeout: 60000 },
      );
      assert.ok(result.includes("policies verified"));
      const security = await setup.inspectSecurity();
      assert.equal(security.publicReady, false);
      assert.equal(
        security.checks.find((c) => c.name === "MFA-Regeln").state,
        "ok",
      );
      assert.equal(
        security.checks.find((c) => c.name === "Authentik-Abmeldung").state,
        "ok",
      );
      assert.equal(
        security.checks.find((c) => c.name === "Administratoren").state,
        "todo",
      );
      assert.match(
        security.checks.find((c) => c.name === "Zuschauer").message,
        /1 von 2/,
      );
      assert.match(
        security.checks.find((c) => c.name === "Zuschauer-Wiederherstellung")
          .message,
        /1 von 2/,
      );
      assert.equal(
        JSON.stringify(security).includes("fixture-recovery-only"),
        false,
      );
      await verifyMfaFlows(
        `http://127.0.0.1:${record.input.adminPort}`,
        `${record.input.hostname}:${record.input.adminPort}`,
      );
      console.log(
        "Authentik-Anmeldeflow: kein Gerät abgewiesen, falscher Code abgewiesen, gültiger TOTP-Code angenommen; Zuschauer-/Administratorrichtlinien geprüft.",
      );
      await localDocker([
        "network",
        "connect",
        record.project + "_ingress",
        worker.Id,
      ]);
      await assert.rejects(() => setup.inspectSecurity(), /nicht bestätigt/);
      await localDocker([
        "network",
        "disconnect",
        record.project + "_ingress",
        worker.Id,
      ]);
      if (process.env.STACKPILOT_TEST_BROWSER === "1") {
        const { verifyOidcBrowser } = await import(
          "./identity/testing/oidc-browser.js"
        );
        const result = await verifyOidcBrowser(
          record,
          vault.get(`identity-secrets:${record.id}`).oidc_secret,
        );
        assert.equal(result.signedIdToken, true);
        console.log(
          "Browser-OIDC: MFA, signiertes ID-Token, Nonce, PKCE und Code-Replay geprüft.",
        );
      }
      const base = `http://127.0.0.1:${record.input.gatewayPort}`,
        headers = { Host: record.input.hostname };
      for (const route of [
        "/if/admin/",
        "/api/v3/core/users/",
        "/api/v3/core/tokens/",
        "/api/v3/flows/instances/",
        "/if/flow/stackpilot-admin-login/",
        "/api/v3/flows/executor/stackpilot-admin-login/",
        "/if/flow/default-authentication-flow/",
        "/%69f/admin/",
        "/api/v3/core/brands/",
      ]) {
        const r = await localIdentityRequest(base + route, {
          headers,
          redirect: "manual",
        });
        await r.arrayBuffer();
        assert.equal(r.status, 404, route);
      }
      for (const route of [
        "/api/v3/root/config/",
        "/if/flow/stackpilot-authentication/",
      ]) {
        const r = await localIdentityRequest(base + route, {
          headers,
          redirect: "manual",
        });
        await r.arrayBuffer();
        assert.equal(r.status, 200, route);
      }
      const badHost = await localIdentityRequest(base + "/healthz", {
        headers: { Host: "untrusted.example" },
        redirect: "manual",
      });
      await badHost.arrayBuffer();
      assert.equal(badHost.status, 421);
      const secret = vault.get(`identity-secrets:${record.id}`).oidc_secret;
      for (const grant of ["password", "client_credentials", "refresh_token"]) {
        const r = await localIdentityRequest(base + "/application/o/token/", {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            grant_type: grant,
            client_id: "stackpilot-jellyfin",
            client_secret: secret,
            username: "fixture-mfa",
            password: "Fixture-Identity-Test-2026!",
            refresh_token: "invalid",
          }),
          redirect: "manual",
        });
        const body = await r.json();
        assert.ok(r.status >= 400);
        assert.equal(body.access_token, undefined);
      }
      console.log(
        "Öffentliche Login-Grenze: Admin-/API-/Umgehungspfade abgewiesen; Passwort-, Client-Credentials- und Refresh-Grants abgewiesen.",
      );
      const backups = new IdentityBackups(setup);
      const passphrase = "Fixture-Recovery-2026-Only!";
      const backup = await backups.create({ confirmation: "OK", passphrase });
      assert.ok(backup.bytes > 1000);
      assert.equal(backups.maintenance().needsResume, false);
      assert.equal(
        (await backups.bytes(backup.id)).includes(Buffer.from("CREATE TABLE")),
        false,
      );
      await assert.rejects(
        () =>
          backups.verifyRestore({
            id: backup.id,
            confirmation: "OK",
            passphrase: "Wrong-Recovery-2026!",
          }),
        /authentifiziert/,
      );
      const restored = await backups.verifyRestore({
        id: backup.id,
        confirmation: "OK",
        passphrase,
      });
      assert.equal(restored.restore.status, "passed");
      await setup.containers(record, true);
      console.log(
        "Verschlüsselte Sicherung und isolierte Wiederherstellung: Datenbank, Geheimnisse und MFA-Regeln geprüft; Original läuft weiter.",
      );
      await writeFile(
        path.join(record.directory, "config/start.py"),
        "changed",
      );
      await assert.rejects(
        () => setup.start({ id: record.id, confirmation: "OK" }),
        /geändert/,
      );
    } finally {
      if (setup.pending) await setup.pending;
      if (record)
        await localDocker(
          [
            "compose",
            "-f",
            path.join(record.directory, "compose.json"),
            "down",
          ],
          { timeout: 120000 },
        );
      store.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
