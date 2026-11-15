// Explicit opt-in: isolated Linux/Docker host only. Creates eight apps + API relay.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, lstat } from "node:fs/promises";
import { catalog } from "./catalog.js";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { StateStore } from "./state.js";
import { Vault } from "./vault.js";
import { DeploymentEngine } from "./installer.js";
import { localDocker } from "./retirement.js";
import { relayRequest } from "./docker-io.js";
test(
  "Erstinstallation und Erweiterung verbinden acht Dienste mit echten Aktivitäten; qBittorrent ohne VPN bleibt gesperrt",
  { timeout: 600000 },
  async () => {
    const root = await mkdtemp("/tmp/stackpilot-install-");
    const store = new StateStore(root + "/state");
    const vault = new Vault(store);
    const engine = new DeploymentEngine(store, vault, {
      project: "sp-integration-" + randomUUID().slice(0, 8),
      portOffset: 20000,
      allowUnqualifiedLinux: true,
    });
    let plan;
    let extension;
    try {
      plan = await engine.createPlan({
        selected: ["Jellyfin", "Sonarr", "Radarr", "Prowlarr"],
        path: root + "/data",
        username: "stackadmin",
        language: "Deutsch",
        vpn: false,
      });
      assert.equal(plan.executable, true, plan.blockers.join("\n"));
      await assert.rejects(engine.confirm(plan.id, "wrong", true));
      const op = await engine.confirm(plan.id, plan.confirmation, true);
      let last = "";
      const end = Date.now() + 540000;
      while (Date.now() < end) {
        const current = store.operation(op.id);
        const active = current.steps.find((s) => s.status === "running");
        if (active && active.label !== last) {
          last = active.label;
          console.log(last);
        }
        if (current.status === "failed") assert.fail(current.error);
        if (current.status === "completed") break;
        await new Promise((r) => setTimeout(r, 250));
      }
      const completed = store.operation(op.id);
      assert.equal(completed.status, "completed");
      assert.equal(completed.checks.length, 4);
      assert.ok(completed.steps.every((s) => s.status === "completed"));
      assert.equal(
        (await engine.confirm(plan.id, plan.confirmation, true)).id,
        op.id,
      );
      const relay = await engine.relay(plan);
      const unauthorized = await relayRequest(relay, {
        url: "http://sonarr:8989/api/v3/config/host",
        method: "GET",
        headers: {},
      });
      assert.equal(unauthorized.status, 401);
      const nativePasswords = plan.spec.selected.map(
        (n) => vault.get(`deployment:${plan.id}:${n.toLowerCase()}`).password,
      );
      assert.equal(new Set(nativePasswords).size, 4);
      const compose = JSON.parse(
        await readFile(
          path.join(store.directory, "deployments", plan.id, "compose.json"),
          "utf8",
        ),
      );
      assert.ok(
        Object.values(compose.services)
          .filter((s) => s.ports?.length)
          .every((s) => s.ports.every((p) => p.startsWith("127.0.0.1:"))),
      );
      assert.ok(
        !(await readFile(path.join(store.directory, "state.sqlite"))).includes(
          Buffer.from(nativePasswords[0]),
        ),
      );
      const before = await engine.validate(plan, true);
      assert.equal(before.length, 5);
      const spec = {
        ...plan.spec,
        selected: [
          ...plan.spec.selected,
          "Lidarr",
          "Bazarr",
          "Seerr",
          "Streamystats",
        ],
      };
      extension = await engine.createPlan(spec);
      assert.equal(extension.executable, true, extension.blockers.join("\n"));
      assert.deepEqual(extension.added, [
        "Streamystats",
        "Lidarr",
        "Bazarr",
        "Seerr",
      ]);
      const competing = await engine.createPlan(spec);
      const extended = await engine.confirm(
        extension.id,
        extension.confirmation,
        true,
      );
      const extensionDeadline = Date.now() + 360000;
      while (Date.now() < extensionDeadline) {
        const current = store.operation(extended.id);
        const active = current.steps.find((s) => s.status === "running");
        if (active && last !== active.id) {
          last = active.id;
          console.log("Erweiterung: " + active.label);
        }
        if (current.status === "failed") assert.fail(current.error);
        if (current.status === "completed") break;
        await new Promise((r) => setTimeout(r, 250));
      }
      assert.equal(store.operation(extended.id).status, "completed");
      assert.equal(store.operation(extended.id).checks.length, 8);
      await assert.rejects(
        engine.confirm(competing.id, competing.confirmation, true),
        /Stack hat sich/,
      );
      const after = await engine.validate(extension, true);
      assert.equal(after.length, 9);
      for (const old of before)
        assert.ok(
          after.some((c) => c.id === old.id),
          `${old.service} must not be recreated`,
        );
      for (const name of plan.spec.selected)
        assert.equal(
          vault.get(`deployment:${plan.id}:${name.toLowerCase()}`).password,
          nativePasswords[plan.spec.selected.indexOf(name)],
        );
      const noop = await engine.createPlan(extension.spec);
      assert.equal(noop.executable, false);
      const removed = await engine.createPlan({
        ...extension.spec,
        selected: ["Jellyfin"],
      });
      assert.ok(removed.blockers.some((b) => b.includes("Installierte Apps")));
      console.log(
        "Erweiterung geprüft: bestehende Container und Passwörter unverändert, Lidarr, Bazarr, Seerr und Streamystats neu verbunden, veralteter Plan gesperrt.",
      );
      const { ActivityMonitor } = await import("./activity.js");
      const monitor = new ActivityMonitor(engine, {
        status: { state: "not-required" },
      });
      const activity = await monitor.get();
      assert.equal(
        activity.jellyfin.state,
        "ready",
        JSON.stringify(monitor.diagnostics),
      );
      assert.deepEqual(activity.jellyfin.sessions, []);
      assert.equal(activity.arr.length, 3);
      assert.ok(
        activity.arr.every(
          (queue) => queue.state === "ready" && queue.queued === 0,
        ),
      );
      const { MediaHub } = await import("./media-hub.js");
      const { Sources } = await import("./sources.js");
      const hub = new MediaHub(engine, {
        check: async () => ({ state: "not-required" }),
      });
      const sourceData = await new Sources(hub).list();
      assert.ok(
        sourceData.schemas.length > 0,
        "Real Prowlarr schemas available",
      );
      assert.equal(sourceData.sources.length, 0);
      assert.ok(sourceData.connections.length >= 3);
      // Controlled Torznab fixture: only metadata, no torrents or external requests.
      const fixtureRelay = await engine.relay(extension);
      const caps = `<?xml version="1.0"?><caps><server version="1.0" title="StackPilot fixture"/><limits max="100" default="100"/><registration available="no" open="no"/><searching><search available="yes" supportedParams="q"/><tv-search available="yes" supportedParams="q,season,ep,tvdbid"/><movie-search available="yes" supportedParams="q,imdbid,tmdbid"/></searching><categories><category id="2000" name="Movies"/><category id="5000" name="TV"/></categories></caps>`;
      const rss = `<?xml version="1.0"?><rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel><title>Fixture</title><item><title>StackPilot.Test.2026.1080p</title><guid isPermaLink="false">fixture-only</guid><link>http://api-relay:9876/fixture.torrent</link><pubDate>Sat, 07 Nov 2026 10:00:00 GMT</pubDate><size>1048576</size><category>2000</category><enclosure url="http://api-relay:9876/fixture.torrent" length="1048576" type="application/x-bittorrent"/><torznab:attr name="category" value="2000"/><torznab:attr name="seeders" value="1"/><torznab:attr name="peers" value="1"/><torznab:attr name="infohash" value="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"/></item></channel></rss>`;
      const serverProgram = `import {createServer} from 'node:http';const caps=${JSON.stringify(caps)},rss=${JSON.stringify(rss)};createServer((req,res)=>{const query=new URL(req.url,'http://localhost').searchParams;if(query.get('t')!=='caps'&&query.get('apikey')!=='fixture-test-key'){res.writeHead(401);return res.end();}res.setHeader('Content-Type','application/xml');res.end(query.get('t')==='caps'?caps:rss)}).listen(9876,'0.0.0.0');`;
      await localDocker([
        "exec",
        "-d",
        fixtureRelay,
        "node",
        "--input-type=module",
        "-e",
        serverProgram,
      ]);
      const torznab = sourceData.schemas.find((v) =>
        v.key.startsWith("Torznab:"),
      );
      assert.ok(torznab, "Torznab adapter exists");
      const sources = new Sources(hub);
      const draft = await sources.test({
        schema: torznab.key,
        name: "StackPilot fixture source",
        values: {
          baseUrl: "http://api-relay:9876",
          apiKey: "fixture-test-key",
        },
      });
      const saved = await sources.save({ id: draft.id, confirmation: "OK" });
      assert.ok(saved.id);
      await sources.action({ id: saved.id, action: "test" });
      await sources.action({ id: saved.id, action: "toggle", enabled: false });
      assert.equal(
        (await sources.list()).sources.find((v) => v.id === saved.id).enabled,
        false,
      );
      console.log(
        "Echte Prowlarr-Quelle gegen isolierte Torznab-Fixture getestet, gespeichert und deaktiviert.",
      );
      const edited = await sources.test({
        sourceId: saved.id,
        name: "StackPilot edited fixture",
        values: { apiKey: "" },
      });
      await sources.save({ id: edited.id, confirmation: "OK" });
      assert.equal(
        (await sources.list()).sources.find((v) => v.id === saved.id).name,
        "StackPilot edited fixture",
      );
      assert.equal(
        (await sources.list()).sources.find((v) => v.id === saved.id).enabled,
        false,
      );
      const { Services } = await import("./service-api.js");
      const native = new Services(extension, vault, fixtureRelay);
      const { compactProfile } = await import("./quality-settings.js");
      const profile = await native.arr("Radarr", "/qualityprofile", {
        method: "POST",
        body: compactProfile(
          await native.arr("Radarr", "/qualityprofile/schema"),
        ),
      });
      assert.ok(profile.id);
      const { compactValid, allowedQualities } = await import(
        "./quality-policy.js"
      );
      const persistedProfile = await native.arr(
        "Radarr",
        `/qualityprofile/${profile.id}`,
      );
      assert.equal(
        compactValid(persistedProfile),
        true,
        JSON.stringify(allowedQualities(persistedProfile.items)),
      );
      console.log(
        "Native Radarr-Profilregeln zurückgelesen: nur 1080p ohne Remux, keine Upgrades.",
      );
      const seerrServers = await native.additional.seerr("/settings/radarr");
      const seerrServer = seerrServers.find((v) => v.hostname === "radarr");
      await native.additional.seerr(`/settings/radarr/${seerrServer.id}`, {
        method: "PUT",
        body: {
          ...seerrServer,
          id: undefined,
          activeProfileId: profile.id,
          activeProfileName: profile.name,
        },
      });
      assert.equal(
        (await native.additional.seerr("/settings/radarr")).find(
          (v) => v.id === seerrServer.id,
        ).activeProfileId,
        profile.id,
      );
      assert.equal(
        typeof (await native.arr("Radarr", "/config/downloadclient"))
          .enableCompletedDownloadHandling,
        "boolean",
      );
      const jellyfinLogin =
        await native.additional.jellyfinLogin("import-check");
      const jellyfinItems = await native.request(
        "Jellyfin",
        "/Items?Recursive=true&IncludeItemTypes=Movie&AnyProviderIdEquals=Tmdb.42&Fields=ProviderIds&Limit=10",
        {
          headers: {
            Authorization: `MediaBrowser Client="StackPilot", Device="import-check", DeviceId="stackpilot-import-check", Version="0.1.0", Token="${jellyfinLogin.AccessToken}"`,
          },
        },
      );
      assert.ok(Array.isArray(jellyfinItems.Items));
      console.log(
        "Native Quellenbearbeitung, 1080p-Profil, Seerr-Standard und Import-Abfrage geprüft.",
      );
      assert.equal((await hub.library.run(true)).state, "jellyfin");
      let scan;
      for (let attempt = 0; attempt < 60; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        scan = await hub.library.run();
        if (["completed", "failed"].includes(scan.state)) break;
      }
      assert.equal(scan.state, "completed", JSON.stringify(scan));
      console.log(
        "Jellyfin-Scan und anschließender Seerr-Abgleich nativ bestätigt.",
      );
      const requests = await hub.requests();
      assert.equal(requests.results.length, 0);
      console.log(
        "Quellenkatalog und Anfrageübersicht gegen echtes Prowlarr/Seerr geprüft.",
      );
      const denied = await engine.createPlan({
        ...extension.spec,
        selected: [...extension.spec.selected, "qBittorrent"],
        vpn: false,
      });
      assert.equal(denied.executable, false);
      assert.ok(denied.blockers.some((b) => b.includes("Downloads benötigen")));
    } finally {
      if (plan) {
        const file = path.join(
          store.directory,
          "deployments",
          (extension || plan).id,
          "compose.json",
        );
        try {
          await readFile(file);
          await localDocker(["compose", "-f", file, "down"], {
            timeout: 180000,
          });
        } catch (e) {
          console.error("Testressourcen prüfen: " + e.message);
        }
      }
      store.close();
      // The upstream AIO image runs PostgreSQL as its own UID. Restore only
      // this isolated fixture directory's ownership before local cleanup.
      const database = root + "/data-appdata/streamystats/database";
      if (await lstat(database).catch(() => null)) {
        await localDocker([
          "run",
          "--rm",
          "--network",
          "none",
          "--user",
          "0:0",
          "--mount",
          `type=bind,src=${database},dst=/fixture-database`,
          catalog.services.ApiRelay.image,
          "node",
          "-e",
          "const fs=require('node:fs');const visit=p=>{const s=fs.lstatSync(p);if(s.isDirectory())for(const n of fs.readdirSync(p))visit(p+'/'+n);fs.lchownSync(p,Number(process.argv[1]),Number(process.argv[2]));};visit('/fixture-database');",
          String(process.getuid()),
          String(process.getgid()),
        ]);
      }
      await rm(root, { recursive: true });
    }
  },
);
