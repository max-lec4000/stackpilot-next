import test from "node:test";
import assert from "node:assert/strict";
import { RemoteSetup } from "./remote-setup.js";

function fixture(overrides = {}) {
  const store = new Map();
  const calls = [];
  const state = { identity: "none", protection: "none", sso: false, routes: false };
  const hub = {
    engine: {
      current: () => ({ plan: { id: "p1" }, job: { status: overrides.job || "completed" } }),
      vault: { get: (k) => store.get(k) || null, set: (k, v) => store.set(k, structuredClone(v)) },
    },
  };
  const parts = {
    identity: {
      summary: () => ({
        prepared: state.identity !== "none",
        id: "i1",
        status: state.identity === "ready" ? "local-ready" : state.identity,
        running: false,
        error: null,
      }),
      prepare: async () => {
        calls.push("identity.prepare");
        state.identity = "prepared";
        return parts.identity.summary();
      },
      start: async (body) => {
        calls.push("identity.start");
        assert.deepEqual(body, { id: "i1", confirmation: "OK" });
        state.identity = overrides.identityFails ? "failed" : "ready";
      },
    },
    protection: {
      summary: () => ({ status: state.protection, running: false, error: null }),
      preview: async () => ({ review: "r-protect" }),
      start: async (body) => {
        calls.push("protection.start");
        assert.equal(body.review, "r-protect");
        state.protection = "ready";
      },
    },
    sso: {
      plan: async () => ({
        configured: state.sso,
        canApply: !overrides.ssoBlocked,
        blockers: overrides.ssoBlocked ? ["Plugin fehlt."] : [],
        review: "r-sso",
        resuming: false,
        libraries: [{ id: "a" }, { id: "b" }],
      }),
      apply: async (body) => {
        calls.push("sso.apply");
        assert.deepEqual(body.libraryIds, ["a", "b"]);
        state.sso = true;
      },
    },
    serve: {
      preview: async () => ({
        review: "r-serve",
        routesReady: state.routes,
        ready: state.routes,
        routes: [{ url: "https://host.ts.net", loginUrl: "https://host.ts.net/sso/OID/start/stackpilot", target: "x" }],
      }),
      apply: async () => {
        calls.push("serve.apply");
        state.routes = true;
      },
    },
  };
  return { setup: new RemoteSetup(hub, parts, { pollMs: 1, retryMs: 1 }), calls, state };
}

test("Ein Auftrag führt alle vier Schritte in Reihenfolge aus und nennt die Adressen", async () => {
  const f = fixture();
  await f.setup.start();
  await f.setup.pending;
  const s = f.setup.summary();
  assert.equal(s.status, "completed");
  assert.deepEqual(f.calls, ["identity.prepare", "identity.start", "protection.start", "sso.apply", "serve.apply"]);
  assert.ok(s.steps.every((step) => step.status === "completed"));
  assert.equal(s.result.routes[0].loginUrl, "https://host.ts.net/sso/OID/start/stackpilot");
  assert.ok(!("target" in s.result.routes[0]));
});

test("Wiederholen überspringt, was schon fertig ist", async () => {
  const f = fixture();
  await f.setup.start();
  await f.setup.pending;
  f.calls.length = 0;
  await f.setup.start();
  await f.setup.pending;
  assert.deepEqual(f.calls, []);
  assert.equal(f.setup.summary().status, "completed");
});

test("Ein Fehlschlag stoppt den Auftrag, nennt den Grund und lässt spätere Schritte unberührt", async () => {
  const f = fixture({ ssoBlocked: true });
  await f.setup.start();
  await f.setup.pending;
  const s = f.setup.summary();
  assert.equal(s.status, "failed");
  assert.equal(s.error, "Plugin fehlt.");
  assert.deepEqual(s.steps.map((step) => step.status), ["completed", "completed", "failed", "pending"]);
  assert.ok(!f.calls.includes("serve.apply"));
  const g = fixture({ identityFails: true });
  await g.setup.start();
  await g.setup.pending;
  assert.equal(g.setup.summary().steps[0].status, "failed");
  assert.ok(!g.calls.includes("protection.start"));
});

