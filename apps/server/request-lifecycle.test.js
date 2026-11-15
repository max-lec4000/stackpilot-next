import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { StateStore } from "./state.js";
import { RequestRecords } from "./request-records.js";
import { RequestLifecycle } from "./request-lifecycle.js";
async function fixture() {
  const root = await mkdtemp("/tmp/sp-lifecycle-"),
    store = new StateStore(root),
    records = new RequestRecords(store),
    values = new Map(),
    calls = [];
  const state = {
    item: {
      id: 11,
      tmdbId: 42,
      path: "/data/media/movies/Test",
      monitored: true,
      qualityProfileId: 1,
    },
    request: {
      id: 7,
      status: 2,
      createdAt: "2026-11-01",
      media: { tmdbId: 42, mediaType: "movie" },
      seasons: [],
    },
    exists: true,
    others: [],
    commands: [],
  };
  const plan = { id: "plan", rootId: "root" },
    s = {
      arr: async (name, path, options) => {
        calls.push({ path, options });
        if (path === "/command") return state.commands;
        if (path === "/movie/11") {
          if (options) {
            state.item = structuredClone(options.body);
            if (state.failPut) {
              state.failPut = false;
              throw Error("response interrupted");
            }
          }
          return state.item;
        }
        throw Error(path);
      },
      additional: {
        seerr: async (path, options) => {
          calls.push({ path, options });
          if (path === "/movie/42?language=de")
            return {
              title: "Fixture Film",
              mediaInfo: { requests: [state.request, ...state.others] },
            };
          if (path === "/request/7") {
            if (options?.method === "DELETE") {
              state.exists = false;
              if (state.failDelete) {
                state.failDelete = false;
                throw Error("response interrupted");
              }
              return null;
            }
            if (!state.exists) throw Error("Seerr: HTTP 404");
            return state.request;
          }
          throw Error(path);
        },
      },
    };
  const hub = {
    engine: {
      vault: {
        get: (k) => values.get(k),
        set: (k, v) => values.set(k, structuredClone(v)),
      },
    },
    context: async () => ({ s, plan }),
    mutate: async (n, fn) => fn({ s, plan }),
    invalidateRequests() {},
  };
  const lifecycle = new RequestLifecycle(
    hub,
    {
      target: async () => {
        if (!state.exists) throw Error("HTTP 404");
        return {
          request: state.request,
          item: state.item,
          kind: "movie",
          mediaId: 42,
          service: "Radarr",
        };
      },
    },
    records,
  );
  return {
    state,
    calls,
    values,
    records,
    plan,
    lifecycle,
    close: async () => {
      store.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
test("Archivieren verändert keine Dienstüberwachung und hält Seitennavigation/Stack-Grenze ein", async () => {
  const f = await fixture();
  try {
    await f.lifecycle.archive({ requestId: 7 });
    assert.equal(f.state.item.monitored, true);
    assert.ok(f.records.archivedIds(f.plan).has(7));
    assert.equal(f.records.history(f.plan).total, 1);
    assert.equal(f.records.history({ id: "different" }).total, 0);
    await f.lifecycle.archive({ requestId: 7, restore: true });
    assert.equal(f.records.history(f.plan).total, 0);
    assert.ok(!f.calls.some((c) => c.options?.method === "DELETE"));
  } finally {
    await f.close();
  }
});
test("Abbrechen deaktiviert nur die Überwachung und entfernt die Anfrage ohne Dateien/Torrents zu löschen", async () => {
  const f = await fixture();
  try {
    const p = await f.lifecycle.preview(7);
    assert.equal(p.canCancel, true);
    await f.lifecycle.cancel({
      requestId: 7,
      review: p.review,
      confirmation: "OK",
    });
    assert.equal(f.state.item.monitored, false);
    assert.equal(f.state.exists, false);
    assert.equal(f.records.history(f.plan).results[0].cancelled, true);
    assert.ok(
      f.calls.every(
        (c) => !c.path.includes("deleteFiles") && !c.path.includes("torrent"),
      ),
    );
  } finally {
    await f.close();
  }
});
test("Geteilte Anfragen und veraltete Vorschauen verhindern einen Abbruch", async () => {
  const f = await fixture();
  try {
    const p = await f.lifecycle.preview(7);
    f.state.others = [{ id: 8, status: 2 }];
    assert.equal((await f.lifecycle.preview(7)).canCancel, false);
    await assert.rejects(
      f.lifecycle.cancel({
        requestId: 7,
        review: p.review,
        confirmation: "OK",
      }),
      /geändert/,
    );
    assert.equal(f.state.item.monitored, true);
    assert.equal(f.state.exists, true);
  } finally {
    await f.close();
  }
});
for (const failure of ["failPut", "failDelete"])
  test(
    "Abbruch wird nach unterbrochener Antwort fortgesetzt: " + failure,
    async () => {
      const f = await fixture();
      try {
        f.state[failure] = true;
        const p = await f.lifecycle.preview(7);
        await assert.rejects(
          f.lifecycle.cancel({
            requestId: 7,
            review: p.review,
            confirmation: "OK",
          }),
          /interrupted/,
        );
        assert.equal(f.records.history(f.plan).results[0].cancelPending, true);
        const retry = await f.lifecycle.preview(7);
        await f.lifecycle.cancel({
          requestId: 7,
          review: retry.review,
          confirmation: "OK",
        });
        assert.equal(f.records.history(f.plan).results[0].cancelled, true);
        assert.equal(f.state.item.monitored, false);
      } finally {
        await f.close();
      }
    },
  );

test("Serienabbruch ändert nur die angefragten Staffeln und lässt weitere Anfragen bestehen", async () => {
  const f = await fixture();
  try {
    f.state.request.media.mediaType = "tv";
    f.state.request.seasons = [{ seasonNumber: 1 }];
    f.state.item = {
      id: 11,
      tvdbId: 44,
      monitored: true,
      qualityProfileId: 1,
      path: "/data/media/tv/Fixture",
      seasons: [
        { seasonNumber: 1, monitored: true },
        { seasonNumber: 2, monitored: true },
      ],
    };
    f.state.others = [{ id: 8, status: 2, seasons: [{ seasonNumber: 2 }] }];
    const original = f.lifecycle.diagnostics.target;
    f.lifecycle.diagnostics.target = async (s, id) => ({
      ...(await original(s, id)),
      kind: "tv",
      service: "Sonarr",
    });
    const originalContext = f.lifecycle.hub.context;
    f.lifecycle.hub.context = async (...args) => {
      const ctx = await originalContext(...args),
        old = ctx.s.additional.seerr;
      ctx.s.additional.seerr = async (path, options) =>
        path === "/tv/42?language=de"
          ? {
              name: "Fixture Series",
              mediaInfo: { requests: [f.state.request, ...f.state.others] },
            }
          : old(path, options);
      const arr = ctx.s.arr;
      ctx.s.arr = async (name, path, options) =>
        arr(name, path.replace("/series/", "/movie/"), options);
      return ctx;
    };
    const single = await f.lifecycle.preview(7);
    assert.deepEqual(single.monitoredSeasons, [1]);
    await assert.rejects(f.lifecycle.cancelSeason({
      requestId: 7, review: single.review, season: 2, confirmation: "OK",
    }), /nicht geändert/);
    await f.lifecycle.cancelSeason({
      requestId: 7, review: single.review, season: 1, confirmation: "OK",
    });
    assert.equal(f.state.exists, true);
    assert.equal(f.state.item.seasons[0].monitored, false);
    assert.equal(f.state.item.seasons[1].monitored, true);
    assert.deepEqual((await f.lifecycle.preview(7)).monitoredSeasons, []);
    f.state.item.seasons[0].monitored = true;
    const p = await f.lifecycle.preview(7);
    assert.equal(p.canCancel, true);
    await f.lifecycle.cancel({
      requestId: 7,
      review: p.review,
      confirmation: "OK",
    });
    assert.equal(f.state.item.monitored, true);
    assert.equal(f.state.item.seasons[0].monitored, false);
    assert.equal(f.state.item.seasons[1].monitored, true);
  } finally {
    await f.close();
  }
});

test("Ein unterbrochener Abbruch kann ohne weitere Dienständerung bewusst verworfen und archiviert werden", async () => {
  const f = await fixture();
  try {
    f.state.failPut = true;
    const p = await f.lifecycle.preview(7);
    await assert.rejects(
      f.lifecycle.cancel({
        requestId: 7,
        review: p.review,
        confirmation: "OK",
      }),
      /interrupted/,
    );
    await assert.rejects(f.lifecycle.archive({ requestId: 7 }), /ausdrücklich/);
    const writes = f.calls.filter((c) => c.options).length;
    await f.lifecycle.archive({
      requestId: 7,
      abandon: true,
      confirmation: "OK",
    });
    assert.equal(f.state.exists, true);
    assert.equal(f.state.item.monitored, false);
    assert.equal(f.records.history(f.plan).results[0].cancelPending, false);
    assert.equal(f.calls.filter((c) => c.options).length, writes);
    assert.equal(f.records.history(f.plan).results[0].cancelled, false);
  } finally {
    await f.close();
  }
});

test("Archivdaten werden bei wiederverwendeter Anfrage-ID nicht still überschrieben", async () => {
  const f = await fixture();
  try {
    await f.lifecycle.archive({ requestId: 7 });
    assert.throws(
      () =>
        f.records.put(f.plan, 7, {
          type: "movie",
          mediaId: 99,
          createdAt: "new",
          title: "Other",
        }),
      /wiederverwendet/,
    );
    assert.equal(f.records.history(f.plan).results[0].mediaId, 42);
  } finally {
    await f.close();
  }
});
