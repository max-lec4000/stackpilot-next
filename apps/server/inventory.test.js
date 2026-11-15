import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, rm } from "node:fs/promises";
import os from "node:os";
import {
  classifyContainer,
  flattenMounts,
  inspectPath,
  inventory,
  validatePath,
} from "./inventory.js";
import { retirementCandidates } from "./system-details.js";
import { StateStore } from "./state.js";
import { inventoryMiddleware } from "./middleware.js";
test("Containererkennung behandelt nur Wortgrenzen und bleibt beobachtend", () => {
  assert.equal(
    classifyContainer({ Names: "my-sonarr-1", Image: "linuxserver/sonarr" })
      .component,
    "sonarr",
  );
  assert.equal(
    classifyContainer({ Names: "notsonarr", Image: "custom" }).component,
    null,
  );
  assert.equal(
    classifyContainer({ Names: "radarr", Image: "radarr" }).mode,
    "observed",
  );
});
test("Mounts verschachtelt und fehlende Tools werden sichtbar", async () => {
  assert.equal(
    flattenMounts([{ target: "/", children: [{ target: "/data" }] }]).length,
    2,
  );
  const i = await inventory(async () => ({
    ok: false,
    reason: "Nicht installiert",
  }));
  assert.equal(i.docker.available, false);
  assert.ok(i.issues.length >= 3);
});
test("Docker-Inventar exportiert keine zusätzlichen Geheimnisfelder", async () => {
  const i = await inventory(async (bin, args) =>
    bin === "docker" && args[0] === "ps"
      ? {
          ok: true,
          output: JSON.stringify({
            ID: "1",
            Names: "sonarr",
            Image: "sonarr",
            Env: ["SECRET=private"],
            State: "running",
          }),
        }
      : { ok: false, reason: "Test" },
  );
  assert.equal(i.containers[0].component, "sonarr");
  assert.ok(!JSON.stringify(i).includes("SECRET"));
});
test("Pfadprüfung ist lesend und weist Systempfade ab", async () => {
  const root = await mkdtemp(os.tmpdir() + "/stackpilot-test-");
  try {
    const p = await inspectPath(root + "/missing/data");
    assert.equal(p.exists, false);
    assert.equal(p.existingParent, root);
    assert.ok(p.freeBytes > 0);
    await assert.rejects(inspectPath("/etc/stackpilot"));
    await mkdir(root + "/existing");
    assert.equal((await inspectPath(root + "/existing")).exists, true);
    await symlink("/etc", root + "/link");
    await assert.rejects(inspectPath(root + "/link/data"));
    for (const s of ["/", "/srv/../etc", "relative", "/proc/1"])
      assert.equal(validatePath(s), false);
  } finally {
    await rm(root, { recursive: true });
  }
});
test("API lehnt Schreibzugriffe und fremde Ursprünge ab", async () => {
  const dir = await mkdtemp(os.tmpdir() + "/sp-api-test-");
  const store = new StateStore(dir);
  try {
    const api = inventoryMiddleware({ store });
    for (const req of [
      ...[
        "/api/media/search?q=test",
        "/api/media/archive",
        "/api/media/request-action?requestId=1",
        "/api/media/size-settings",
        "/api/audit",
        "/api/development/report",
        "/api/development/status",
        "/api/remote-access/connection",
        "/api/remote-access/journey",
        "/api/operations/overview",
        "/api/media/detail?type=movie&id=1",
        "/api/media/requests",
        "/api/remote-access",
        "/api/remote-access/identity",
        "/api/remote-access/sso",
        "/api/remote-access/protection",
        "/api/remote-access/protection/preview",
        "/api/remote-access/private-serve",
        "/api/remote-access/funnel",
        "/api/remote-access/backups",
        "/api/remote-access/admins",
        "/api/remote-access/devices",
        "/api/downloads/list?page=1",
        "/api/media/diagnosis?requestId=1",
        "/api/media/quality?requestId=1",
        "/api/sources/detail?id=1",
        "/api/media/poster?path=/test.jpg",
        "/api/sources",
        "/api/safety",
      ].map((url) => ({
        url,
        method: "GET",
        headers: { host: "localhost:5173" },
      })),
      ...[
        "/api/development/report/publish",
        "/api/development/consent",
        "/api/media/request",
        "/api/media/request/archive",
        "/api/media/request/cancel",
        "/api/media/size-settings",
        "/api/remote-access/identity/prepare",
        "/api/remote-access/sso/apply",
        "/api/remote-access/protection/start",
        "/api/remote-access/private-serve/apply",
        "/api/remote-access/backup/create",
        "/api/remote-access/backup/test",
        "/api/remote-access/backup/download",
        "/api/remote-access/backup/resume",
        "/api/remote-access/admins/protect",
        "/api/remote-access/devices/revoke",
        "/api/remote-access/funnel-plan",
        "/api/remote-access/funnel/enable",
        "/api/remote-access/funnel/disable",
        "/api/remote-access/identity/start",
        "/api/remote-access/identity/check",
        "/api/remote-access/identity/credentials",
        "/api/media/movie-removal/preview",
        "/api/media/movie-removal/execute",
        "/api/media/library/refresh",
        "/api/media/research",
        "/api/media/quality",
        "/api/media/releases",
        "/api/sources/save",
        "/api/safety/start",
        "/api/downloads/action",
      ].map((url) => ({
        url,
        method: "POST",
        headers: { host: "localhost:5173" },
      })),
      {
        url: "/api/inventory",
        method: "POST",
        headers: { host: "localhost:5173" },
      },
      {
        url: "/api/inventory",
        method: "GET",
        headers: { host: "evil.example" },
      },
      {
        url: "/api/inventory",
        method: "GET",
        headers: { host: "localhost:5173", origin: "https://evil.example" },
      },
    ]) {
      let status;
      const res = {
        setHeader() {},
        writeHead(s) {
          status = s;
        },
        end() {},
      };
      await api(req, res, () => assert.fail("Unexpected next"));
      assert.ok([401, 403, 405].includes(status));
    }
  } finally {
    store.close();
    await rm(dir, { recursive: true });
  }
});
test("Docker-NAT-Ports werden auch ohne sichtbaren Host-Socket berücksichtigt", async () => {
  const i = await inventory(async (bin, args) =>
    bin === "docker" && args[0] === "ps"
      ? {
          ok: true,
          output: JSON.stringify({
            ID: "1",
            Names: "old-sonarr",
            Image: "sonarr",
            Ports: "0.0.0.0:8989->8989/tcp, [::]:8989->8989/tcp",
            State: "running",
          }),
        }
      : { ok: false, reason: "Test" },
  );
  assert.ok(i.listening.includes("docker:8989"));
  assert.equal(i.listening.filter((s) => s === "docker:8989").length, 1);
});

test("Eigene verwaltete Container werden nicht als Altinstallationen zur Ablösung vorgeschlagen", () => {
  const result = retirementCandidates({
    containers: [
      {
        ID: "own",
        Names: "stackpilot-sonarr-1",
        component: "sonarr",
        project: "stackpilot",
      },
      {
        ID: "owned-other",
        Names: "managed-radarr",
        component: "radarr",
        project: "other",
        managed: true,
      },
      {
        ID: "foreign",
        Names: "old-sonarr",
        component: "sonarr",
        project: "old",
      },
    ],
  });
  assert.deepEqual(
    result.containers.map((c) => c.id),
    ["foreign"],
  );
});
