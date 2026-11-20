import { test } from "node:test";
import assert from "node:assert/strict";
import { SubtitleTitles, projectSubs } from "./subtitle-titles.js";

const plan = { id: "p", spec: { selected: ["Bazarr"] } };
const SUB = "/data/media/movies/Film (2020)/Film.de.srt";
function setup({ history = true, fill = true } = {}) {
  const movie = { radarrId: 7, title: "Ein Film", year: "2020", profileId: 1,
    subtitles: [{ name: "German", code2: "de", forced: false, hi: false, path: SUB }, { name: "English", code2: "en", forced: false, hi: false, path: null }],
    missing_subtitles: [{ name: "French", code2: "fr", forced: false, hi: false }] };
  const episode = { sonarrSeriesId: 3, sonarrEpisodeId: 31, season: 1, episode: 2, title: "Zwei", subtitles: [], missing_subtitles: [{ name: "German", code2: "de", forced: false, hi: false }] };
  const calls = [];
  const s = { additional: { bazarr: async (route, o = {}) => {
    calls.push([o.method || "GET", route]);
    if (route.startsWith("/movies?start")) return { data: [movie, { radarrId: 8, title: "Anderes" }] };
    if (route.startsWith("/series?start")) return { data: [{ sonarrSeriesId: 3, title: "Eine Film-Serie", episodeMissingCount: 4, profileId: 1 }] };
    if (route === "/movies?radarrid[]=7") return { data: [structuredClone(movie)] };
    if (route === "/series?seriesid[]=3") return { data: [{ sonarrSeriesId: 3, title: "Eine Film-Serie", profileId: 1 }] };
    if (route === "/episodes?seriesid[]=3") return { data: [structuredClone(episode)] };
    if (route.startsWith("/movies/subtitles?") && o.method === "PATCH") { if (fill) movie.missing_subtitles = []; return null; }
    if (route.startsWith("/movies/history")) return { data: history ? [{ subtitles_path: SUB, provider: "gestdown", subs_id: "x1" }] : [] };
    return null;
  } } };
  const hub = { engine: { current: () => ({ job: { status: "completed" }, plan }) }, context: async () => ({ s, plan }), mutate: async (_n, fn) => fn({ s, plan }) };
  return { t: new SubtitleTitles(hub), calls };
}

test("Suche über Filme und Serien, Pfade bleiben im Server", async () => {
  const { t } = setup();
  await assert.rejects(t.search("a"), /zwei Zeichen/);
  const { results } = await t.search("film");
  assert.deepEqual(results.map((r) => [r.kind, r.title, r.missing]), [["movie", "Ein Film", 1], ["tv", "Eine Film-Serie", 4]]);
  const d = await t.detail("movie", 7);
  assert.equal(d.subtitles[0].file, "Film.de.srt");
  assert.equal(d.subtitles[1].token, null, "eingebettet: keine Aktion");
  assert.ok(!JSON.stringify(d).includes("/data/"));
  const tv = await t.detail("tv", 3);
  assert.equal(tv.episodes[0].label, "S01E02 – Zwei");
  assert.deepEqual(projectSubs({}), { subtitles: [], missing: [] });
});

test("Fehlende suchen, eine Sprache suchen", async () => {
  const { t, calls } = setup();
  await t.act({ kind: "tv", id: 3, action: "search-missing" });
  assert.deepEqual(calls.at(-1), ["PATCH", "/series?seriesid=3&action=search-missing"]);
  await assert.rejects(t.act({ kind: "movie", id: 7, action: "search", language: "de" }), /fehlt nicht/);
  const r = await t.act({ kind: "movie", id: 7, action: "search", language: "fr" });
  assert.equal(r.found, true);
  assert.ok(calls.some(([m, route]) => m === "PATCH" && route === "/movies/subtitles?radarrid=7&language=fr&forced=false&hi=false"));
  const none = setup({ fill: false });
  assert.equal((await none.t.act({ kind: "movie", id: 7, action: "search", language: "fr" })).found, false);
  await assert.rejects(t.act({ kind: "tv", id: 3, action: "search", language: "de" }), /Folge wählen/);
});

test("Ersetzen über Sperrliste, ohne Herkunft nur neu suchen; Löschen mit OK", async () => {
  const { t, calls } = setup();
  const d = await t.detail("movie", 7);
  const tok = d.subtitles[0].token;
  await assert.rejects(t.act({ kind: "movie", id: 7, action: "replace", token: tok }), /mit OK/);
  await assert.rejects(t.act({ kind: "movie", id: 7, action: "delete", token: "0".repeat(16), confirmation: "OK" }), /nicht mehr da/);
  const r = await t.act({ kind: "movie", id: 7, action: "replace", token: tok, confirmation: "OK" });
  assert.match(r.message, /gestdown gesperrt/);
  const post = calls.find(([m, route]) => m === "POST" && route.startsWith("/movies/blacklist?"));
  const q = new URLSearchParams(post[1].split("?")[1]);
  assert.deepEqual(Object.fromEntries(q), { radarrid: "7", provider: "gestdown", subs_id: "x1", language: "de", subtitles_path: SUB });
  const plain = setup({ history: false });
  const r2 = await plain.t.act({ kind: "movie", id: 7, action: "replace", token: tok, confirmation: "OK" });
  assert.match(r2.message, /Herkunft unbekannt/);
  assert.ok(!plain.calls.some(([m]) => m === "POST"));
  await t.act({ kind: "movie", id: 7, action: "delete", token: tok, confirmation: "OK" });
  assert.deepEqual(calls.at(-1), ["DELETE", `/movies/subtitles?radarrid=7&language=de&forced=false&hi=false&path=${encodeURIComponent(SUB)}`]);
});
