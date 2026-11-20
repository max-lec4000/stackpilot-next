import { test } from "node:test";
import assert from "node:assert/strict";
import { ViewerRatings } from "./viewer-ratings.js";

const ID = "a".repeat(32), ADMIN = "b".repeat(32);
function setup() {
  const users = {
    [ID]: { Id: ID, Policy: { IsAdministrator: false, MaxParentalRating: null, BlockUnratedItems: ["Book"], EnableAllFolders: true, MaxParentalSubRating: null } },
    [ADMIN]: { Id: ADMIN, Policy: { IsAdministrator: true } },
  };
  const posts = [];
  const hub = {
    context: async () => ({ s: {}, plan: { id: "p" } }),
    mutate: async (_n, fn) => fn(),
    library: {
      request: async (_s, _p, route, options = {}) => {
        const m = route.match(/^\/Users\/([a-f0-9]{32})(\/Policy)?$/);
        if (options.method === "POST") { posts.push([m[1], options.body]); users[m[1]].Policy = structuredClone(options.body); return null; }
        return structuredClone(users[m[1]]);
      },
    },
  };
  const connection = { context: async () => ({ request: async () => ({ stackpilot: { CanonicalLinks: { spv_familie: ID.replace(/^(.{8})/, "$1-"), spv_chef: ADMIN } } }) }) };
  const viewers = { list: async () => ({ viewers: [{ username: "familie", active: true }, { username: "chef", active: true }, { username: "neu", active: true }, { username: "weg", active: false }] }) };
  return { ratings: new ViewerRatings(hub, connection, viewers), users, posts };
}

test("Altersfreigabe: Liste je aktivem Zuschauer, Administratoren und Unverknüpfte gesperrt", async () => {
  const { ratings } = setup();
  const { levels, viewers } = await ratings.list();
  assert.deepEqual(levels, [0, 6, 12, 16, 18]);
  assert.deepEqual(viewers.map((v) => [v.username, v.editable]), [["familie", true], ["chef", false], ["neu", false]]);
  assert.deepEqual(viewers[0], { username: "familie", linked: true, editable: true, maxAge: null, blockUnrated: false, downloads: true, deletion: false, suspended: false });
  assert.match(viewers[1].reason, /Administratoren/);
  assert.match(viewers[2].reason, /Noch keine bestätigte Jellyfin-Anmeldung/);
});

test("Altersfreigabe setzen: übrige Richtlinie bleibt, Bestätigung, Grenzen", async () => {
  const { ratings, users, posts } = setup();
  await assert.rejects(ratings.change({ username: "familie", maxAge: 12, blockUnrated: true }), /mit OK/);
  await assert.rejects(ratings.change({ username: "familie", maxAge: 13, blockUnrated: true, confirmation: "OK" }), /Ungültige Altersstufe/);
  await assert.rejects(ratings.change({ username: "familie", maxAge: 12, confirmation: "OK" }), /ohne Altersfreigabe/);
  await assert.rejects(ratings.change({ username: "chef", maxAge: 12, blockUnrated: false, confirmation: "OK" }), /Administratoren/);
  await assert.rejects(ratings.change({ username: "weg", maxAge: 12, blockUnrated: false, confirmation: "OK" }), /nicht gefunden/);
  assert.equal(posts.length, 0);
  const after = await ratings.change({ username: "familie", maxAge: 12, blockUnrated: true, confirmation: "OK" });
  assert.deepEqual(after, { username: "familie", linked: true, editable: true, maxAge: 12, blockUnrated: true, downloads: true, deletion: false, suspended: false });
  const p = users[ID].Policy;
  assert.equal(p.EnableAllFolders, true, "übrige Richtlinie bleibt erhalten");
  assert.deepEqual(p.BlockUnratedItems, ["Book", "Movie", "Series"]);
  assert.equal(p.MaxParentalSubRating, null);
  const off = await ratings.change({ username: "familie", maxAge: null, blockUnrated: false, confirmation: "OK" });
  assert.equal(off.maxAge, null);
  assert.deepEqual(users[ID].Policy.BlockUnratedItems, ["Book"]);
});

test("Sperren, Herunterladen, Löschen: nur das Genannte ändert sich", async () => {
  const { ratings, users } = setup();
  users[ID].Policy.MaxParentalRating = 12;
  await assert.rejects(ratings.change({ username: "familie", confirmation: "OK" }), /Nichts zu ändern/);
  await assert.rejects(ratings.change({ username: "familie", suspended: "ja", confirmation: "OK" }), /Ungültige Angabe/);
  const r = await ratings.change({ username: "familie", suspended: true, downloads: false, confirmation: "OK" });
  assert.deepEqual([r.suspended, r.downloads, r.deletion, r.maxAge], [true, false, false, 12], "Altersfreigabe bleibt");
  assert.equal(users[ID].Policy.IsDisabled, true);
  assert.equal(users[ID].Policy.EnableAllFolders, true);
  const back = await ratings.change({ username: "familie", suspended: false, confirmation: "OK" });
  assert.equal(back.suspended, false);
  await assert.rejects(ratings.change({ username: "chef", suspended: true, confirmation: "OK" }), /Administratoren/);
});
