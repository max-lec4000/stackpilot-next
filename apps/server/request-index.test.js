import { test } from "node:test";
import assert from "node:assert/strict";
import { LiveCache, allArrQueue, requestPage } from "./request-index.js";
test("Gemeinsame Abfragen teilen laufende Arbeit; Invalidierung lässt keine alte Antwort zurückkehren", async () => {
  const c = new LiveCache();
  let finish,
    calls = 0;
  const pending = c.read("a", () => {
    calls++;
    return new Promise((r) => (finish = r));
  });
  const second = c.read("a", () => {
    calls++;
  });
  await Promise.resolve();
  assert.equal(calls, 1);
  c.clear();
  assert.equal(await c.read("a", async () => 2), 2);
  finish(1);
  assert.equal(await pending, 1);
  assert.equal(await second, 1);
  assert.equal(await c.read("a", async () => 3), 2);
});
test("ARR-Warteschlangen werden vollständig statt nur bis Eintrag 250 gelesen", async () => {
  let calls = 0;
  const rows = await allArrQueue(
    {
      arr: async () => ({
        totalRecords: 251,
        records: Array.from({ length: ++calls === 1 ? 250 : 1 }, () => ({
          id: calls,
        })),
      }),
    },
    "Radarr",
  );
  assert.equal(rows.length, 251);
  assert.equal(calls, 2);
});
test("Archivierte Einträge werden vor der sichtbaren Seiteneinteilung ausgeschlossen", async () => {
  const r = await requestPage(
    {
      additional: {
        seerr: async () => ({
          pageInfo: { results: 10 },
          results: Array.from({ length: 10 }, (_, i) => ({ id: i + 1 })),
        }),
      },
    },
    {
      page: 1,
      pageSize: 8,
      filter: "all",
      type: "all",
      excluded: new Set([1, 2, 3]),
    },
  );
  assert.equal(r.pageInfo.results, 7);
  assert.deepEqual(
    r.results.map((v) => v.id),
    [4, 5, 6, 7, 8, 9, 10],
  );
});

test("Archivkennzeichen verbergen keine fremde Anfrage nach Wiederverwendung einer Seerr-ID", async () => {
  const result = await requestPage(
    {
      additional: {
        seerr: async () => ({
          pageInfo: { results: 1 },
          results: [
            {
              id: 7,
              media: { tmdbId: 99, mediaType: "movie" },
              createdAt: "new",
            },
          ],
        }),
      },
    },
    {
      page: 1,
      pageSize: 8,
      filter: "all",
      type: "all",
      excluded: new Map([
        [7, { mediaId: 42, type: "movie", createdAt: "old" }],
      ]),
    },
  );
  assert.equal(result.results.length, 1);
});
