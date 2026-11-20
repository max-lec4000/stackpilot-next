import { test } from "node:test";
import assert from "node:assert/strict";
import { Subtitles, projection, validate, PROFILE_NAME } from "./subtitles.js";

// Bazarr-Attrappe mit Formular-Speicherung wie die echte API (Listen über wiederholte Schlüssel)
function fakeBazarr(initial = {}) {
  const st = {
    general: { serie_default_enabled: false, serie_default_profile: "", movie_default_enabled: false, movie_default_profile: "", enabled_providers: ["subdl"] },
    opensubtitlescom: { username: "" },
    profiles: [{ profileId: 1, name: "Anime", items: [{ id: 1, language: "ja" }] }],
    series: [{ sonarrSeriesId: 5, profileId: null }, { sonarrSeriesId: 6, profileId: 1 }],
    movies: [{ radarrId: 9, profileId: null }],
    posts: [], ...initial,
  };
  const bazarr = async (route, o = {}) => {
    if (o.method === "POST") {
      const f = o.body; st.posts.push([route, [...f.entries()]]);
      if (route === "/system/settings") {
        if (f.has("languages-profiles")) st.profiles = JSON.parse(f.get("languages-profiles"));
        if (f.has("settings-general-enabled_providers")) st.general.enabled_providers = f.getAll("settings-general-enabled_providers");
        for (const k of ["serie_default_enabled", "serie_default_profile", "movie_default_enabled", "movie_default_profile"])
          if (f.has(`settings-general-${k}`)) st.general[k] = f.get(`settings-general-${k}`) === "true" ? true : f.get(`settings-general-${k}`) === "false" ? false : f.get(`settings-general-${k}`);
        if (f.has("settings-opensubtitlescom-username")) st.opensubtitlescom.username = f.get("settings-opensubtitlescom-username");
      } else {
        const ids = f.getAll(route === "/series" ? "seriesid" : "radarrid").map(Number), prof = f.getAll("profileid").map(Number);
        for (const [i, id] of ids.entries()) {
          const row = (route === "/series" ? st.series : st.movies).find((r) => (r.sonarrSeriesId ?? r.radarrId) === id);
          row.profileId = prof[i];
        }
      }
      return null;
    }
    if (route === "/system/settings") return { general: { ...st.general }, opensubtitlescom: { ...st.opensubtitlescom } };
    if (route === "/system/languages/profiles") return structuredClone(st.profiles);
    if (route.startsWith("/series")) return { data: structuredClone(st.series) };
    if (route.startsWith("/movies")) return { data: structuredClone(st.movies) };
  };
  const plan = { id: "p", spec: { selected: ["Bazarr"] } };
  const vault = new Map();
  const hub = {
    engine: { current: () => ({ job: { status: "completed" }, plan }), vault: { ensure: (k, fn) => vault.has(k) || vault.set(k, fn()) } },
    context: async () => ({ s: { additional: { bazarr } }, plan }),
    mutate: async (_n, fn) => fn({ s: { additional: { bazarr } }, plan }),
  };
  return { sub: new Subtitles(hub), st, vault };
}

test("Untertitel: Eingaben prüfen", () => {
  assert.deepEqual(validate({ languages: ["de", "en", "de"], providers: ["embeddedsubtitles"] }).languages, ["de", "en"]);
  assert.throws(() => validate({ languages: [], providers: ["embeddedsubtitles"] }), /Untertitelsprachen/);
  assert.throws(() => validate({ languages: ["xx"], providers: ["embeddedsubtitles"] }), /Untertitelsprachen/);
  assert.throws(() => validate({ languages: ["de"], providers: [] }), /Mindestens einen Anbieter/);
  assert.throws(() => validate({ languages: ["de"], providers: ["irgendwas"] }), /Unbekannter/);
  assert.throws(() => validate({ languages: ["de"], providers: ["opensubtitlescom"], opensubtitles: { username: "a b", password: "x" } }), /OpenSubtitles/);
});

test("Untertitel speichern: eigenes Profil, Standard, Anbieter, vorhandene ohne Profil", async () => {
  const { sub, st, vault } = fakeBazarr();
  await assert.rejects(sub.save({ languages: ["de"], providers: ["embeddedsubtitles"] }), /mit OK/);
  const r = await sub.save({ languages: ["de", "en"], providers: ["embeddedsubtitles", "opensubtitlescom"], applyExisting: true,
    opensubtitles: { username: "max_os", password: "geheim123" }, confirmation: "OK" });
  assert.deepEqual(r.profile, { id: 2, languages: ["de", "en"] });
  assert.equal(st.profiles.find((p) => p.name === "Anime").items[0].language, "ja", "fremdes Profil bleibt");
  assert.deepEqual(r.defaults, { series: true, movies: true, otherSeries: false, otherMovies: false });
  assert.deepEqual(st.general.enabled_providers, ["subdl", "embeddedsubtitles", "opensubtitlescom"], "fremder Anbieter bleibt");
  assert.equal(r.opensubtitles, true);
  assert.deepEqual(r.assigned, { series: 1, movies: 1 });
  assert.equal(st.series.find((x) => x.sonarrSeriesId === 6).profileId, 1, "Serie mit anderem Profil bleibt");
  const enabled = st.posts[0][1].filter(([k]) => k === "languages-enabled").map(([, v]) => v).sort();
  assert.deepEqual(enabled, ["de", "en", "ja"], "Sprachen anderer Profile bleiben aktiv");
  assert.equal(vault.size, 1, "Vorzustand gesichert");
  // erneut speichern: gleiches Profil wird ersetzt, nicht verdoppelt
  const again = await sub.save({ languages: ["de"], providers: ["embeddedsubtitles"], confirmation: "OK" });
  assert.deepEqual(again.profile, { id: 2, languages: ["de"] });
  assert.equal(st.profiles.filter((p) => p.name === PROFILE_NAME).length, 1);
});

test("Untertitel: Abweichung beim Zurücklesen wird gemeldet", async () => {
  const { sub, st } = fakeBazarr();
  const orig = st.general;
  Object.defineProperty(st, "general", { get: () => ({ ...orig, enabled_providers: [] }), set: () => {} });
  await assert.rejects(sub.save({ languages: ["de"], providers: ["embeddedsubtitles"], confirmation: "OK" }), /nicht alles übernommen:.*Anbieter/);
});

test("Untertitel: Darstellung erkennt fremde Standards", () => {
  const v = projection({ general: { serie_default_enabled: true, serie_default_profile: "1", enabled_providers: ["subdl"] } },
    [{ profileId: 1, name: "Anime", items: [] }], [], []);
  assert.equal(v.profile, null);
  assert.equal(v.defaults.otherSeries, true);
  assert.deepEqual(v.otherProviders, ["subdl"]);
});
