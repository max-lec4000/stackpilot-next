import { test } from "node:test";
import assert from "node:assert/strict";
import { QualityProfiles, applyTiers, projectProfile, tierOf } from "./quality-profiles.js";

const q = (id, name, resolution, allowed) => ({ quality: { id, name, resolution }, items: [], allowed });
const items = () => [
  q(0, "Unknown", 0, false), q(25, "CAM", 0, false), q(1, "SDTV", 480, false),
  q(4, "HDTV-720p", 720, false),
  q(9, "HDTV-1080p", 1080, true),
  { id: 1002, name: "WEB 1080p", allowed: true, items: [q(3, "WEBDL-1080p", 1080, true), q(15, "WEBRip-1080p", 1080, true)] },
  q(30, "Remux-1080p", 1080, false), q(19, "Bluray-2160p", 2160, false), q(31, "Remux-2160p", 2160, false),
  q(22, "BR-DISK", 1080, false),
];
const plan = { id: "p", spec: { selected: ["Radarr", "Sonarr"] } };

function setup() {
  const db = {
    Radarr: { 4: { id: 4, name: "HD-1080p", cutoff: 9, upgradeAllowed: false, items: items(), language: { id: -2, name: "Original" }, formatItems: [], minFormatScore: 0 },
      9: { id: 9, name: "StackPilot 1080p ≤ 4 GiB", items: items() } },
    Sonarr: { 4: { id: 4, name: "HD-1080p", cutoff: 9, upgradeAllowed: false, items: items(), formatItems: [{ format: 1, name: "Eigen", score: 0 }], minFormatScore: 0 },
      5: { id: 5, name: "Eigen", cutoff: 9, items: items(), formatItems: [], minFormatScore: 50 } },
  };
  const formats = { Sonarr: [{ id: 1, name: "Eigen" }] };
  const calls = [];
  const s = {
    arr: async (svc, route, o = {}) => {
      calls.push([svc, o.method || "GET", route]);
      if (route === "/qualityprofile") return Object.values(db[svc]).map((p) => structuredClone(p));
      const m = route.match(/^\/qualityprofile\/(\d+)$/);
      if (m && o.method === "PUT") { db[svc][m[1]] = structuredClone(o.body); return o.body; }
      if (m) return structuredClone(db[svc][m[1]] ?? {});
      if (route === "/language") return [{ id: -1, name: "Any" }, { id: -2, name: "Original" }, { id: 1, name: "English" }, { id: 4, name: "German" }];
      if (route === "/customformat" && o.method === "POST") {
        const id = formats[svc].length + 1; formats[svc].push({ id, ...o.body });
        for (const p of Object.values(db[svc])) p.formatItems?.push({ format: id, name: o.body.name, score: 0 });
        return { id };
      }
      if (route === "/customformat") return structuredClone(formats[svc]);
      return null;
    },
  };
  const hub = { engine: { current: () => ({ job: { status: "completed" }, plan }) }, context: async () => ({ s, plan }), mutate: async (_n, fn) => fn({ s, plan }) };
  return { p: new QualityProfiles(hub), db, formats, calls };
}

test("Stufen erkennen; Unbekanntes, CAM und BR-DISK bleiben unberührt", () => {
  assert.equal(tierOf({ name: "CAM", resolution: 0 }), null);
  assert.equal(tierOf({ name: "BR-DISK", resolution: 1080 }), null);
  assert.equal(tierOf({ name: "Bluray-576p", resolution: 576 }), "sd");
  const next = applyTiers(items(), { sd: false, hd720: true, hd1080: true, uhd: true }, true);
  const by = Object.fromEntries(next.flatMap((i) => (i.quality ? [i] : i.items)).map((i) => [i.quality.name, i.allowed]));
  assert.deepEqual(by, { Unknown: false, CAM: false, SDTV: false, "HDTV-720p": true, "HDTV-1080p": true, "WEBDL-1080p": true, "WEBRip-1080p": true,
    "Remux-1080p": true, "Bluray-2160p": true, "Remux-2160p": true, "BR-DISK": false });
  const off = applyTiers(items(), { sd: false, hd720: false, hd1080: false, uhd: true }, false);
  assert.equal(off.find((i) => i.id === 1002).allowed, false, "Gruppe folgt ihren Qualitäten");
});

