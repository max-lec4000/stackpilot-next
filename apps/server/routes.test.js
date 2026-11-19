import { test } from "node:test";
import assert from "node:assert/strict";
import { RouteRegistry } from "./routes.js";
import { updateRoutes } from "./domains/system/updates.routes.js";
import { vpnRoutes } from "./domains/access/vpn.routes.js";
import { viewerRequestRoutes } from "./domains/requests/viewer-requests.routes.js";
import { remoteRoutes } from "./domains/access/remote.routes.js";
import { safetyRoutes } from "./domains/access/safety.routes.js";
import { downloadRoutes } from "./domains/downloads/downloads.routes.js";

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
    { method: "POST", path: "/api/p", guard: "password", confirm: "Mit OK bestätigen.", handler: () => calls.push("p") },
    { method: "POST", path: "/api/q", guard: "password", handler: () => calls.push("q") },
  ]);
  const manager = { reauthenticate: async (pw) => { if (pw !== "richtig") throw Error("Anmeldung fehlgeschlagen."); } };
  await r.run(r.find("POST", "/api/s"), { body: {}, manager });
  await assert.rejects(r.run(r.find("POST", "/api/o"), { body: {}, manager }), /Bitte OK\./);
  await r.run(r.find("POST", "/api/o"), { body: { confirmation: "OK" }, manager });
  await assert.rejects(r.run(r.find("POST", "/api/p"), { body: { confirmation: "OK", password: "falsch" }, manager }), /Anmeldung/);
  await assert.rejects(r.run(r.find("POST", "/api/p"), { body: { password: "richtig" }, manager }), /OK/);
  await r.run(r.find("POST", "/api/p"), { body: { confirmation: "OK", password: "richtig" }, manager });
  // Passwort-Route ohne zusätzliches „OK“
  await assert.rejects(r.run(r.find("POST", "/api/q"), { body: {}, manager }), /Anmeldung/);
  await r.run(r.find("POST", "/api/q"), { body: { password: "richtig" }, manager });
  assert.deepEqual(calls, ["s", "o", "p", "q"]);
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

test("Zugriff & Netzwerk: alles, was Zugang verändert, verlangt das Passwort", () => {
  const r = new RouteRegistry().add(remoteRoutes({}));
  const table = Object.fromEntries(r.list().map(({ method, path, guard }) => [`${method} ${path}`, guard]));
  const password = [
    "private-serve/apply", "streamyfin/activate", "streamyfin/rollback", "streamyfin/prepare",
    "protection/start", "sso/apply", "backup/create", "backup/resume", "backup/test", "backup/download",
    "admins/protect", "devices/revoke", "funnel/enable", "funnel/disable", "identity/credentials",
  ].map((p) => `POST /api/remote-access/${p}`);
  for (const key of password) assert.equal(table[key], "password", key);
  for (const key of ["POST /api/remote-access/streamyfin/activate", "POST /api/remote-access/streamyfin/rollback", "POST /api/remote-access/streamyfin/prepare"])
    assert.ok(r.find("POST", key.slice(5)).confirm, key + " braucht zusätzlich OK");
  const session = Object.entries(table).filter(([, g]) => g === "session").map(([k]) => k).sort();
  assert.deepEqual(session, [
    "GET /api/admin-tailnet", "GET /api/remote-access", "GET /api/remote-access/admins", "GET /api/remote-access/backups",
    "GET /api/remote-access/connection", "GET /api/remote-access/devices", "GET /api/remote-access/funnel",
    "GET /api/remote-access/identity", "GET /api/remote-access/journey", "GET /api/remote-access/private-serve",
    "GET /api/remote-access/protection", "GET /api/remote-access/protection/preview", "GET /api/remote-access/sso",
    "GET /api/remote-access/streamyfin",
    "POST /api/admin-tailnet/grant", "POST /api/remote-access/funnel-plan", "POST /api/remote-access/identity/check",
    "POST /api/remote-access/identity/prepare", "POST /api/remote-access/identity/start",
  ]);
  assert.equal(Object.keys(table).length, password.length + session.length);
});

test("Downloads und Ausfallsperren-Test: Schutzstufen", () => {
  const r = new RouteRegistry().add(safetyRoutes({})).add(downloadRoutes({}));
  assert.deepEqual(Object.fromEntries(r.list().map(({ method, path, guard }) => [`${method} ${path}`, guard])), {
    "GET /api/safety": "session",
    "POST /api/safety/start": "ok",
    "GET /api/downloads/status": "session",
    "GET /api/downloads/list": "session",
    "POST /api/downloads/action": "session",
    "POST /api/downloads/resume": "session",
  });
});
