import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { StateStore } from "./state.js";
import { Vault } from "./vault.js";
import { prepareFiles } from "./provision-files.js";
import { Services } from "./service-api.js";
import { LibrarySync } from "./library-sync.js";
import { localDocker } from "./retirement.js";
import { JellyfinProtection } from "./identity/jellyfin-protection.js";
import { unpackSsoArchive } from "./identity/plugin-archive.js";
import { localIdentityRequest } from "./identity/local-request.js";
test(
  "Jellyfin-Schutz: geprüfte Plugin-Installation, gezielter Neustart, lokales Gateway, Fortsetzung und Manipulationsschutz",
  { timeout: 300000 },
  async () => {
    const root = await mkdtemp("/tmp/sp-protection-"),
      store = new StateStore(root + "/state"),
      vault = new Vault(store);
    const plan = {
      id: randomUUID(),
      project: "sp-protection-" + randomUUID().slice(0, 8),
      uid: process.getuid(),
      gid: process.getgid(),
      spec: {
        selected: ["Jellyfin"],
        path: root + "/data",
        username: "fixture-admin",
        language: "Deutsch",
      },
      appdata: root + "/appdata",
      ports: { Jellyfin: 28096 },
    };
    const manifest = root + "/manifest";
    let protection;
    try {
      const archive = await readFile(
        process.env.STACKPILOT_SSO_ARCHIVE || "/tmp/stackpilot-sso-4.0.0.4.zip",
      );
      assert.equal(Object.keys(unpackSsoArchive(archive)).length, 4);
      const corrupt = Buffer.from(archive);
      corrupt[60] ^= 1;
      assert.throws(() => unpackSsoArchive(corrupt), /SHA-256/);
      await prepareFiles(plan, vault, manifest);
      await localDocker(
        [
          "compose",
          "-f",
          manifest + "/compose.json",
          "up",
          "-d",
          "--pull",
          "never",
        ],
        { timeout: 120000 },
      );
      const relay = (
        await localDocker([
          "ps",
          "-q",
          "--no-trunc",
          "--filter",
          "label=com.docker.compose.project=" + plan.project,
          "--filter",
          "label=com.docker.compose.service=api-relay",
        ])
      ).trim();
      const s = new Services(plan, vault, relay);
      await s.wait("Jellyfin");
      await s.configure("Jellyfin");
      const hub = {
        engine: {
          store,
          vault,
          current: () => ({ plan, job: { status: "completed" } }),
        },
        context: async () => ({ plan, s }),
        mutate: async (n, fn) => fn({ plan, s }),
      };
      hub.library = new LibrarySync(hub);
      const identity = {
        verify: async () => ({
          id: "fixture",
          status: "local-ready",
          rootId: plan.id,
          input: {
            uid: plan.uid,
            gid: plan.gid,
            hostname: "identity.example.ts.net",
          },
        }),
        remote: {
          inspect: async () => ({
            tailscaleRunning: true,
            hostname: "identity.example.ts.net",
            serveKnown: true,
            serve: { exclusive: true, public: false },
            jellyfin: { version: "12.4.0" },
          }),
        },
      };
      protection = new JellyfinProtection(
        hub,
        identity,
        localDocker,
        async () => archive,
      );
      const preview = await protection.preview();
      assert.equal(preview.pluginInstalled, false);
      await assert.rejects(
        protection.start({ review: "stale", confirmation: "OK" }),
        /geändert/,
      );
      await protection.start({ review: preview.review, confirmation: "OK" });
      await protection.pending;
      assert.equal(
        protection.current().status,
        "ready",
        protection.current().error,
      );
      await protection.verify();
      const adminHeader = s.cookies.jellyfin.Authorization;
      const token = adminHeader.match(/Token="([^"]+)"/)[1];
      assert.ok(
        (await hub.library.request(s, plan, "/Users/Me")).Policy
          .IsAdministrator,
      );
      for (const options of [
        { route: "/Users/Me", headers: { Authorization: adminHeader } },
        { route: "/Users/Me?ApiKey=" + token, headers: {} },
        { route: "/Users/Me?aPiKeY=" + token, headers: {} },
      ]) {
        const response = await localIdentityRequest(
          "http://127.0.0.1:19096" + options.route,
          { headers: { Host: "identity.example.ts.net", ...options.headers } },
        );
        await response.arrayBuffer();
        assert.equal(
          response.status,
          403,
          "Administratortoken darf das Gateway nicht passieren",
        );
      }
      const pluginPath =
        plan.appdata + "/jellyfin/plugins/SSO-Auth_4.0.0.4/SSO-Auth.dll";
      const before = await readFile(pluginPath),
        gatewayId = (await protection.verifyContainer(protection.current())).Id;
      const again = await protection.preview();
      await protection.start({ review: again.review, confirmation: "OK" });
      await protection.pending;
      assert.equal(
        protection.current().status,
        "ready",
        protection.current().error,
      );
      assert.deepEqual(await readFile(pluginPath), before);
      assert.equal(
        (await protection.verifyContainer(protection.current())).Id,
        gatewayId,
      );
      const config = protection.current().directory + "/nginx.conf",
        original = await readFile(config);
      await writeFile(
        config,
        Buffer.concat([original, Buffer.from("\n# manual change\n")]),
      );
      assert.equal((await protection.status()).verified, false);
      const changed = await protection.preview();
      await protection.start({ review: changed.review, confirmation: "OK" });
      await protection.pending;
      assert.equal(protection.current().status, "failed");
      assert.match(protection.current().error, /verändert|Überschreibung/);
      assert.match(await readFile(config, "utf8"), /manual change/);
      console.log(
        "Native Plugin-/Gateway-Einrichtung, lokaler Passwortschutz, wiederholter Auftrag und manuelle Dateisperre bestanden.",
      );
    } finally {
      if (protection?.current()?.directory)
        await localDocker(
          [
            "compose",
            "-f",
            protection.current().directory + "/compose.json",
            "down",
          ],
          { timeout: 120000 },
        );
      await localDocker(["compose", "-f", manifest + "/compose.json", "down"], {
        timeout: 120000,
      });
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
