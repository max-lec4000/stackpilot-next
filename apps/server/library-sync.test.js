import { test } from "node:test";
import assert from "node:assert/strict";
import { LibrarySync } from "./library-sync.js";
function fixture() {
  const values = new Map(),
    calls = [];
  const plan = { id: "p", spec: { selected: ["Jellyfin", "Radarr", "Seerr"] } };
  const task = { Key: "RefreshLibrary", State: "Idle" };
  let items = [],
    fail = false;
  const s = {
    additional: {
      jellyfinLogin: async () => ({ AccessToken: "fixture" }),
      seerr: async (route, options) => {
        calls.push(["seerr", route, options]);
        return { running: false };
      },
    },
    arr: async () => [{ tmdbId: 42, hasFile: true, movieFile: { id: 1 } }],
    request: async (name, route, options) => {
      calls.push([name, route, options]);
      if (fail) throw Error("offline");
      if (route === "/ScheduledTasks") return [task];
      if (route.startsWith("/Items")) return { Items: items };
      return null;
    },
  };
  const hub = {
    engine: {
      current: () => ({ plan, job: { status: "completed" } }),
      store: { activeLease: () => false },
      vault: { get: (k) => values.get(k), set: (k, v) => values.set(k, v) },
    },
    context: async () => ({ s, plan }),
    mutate: async (names, fn) => fn({ s, plan }),
  };
  return {
    hub,
    s,
    plan,
    task,
    calls,
    setItems: (v) => (items = v),
    setFail: (v) => (fail = v),
  };
}
test("Bibliothek prüft die genaue TMDB-ID und unterscheidet nicht erreichbar von nicht vorhanden", async () => {
  const f = fixture(),
    lib = new LibrarySync(f.hub);
  f.setItems([{ ProviderIds: { Tmdb: "99" } }]);
  assert.equal(await lib.available(f.s, f.plan, 42), false);
  lib.cache.clear();
  f.setItems([{ ProviderIds: { Tmdb: "42" } }]);
  assert.equal(await lib.available(f.s, f.plan, 42), true);
  lib.cache.clear();
  f.setFail(true);
  assert.equal(await lib.available(f.s, f.plan, 42), null);
});
test("Import löst einen Scan aus; erst bestätigter Jellyfin-Abschluss startet Seerr, Neustart setzt fort", async () => {
  const f = fixture();
  let lib = new LibrarySync(f.hub);
  assert.equal((await lib.run()).state, "jellyfin");
  assert.equal((await lib.run()).state, "jellyfin");
  assert.equal(f.calls.filter((c) => c[1] === "/Library/Refresh").length, 1);
  assert.equal(f.calls.filter((c) => c[0] === "seerr").length, 0);
  f.task.LastExecutionResult = {
    EndTimeUtc: new Date().toISOString(),
    Status: "Completed",
  };
  lib = new LibrarySync(f.hub);
  assert.equal((await lib.run()).state, "seerr");
  assert.equal((await lib.run()).state, "completed");
  await lib.run();
  assert.equal(f.calls.filter((c) => c[1] === "/Library/Refresh").length, 1);
  assert.equal(
    f.calls.filter((c) => c[0] === "seerr" && c[2]?.method === "POST").length,
    1,
  );
});
test("Aktiver Einrichtungsauftrag verhindert zusätzliche Scan-Kommandos", async () => {
  const f = fixture();
  f.hub.engine.store.activeLease = () => true;
  assert.equal((await new LibrarySync(f.hub).run(true)).busy, true);
  assert.equal(f.calls.length, 0);
});
test("Fehlgeschlagene automatische Scans warten vor einem neuen Versuch und blockieren spätere Wiederholung nicht", async () => {
  const f = fixture(),
    lib = new LibrarySync(f.hub);
  f.setFail(true);
  assert.equal((await lib.run()).state, "failed");
  f.setFail(false);
  await lib.run();
  assert.equal(f.calls.filter((c) => c[1] === "/Library/Refresh").length, 0);
  const saved = lib.status();
  f.hub.engine.vault.set(lib.key(f.plan), {
    ...saved,
    lastAttemptAt: new Date(Date.now() - 301000).toISOString(),
  });
  assert.equal((await lib.run()).state, "jellyfin");
  assert.equal(f.calls.filter((c) => c[1] === "/Library/Refresh").length, 1);
});
