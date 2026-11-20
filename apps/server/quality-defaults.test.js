import { test } from "node:test";
import assert from "node:assert/strict";
import { QualityDefaults, profileSummary } from "./quality-defaults.js";
import { qualityDefaultKey } from "./quality-policy.js";

const q = (id, name, allowed = true) => ({ quality: { id, name }, allowed });
const profiles = {
  Radarr: [
    { id: 1, name: "HD-1080p", upgradeAllowed: true, cutoff: 7, language: { name: "Original" }, items: [q(4, "HDTV-720p"), q(7, "Bluray-1080p"), q(19, "Bluray-2160p", false)] },
    { id: 9, name: "StackPilot Filmlimit 11111111-2222-3333-4444-555555555555", items: [] },
    { id: 10, name: "StackPilot 1080p ≤ 4 GiB", items: [] },
    { id: 11, name: "StackPilot · Größenprüfung ausstehend", items: [] },
  ],
  Sonarr: [{ id: 3, name: "Any", upgradeAllowed: false, cutoff: 1, items: [{ name: "WEB 1080p", id: 1001, allowed: true, items: [q(3, "WEBDL-1080p"), q(15, "WEBRip-1080p")] }] }],
};
function setup({ size = { rate: 0 } } = {}) {
  const servers = {
    radarr: [{ id: 1, isDefault: true, is4k: false, hostname: "radarr", port: 7878, useSsl: false, baseUrl: "", activeProfileId: 1, activeProfileName: "HD-1080p" }],
    sonarr: [{ id: 4, isDefault: true, is4k: false, hostname: "sonarr", port: 8989, useSsl: false, baseUrl: "/", activeProfileId: 3, activeProfileName: "Any" }],
  };
  const puts = [], vault = new Map();
  const s = {
    arr: async (service, route) => { assert.equal(route, "/qualityprofile"); return structuredClone(profiles[service]); },
    additional: { seerr: async (route, o = {}) => {
      const m = route.match(/^\/settings\/(radarr|sonarr)(?:\/(\d+))?$/);
      if (o.method === "PUT") { puts.push([route, o.body]); const row = servers[m[1]].find((v) => v.id === Number(m[2])); Object.assign(row, o.body, { id: row.id }); return row; }
      return structuredClone(servers[m[1]]);
    } },
  };
  const plan = { id: "p", spec: { selected: ["Seerr", "Radarr", "Sonarr"] } };
  const hub = {
    engine: { current: () => ({ job: { status: "completed" }, plan }), vault: { get: (k) => vault.get(k), set: (k, v) => { assert.match(k, /^[a-z0-9:_-]{1,100}$/, "gültiger Tresorname wie im echten Tresor"); vault.set(k, v); } } },
    context: async () => ({ s, plan }), mutate: async (_n, fn) => fn({ s, plan }), sizeLimits: { config: () => size },
  };
  return { d: new QualityDefaults(hub), puts, vault, plan, servers };
}

test("Profilübersicht: erlaubte Qualitäten, Upgrades, Ziel, Sprache", () => {
  assert.deepEqual(profileSummary(profiles.Radarr[0]), { id: 1, name: "HD-1080p", allowed: ["HDTV-720p", "Bluray-1080p"], upgrades: true, cutoff: "Bluray-1080p", language: "Original" });
  assert.deepEqual(profileSummary(profiles.Sonarr[0]).allowed, ["WEBDL-1080p", "WEBRip-1080p"]);
  assert.equal(profileSummary(profiles.Sonarr[0]).cutoff, null);
});

test("Überblick ohne interne Limitprofile, Größenregel steuert Filme", async () => {
  const { d } = setup({ size: { rate: 4 } });
  const { services } = await d.read();
  assert.deepEqual(services.map((x) => [x.service, x.defaultProfileId, x.governedBySize, x.profiles.map((p) => p.id)]),
    [["Radarr", 1, true, [1]], ["Sonarr", 3, false, [3]]]);
  await assert.rejects(d.setDefault({ service: "Radarr", profileId: 1, confirmation: "OK" }), /Größenregel/);
});

test("Standard ändern: OK, Seerr bestätigt, Vorgabe im Tresor", async () => {
  const { d, puts, vault, plan } = setup();
  await assert.rejects(d.setDefault({ service: "Sonarr", profileId: 3 }), /mit OK/);
  for (const id of [9, 10, 11]) await assert.rejects(d.setDefault({ service: "Radarr", profileId: id, confirmation: "OK" }), /nicht \(mehr\)/);
  await assert.rejects(d.setDefault({ service: "Lidarr", profileId: 1, confirmation: "OK" }), /Radarr oder Sonarr/);
  const r = await d.setDefault({ service: "Radarr", profileId: 1, confirmation: "OK" });
  assert.equal(r.profileName, "HD-1080p");
  assert.equal(puts.length, 1);
  assert.equal(puts[0][1].activeProfileId, 1);
  assert.equal(puts[0][1].id, undefined);
  assert.deepEqual({ ...vault.get(qualityDefaultKey(plan, "Radarr")), updatedAt: "x" }, { profileId: 1, profileName: "HD-1080p", serverId: 1, compact: false, updatedAt: "x" });
});
