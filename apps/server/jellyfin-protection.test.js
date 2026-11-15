import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, chmod, rm } from "node:fs/promises";
import {
  safeDirectory,
  protectionCompose,
  mediaGatewayConfig,
} from "./identity/jellyfin-protection.js";
import { unpackSsoArchive } from "./identity/plugin-archive.js";
import { releases } from "./identity/config.js";
test("SSO-Archiv verweigert falschen Digest vor jeder Extraktion", () => {
  for (const data of [
    Buffer.alloc(22),
    Buffer.alloc(9 * 1024 * 1024),
    Buffer.from("not a zip"),
  ])
    assert.throws(() => unpackSsoArchive(data), /SHA-256/);
});
test("Plugin-Pfade akzeptieren keine Links oder fremd beschreibbaren Verzeichnisse", async () => {
  const root = await mkdtemp("/tmp/sp-safe-plugin-");
  try {
    await mkdir(root + "/real", { mode: 0o700 });
    await safeDirectory(root + "/real", process.getuid());
    await symlink(root + "/real", root + "/link");
    await assert.rejects(
      safeDirectory(root + "/link", process.getuid()),
      /Links/,
    );
    await chmod(root + "/real", 0o777);
    await assert.rejects(
      safeDirectory(root + "/real", process.getuid()),
      /Schreibrechte/,
    );
    await assert.rejects(safeDirectory(root, 0), /Besitzer/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("Gateway-Konfiguration exponiert weder Docker noch Daten und bindet ausschließlich Loopback", () => {
  const r = {
    id: "fixture",
    rootId: "root",
    project: "fixture",
    directory: "/private/gateway",
    uid: 1000,
    gid: 1000,
    network: "media_default",
  };
  const c = protectionCompose(r),
    s = c.services.gateway;
  assert.equal(s.image, releases.gateway.image);
  assert.deepEqual(s.ports, ["127.0.0.1:19096:8081"]);
  assert.equal(s.read_only, true);
  assert.deepEqual(s.cap_drop, ["ALL"]);
  assert.equal(s.volumes.length, 1);
  assert.equal(
    s.volumes[0],
    "/private/gateway/nginx.conf:/etc/nginx/nginx.conf:ro",
  );
  assert.deepEqual(c.networks.media, { external: true, name: "media_default" });
  assert.doesNotMatch(
    JSON.stringify(c),
    /docker.sock|\/data\/media|secret_key/,
  );
  assert.match(
    mediaGatewayConfig({
      hostname: "media.example.ts.net",
      uid: 1000,
      gid: 1000,
    }),
    /access_log off/,
  );
});

test("Jellyfin darf Anzeigenamen/Status normalisieren, aber keine Updates oder andere Assemblies aktivieren", async () => {
  const { validMetadata } = await import("./identity/jellyfin-protection.js");
  const expected = {
    guid: releases.ssoPlugin.id,
    version: releases.ssoPlugin.version,
    name: "SSO Authentication",
    description: "Official description",
    timestamp: "2026-03-20T03:13:59Z",
    status: "Active",
    autoUpdate: false,
    assemblies: ["SSO-Auth.dll"],
  };
  const normal = {
    ...expected,
    name: "SSO-Auth",
    description: "",
    timestamp: "2026-03-20T03:13:59.0000000Z",
  };
  const bytes = (v) => Buffer.from(JSON.stringify(v));
  assert.equal(validMetadata(bytes(normal), expected), true);
  for (const modified of [
    { ...normal, autoUpdate: true },
    { ...normal, status: "Disabled" },
    { ...normal, assemblies: ["../other.dll"] },
    { ...normal, guid: "other" },
    { ...normal, imagePath: "/etc/passwd" },
    { ...normal, unexpected: "value" },
  ])
    assert.equal(validMetadata(bytes(modified), expected), false);
});

test("Ein Auftrag ohne lebende Sperre wird nach Prozessneustart als unterbrochen angezeigt", async () => {
  const { JellyfinProtection } = await import(
    "./identity/jellyfin-protection.js"
  );
  const service = new JellyfinProtection(
    { engine: { store: { owns: () => false } } },
    {},
  );
  const record = {
    status: "running",
    owner: "old-process",
    stage: "Plugin prüfen",
  };
  assert.equal(service.summary(record).status, "interrupted");
  assert.equal(service.summary(record).running, false);
  service.pending = Promise.resolve();
  assert.equal(service.summary(record).running, true);
});

test("Verlorene Auftragssperre verhindert Provisionierung und das Überschreiben fremder Fortschritte", async () => {
  const { JellyfinProtection } = await import(
    "./identity/jellyfin-protection.js"
  );
  const values = new Map([
      [
        "jellyfin-protection:root",
        { id: "existing", status: "running", stage: "other owner" },
      ],
    ]),
    calls = [];
  const hub = {
    engine: {
      store: { owns: () => false },
      vault: { set: (key, value) => values.set(key, value) },
    },
    mutate: async (names, fn) => fn({ leaseOwner: "expired" }),
  };
  const service = new JellyfinProtection(
    hub,
    {},
    async (...args) => {
      calls.push(args);
    },
    async () => assert.fail("No download after lease loss"),
  );
  service.context = async () => ({ plan: { id: "root" }, review: "review" });
  await assert.rejects(service.run("review"), /Auftragssperre/);
  assert.equal(calls.length, 0);
  assert.deepEqual(values.get("jellyfin-protection:root"), {
    id: "existing",
    status: "running",
    stage: "other owner",
  });
  assert.throws(
    () => service.save({ id: "root" }, { owner: "expired", stage: "stale" }),
    /Auftragssperre/,
  );
});
