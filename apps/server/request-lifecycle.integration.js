// Native Seerr request API, seeded disposable database, synthetic ARR adapter; no providers/downloads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { StateStore } from "./state.js";
import { Vault } from "./vault.js";
import { DeploymentEngine } from "./installer.js";
import { Services } from "./service-api.js";
import { localDocker } from "./retirement.js";
import { RequestLifecycle } from "./request-lifecycle.js";
import { RequestRecords } from "./request-records.js";
test(
  "Seerr bestätigt Anfrage-Abbruch mit DELETE/404; lokales Archiv bleibt erhalten",
  { timeout: 300000 },
  async () => {
    const root = await mkdtemp("/tmp/sp-cancel-contract-"),
      store = new StateStore(root + "/state"),
      vault = new Vault(store),
      engine = new DeploymentEngine(store, vault, {
        project: "sp-cancel-" + randomUUID().slice(0, 8),
        portOffset: 30000,
        allowUnqualifiedLinux: true,
      });
    let plan, db;
    try {
      plan = await engine.createPlan({
        selected: ["Jellyfin", "Seerr"],
        path: root + "/data",
        username: "fixture-admin",
        language: "Deutsch",
        vpn: false,
      });
      assert.equal(plan.executable, true, plan.blockers.join(" "));
      const job = await engine.confirm(plan.id, plan.confirmation, true),
        deadline = Date.now() + 200000;
      while (Date.now() < deadline) {
        const current = store.operation(job.id);
        if (current.status === "failed") assert.fail(current.error);
        if (current.status === "completed") break;
        await new Promise((r) => setTimeout(r, 500));
      }
      assert.equal(store.operation(job.id).status, "completed");
      const native = new Services(plan, vault, await engine.relay(plan));
      const actor = await native.additional.seerr("/auth/me");
      db = new DatabaseSync(plan.appdata + "/seerr/db/db.sqlite3");
      db.exec("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;");
      const media = Number(
        db
          .prepare("INSERT INTO media (tmdbId,mediaType,status) VALUES(?,?,?)")
          .run(987654321, "movie", 3).lastInsertRowid,
      );
      let requestId = Number(
        db
          .prepare(
            "INSERT INTO media_request (status,type,is4k,mediaId,requestedById) VALUES(?,?,?,?,?)",
          )
          .run(2, "movie", 0, media, actor.id).lastInsertRowid,
      );
      let kind = "movie";
      let item = {
        id: 11,
        tmdbId: 987654321,
        monitored: true,
        path: "/data/media/movies/Fixture",
        qualityProfileId: 1,
      };
      const s = {
        arr: async (name, path, options) => {
          if (path === "/command") return [];
          if (options) item = structuredClone(options.body);
          return item;
        },
        additional: {
          seerr: async (path, options) => {
            if (path.startsWith("/movie/") || path.startsWith("/tv/"))
              return {
                title: "Fixture request",
                mediaInfo: {
                  requests: [
                    await native.additional.seerr(`/request/${requestId}`),
                  ],
                },
              };
            return native.additional.seerr(path, options);
          },
        },
      };
      const hub = {
        engine: { store, vault },
        context: async () => ({ s, plan }),
        mutate: async (n, fn) => fn({ s, plan }),
        invalidateRequests() {},
      };
      const records = new RequestRecords(store),
        lifecycle = new RequestLifecycle(
          hub,
          {
            target: async () => ({
              item,
              request: await native.additional.seerr(`/request/${requestId}`),
              kind,
              mediaId: 987654321,
              service: kind === "movie" ? "Radarr" : "Sonarr",
            }),
          },
          records,
        );
      const preview = await lifecycle.preview(requestId);
      assert.equal(preview.canCancel, true);
      await lifecycle.cancel({
        requestId,
        review: preview.review,
        confirmation: "OK",
      });
      await assert.rejects(
        native.additional.seerr(`/request/${requestId}`),
        /HTTP 404/,
      );
      assert.equal(item.monitored, false);
      assert.equal(records.history(plan).results[0].cancelled, true);
      assert.equal(
        db.prepare("SELECT COUNT(*) AS n FROM media WHERE id=?").get(media).n,
        1,
      );
      const tvMedia = Number(db.prepare("INSERT INTO media (tmdbId,mediaType,status) VALUES(?,?,?)")
        .run(987654321, "tv", 2).lastInsertRowid);
      requestId = Number(db.prepare("INSERT INTO media_request (status,type,is4k,mediaId,requestedById) VALUES(?,?,?,?,?)")
        .run(1, "tv", 0, tvMedia, actor.id).lastInsertRowid);
      const insertSeason = db.prepare('INSERT INTO season_request ("seasonNumber", status, "requestId") VALUES(?,?,?)');
      for (const number of [1, 2, 3]) insertSeason.run(number, 1, requestId);
      kind = "tv";
      item = null;
      const seasonPreview = await lifecycle.preview(requestId);
      assert.deepEqual(seasonPreview.editableSeasons, [1, 2, 3]);
      await lifecycle.cancelSeason({ requestId, season: 2, review: seasonPreview.review, confirmation: "OK" });
      const remaining = await native.additional.seerr(`/request/${requestId}`);
      assert.deepEqual(remaining.seasons.map((season) => season.seasonNumber), [1, 3]);
      assert.equal(remaining.status, 1);
      await assert.rejects(lifecycle.cancelSeason({
        requestId, season: 3, review: seasonPreview.review, confirmation: "OK",
      }), /Neu prüfen/);
      console.log(
        "Native Seerr-Entfernung und Nachweis, Daten-erhaltender Adapter und Archiv geprüft.",
      );
    } finally {
      db?.close();
      if (plan)
        await localDocker(
          [
            "compose",
            "-f",
            store.directory + "/deployments/" + plan.id + "/compose.json",
            "down",
          ],
          { timeout: 120000 },
        );
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
