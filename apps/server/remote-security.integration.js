// Opt-in: isolated Jellyfin and relay, no real server or Tailscale changes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { StateStore } from "./state.js";
import { Vault } from "./vault.js";
import { prepareFiles } from "./provision-files.js";
import { Services } from "./service-api.js";
import { LibrarySync } from "./library-sync.js";
import { localDocker } from "./retirement.js";
import { RemoteSecurity } from "./remote-security.js";
test(
  "Jellyfin: Administrator-Schutz erhält Rechte; Gerätewiderruf macht echtes Zuschauertoken ungültig",
  { timeout: 300000 },
  async () => {
    const dir = await mkdtemp("/tmp/sp-jellyfin-security-"),
      store = new StateStore(dir + "/state"),
      vault = new Vault(store);
    const plan = {
      id: randomUUID(),
      project: "sp-jf-security-" + randomUUID().slice(0, 8),
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
      const hub = {
        engine: { vault },
        context: async () => ({ s, plan }),
        mutate: async (n, fn) => fn(),
      };
      hub.library = new LibrarySync(hub);
      const api = (route, opts) => hub.library.request(s, plan, route, opts);
      const security = new RemoteSecurity(hub, {}, {}, {});
      const info = await api("/System/Info");
      console.log("Jellyfin-Testversion:", info.Version);
      const user = await api("/Users/New", {
        method: "POST",
        body: {
          Name: "fixture-viewer",
          Password: "Fixture-Viewer-2026-Strong!",
        },
      });
      assert.equal(user.Policy.IsAdministrator, false);
      const preview = await security.admins();
      assert.equal(preview.accounts.length, 1);
      const admin = (await api("/Users")).find((u) => u.Policy.IsAdministrator);
      await api("/Users/" + admin.Id + "/Policy", {
        method: "POST",
        body: { ...admin.Policy, EnableContentDeletion: false },
      });
      await assert.rejects(
        () =>
          security.protectAdmins({
            confirmation: "OK",
            review: preview.review,
          }),
        /geändert/,
      );
      const fresh = await security.admins();
      await security.protectAdmins({
        confirmation: "OK",
        review: fresh.review,
      });
      const protectedAdmin = (await api("/Users")).find(
        (u) => u.Id === admin.Id,
      );
      assert.equal(protectedAdmin.Policy.EnableRemoteAccess, false);
      assert.equal(protectedAdmin.Policy.EnableContentDeletion, false);
      const deviceId = "fixture-device-" + randomUUID();
      const auth =
        'MediaBrowser Client="Fixture", Device="Fixture TV", DeviceId="' +
        deviceId +
        '", Version="1.0"';
      const login = await s.request("Jellyfin", "/Users/AuthenticateByName", {
        method: "POST",
        headers: { Authorization: auth },
        body: { Username: "fixture-viewer", Pw: "Fixture-Viewer-2026-Strong!" },
      });
      const viewerHeaders = {
        Authorization: auth + ', Token="' + login.AccessToken + '"',
      };
      await s.request("Jellyfin", "/Users/Me", { headers: viewerHeaders });
      const list = await security.devices();
      const device = list.devices.find((d) =>
        d.users.includes("fixture-viewer"),
      );
      assert.ok(device);
      assert.equal(device.protected, false);
      const adminDevice = list.devices.find((d) => d.protected);
      assert.ok(adminDevice);
      await assert.rejects(
        () => security.revoke({ id: adminDevice.id, confirmation: "OK" }),
        /Administratorkonto/,
      );
      await security.revoke({ id: device.id, confirmation: "OK" });
      await assert.rejects(
        () => s.request("Jellyfin", "/Users/Me", { headers: viewerHeaders }),
        /HTTP 401/,
      );
      console.log(
        "Echter Gerätewiderruf: vorheriges Jellyfin-Token wird nach Abmeldung abgewiesen.",
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
