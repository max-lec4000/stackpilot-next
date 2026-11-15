import { DatabaseSync } from "node:sqlite";
import { setReportConsent } from "./dev-report-consent.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  developmentReport,
  publishDevelopmentReport,
  repositoryUrl,
} from "./development-report.js";
function enabledStore(t) {
  const store = { db: new DatabaseSync(":memory:") };
  setReportConsent(store, true);
  t.after(() => store.db.close());
  return store;
}
test("Entwicklungsbericht exportiert keine vollständigen Konfigurationen, Token, Konten oder Rohlogs", async () => {
  const secret = "NEVER_PUBLISH_SECRET";
  const r = await developmentReport(
    {
      engine: {
        current: () => ({
          plan: {
            id: "p",
            spec: {
              selected: ["Jellyfin"],
              path: "/data",
              vpn: true,
              username: secret,
            },
            ports: { Jellyfin: 8096 },
            appdata: "/config",
            secret,
          },
          job: {
            status: "completed",
            steps: [
              { id: "x", status: "completed", attempts: 1, error: secret },
            ],
          },
        }),
      },
      remote: {
        inspect: async () => ({
          hostname: "device.example.ts.net",
          tailscaleRunning: true,
          serve: { exclusive: true, public: false, routes: 2 },
          jellyfin: { version: "12.4.0", password: secret },
          token: secret,
        }),
      },
      sso: {
        plan: async () => ({
          configured: true,
          libraries: [{ name: secret }],
          blockers: [],
          secret,
        }),
      },
      protection: { status: async () => ({ verified: true, secret }) },
      backchannel: {
        inspect: async () => {
          throw Error(secret);
        },
        diagnostics: async () => ({
          configured: true,
          installed: false,
          verified: false,
          stage: "certificate",
          lastFailure: {
            code: "permission",
            stage: "certificate",
            at: "2026-11-09T20:00:00.000Z",
            message: secret,
            rawError: secret,
          },
        }),
      },
      settings: {
        inspect: async () => ({
          supported: true,
          baseUrl: "expected",
          avatars: "initials",
          changed: false,
        }),
      },
      connection: {
        inspect: async () => ({
          ready: false,
          checks: [],
          network: { hostAddresses: [], containerAddresses: [] },
          token: secret,
        }),
      },
    },
    async () => ({ host: "fixture" }),
  );
  assert.ok(!JSON.stringify(r).includes(secret));
  assert.equal(r.configuration.connection.value.ready, false);
  assert.equal(r.configuration.oidcBackchannel.state, "read");
  assert.equal(
    r.configuration.oidcBackchannel.value.lastFailure.code,
    "permission",
  );
  assert.equal(r.configuration.stack.value.vpnRequested, true);
});
test("Berichtupload verwendet isolierten Index, nur einen Bericht und Fast-forward statt fremder Arbeitsdateien", async (t) => {
  const calls = [];
  const run = async (args, input) => {
    calls.push({ args, input });
    if (args[0] === "remote") return repositoryUrl;
    if (args[0] === "rev-parse") return "a".repeat(40);
    if (args[0] === "hash-object") return "b".repeat(40);
    if (args[0] === "write-tree") return "c".repeat(40);
    if (args.includes("commit-tree")) return "d".repeat(40);
    return "";
  };
  const r = await publishDevelopmentReport(
    { kind: "stackpilot-development-report", schemaVersion: 2 },
    { policy: async () => true, run, store: enabledStore(t) },
  );
  assert.match(r.file, /^dev-private\/reports\/stackpilot-diagnose-/);
  assert.equal(calls.filter((c) => c.args[0] === "update-index").length, 1);
  assert.ok(
    !calls.some(
      (c) =>
        c.args.includes("--force") ||
        c.args.includes("--force-with-lease") ||
        c.args[0] === "add" ||
        c.args[0] === "commit",
    ),
  );
  assert.deepEqual(calls.at(-1).args, [
    "push",
    "origin",
    "d".repeat(40) + ":refs/heads/main",
  ]);
});
test("Entwicklungsupload bleibt ohne Policy und bei fremdem Repository gesperrt", async (t) => {
  const r = { kind: "stackpilot-development-report", schemaVersion: 2 };
  await assert.rejects(
    publishDevelopmentReport(r, { policy: async () => false }),
    /deaktiviert/,
  );
  await assert.rejects(
    publishDevelopmentReport(r, {
      policy: async () => true,
      store: enabledStore(t),
      run: async () => "https://github.com/other/repo.git",
    }),
    /festgelegten/,
  );
});

test("Repository-Policy allein autorisiert keinen Upload einer neuen Installation", async () => {
  let called = false;
  await assert.rejects(
    publishDevelopmentReport(
      { kind: "stackpilot-development-report", schemaVersion: 2 },
      {
        policy: async () => true,
        run: async () => {
          called = true;
          return "";
        },
      },
    ),
    /nicht freigegeben/,
  );
  assert.equal(called, false);
});
