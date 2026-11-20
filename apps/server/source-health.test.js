import { test } from "node:test";
import assert from "node:assert/strict";
import { SourceHealth, sourceState } from "./source-health.js";

test("Zustand je Quelle: aus, gesperrt, Fehler, in Ordnung", () => {
  const now = Date.parse("2026-11-20T12:00:00Z");
  assert.equal(sourceState({ id: 1, name: "A", enable: false }, null, null, now).state, "off");
  const blocked = sourceState({ id: 2, name: "B", enable: true }, { disabledTill: "2026-11-20T14:00:00Z", mostRecentFailure: "2026-11-20T11:00:00Z" }, null, now);
  assert.equal(blocked.state, "blocked"); assert.equal(blocked.disabledTill, "2026-11-20T14:00:00.000Z");
  assert.equal(sourceState({ id: 3, name: "C", enable: true }, { disabledTill: "2026-11-20T10:00:00Z", mostRecentFailure: "2026-11-20T09:00:00Z" }, null, now).state, "failing");
  const ok = sourceState({ id: 4, name: "D", enable: true }, null, { numberOfQueries: 10, numberOfGrabs: 2, numberOfFailedQueries: 1, averageResponseTime: 412.6 }, now);
  assert.deepEqual([ok.state, ok.queries, ok.grabs, ok.failedQueries, ok.averageMs], ["ok", 10, 2, 1, 413]);
});

function setup() {
  const calls = [];
  const s = {
    credentials: () => ({ apiKey: "GEHEIMKEY", password: "pw" }),
    arr: async (name, route, o = {}) => {
      calls.push([name, o.method || "GET", route]);
      if (name === "Prowlarr") {
        if (route === "/indexer") return [{ id: 1, name: "Quelle eins", enable: true }, { id: 2, name: "Quelle zwei", enable: true }];
        if (route === "/indexerstatus") return [{ indexerId: 2, disabledTill: "2999-01-01T00:00:00Z", mostRecentFailure: "2026-11-20T09:00:00Z" }];
        if (route === "/indexerstats") return { indexers: [{ indexerId: 1, numberOfQueries: 5 }] };
        if (route === "/health") return [{ type: "warning", source: "IndexerStatusCheck", message: "Indexers unavailable due to failures: Quelle zwei (apikey=GEHEIMKEY)" }, { type: "notice", message: "egal" }, { type: "warning", source: "UpdateCheck", message: "New update is available" }];
        if (route === "/applications") return [{ implementation: "Radarr" }];
        if (route === "/indexer/testall") { const e = Error("HTTP 400"); Object.defineProperty(e, "body", { value: [{ id: 1, isValid: true, validationFailures: [] }, { id: 2, isValid: false, validationFailures: [{ errorMessage: "Unable to connect to http://tracker.example/api?apikey=GEHEIMKEY" }] }] }); throw e; }
        if (route === "/command") return { id: 7 };
      }
      if (route === "/indexer") return name === "Radarr" ? [{ enableRss: true }, { enableRss: false }] : [];
      if (route === "/health") return name === "Sonarr" ? [{ source: "IndexerSearchCheck", message: "No indexers available with Automatic Search enabled" }] : [];
    },
  };
  const plan = { id: "p", spec: { selected: ["Prowlarr", "Radarr", "Sonarr"] } };
  const hub = { engine: { current: () => ({ job: { status: "completed" }, plan }) }, context: async () => ({ s, plan }), mutate: async (_n, fn) => fn({ s, plan }) };
  return { health: new SourceHealth(hub), calls };
}

test("Zustand lesen: Quellen, Apps, Warnungen ohne Schlüssel", async () => {
  const { health } = setup();
  const r = await health.read();
  assert.deepEqual(r.summary, { ok: 1, failing: 0, blocked: 1, off: 0 });
  assert.deepEqual(r.arr.map((a) => [a.name, a.connected, a.indexers, a.problems.length]), [["Radarr", true, 1, 0], ["Sonarr", false, 0, 1]]);
  assert.equal(r.warnings.length, 1);
  assert.ok(!r.warnings[0].includes("GEHEIMKEY"));
});

test("Alle testen (auch bei 400) und an die Apps übertragen", async () => {
  const { health, calls } = setup();
  const t = await health.testAll();
  assert.deepEqual(t.results.map((x) => [x.name, x.ok]), [["Quelle eins", true], ["Quelle zwei", false]]);
  assert.ok(!t.results[1].message.includes("GEHEIMKEY") && !t.results[1].message.includes("tracker.example"));
  const s = await health.sync();
  assert.ok(s.ok);
  assert.ok(calls.some(([n, m, r]) => n === "Prowlarr" && m === "POST" && r === "/command"));
});
