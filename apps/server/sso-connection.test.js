import { test } from "node:test";
import assert from "node:assert/strict";
import { SsoConnection } from "./identity/sso-connection.js";
import { releases } from "./identity/config.js";
import { denyPasswordProvider } from "./identity/sso-profile.js";
function fixture() {
  const values = new Map([
    ["identity-secrets:fixture", { oidc_secret: "fixture-secret-".repeat(5) }],
  ]);
  const state = {
    oid: {},
    saml: {},
    users: [
      { Id: "a".repeat(32), Name: "admin", Policy: { IsAdministrator: true } },
    ],
    libraries: [
      { ItemId: "b".repeat(32), Name: "Filme" },
      { ItemId: "c".repeat(32), Name: "Privat" },
    ],
    plugin: {
      Id: releases.ssoPlugin.id,
      Version: releases.ssoPlugin.version,
      Status: "Active",
    },
    calls: [],
  };
  const hub = {
    engine: {
      vault: { get: (k) => values.get(k), set: (k, v) => values.set(k, v) },
    },
    context: async () => ({ s: {}, plan: { id: "plan", rootId: "root" } }),
    mutate: async (n, fn) => fn(),
    library: {
      request: async (s, p, path, options) => {
        state.calls.push({ path, options });
        if (path === "/System/Info") return { Version: "12.4.0" };
        if (path === "/Plugins") return [state.plugin];
        if (path === "/Library/VirtualFolders") return state.libraries;
        if (path === "/Users") return state.users;
        if (path === "/sso/OID/Get") return state.oid;
        if (path === "/sso/SAML/Get") return state.saml;
        if (path === "/sso/OID/Add/stackpilot") {
          state.oid.stackpilot = { ...options.body, CanonicalLinks: {} };
          if(state.failAfterWrite){state.failAfterWrite=false;throw Error("simulated interrupted response");}
          return null;
        }
        throw Error("Unexpected request");
      },
    },
  };
  const identity = {
    verify: async () => ({
      id: "fixture",
      rootId: "root",
      status: "local-ready",
      input: { hostname: "identity.example.ts.net", uid: 1000, gid: 1000 },
    }),
    remote: {
      inspect: async () => ({
        tailscaleRunning: true,
        hostname: "identity.example.ts.net",
        jellyfin: { version: "12.4.0" },
        serveKnown: true,
        serve: { exclusive: true, public: false },
      }),
    },
  };
  return { state, values, connection: new SsoConnection(hub, identity) };
}
test("Private SSO-Konfiguration überträgt Schlüssel intern, begrenzt Bibliotheken und bleibt nicht öffentlich", async () => {
  const f = fixture(),
    p = await f.connection.plan();
  assert.equal(p.canApply, true);
  assert.equal(JSON.stringify(p).includes("fixture-secret-"), false);
  await f.connection.apply({
    review: p.review,
    libraryIds: ["b".repeat(32)],
    confirmation: "OK",
  });
  const config = f.state.oid.stackpilot;
  assert.equal(config.DefaultProvider, denyPasswordProvider);
  assert.equal(config.EnableAllFolders, false);
  assert.deepEqual(config.EnabledFolders, ["b".repeat(32)]);
  assert.deepEqual(config.AdminRoles, []);
  const after = await f.connection.plan();
  assert.equal(after.configured, true);
  assert.equal(after.canApply, false);
  assert.equal(after.publicReady, false);
});
test("Vorschau schützt manuelle Änderungen und fremde SSO-Anbieter", async () => {
  const f = fixture(),
    p = await f.connection.plan();
  f.state.libraries[0].Name = "Manuell geändert";
  await assert.rejects(
    () =>
      f.connection.apply({
        review: p.review,
        libraryIds: ["b".repeat(32)],
        confirmation: "OK",
      }),
    /geändert/,
  );
  f.state.oid.other = { Enabled: true };
  assert.equal((await f.connection.plan()).canApply, false);
  assert.equal(
    f.state.calls.some((c) => c.options?.method === "POST"),
    false,
  );
});
test("Automatische sichere Kontoverknüpfung bleibt gültig, Passwortanbieterwechsel wird erkannt", async () => {
  const f = fixture(),
    p = await f.connection.plan();
  await f.connection.apply({
    review: p.review,
    libraryIds: ["b".repeat(32)],
    confirmation: "OK",
  });
  f.state.users.push({
    Id: "d".repeat(32),
    Name: "spv_viewer",
    Policy: {
      IsAdministrator: false,
      AuthenticationProviderId: denyPasswordProvider,
    },
  });
  f.state.oid.stackpilot.CanonicalLinks.spv_viewer = "d".repeat(32);
  assert.equal((await f.connection.plan()).configured, true);
  f.state.users[1].Policy.AuthenticationProviderId = "Default";
  assert.equal((await f.connection.plan()).configured, false);
  f.state.oid.stackpilot.CanonicalLinks.spv_viewer = "a".repeat(32);
  assert.ok(
    (await f.connection.plan()).blockers.some((b) =>
      b.includes("Kontoverknüpfungen"),
    ),
  );
});
test("Unverwaltete vorhandene Provider werden nie still übernommen", async () => {
  const f = fixture();
  f.state.oid.stackpilot = { Enabled: false };
  const p = await f.connection.plan();
  assert.equal(p.canApply, false);
  assert.equal(p.configured, false);
  await assert.rejects(
    () =>
      f.connection.apply({
        review: p.review,
        libraryIds: ["b".repeat(32)],
        confirmation: "OK",
      }),
    /Übernahme/,
  );
  assert.equal(f.state.oid.stackpilot.Enabled, false);
});

test('Unterbrochene Bestätigung wird ohne erneutes Überschreiben gezielt fortgesetzt',async()=>{const f=fixture(),p=await f.connection.plan();f.state.failAfterWrite=true;await assert.rejects(()=>f.connection.apply({review:p.review,libraryIds:['b'.repeat(32)],confirmation:'OK'}),/interrupted/);const pending=await f.connection.plan();assert.equal(pending.resuming,true);assert.equal(pending.canApply,true);assert.deepEqual(pending.selectedLibraryIds,['b'.repeat(32)]);await f.connection.apply({review:pending.review,libraryIds:pending.selectedLibraryIds,confirmation:'OK'});assert.equal((await f.connection.plan()).configured,true);assert.equal(f.state.calls.filter(c=>c.path==='/sso/OID/Add/stackpilot').length,1);});

test("Ein vom Plugin ergänztes leeres FolderRoleMapping gilt nicht als Änderung, ein gefülltes schon", async () => {
  const f = fixture(),
    p = await f.connection.plan();
  await f.connection.apply({ review: p.review, libraryIds: ["b".repeat(32)], confirmation: "OK" });
  assert.equal((await f.connection.plan()).configured, true);
  f.state.oid.stackpilot.FolderRoleMapping = [];
  assert.equal((await f.connection.plan()).configured, true);
  f.state.oid.stackpilot.FolderRoleMapping = [{ Role: "x", Folders: [] }];
  assert.equal((await f.connection.plan()).configured, false);
});
