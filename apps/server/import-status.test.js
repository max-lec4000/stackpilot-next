import { test } from "node:test";
import assert from "node:assert/strict";
import { importStatus } from "./import-status.js";
test("100 % und Seeding sind kein Importbeweis; native Importfehler bleiben nachvollziehbar und Geheimnisse ausgeblendet", async () => {
  const hash = "a".repeat(40),
    target = {
      kind: "movie",
      service: "Radarr",
      mediaId: 42,
      item: { id: 11, hasFile: false },
    },
    s = {
      arr: async (name, route) =>
        route.startsWith("/queue")
          ? {
              totalRecords: 1,
              records: [
                {
                  movieId: 11,
                  downloadId: hash,
                  trackedDownloadStatus: "warning",
                  trackedDownloadState: "importBlocked",
                  statusMessages: [
                    {
                      title: "Import blocked",
                      messages: [
                        "Access denied /data/media/movies/test",
                        "https://tracker/?passkey=private",
                        "password=private",
                      ],
                    },
                  ],
                },
              ],
            }
          : { enableCompletedDownloadHandling: true },
      qbit: async () => [
        {
          hash,
          progress: 1,
          state: "stalledUP",
          category: "stackpilot-movies",
          content_path: "/data/downloads/complete/movies/test",
        },
      ],
    };
  const r = await importStatus(
    s,
    { spec: { selected: ["Radarr", "qBittorrent"] } },
    target,
    [],
    [
      {
        name: "StackPilot qBittorrent",
        fields: [{ name: "movieCategory", value: "stackpilot-movies" }],
      },
    ],
  );
  assert.equal(r.downloadComplete, true);
  assert.equal(r.seeding, true);
  assert.equal(r.imported, false);
  assert.equal(r.phase, "blocked");
  assert.ok(r.messages.some((m) => m.includes("Access denied")));
  assert.ok(!JSON.stringify(r).includes("passkey=private"));
  assert.ok(!JSON.stringify(r).includes("password=private"));
});
test("Import und Jellyfin-Verfügbarkeit werden getrennt über echte Provider-ID-Ergebnisse bestätigt", async () => {
  const s = {
      arr: async (name, route) =>
        route.startsWith("/queue")
          ? { totalRecords: 0, records: [] }
          : { enableCompletedDownloadHandling: true },
      qbit: async () => [],
      additional: { jellyfinLogin: async () => ({ AccessToken: "hidden" }) },
      request: async () => ({
        Items: [{ Id: "movie", ProviderIds: { Tmdb: "42" } }],
      }),
    },
    plan = { spec: { selected: ["Radarr", "Jellyfin", "qBittorrent"] } },
    target = {
      kind: "movie",
      service: "Radarr",
      mediaId: 42,
      item: { id: 11, hasFile: true },
    };
  let r = await importStatus(s, plan, target, [], []);
  assert.equal(r.phase, "available");
  assert.ok(!JSON.stringify(r).includes("hidden"));
  s.request = async () => ({ Items: [{ ProviderIds: { Tmdb: "99" } }] });
  r = await importStatus(s, plan, target, [], []);
  assert.equal(r.phase, "library-sync");
  assert.equal(r.availableInJellyfin, false);
});
