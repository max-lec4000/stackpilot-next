import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { StateStore } from "./state.js";
import { Vault } from "./vault.js";
import { composeFor, prepareFiles, testHardlinks } from "./provision-files.js";
function plan(root) {
  return {
    id: randomUUID(),
    project: "sp-test",
    uid: 1000,
    gid: 1000,
    spec: {
      selected: ["Jellyfin", "Sonarr", "Prowlarr", "qBittorrent"],
      path: root + "/data",
      username: "admin",
    },
    appdata: root + "/config",
    ports: { Jellyfin: 8096, Sonarr: 8989, Prowlarr: 9696, qBittorrent: 8080 },
  };
}
test("Bootstrap veröffentlicht keine Ports; finaler Plan bindet nur Loopback und mountet keinen Docker-Socket", () => {
  const p = plan("/fixture");
  const initial = composeFor(p, false);
  assert.ok(Object.values(initial.services).every((s) => !s.ports?.length));
  p.images = { Sonarr: "docker.io/example/sonarr@sha256:" + "a".repeat(64) };
  const final = composeFor(p, true);
  assert.equal(final.services.sonarr.image, p.images.Sonarr);
  assert.ok(final.services.sonarr.environment.NO_PROXY.includes("qbittorrent"));
  assert.ok(final.services.sonarr.ports[0].startsWith("127.0.0.1:"));
  assert.ok(
    final.services.jellyfin.volumes.some((v) => v.endsWith(":/data/media:ro")),
  );
  assert.ok(!final.services.prowlarr.volumes.some((v) => v.endsWith(":/data")));
  assert.ok(!JSON.stringify(final).includes("docker.sock"));
  assert.ok(
    Object.values(final.services).every((s) => s.image.includes("@sha256:")),
  );
});
test("Neue Konfiguration ist wiederholbar, schützt fremde Ordner und weist echte Hardlinks nach", async () => {
  const root = await mkdtemp("/tmp/sp-prepare-");
  const store = new StateStore(root + "/state");
  try {
    const vault = new Vault(store);
    const p = plan(root);
    await prepareFiles(p, vault, root + "/manifest");
    const config = p.appdata + "/qbittorrent/qBittorrent/qBittorrent.conf";
    const before = await readFile(config, "utf8");
    await prepareFiles(p, vault, root + "/manifest");
    assert.equal(await readFile(config, "utf8"), before);
    await testHardlinks(p);
    assert.equal((await readdir(p.spec.path + "/media/movies")).length, 0);
    await assert.rejects(
      prepareFiles({ ...p, id: randomUUID() }, vault, root + "/other-manifest"),
    );
  } finally {
    store.close();
    await rm(root, { recursive: true });
  }
});

test("Neue Add-ons erhalten passende persistente Mounts; Streamystats-Geheimnisse bleiben aus Compose entfernt", async () => {
  const root = await mkdtemp("/tmp/sp-addons-");
  const store = new StateStore(root + "/state");
  try {
    const vault = new Vault(store),
      p = plan(root);
    p.spec.selected = [
      "Jellyfin",
      "Sonarr",
      "Radarr",
      "Bazarr",
      "Seerr",
      "Streamystats",
    ];
    p.ports = {
      ...p.ports,
      Radarr: 7878,
      Bazarr: 6767,
      Seerr: 5055,
      Streamystats: 3000,
    };
    await prepareFiles(p, vault, root + "/manifest");
    const config = composeFor(p, false);
    assert.ok(config.services.bazarr.volumes.includes(p.spec.path + ":/data"));
    assert.deepEqual(config.services.seerr.volumes, [
      p.appdata + "/seerr:/app/config",
    ]);
    assert.ok(
      config.services.streamystats.volumes.some((v) =>
        v.endsWith(":/var/lib/postgresql/data"),
      ),
    );
    const secret = vault.get(`deployment:${p.id}:streamystats-runtime`);
    for (const value of Object.values(secret))
      assert.ok(!JSON.stringify(config).includes(value));
    const seed = JSON.parse(
      await readFile(p.appdata + "/bazarr/config/config.yaml", "utf8"),
    );
    assert.equal(seed.auth.type, "form");
    assert.equal(seed.general.auto_update, false);
    assert.notEqual(
      seed.auth.password,
      vault.get(`deployment:${p.id}:bazarr`).password,
    );
    assert.ok(
      (
        await readFile(p.appdata + "/streamystats/runtime.env", "utf8")
      ).includes(secret.sessionSecret),
    );
  } finally {
    store.close();
    await rm(root, { recursive: true });
  }
});
