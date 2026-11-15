import test from "node:test";
import assert from "node:assert/strict";
import { Services } from "./service-api.js";

test("linksFor gibt einer App Adresse und Schlüssel genau ihrer gewählten Partner", () => {
  const store = new Map();
  const vault = { ensure: (k, make) => (store.has(k) ? store.get(k) : (store.set(k, make()), store.get(k))) };
  const plan = { id: "p", spec: { selected: ["Bazarr", "Sonarr", "qBittorrent", "Radarr"], vpn: true, username: "admin" } };
  const s = new Services(plan, vault);
  const bazarr = s.linksFor("Bazarr");
  assert.deepEqual(Object.keys(bazarr), ["Sonarr", "Radarr"]);
  assert.equal(bazarr.Sonarr.url, "http://sonarr:8989");
  assert.equal(bazarr.Sonarr.apiKey, s.credentials("Sonarr").apiKey);
  const sonarr = s.linksFor("Sonarr");
  assert.equal(sonarr.qBittorrent.url, "http://gluetun:8080");
  assert.equal(sonarr.qBittorrent.apiKey, null);
  assert.deepEqual(s.linksFor("Jellyfin"), {});
});
