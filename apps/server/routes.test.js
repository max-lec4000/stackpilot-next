import { test } from "node:test";
import assert from "node:assert/strict";
import { RouteRegistry } from "./routes.js";
import { updateRoutes } from "./domains/system/updates.routes.js";
import { vpnRoutes } from "./domains/access/vpn.routes.js";
import { viewerRequestRoutes } from "./domains/requests/viewer-requests.routes.js";
import { remoteRoutes } from "./domains/access/remote.routes.js";
import { safetyRoutes } from "./domains/access/safety.routes.js";
import { downloadRoutes } from "./domains/downloads/downloads.routes.js";
import { qualityRoutes } from "./domains/quality/quality.routes.js";
import { requestRoutes } from "./domains/requests/requests.routes.js";
import { libraryRoutes } from "./domains/library/library.routes.js";
import { peopleRoutes } from "./domains/people/people.routes.js";
import { couchdeckRoutes } from "./domains/couchdeck/couchdeck.routes.js";
import { setupRoutes } from "./domains/system/setup.routes.js";
import { systemRoutes } from "./domains/system/system.routes.js";

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

test("Qualität & Quellen: Schutzstufen", () => {
  const r = new RouteRegistry().add(qualityRoutes({}));
  assert.deepEqual(Object.fromEntries(r.list().map(({ method, path, guard }) => [`${method} ${path}`, guard])), {
    "GET /api/media/size-settings": "session",
    "POST /api/media/size-settings": "ok",
    "GET /api/sources": "session",
    "GET /api/sources/detail": "session",
    "POST /api/sources/test": "session",
    "POST /api/sources/save": "ok",
    "POST /api/sources/action": "session",
  });
});

test("Anfragen und Medien: Löschen, Abbrechen, Freigeben und Austausch verlangen OK", () => {
  const r = new RouteRegistry().add(requestRoutes({})).add(libraryRoutes({}));
  const table = Object.fromEntries(r.list().map(({ method, path, guard }) => [`${method} ${path}`, guard]));
  const ok = [
    "request/approve", "request/cancel-season", "request/cancel", "film-limit", "quality",
    "season-transfer/replace", "season-transfer/remove", "season-transfer/pause", "episodes/delete-file",
    "series-limits", "replacement/start", "replacement/restore", "series-removal/execute", "movie-removal/execute",
  ].map((p) => `POST /api/media/${p}`);
  for (const key of ok) assert.equal(table[key], "ok", key);
  for (const [key, guard] of Object.entries(table)) if (key.startsWith("GET ")) assert.equal(guard, "session", key);
  const sessionPosts = Object.entries(table).filter(([k, g]) => k.startsWith("POST ") && g === "session").map(([k]) => k).sort();
  assert.deepEqual(sessionPosts, [
    "POST /api/media/library/refresh", "POST /api/media/movie-removal/preview", "POST /api/media/releases",
    "POST /api/media/replacement/preview", "POST /api/media/request", "POST /api/media/request/archive",
    "POST /api/media/research", "POST /api/media/series-removal/preview",
  ]);
  assert.equal(Object.keys(table).length, 39);
});

test("Gesamtes Verzeichnis: keine Doppelungen, feste Liste der Passwort-Routen", () => {
  const all = new RouteRegistry()
    .add(updateRoutes({})).add(vpnRoutes({})).add(viewerRequestRoutes({})).add(remoteRoutes({}))
    .add(safetyRoutes({})).add(downloadRoutes({})).add(qualityRoutes({})).add(requestRoutes({}))
    .add(libraryRoutes({})).add(peopleRoutes({})).add(couchdeckRoutes({})).add(setupRoutes({})).add(systemRoutes({}));
  const list = all.list();
  assert.ok(list.length >= 150, `nur ${list.length} Routen`);
  for (const r of list) if (r.method === "GET") assert.equal(r.guard, "session", r.path);
  const password = list.filter((r) => r.guard === "password").map((r) => r.path).sort();
  assert.deepEqual(password, [
    "/api/credentials/reveal",
    ...["bazarr", "jellyfin-couchdeck", "jellyfin-seerr", "jellyfin-streamystats", "lidarr", "prowlarr", "radarr", "seerr", "sonarr"].map((x) => "/api/credentials/rotate-" + x),
    ...["admins/protect", "backup/create", "backup/download", "backup/resume", "backup/test", "devices/revoke",
      "funnel/disable", "funnel/enable", "identity/credentials", "private-serve/apply", "protection/start", "sso/apply",
      "streamyfin/activate", "streamyfin/prepare", "streamyfin/rollback"].map((x) => "/api/remote-access/" + x),
    "/api/vault-backup", "/api/vault-backup/restore",
  ].sort());
  // Schlüsselwechsel verlangt zusätzlich „OK“ (vor dem Passwort, verbraucht keinen Versuch)
  assert.equal(all.find("POST", "/api/credentials/rotate-sonarr").confirm, "Schlüsselwechsel zuerst bestätigen.");
});
