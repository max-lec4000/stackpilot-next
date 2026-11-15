import { test } from "node:test";
import assert from "node:assert/strict";
import { globalSearch } from "./global-search.js";
test("Globale Suche bleibt bei einem nicht erreichbaren Dienst nutzbar und gibt keine Zugangsdaten aus", async () => {
  const hub = { engine: {}, search: async () => { throw Error("secret-token"); } };
  const result = await globalSearch("jelly", hub, async () => ({ services: [{ name: "Jellyfin", state: "running", username: "private", password: "secret-token" }] }));
  assert.deepEqual(result.applications, [{ title: "Jellyfin", state: "running" }]);
  assert.equal(result.unavailable.length, 1);
  assert.ok(!JSON.stringify(result).includes("secret-token"));
  await assert.rejects(() => globalSearch("x", hub), /Suchbegriff/);
});
test("Mediensuche begrenzt Ergebnisse und unterscheidet Anfrage und Verfügbarkeit", async () => {
  const result = await globalSearch("Test", { engine: {}, search: async () => ({ results: Array.from({ length: 20 }, (_, id) => ({ id, title: "Testfilm", type: "movie", year: "2026", requested: id === 1, status: id === 2 ? 5 : 1 })) }) }, async () => ({ services: [] }));
  assert.equal(result.media.length, 12); assert.equal(result.requested.length, 1);
  assert.equal(result.media[2].available, true); assert.equal(result.media[1].available, false);
});
