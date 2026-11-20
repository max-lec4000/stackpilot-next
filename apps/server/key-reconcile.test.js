import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcileKeys, reconcileSummary } from "./key-reconcile.js";

const K = { Sonarr: "a".repeat(32), Radarr: "b".repeat(32), Lidarr: "c".repeat(32), Prowlarr: "d".repeat(32) };
const OLD = "0".repeat(32);
function setup({ seerrSonarr = OLD, ambiguous = false, masked = false } = {}) {
  const seerr = {
    sonarr: [{ id: 0, name: "StackPilot Sonarr", hostname: "sonarr", port: 8989, useSsl: false, apiKey: seerrSonarr }],
    radarr: [{ id: 0, name: "StackPilot Radarr", hostname: ambiguous ? "anders" : "radarr", port: 7878, useSsl: false, apiKey: K.Radarr }],
  };
  const bazarr = { general: { use_sonarr: true, use_radarr: false }, sonarr: { ip: "sonarr", port: 8989, ssl: false, base_url: "", apikey: OLD } };
  const prowlarrApps = [{ id: 3, name: "StackPilot Sonarr", implementation: "Sonarr", fields: [{ name: "baseUrl", value: "http://sonarr:8989" }, { name: "apiKey", value: masked ? "********" : OLD }] }];
  const indexers = { Sonarr: [{ id: 9, name: "Quelle", implementation: "Torznab", fields: [{ name: "baseUrl", value: "http://prowlarr:9696/1/" }, { name: "apiKey", value: OLD }] }], Radarr: [], Lidarr: [] };
  const calls = [];
  const s = {
    plan: { spec: { selected: ["Sonarr", "Radarr", "Prowlarr", "Seerr", "Bazarr"] } },
    credentials: (n) => ({ apiKey: K[n] }),
    additional: {
      seerr: async (route, o = {}) => {
        calls.push(["Seerr", o.method || "GET", route]);
        const slug = route.split("/")[2];
        if (route.endsWith("/test")) { if (o.body.apiKey !== K[slug === "sonarr" ? "Sonarr" : "Radarr"]) throw Error("HTTP 500"); return {}; }
        if (o.method === "PUT") { assert.ok(!("id" in o.body), "ohne id"); seerr[slug][0] = { ...o.body, id: 0 }; return {}; }
        return structuredClone(seerr[slug]);
      },
      bazarr: async (route, o = {}) => {
        calls.push(["Bazarr", o.method || "GET", route]);
        if (o.method === "POST") { bazarr.sonarr.apikey = o.body.get("settings-sonarr-apikey"); return null; }
        return structuredClone(bazarr);
      },
    },
    arr: async (svc, route, o = {}) => {
      calls.push([svc, o.method || "GET", route]);
      if (svc === "Prowlarr" && route === "/applications") return structuredClone(prowlarrApps);
      if (svc === "Prowlarr" && route === "/applications/test") { if (o.body.fields.find((f) => f.name === "apiKey").value !== K.Sonarr) throw Error("HTTP 400"); return {}; }
      if (svc === "Prowlarr" && route.startsWith("/applications/")) { prowlarrApps[0] = o.body; return o.body; }
      if (route === "/indexer") return structuredClone(indexers[svc]);
      if (route.startsWith("/indexer/") && o.method === "PUT") { indexers[svc][0] = o.body; return o.body; }
      return {};
    },
  };
  return { s, seerr, bazarr, prowlarrApps, indexers, calls };
}

test("Veraltete Schlüssel in Seerr, Bazarr, Prowlarr und Quellen werden ersetzt und getestet", async () => {
  const { s, seerr, bazarr, prowlarrApps, indexers } = setup();
  const r = await reconcileKeys(s);
  assert.deepEqual(r.repaired, ["Seerr → Sonarr", "Bazarr → Sonarr", "Prowlarr → Sonarr", "Sonarr → Prowlarr-Quellen (1)"]);
  assert.deepEqual(r.problems, []);
  assert.equal(seerr.sonarr[0].apiKey, K.Sonarr);
  assert.equal(seerr.radarr[0].apiKey, K.Radarr, "stimmte schon");
  assert.equal(bazarr.sonarr.apikey, K.Sonarr);
  assert.equal(prowlarrApps[0].fields[1].value, K.Sonarr);
  assert.equal(indexers.Sonarr[0].fields[1].value, K.Prowlarr);
  assert.match(reconcileSummary(r), /Schlüssel abgeglichen: Seerr → Sonarr/);
});

test("Alles stimmt: nichts wird geschrieben", async () => {
  const { s, calls } = setup({ seerrSonarr: K.Sonarr });
  const first = await reconcileKeys(s);
  const writes = () => calls.filter(([, m, route]) => (m === "PUT" || (m === "POST" && !route.endsWith("/test"))));
  const before = writes().length;
  const again = await reconcileKeys(s);
  assert.deepEqual(again.repaired, []);
  assert.equal(writes().length, before, "zweiter Lauf schreibt nichts");
  assert.ok(first.checked >= 4);
});

test("Maskierter Schlüssel: erst testen, nur bei Fehler ersetzen; nicht eindeutige bleiben unverändert", async () => {
  const { s, seerr, prowlarrApps } = setup({ masked: true, ambiguous: true });
  const r = await reconcileKeys(s);
  assert.ok(r.repaired.includes("Prowlarr → Sonarr"), "maskiert und Test fehlgeschlagen → ersetzt");
  assert.equal(prowlarrApps[0].fields[1].value, K.Sonarr);
  assert.equal(seerr.radarr[0].hostname, "anders");
  assert.match(r.problems.join(" "), /Seerr → Radarr: Verbindung nicht eindeutig/);
});
