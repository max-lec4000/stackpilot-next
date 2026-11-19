import { test } from "node:test";
import assert from "node:assert/strict";
import { RouteRegistry } from "./routes.js";
import { updateRoutes } from "./domains/system/updates.routes.js";
import { vpnRoutes } from "./domains/access/vpn.routes.js";
import { viewerRequestRoutes } from "./domains/requests/viewer-requests.routes.js";

const h = () => "ok";

test("Routen-Verzeichnis: Pflichtangaben, keine Doppelungen, GET ohne Bestätigung", () => {
  const r = new RouteRegistry();
  assert.throws(() => r.add([{ method: "PUT", path: "/api/x", guard: "session", handler: h }]), /Methode/);
  assert.throws(() => r.add([{ method: "POST", path: "/api/x", handler: h }]), /Schutzstufe/);
  assert.throws(() => r.add([{ method: "POST", path: "/x", guard: "ok", handler: h }]), /Pfad/);
  assert.throws(() => r.add([{ method: "GET", path: "/api/x", guard: "ok", handler: h }]), /GET/);
  r.add([{ method: "POST", path: "/api/x", guard: "ok", handler: h }]);
  assert.throws(() => r.add([{ method: "POST", path: "/api/x", guard: "ok", handler: h }]), /doppelt/);
  assert.equal(r.find("GET", "/api/x"), null);
  assert.equal(r.find("POST", "/api/x").guard, "ok");
});

test("Schutzstufen werden vor der Fachlogik erzwungen", async () => {
  const calls = [];
  const r = new RouteRegistry().add([
    { method: "POST", path: "/api/s", guard: "session", handler: () => calls.push("s") },
    { method: "POST", path: "/api/o", guard: "ok", confirm: "Bitte OK.", handler: () => calls.push("o") },
    { method: "POST", path: "/api/p", guard: "password", handler: () => calls.push("p") },
  ]);
  const manager = { reauthenticate: async (pw) => { if (pw !== "richtig") throw Error("Anmeldung fehlgeschlagen."); } };
  await r.run(r.find("POST", "/api/s"), { body: {}, manager });
  await assert.rejects(r.run(r.find("POST", "/api/o"), { body: {}, manager }), /Bitte OK\./);
  await r.run(r.find("POST", "/api/o"), { body: { confirmation: "OK" }, manager });
  await assert.rejects(r.run(r.find("POST", "/api/p"), { body: { confirmation: "OK", password: "falsch" }, manager }), /Anmeldung/);
  await assert.rejects(r.run(r.find("POST", "/api/p"), { body: { password: "richtig" }, manager }), /OK/);
  await r.run(r.find("POST", "/api/p"), { body: { confirmation: "OK", password: "richtig" }, manager });
  assert.deepEqual(calls, ["s", "o", "p"]);
});

test("Umgezogene Routen behalten ihre Schutzstufen", () => {
  const r = new RouteRegistry()
    .add(updateRoutes({}))
    .add(vpnRoutes({ vault: () => null, youtubeVpn: {}, vpnSwitch: {}, completedPlan: () => null }))
    .add(viewerRequestRoutes({}));
  const table = Object.fromEntries(r.list().map(({ method, path, guard }) => [`${method} ${path}`, guard]));
  assert.deepEqual(table, {
    "GET /api/updates/job": "session",
    "POST /api/updates/preview": "session",
    "POST /api/updates/start": "ok",
    "GET /api/container-maintenance": "session",
    "POST /api/container-maintenance/update": "ok",
    "POST /api/container-maintenance/rollback": "ok",
    "POST /api/container-maintenance/batch": "ok",
    "GET /api/vpn/profiles": "session",
    "POST /api/vpn/import": "session",
    "POST /api/vpn/profiles/remove": "session",
    "POST /api/vpn/youtube": "session",
    "POST /api/vpn/profiles/qbittorrent": "ok",
    "GET /api/viewer-requests": "session",
    "POST /api/viewer-requests": "ok",
  });
});
