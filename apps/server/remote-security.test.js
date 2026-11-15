import { test } from "node:test";
import assert from "node:assert/strict";
import { RemoteSecurity } from "./remote-security.js";
import {
  encryptBackup,
  decryptBackup,
  validateBackup,
  sha256,
} from "./identity/backup-format.js";
test("Sicherungsarchiv lehnt falsche Passphrase, Manipulation und unsichere Pfade ab", async () => {
  const pass = "Fixture-Recovery-Strong-2026!";
  const bytes = await encryptBackup(
    { format: 1, text: "private-fixture-only" },
    pass,
  );
  assert.equal(bytes.includes(Buffer.from("private-fixture-only")), false);
  assert.deepEqual(await decryptBackup(bytes, pass), {
    format: 1,
    text: "private-fixture-only",
  });
  await assert.rejects(
    () => decryptBackup(bytes, "Other-Recovery-Strong!"),
    /authentifiziert/,
  );
  const damaged = Buffer.from(bytes);
  damaged[damaged.length - 20] ^= 1;
  await assert.rejects(() => decryptBackup(damaged, pass), /authentifiziert/);
  await assert.rejects(() => encryptBackup({}, "short"), /16 Zeichen/);
  const r = {
    id: "fixture",
    images: { server: "pinned" },
    hashes: { "config/start.py": sha256("good") },
  };
  const value = {
    format: 1,
    record: r,
    images: r.images,
    database: "SQL",
    files: [
      {
        name: "config/start.py",
        data: Buffer.from("good").toString("base64"),
        sha256: sha256("good"),
      },
    ],
  };
  assert.equal(validateBackup(value, r), value);
  assert.throws(
    () =>
      validateBackup(
        { ...value, files: [{ ...value.files[0], name: "data/../../escape" }] },
        r,
      ),
    /Unsicherer/,
  );
  assert.throws(() => validateBackup({ ...value, files: [] }, r), /fehlt/);
});
function fixture() {
  const admin = {
    Id: "a".repeat(32),
    Name: "admin",
    Policy: {
      IsAdministrator: true,
      EnableRemoteAccess: true,
      EnableContentDeletion: false,
    },
  };
  const viewer = {
    Id: "b".repeat(32),
    Name: "viewer",
    Policy: { IsAdministrator: false },
  };
  let device = true;
  const calls = [];
  const hub = {
    engine: { vault: { set() {} } },
    context: async () => ({
      s: {},
      plan: { id: "fixture", rootId: "fixture" },
    }),
    mutate: async (n, fn) => fn(),
    library: {
      request: async (s, p, route, opts) => {
        calls.push({ route, opts });
        if (route === "/Users") return [admin, viewer];
        if (route === "/Devices")
          return {
            Items: device
              ? [
                  {
                    Id: "viewer-device",
                    LastUserId: viewer.Id,
                    Name: "TV",
                    AppName: "Jellyfin",
                    AccessToken: "MUST-NOT-LEAK",
                  },
                  {
                    Id: "admin-device",
                    LastUserId: admin.Id,
                    Name: "monitor",
                    AppName: "StackPilot",
                  },
                ]
              : [{ Id: "admin-device", LastUserId: admin.Id, Name: "monitor" }],
          };
        if (route.includes("/Policy")) {
          admin.Policy = opts.body;
          return;
        }
        if (route === "/Devices?id=viewer-device") {
          device = false;
          return;
        }
        throw Error("Unexpected route " + route);
      },
    },
  };
  return { hub, admin, calls, security: new RemoteSecurity(hub, {}, {}, {}) };
}
test("Administrator-Vorschau schützt manuelle Rechte und weist veraltete Vorschau ab", async () => {
  const f = fixture();
  const p = await f.security.admins();
  f.admin.Policy.EnableContentDeletion = true;
  await assert.rejects(
    () => f.security.protectAdmins({ review: p.review, confirmation: "OK" }),
    /geändert/,
  );
  const current = await f.security.admins();
  await f.security.protectAdmins({
    review: current.review,
    confirmation: "OK",
  });
  assert.equal(f.admin.Policy.EnableRemoteAccess, false);
  assert.equal(f.admin.Policy.EnableContentDeletion, true);
});
test("Gerätezuordnung verwendet tatsächlichen Token-Besitzer und exportiert keine Tokens", async () => {
  const f = fixture();
  const list = await f.security.devices();
  assert.equal(JSON.stringify(list).includes("MUST-NOT-LEAK"), false);
  const viewer = list.devices.find((d) => d.name === "TV"),
    admin = list.devices.find((d) => d.name === "monitor");
  assert.equal(viewer.protected, false);
  await assert.rejects(
    () => f.security.revoke({ id: admin.id, confirmation: "OK" }),
    /Administratorkonto/,
  );
  await f.security.revoke({ id: viewer.id, confirmation: "OK" });
  assert.ok(f.calls.some((c) => c.opts?.method === "DELETE"));
});
test("Funnel-Vorschau bleibt ohne SSO-Nachweis und Client-Abnahme gesperrt und veröffentlicht nie Verwaltung", async () => {
  const f = fixture();
  f.security.remote = {
    inspect: async () => ({
      target: "http://127.0.0.1:8096",
      hostname: "test.example.ts.net",
      tailscaleRunning: true,
      serveKnown: true,
      serve: { exclusive: true, public: false },
      jellyfin: { version: "12.4.0", remoteAdmins: 0, viewers: 1 },
    }),
  };
  f.security.identity = {
    current: () => ({ status: "local-ready", input: { gatewayPort: 19080 } }),
    inspectSecurity: async () => ({ checks: [] }),
  };
  f.security.backups = { list: () => [{ restore: { status: "passed" } }] };
  const p = await f.security.funnelPlan();
  assert.equal(p.publicReady, false);
  assert.equal(p.applyAvailable, false);
  assert.deepEqual(
    p.routes.map((r) => r.target),
    [null, "http://127.0.0.1:19080"],
  );
  assert.equal(JSON.stringify(p).includes("19000"), false);
  assert.ok(p.blockers.some((v) => v.includes("SSO-Plugin")));
  assert.ok(p.blockers.some((v) => v.includes("extern abnehmen")));
  assert.equal(p.commands, undefined);
});
