import { test } from "node:test";
import assert from "node:assert/strict";
import { AdditionalServices } from "./additional-services.js";
import { Services } from "./service-api.js";
const credentials = () => ({
  username: "admin",
  password: "fixture-password",
  apiKey: "fixture-api-key",
});
const vault = () => {
  const values = new Map();
  return {
    get: (key) => values.get(key),
    set: (key, value) => values.set(key, value),
    ensure: (key, make) => {
      if (!values.has(key)) values.set(key, make());
      return values.get(key);
    },
  };
};
test("Seerr-Erweiterung erhält manuelle Standardserver und Bibliotheksauswahl", async () => {
  const calls = [];
  const s = {
    plan: {
      id: "fixture",
      existing: ["Jellyfin", "Seerr"],
      spec: { selected: ["Jellyfin", "Seerr", "Radarr"] },
    },
    cookies: { seerr: "fixture-cookie" },
    vault: vault(),
    credentials,
    arr: async () => [{ id: 1, name: "HD-1080p" }],
    request: async (_name, route, options) => {
      calls.push({ route, options });
      if (route === "/api/v1/settings/radarr" && !options?.method)
        return [{ id: 1, name: "My manual server", isDefault: true }];
      return {};
    },
  };
  await new AdditionalServices(s).connectSeerr();
  assert.ok(!calls.some((c) => c.route.includes("library")));
  const added = calls.find(
    (c) =>
      c.route === "/api/v1/settings/radarr" && c.options?.method === "POST",
  );
  assert.equal(added.options.body.isDefault, false);
  assert.ok(!calls.some((c) => c.options?.method === "PUT"));
});
test("Bereits konfigurierte fremde Streamystats- und Bazarr-Verbindungen werden nicht überschrieben", async () => {
  const calls = [];
  const s = {
    plan: { id: "fixture", spec: { selected: ["Sonarr"] } },
    credentials,
    vault: vault(),
    request: async (_name, route, options) => {
      calls.push(options?.method);
      return route === "/api/servers"
        ? [{ url: "http://manual-server:8096" }]
        : {
            general: { use_sonarr: true },
            sonarr: { ip: "manual-sonarr", apikey: "other" },
          };
    },
  };
  const adapter = new AdditionalServices(s);
  await assert.rejects(adapter.connectStreamystats(), /nicht übernommen/);
  await assert.rejects(adapter.connectBazarr(), /nicht überschrieben/);
  assert.ok(!calls.includes("POST"));
});
test("Jellyfin-Erweiterungen verwenden den tatsächlichen Jellyfin-Zugang statt eines unbenutzten Zufallspassworts", () => {
  const services = new Services(
    { id: "fixture", spec: { username: "admin" } },
    vault(),
  );
  assert.deepEqual(
    services.credentials("Seerr"),
    services.credentials("Jellyfin"),
  );
  assert.deepEqual(
    services.credentials("Streamystats"),
    services.credentials("Jellyfin"),
  );
  assert.notEqual(
    services.credentials("Bazarr").password,
    services.credentials("Jellyfin").password,
  );
});
