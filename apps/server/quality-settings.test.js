import { test } from "node:test";
import assert from "node:assert/strict";
import { compactProfile, QualitySettings } from "./quality-settings.js";
import { SizeLimits } from "./size-limits.js";
const profileSchema = {
  name: "Any",
  id: 0,
  upgradeAllowed: true,
  items: [
    { quality: { id: 1, name: "SDTV" }, allowed: true },
    {
      name: "WEB",
      items: [
        { quality: { id: 2, name: "WEBDL-1080p" }, allowed: true },
        { quality: { id: 3, name: "WEBRip-2160p" }, allowed: true },
      ],
    },
    { quality: { id: 4, name: "Remux-1080p" }, allowed: true },
  ],
};
test("1080p-Profil verwendet alle nativen Qualitätsdefinitionen, lässt nur 1080p ohne Remux zu und verändert die Vorlage nicht", () => {
  const result = compactProfile(profileSchema);
  assert.equal(result.id, undefined);
  assert.equal(result.items.length, 4);
  assert.deepEqual(
    result.items.filter((v) => v.allowed).map((v) => v.quality.id),
    [2],
  );
  assert.equal(result.upgradeAllowed, false);
  assert.equal(profileSchema.items[0].allowed, true);
});
test("Qualitätswechsel erhält Pfade und manuelle Einstellungen, sichert Originale und startet keine neue Suche", async () => {
  const calls = [],
    values = new Map(),
    item = {
      id: 11,
      qualityProfileId: 1,
      path: "/data/media/movies/test",
      monitored: true,
      tags: [5],
      hasFile: true,
    },
    server = {
      id: 1,
      isDefault: true,
      hostname: "radarr",
      apiKey: "private",
      activeProfileId: 1,
    };
  const target = {
    item,
    server,
    mediaId: 42,
    kind: "movie",
    service: "Radarr",
  };
  let createdProfile, savedItem;
  const s = {
    arr: async (name, route, opts) => {
      calls.push([name, route, opts]);
      if (route === "/qualityprofile") {
        if (opts?.method === "POST")
          return (createdProfile = { ...opts.body, id: 2 });
        return [{ id: 1, name: "Any", items: profileSchema.items }];
      }
      if (route === "/qualityprofile/2") return createdProfile;
      if (route === "/movie/11") {
        if (opts?.method === "PUT") savedItem = opts.body;
        return savedItem;
      }
      if (route === "/qualityprofile/schema") return profileSchema;
      return { ...opts?.body };
    },
    additional: {
      seerr: async (route, opts) => {
        calls.push(["seerr", route, opts]);
        if (opts) {
          server.activeProfileId = opts.body.activeProfileId;
          return {};
        }
        return [server];
      },
    },
  };
  const engine = {
    vault: {
      get: (k) => values.get(k),
      set: (k, v) => values.set(k, structuredClone(v)),
    },
  };
  const hub = {
      engine,
      context: async () => ({ s }),
      mutate: async (names, fn) => fn({ s, plan: { id: "plan" } }),
    },
    q = new QualitySettings(hub, { target: async () => target });
  await q.apply({
    requestId: 7,
    previousProfileId: 1,
    profile: "1080p-compact",
    alsoFuture: true,
    confirmation: "OK",
  });
  const saved = calls.find((c) => c[1] === "/movie/11")[2].body;
  assert.equal(saved.path, item.path);
  assert.deepEqual(saved.tags, [5]);
  assert.equal(saved.hasFile, true);
  assert.equal(saved.qualityProfileId, 2);
  assert.ok(!calls.some((c) => c[1] === "/command"));
  const future = calls.find((c) => c[1] === "/settings/radarr/1")[2].body;
  assert.equal(future.apiKey, "private");
  assert.equal(future.id, undefined);
  assert.equal(future.activeProfileId, 2);
  assert.equal([...values.values()][0].item.qualityProfileId, 1);
  await assert.rejects(
    q.apply({
      requestId: 7,
      previousProfileId: 99,
      profile: "1",
      confirmation: "OK",
    }),
    /inzwischen geändert/,
  );
});
function readbackFixture(movieProfileId = 2) {
  const values = new Map(),
    profile = {
      id: 2,
      name: "HD-1080p",
      items: [{ allowed: true, quality: { name: "WEBDL-1080p" } }],
    },
    item = { id: 11, qualityProfileId: 1 },
    server = { id: 0, isDefault: true, activeProfileId: 1 };
  const hub = {
    engine: {
      vault: {
        get: (k) => values.get(k),
        set: (k, v) => values.set(k, structuredClone(v)),
      },
    },
    mutate: async (names, fn) =>
      fn({
        plan: { id: "p", rootId: "r" },
        s: {
          arr: async (name, route, options) =>
            route === "/qualityprofile"
              ? [profile]
              : route.startsWith("/qualityprofile/")
                ? profile
                : options?.method === "PUT"
                  ? options.body
                  : { ...item, qualityProfileId: movieProfileId },
          additional: { seerr: async () => [structuredClone(server)] },
        },
      }),
  };
  hub.sizeLimits = new SizeLimits(hub);
  hub.sizeLimits.ensure = async () => ({ profileId: 2, capGiB: 6 });
  hub.sizeLimits.verify = async () => {};
  return {
    values,
    q: new QualitySettings(hub, {
      target: async () => ({
        kind: "movie",
        service: "Radarr",
        mediaId: 42,
        item,
        server,
      }),
    }),
  };
}
test("Profilwechsel ohne bestätigte Radarr-Änderung wird nicht als gespeichert ausgegeben", async () => {
  const f = readbackFixture(1);
  await assert.rejects(
    () =>
      f.q.apply({
        requestId: 7,
        previousProfileId: 1,
        profile: "2",
        confirmation: "OK",
      }),
    /nicht bestätigt/,
  );
  assert.equal(f.values.has("quality-policy:r:movie:42"), false);
});
test("Unveränderter Seerr-Standard meldet Teilfehler statt falscher Erfolgsbestätigung", async () => {
  const f = readbackFixture();
  const result = await f.q.apply({
    requestId: 7,
    previousProfileId: 1,
    profile: "2",
    alsoFuture: true,
    confirmation: "OK",
  });
  assert.equal(result.futureUpdated, false);
  assert.match(result.warning, /nicht bestätigt/);
  assert.equal(f.values.get("quality-policy:r:movie:42").profileId, 2);
  assert.equal(f.values.has("quality-default:r:radarr"), false);
});
test("Größenregel bestätigt gemeinsamen Standard vor lokalem Speichern", async () => {
  const f = readbackFixture();
  let sharedConfirmed=false;
  f.q.hub.sizeLimits.shared={configure:async(_s,_plan,setting)=>{
    assert.equal(setting.rate,3);
    assert.equal(f.values.has('size-default:r'),false);
    sharedConfirmed=true;
  }};
  const result = await f.q.apply({
    requestId: 7,
    previousProfileId: 1,
    sizeGiBPerHour: 3,
    alsoFuture: true,
    confirmation: "OK",
  });
  assert.equal(sharedConfirmed,true);
  assert.equal(result.futureUpdated, true);
  assert.equal(f.values.get("size-default:r").rate, 3);
  assert.equal(f.values.has("quality-default:r:radarr"), false);
});

test('Einzelprofil überschreibt den gemeinsamen Größenstandard nicht', async () => {
  const f = readbackFixture();
  f.values.set('size-default:r', {rate:2});
  const result = await f.q.apply({requestId:7,previousProfileId:1,profile:'2',alsoFuture:true,confirmation:'OK'});
  assert.equal(result.futureUpdated,false);
  assert.match(result.warning,/Größenstandard aktiv/);
  assert.equal(f.values.get('size-default:r').rate,2);
  assert.equal(f.values.has('quality-default:r:radarr'),false);
});
