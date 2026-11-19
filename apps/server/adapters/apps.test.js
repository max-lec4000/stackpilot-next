import { test } from "node:test";
import assert from "node:assert/strict";
import { ArrAdapter } from "./arr.js";
import { QbitAdapter } from "./qbittorrent.js";
import { JellyfinAdapter } from "./jellyfin.js";
import { runAuthentikScript } from "./authentik.js";

test("ARR: Profilzuweisung wird geschrieben und bestätigt, Abweichung abgelehnt", async () => {
  const movie = { id: 5, tmdbId: 603, qualityProfileId: 1, title: "x" };
  const calls = [];
  const s = { arr: async (name, route, o) => { calls.push([name, o?.method || "GET", route]); if (o?.method === "PUT") Object.assign(movie, o.body); return { ...movie }; } };
  const radarr = new ArrAdapter(s, "Radarr");
  const saved = await radarr.assignMovieProfile({ ...movie }, 7, 603, "nicht bestätigt");
  assert.equal(saved.qualityProfileId, 7);
  assert.deepEqual(calls, [["Radarr", "PUT", "/movie/5"], ["Radarr", "GET", "/movie/5"]]);
  calls.length = 0;
  await radarr.assignMovieProfile({ ...movie }, 7, 603, "nicht bestätigt");
  assert.deepEqual(calls, [["Radarr", "GET", "/movie/5"]], "schon zugewiesen → nur zurücklesen");
  const stubborn = new ArrAdapter({ arr: async () => ({ id: 5, tmdbId: 603, qualityProfileId: 1 }) }, "Radarr");
  await assert.rejects(stubborn.assignMovieProfile({ id: 5, tmdbId: 603, qualityProfileId: 1 }, 7, 603, "Radarr hat nicht bestätigt"), /Radarr hat nicht bestätigt/);
  assert.throws(() => new ArrAdapter(s, "Jellyfin"), /Unbekannter/);
  await assert.rejects(radarr.movie(0), /Ungültige/);
});

test("qBittorrent: Anhalten/Fortsetzen/Entfernen erst nach Bestätigung", async () => {
  const hash = "a".repeat(40);
  let torrent = { hash, state: "downloading" };
  const calls = [];
  const s = { qbit: async (route, body) => {
    calls.push(route);
    if (route === "/torrents/info") return torrent ? [{ ...torrent }] : [];
    if (route === "/torrents/stop") torrent.state = "stoppedDL";
    if (route === "/torrents/start") torrent.state = "queuedDL";
    if (route === "/torrents/delete") torrent = null;
    return "";
  } };
  const q = new QbitAdapter(s, { attempts: 2, delay: 1 });
  await q.stop(hash);
  await q.start(hash);
  await q.priority(hash, "first");
  await q.remove(hash, false);
  assert.ok(calls.includes("/torrents/topPrio"));
  // qBittorrent ignoriert das Anhalten → Fehler statt stiller Erfolg
  torrent = { hash, state: "downloading" };
  const lazy = new QbitAdapter({ qbit: async (route) => (route === "/torrents/info" ? [{ ...torrent }] : "") }, { attempts: 2, delay: 1 });
  await assert.rejects(lazy.stop(hash), /nicht bestätigt/);
  await assert.rejects(lazy.priority(hash, "irgendwo"), /Ungültige/);
});

test("Jellyfin: Anwendungsschlüssel anlegen, widerrufen, prüfen", async () => {
  let keys = [{ AppName: "seerr", AccessToken: "alt" }];
  const s = { request: async (name, route, o) => {
    assert.equal(name, "Jellyfin");
    assert.equal(o.headers.Authorization, "admin");
    if (route === "/Auth/Keys") return { Items: keys };
    if (route.startsWith("/Auth/Keys?app=")) { keys.push({ AppName: decodeURIComponent(route.split("=")[1]), AccessToken: "neu" }); throw Error("HTTP 204 ohne Inhalt"); }
    if (route === "/Auth/Keys/alt" && o.method === "DELETE") { keys = keys.filter((k) => k.AccessToken !== "alt"); return ""; }
    return "";
  } };
  const jf = new JellyfinAdapter(s, { Authorization: "admin" });
  const created = await jf.createApiKey("StackPilot Seerr x");
  assert.deepEqual(created.map((k) => k.AccessToken), ["neu"], "Antwortfehler beim Anlegen zählt nicht, die Liste entscheidet");
  assert.equal(await jf.hasApiKey("alt"), true);
  await jf.revokeApiKey("alt");
  assert.equal(await jf.hasApiKey("alt"), false);
});

test("Authentik: Skript im Worker, Ergebniszeile, Toleranz nur auf Wunsch", async () => {
  const worker = { Id: "w1", Config: { Labels: { "com.docker.compose.service": "worker" } }, State: { Running: true } };
  const identity = { containers: async () => [worker] };
  const script = new URL("./confirm.js", import.meta.url); // beliebige vorhandene Datei
  const seen = [];
  const ok = async (args, stdin) => { seen.push([args.slice(0, 5), JSON.parse(stdin).request]); return "x\nSTACKPILOT_X={\"a\":1}\n"; };
  assert.deepEqual(await runAuthentikScript({ identity, record: {}, input: ok, script, request: { b: 2 }, marker: "STACKPILOT_X=", notReady: "nr", unconfirmed: "uc" }), { a: 1 });
  assert.deepEqual(seen[0], [["exec", "-i", "w1", "ak", "shell"], { b: 2 }]);
  const exits = async () => { throw Object.assign(Error("exit"), { stderr: "SystemExit STACKPILOT_X={\"a\":2}" }); };
  await assert.rejects(runAuthentikScript({ identity, record: {}, input: exits, script, request: {}, marker: "STACKPILOT_X=", notReady: "nr", unconfirmed: "uc" }), /exit/);
  assert.deepEqual(await runAuthentikScript({ identity, record: {}, input: exits, script, request: {}, marker: "STACKPILOT_X=", notReady: "nr", unconfirmed: "uc", tolerateExit: true }), { a: 2 });
  const twice = async () => "STACKPILOT_X={}\nSTACKPILOT_X={}\n";
  await assert.rejects(runAuthentikScript({ identity, record: {}, input: twice, script, request: {}, marker: "STACKPILOT_X=", notReady: "nr", unconfirmed: "nicht eindeutig" }), /nicht eindeutig/);
  await assert.rejects(runAuthentikScript({ identity: { containers: async () => [] }, record: {}, input: ok, script, request: {}, marker: "STACKPILOT_X=", notReady: "kein Worker", unconfirmed: "uc" }), /kein Worker/);
});
