import { test } from "node:test";
import assert from "node:assert/strict";
import { MediaHub } from "./media-hub.js";
test("Downloadsuche findet Treffer jenseits der ersten Seite und paginiert erst nach dem Filtern", async () => {
  const calls = [];
  const rows = Array.from({ length: 35 }, (_, i) => ({ hash: i.toString(16).padStart(40, "0"), name: i < 15 ? "Anderer Titel" : `Film Äpfel ${i}`, state: "downloading", progress: 0.5 }));
  const hub = Object.create(MediaHub.prototype);
  hub.engine = { current: () => ({ job: { status: "completed" }, plan: { spec: { selected: ["qBittorrent"] } } }) };
  hub.guard = { status: { state: "blocked" } };
  hub.context = async () => ({ s: { qbit: async (route) => {
    calls.push(route);
    return route === "/transfer/info" ? { dl_info_speed: 0, up_info_speed: 0 } : rows;
  } } });
  const result = await hub.downloads({ page: 2, query: "ÄPFEL", filter: "all" });
  assert.equal(result.total, 20);
  assert.equal(result.torrents.length, 8);
  assert.equal(result.torrents[0].name, "Film Äpfel 23");
  assert.equal(result.hasMore, true);
  assert.equal(result.vpn.state, "blocked");
  assert.ok(!calls[0].includes("offset"));
  await assert.rejects(() => hub.downloads({ query: "x".repeat(161) }), /Suchbegriff/i);
  await assert.rejects(() => hub.downloads({ query: {} }), /Suchbegriff/i);
});