test("Ohne fertig eingerichteten Stack startet nichts", async () => {
  const f = fixture({ job: "running" });
  await assert.rejects(f.setup.start(), (e) => e.userFacing === true);
  assert.equal(f.setup.summary().status, "idle");
});

test("Erster Zuschauer: Einladung entsteht einmal, bleibt bis zur Bestätigung und wird dann gelöscht", async () => {
  const f = fixture();
  const invited = [];
  f.setup.viewers = {
    list: async () => ({ viewers: invited.map((username) => ({ username })) }),
    invite: async (name) => {
      invited.push(name);
      return { invitation: { username: name, password: "start-geheim", loginUrl: "https://host.ts.net/sso/OID/start/stackpilot" } };
    },
  };
  await f.setup.start({ viewer: "familie" });
  await f.setup.pending;
  let s = f.setup.summary();
  assert.equal(s.status, "completed");
  assert.equal(s.steps.at(-1).id, "viewer");
  assert.equal(s.result.invitation.password, "start-geheim");
  // Erneuter Start lädt niemanden doppelt ein und verliert das noch nicht gezeigte Passwort nicht.
  await f.setup.start();
  await f.setup.pending;
  assert.deepEqual(invited, ["familie"]);
  assert.equal(f.setup.summary().result.invitation.password, "start-geheim");
  s = f.setup.acknowledge();
  assert.equal(s.result.invitation.username, "familie");
  assert.ok(!("password" in s.result.invitation));
  assert.ok(!JSON.stringify(f.setup.load()).includes("start-geheim"));
});

test("Wartet auf das tatsächliche Ende eines Teilauftrags, auch wenn der noch keinen Laufstatus meldet", async () => {
  const f = fixture();
  let finish;
  // Wie der echte Jellyfin-Schutz: startet im Hintergrund, meldet anfangs "läuft nicht".
  f.setup.protection.start = async () => {
    f.calls.push("protection.start");
    f.setup.protection.pending = new Promise((resolve) => (finish = resolve)).then(() => {
      f.state.protection = "ready";
    });
  };
  await f.setup.start();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(f.setup.summary().steps[1].status, "running");
  assert.ok(!f.calls.includes("sso.apply"));
  finish();
  await f.setup.pending;
  assert.equal(f.setup.summary().status, "completed");
});

test("Härtung: Fernzugriff in Jellyfin an, Administratoren nur lokal – nur wenn nötig", async () => {
  const f = fixture();
  const calls = [];
  let network = { EnableRemoteAccess: false, Other: 1 };
  f.setup.hub.context = async () => ({ s: {}, plan: { id: "p1" } });
  f.setup.hub.library = {
    request: async (_s, _plan, route, options) => {
      calls.push([route, options?.method || "GET"]);
      if (options?.method === "POST") network = options.body;
      return network;
    },
  };
  let admins = [{ id: "a", name: "admin" }];
  f.setup.security = {
    admins: async () => ({ review: "r-admin", accounts: admins }),
    protectAdmins: async (body) => {
      calls.push(["protect", body.review]);
      admins = [];
    },
  };
  await f.setup.start();
  await f.setup.pending;
  assert.equal(f.setup.summary().status, "completed");
  assert.deepEqual(network, { EnableRemoteAccess: true, Other: 1 });
  assert.ok(calls.some((c) => c[0] === "protect" && c[1] === "r-admin"));
  // Zweiter Lauf: nichts mehr zu ändern.
  calls.length = 0;
  await f.setup.start();
  await f.setup.pending;
  assert.deepEqual(calls.filter((c) => c[1] === "POST" || c[0] === "protect"), []);
});
