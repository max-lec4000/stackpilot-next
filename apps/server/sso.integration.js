import { test } from "node:test";
import assert from "node:assert/strict";
import { releases } from "./identity/config.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { StateStore } from "./state.js";
import { Vault } from "./vault.js";
import { prepareFiles } from "./provision-files.js";
import { Services } from "./service-api.js";
import { LibrarySync } from "./library-sync.js";
import { localDocker } from "./retirement.js";
test(
  "Offizielles SSO-Plugin lädt unter Jellyfin 12.4 und registriert seine Controller",
  { timeout: 300000 },
  async () => {
    const exec = promisify(execFile);
    const dir = await mkdtemp("/tmp/sp-sso-load-"),
      store = new StateStore(dir + "/state"),
      vault = new Vault(store),
      plan = {
        id: randomUUID(),
        project: "sp-sso-load-" + randomUUID().slice(0, 8),
        uid: process.getuid(),
        gid: process.getgid(),
        spec: {
          selected: ["Jellyfin"],
          path: dir + "/data",
          username: "fixture-admin",
          language: "Deutsch",
        },
        appdata: dir + "/config",
        ports: { Jellyfin: 28096 },
      };
    const manifest = dir + "/manifest";
    try {
      await prepareFiles(plan, vault, manifest);
      const plugin = plan.appdata + "/jellyfin/plugins/SSO-Auth_4.0.0.4";
      await mkdir(plugin, { recursive: true, mode: 0o700 });
      const files = [
        "meta.json",
        "Duende.IdentityModel.dll",
        "SSO-Auth.dll",
        "Duende.IdentityModel.OidcClient.dll",
      ];
      const archive = await readFile(
        process.env.STACKPILOT_SSO_ARCHIVE || "/tmp/stackpilot-sso-4.0.0.4.zip",
      );
      if (
        createHash("sha256").update(archive).digest("hex") !==
        releases.ssoPlugin.sha256
      )
        throw Error("digest");
      for (const f of files) {
        const { stdout } = await exec(
          "unzip",
          [
            "-p",
            process.env.STACKPILOT_SSO_ARCHIVE ||
              "/tmp/stackpilot-sso-4.0.0.4.zip",
            f,
          ],
          { encoding: "buffer", maxBuffer: 1024 * 1024 },
        );
        await writeFile(plugin + "/" + f, stdout, { flag: "wx", mode: 0o600 });
      }
      await localDocker(
        [
          "compose",
          "-f",
          manifest + "/bootstrap.json",
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
      const hub = {};
      hub.library = new LibrarySync(hub);
      const info = await hub.library.request(s, plan, "/System/Info");
      const plugins = await hub.library.request(s, plan, "/Plugins");
      assert.equal(info.Version, "12.4.0");
      const installed = plugins.filter(
        (p) =>
          p.Id.replaceAll("-", "").toLowerCase() ===
          releases.ssoPlugin.id.replaceAll("-", ""),
      );
      assert.equal(installed.length, 1);
      assert.equal(installed[0].Status, "Active");
      assert.equal(installed[0].Version, releases.ssoPlugin.version);
      const names = await hub.library.request(s, plan, "/sso/OID/GetNames");
      assert.ok(Array.isArray(names));
      assert.equal(names.length, 0);
      console.log(
        "SSO 4.0.0.4: Active; Controller antwortet; vollständige Anmeldung separat prüfen.",
      );
    } finally {
      await localDocker(["compose", "-f", manifest + "/compose.json", "down"], {
        timeout: 120000,
      });
      store.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
