import { ViewerRequests } from "./viewer-requests.js";
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
    // This fixture owns only its shifted ports and unique Compose project.
    const nativeHost = engine.host.bind(engine);
    engine.host = async () => {
      const host = await nativeHost();
      return { ...host, listening: host.listening.filter(p => p >= 30000).map(p => p - 30000),
        containers: host.containers.filter(c => String(c.Names || '').startsWith(engine.project + '-')) };
    };
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
        requireVpn: async () => {},
        sizeLimits: { config: () => ({ rate: 0 }) },
      };
      const viewerId = Number(db.prepare('INSERT INTO user (email,permissions,userType,jellyfinUserId,jellyfinUsername,avatar) VALUES(?,?,?,?,?,?)')
        .run('fixture-viewer@example.invalid', 32, 3, 'fixture-jellyfin-id', 'fixture-viewer', '').lastInsertRowid);
      const viewerRequests = new ViewerRequests(hub,
        {context: async () => ({request: async () => ({stackpilot:{CanonicalLinks:{'spv_fixture-viewer':'fixture-jellyfin-id'}}})})},
        {list: async () => ({viewers:[{username:'fixture-viewer',active:true}]})});
      assert.equal((await viewerRequests.list()).viewers[0].editable,true);
      await viewerRequests.change({username:'fixture-viewer',userId:viewerId,previousPermissions:32,enabled:true,confirmation:'OK'});
      assert.equal((await native.additional.seerr(`/user/${viewerId}`)).permissions,160);
      await viewerRequests.change({username:'fixture-viewer',userId:viewerId,previousPermissions:160,enabled:false,confirmation:'OK'});
      assert.equal((await native.additional.seerr(`/user/${viewerId}`)).permissions,32);
      console.log('NATIVE_VIEWER_APPROVAL_RIGHTS_CONFIRMED');
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
      const approval = await lifecycle.approve({requestId, confirmation:"OK"});
      assert.equal(approval.status, 2);
      assert.equal((await native.additional.seerr(`/request/${requestId}`)).status, 2);
      await assert.rejects(lifecycle.approve({requestId, confirmation:"OK"}), /nicht mehr/);
      console.log("NATIVE_REQUEST_APPROVAL_CONFIRMED");
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
        ).catch(() => {});
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
