import { test } from "node:test";
import assert from "node:assert/strict";
import { TitleIdentify } from "./title-identify.js";

const plan = { id: "p", spec: { selected: ["Jellyfin"] } };
const ID = "a".repeat(32);
function setup() {
  let item = { Id: ID, Type: "Movie", Name: "Falscher Film", ProductionYear: 2001, ProviderIds: { Tmdb: "1" }, Path: "/data/media/movies/Richtiger Film (2020)/f.mkv" };
  const calls = [];
  const hub = {
    engine: { current: () => ({ job: { status: "completed" }, plan }) },
    context: async () => ({ s: {}, plan }), mutate: async (_n, fn) => fn(),
    library: { request: async (_s, _p, route, o = {}) => {
      calls.push([o.method || "GET", route, o.body]);
      if (route.startsWith("/Items?SearchTerm")) return { Items: [item, { Id: "zz", Type: "Movie" }] };
      if (route.startsWith("/Items?Ids=")) return { Items: route.includes(ID) ? [structuredClone(item)] : [] };
      if (route === "/Items/RemoteSearch/Movie") return [{ Name: "Richtiger Film", ProductionYear: 2020, ProviderIds: { Tmdb: "42", Imdb: "tt42" }, SearchProviderName: "TheMovieDb" }];
      if (route.startsWith("/Items/RemoteSearch/Apply/")) { item = { ...item, Name: o.body.Name, ProviderIds: o.body.ProviderIds }; return null; }
      return null;
    } },
  };
  const t = new TitleIdentify(hub);
  t.pollMs = 1;
  return { t, calls };
}

test("Titel suchen, Kandidaten, anwenden mit OK", async () => {
  const { t, calls } = setup();
  await assert.rejects(t.search("x"), /zwei Zeichen/);
  const { items } = await t.search("Falsch");
  assert.deepEqual(items, [{ id: ID, kind: "movie", title: "Falscher Film", year: 2001, providers: { tmdb: "1" }, folder: "f.mkv" }]);
  await assert.rejects(t.candidates({ id: ID, tmdb: "abc" }), /Ziffern/);
  await assert.rejects(t.candidates({ id: ID, year: 3000 }), /Ungültiges Jahr/);
  const c = await t.candidates({ id: ID, name: "Richtiger Film", year: 2020 });
  assert.deepEqual(calls.at(-1)[2].SearchInfo, { Name: "Richtiger Film", Year: 2020 });
  assert.equal(c.candidates[0].name, "Richtiger Film");
  assert.ok(!("result" in c.candidates[0]));
  await assert.rejects(t.apply({ token: c.candidates[0].token }), /mit OK/);
  const r = await t.apply({ token: c.candidates[0].token, confirmation: "OK" });
  assert.equal(r.item.providers.tmdb, "42");
  assert.ok(calls.some(([m, route]) => m === "POST" && route === `/Items/RemoteSearch/Apply/${ID}?ReplaceAllImages=true`));
  await assert.rejects(t.apply({ token: c.candidates[0].token, confirmation: "OK" }), /abgelaufen/, "nur einmal");
  await assert.rejects(t.candidates({ id: "b".repeat(32) }), /nicht mehr in Jellyfin/);
});