test("Profile lesen: interne ausgeblendet, Sprache je App", async () => {
  const { p } = setup();
  const r = await p.read();
  const radarr = r.services.find((v) => v.service === "Radarr");
  assert.deepEqual(radarr.profiles.map((v) => v.name), ["HD-1080p"]);
  assert.deepEqual(radarr.profiles[0].tiers, { sd: false, hd720: false, hd1080: true, uhd: false });
  assert.equal(radarr.profiles[0].language, "original");
  assert.deepEqual(radarr.profiles[0].cutoffOptions.filter((o) => o.allowed).map((o) => o.name), ["HDTV-1080p", "WEB 1080p"]);
  assert.deepEqual(radarr.profiles[0].cutoffOptions.find((o) => o.id === 31), { id: 31, name: "Remux-2160p", tier: "uhd", remux: true, allowed: false });
  assert.ok(!radarr.profiles[0].cutoffOptions.some((o) => o.name === "CAM"), "nicht erlaubte ohne Stufe fehlen");
  const sonarr = r.services.find((v) => v.service === "Sonarr");
  assert.equal(sonarr.profiles[0].language, "any");
  assert.equal(sonarr.profiles[1].languageEditable, false);
});

test("Radarr-Profil ändern: Stufen, Remux, Upgrades bis, Sprache Deutsch", async () => {
  const { p, db } = setup();
  const base = { service: "Radarr", profileId: 4, tiers: { sd: false, hd720: false, hd1080: true, uhd: true }, remux: true, upgrades: true, cutoff: 31, language: "German" };
  await assert.rejects(p.change(base), /mit OK/);
  await assert.rejects(p.change({ ...base, tiers: { sd: false, hd720: false, hd1080: false, uhd: false }, confirmation: "OK" }), /Mindestens eine/);
  await assert.rejects(p.change({ ...base, profileId: 9, confirmation: "OK" }), /nicht bearbeitet/);
  await assert.rejects(p.change({ ...base, language: "Klingonisch", confirmation: "OK" }), /Ungültige Sprache/);
  const after = await p.change({ ...base, confirmation: "OK" });
  assert.deepEqual([after.tiers.uhd, after.remux, after.upgrades, after.cutoff, after.language], [true, true, true, 31, "German"]);
  assert.deepEqual(db.Radarr[4].language, { id: 4, name: "German" });
  // Upgrade-Stufe fällt weg → höchste erlaubte
  const lower = await p.change({ ...base, tiers: { sd: false, hd720: true, hd1080: true, uhd: false }, remux: false, confirmation: "OK" });
  assert.equal(lower.cutoff, 1002);
});

test("Sonarr-Sprache über eigenes Format; eigene Formatwertung wird nicht angefasst", async () => {
  const { p, db, formats } = setup();
  const base = { service: "Sonarr", profileId: 4, tiers: { sd: false, hd720: false, hd1080: true, uhd: false }, remux: false, upgrades: false, confirmation: "OK" };
  const de = await p.change({ ...base, language: "German" });
  assert.equal(de.language, "German");
  assert.equal(formats.Sonarr.at(-1).name, "StackPilot · Sprache Deutsch");
  assert.equal(db.Sonarr[4].minFormatScore, 1000);
  assert.deepEqual(db.Sonarr[4].formatItems.find((f) => f.format === 1), { format: 1, name: "Eigen", score: 0 }, "fremdes Format bleibt");
  const orig = await p.change({ ...base, language: "original" });
  assert.equal(orig.language, "original");
  assert.deepEqual(db.Sonarr[4].formatItems.filter((f) => f.score).map((f) => f.name), ["StackPilot · Sprache Originalton"]);
  const any = await p.change({ ...base, language: "any" });
  assert.equal(any.language, "any");
  assert.equal(db.Sonarr[4].minFormatScore, 0);
  assert.ok(db.Sonarr[4].formatItems.every((f) => f.score === 0));
  await assert.rejects(p.change({ ...base, profileId: 5, language: "German" }), /eigene Formatwertung/);
});

test("Rücklesen: fehlende Übernahme wird gemeldet", async () => {
  const { p, db } = setup();
  const orig = db.Radarr[4];
  const { s } = await p.hub.context();
  const put = s.arr;
  s.arr = async (svc, route, o = {}) => (o.method === "PUT" ? null : put(svc, route, o));
  await assert.rejects(p.change({ service: "Radarr", profileId: 4, tiers: { sd: true, hd720: true, hd1080: true, uhd: false }, remux: false, upgrades: false, language: "original", confirmation: "OK" }), /nicht vollständig/);
  assert.equal(db.Radarr[4], orig);
});
