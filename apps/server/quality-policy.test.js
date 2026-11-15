import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allowedQualities,
  compactValid,
  requestQualityOptions,
} from "./quality-policy.js";
const plan = { id: "p", rootId: "r" },
  profile = {
    id: 2,
    name: "Compact",
    upgradeAllowed: false,
    items: [
      { quality: { name: "WEBDL-1080p" }, allowed: true },
      { quality: { name: "Remux-1080p" }, allowed: false },
    ],
  };
function fixture() {
  const values = new Map([
      [
        "quality-policy:r:movie:42",
        { serverId: 0, profileId: 2, compact: true },
      ],
    ]),
    server = {
      id: 0,
      hostname: "radarr",
      port: 7878,
      is4k: false,
      isDefault: true,
      activeProfileId: 2,
    };
  return {
    values,
    server,
    hub: { engine: { vault: { get: (k) => values.get(k) } } },
    s: {
      arr: async () => [structuredClone(profile)],
      additional: {
        seerr: async (route) =>
          route === "/auth/me" ? { permissions: 1 } : [server],
      },
    },
  };
}
test("Gruppierte Qualitäten beachten gesperrte Eltern und Remux wird tatsächlich ausgeschlossen", () => {
  assert.deepEqual(
    allowedQualities([
      {
        allowed: false,
        items: [{ allowed: true, quality: { name: "Remux-1080p" } }],
      },
      ...profile.items,
    ]),
    ["WEBDL-1080p"],
  );
  assert.equal(compactValid(profile), true);
  assert.equal(
    compactValid({
      ...profile,
      items: [{ allowed: true, quality: { name: "Remux-1080p" } }],
    }),
    false,
  );
});
test("Gespeicherte Filmqualität wird einschließlich Server-ID 0 an Seerr übergeben", async () => {
  const f = fixture();
  assert.deepEqual(await requestQualityOptions(f.hub, f.s, plan, "movie", 42), {
    serverId: 0,
    profileId: 2,
  });
});
test("Fehlendes oder verändertes Profil fällt nicht auf das ursprüngliche Any-Profil zurück", async () => {
  const f = fixture();
  f.s.arr = async () => [
    {
      ...profile,
      items: [{ allowed: true, quality: { name: "Remux-1080p" } }],
    },
  ];
  await assert.rejects(
    () => requestQualityOptions(f.hub, f.s, plan, "movie", 42),
    /andere Qualitäten/,
  );
  f.s.arr = async () => [];
  await assert.rejects(
    () => requestQualityOptions(f.hub, f.s, plan, "movie", 42),
    /fehlt/,
  );
});
test("Veränderter Seerr-Standard wird vor einer künftigen Anfrage gemeldet", async () => {
  const f = fixture();
  f.values.delete("quality-policy:r:movie:42");
  f.values.set("quality-default:r:Radarr", { serverId: 0, profileId: 2 });
  f.server.activeProfileId = 1;
  await assert.rejects(
    () => requestQualityOptions(f.hub, f.s, plan, "movie", 50),
    /Standard.*verändert/,
  );
});

test("Ohne bestätigte Seerr-Adminrechte wird kein verbindliches Profil als wirksam angenommen", async () => {
  const f = fixture();
  f.s.additional.seerr = async () => ({ permissions: 0 });
  await assert.rejects(
    () => requestQualityOptions(f.hub, f.s, plan, "movie", 42),
    /Administratorrechte/,
  );
});
test("Eine spätere Suche blockiert ein von der gespeicherten Auswahl abweichendes Dienstprofil", async () => {
  const f = fixture();
  const { verifyCurrentQuality } = await import("./quality-policy.js");
  await assert.rejects(
    () =>
      verifyCurrentQuality(f.hub, f.s, plan, {
        kind: "movie",
        mediaId: 42,
        item: { qualityProfileId: 1 },
        service: "Radarr",
      }),
    /weicht/,
  );
  f.s.arr = async () => ({
    ...profile,
    items: [{ allowed: true, quality: { name: "Remux-1080p" } }],
  });
  await assert.rejects(
    () =>
      verifyCurrentQuality(f.hub, f.s, plan, {
        kind: "movie",
        mediaId: 42,
        item: { qualityProfileId: 2 },
        service: "Radarr",
      }),
    /andere Qualitäten/,
  );
});
