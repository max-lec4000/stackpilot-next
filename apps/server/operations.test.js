import { test } from "node:test";
import assert from "node:assert/strict";
import { Operations } from "./operations.js";
test("Betriebsübersicht unterscheidet Setup, unbekannte Daten und konkrete nächste Aufgaben", async () => {
  let current = null;
  const hub = {
      engine: { current: () => current },
      context: async () => ({ s: { arr: async () => [] } }),
    },
    activity = {
      get: async () => ({
        vpn: { state: "blocked", reason: "VPN-Nachweis fehlt" },
        downloads: { state: "ready" },
        arr: [{ service: "Radarr", state: "ready" }],
      }),
    },
    ops = new Operations(hub, activity, {
      managed: async () => ({
        services: [{ name: "Radarr", state: "running" }],
      }),
      storage: async () => ({ freeBytes: 0, totalBytes: 100 * 1024 ** 3 }),
    });
  assert.equal((await ops.inspect()).phase, "setup");
  current = {
    job: { status: "completed" },
    plan: {
      spec: { path: "/media", selected: ["Radarr", "qBittorrent", "Prowlarr"] },
    },
  };
  const result = await ops.inspect(true);
  assert.equal(result.phase, "operation");
  assert.equal(result.storage.state, "critical");
  assert.deepEqual(
    result.tasks.map((t) => t.id),
    ["storage", "vpn", "sources"],
  );
  assert.equal(result.applications[0].state, "running");
});

test("Unbekannte Dienstaktivität wird bei laufenden Containern nicht als gesunder Betrieb ausgegeben", async () => {
  const hub = {
      engine: {
        current: () => ({
          job: { status: "completed" },
          plan: { spec: { path: "/data", selected: ["Jellyfin"] } },
        }),
      },
    },
    ops = new Operations(
      hub,
      {
        get: async () => {
          throw Error("offline");
        },
      },
      {
        managed: async () => ({
          services: [{ name: "Jellyfin", state: "running" }],
        }),
        storage: async () => ({
          freeBytes: 100 * 1024 ** 3,
          totalBytes: 1000 * 1024 ** 3,
        }),
      },
    );
  const result = await ops.inspect();
  assert.ok(
    result.tasks.some((t) => t.id === "activity" && t.state === "unknown"),
  );
});

test("System- und Medienspeicher werden auf demselben Dateisystem nur einmal ausgegeben", async () => {
  const gib = 1024 ** 3;
  const root = { device: 2, freeBytes: gib, usedBytes: 99 * gib, totalBytes: 100 * gib };
  let device = 2;
  const ops = new Operations({}, {}, {
    storage: async () => ({ device, freeBytes: 3 * gib, usedBytes: 97 * gib, totalBytes: 100 * gib }),
    systemStorage: async () => root,
  });
  const plan = { spec: { path: "/media" } };
  assert.equal((await ops.storageSummary(plan)).system, null);
  device = 3;
  const disks = await ops.storageSummary(plan);
  assert.equal(disks.shared, false);
  assert.equal(disks.system.state, "warning");
  assert.equal(disks.media.usedBytes, 97 * gib);
});

test("Zuhause: Freigaben, Download-Probleme, angehaltener Client und Docker-Wächter mit direkten Links", async () => {
  const current = { job: { status: "completed" }, plan: { spec: { path: "/media", selected: ["Seerr", "Radarr", "qBittorrent"] } } };
  const hub = { engine: { current: () => current }, context: async () => ({ s: {} }), pendingCount: async () => 3 };
  const activity = { get: async () => ({ vpn: { state: "connected" }, downloads: { state: "unknown" }, arr: [{ service: "Radarr", state: "ready" }] }) };
  const ops = new Operations(hub, activity, {
    managed: async () => ({ services: [] }),
    storage: async () => ({ freeBytes: 500 * 1024 ** 3, totalBytes: 1000 * 1024 ** 3 }),
    systemStorage: async () => ({ freeBytes: 500 * 1024 ** 3, totalBytes: 1000 * 1024 ** 3 }),
  });
  ops.downloadIssues = { list: async () => ({ total: 2, issues: [{ cause: "Nur ein Beispielvideo" }, { cause: "Nur ein Beispielvideo" }] }) };
  ops.dockerGuard = { status: async () => ({ mode: "observe", denied: 1 }) };
  ops.sourceHealth = { read: async () => ({ summary: { blocked: 1 }, sources: [{ name: "Quelle A", state: "blocked" }, { name: "Quelle B", state: "ok" }] }) };
  current.plan.spec.selected.push("Prowlarr");
  hub.context = async () => ({ s: { arr: async () => [{ enable: true }] } });
  const { tasks } = await ops.inspect(true);
  const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));
  assert.ok(!byId.connections, "angehaltenes qBittorrent ist keine allgemeine Verbindungsstörung");
  assert.equal(byId["downloads-stopped"].href, "#/downloads");
  assert.equal(byId.approvals.title, "3 Anfragen warten auf deine Freigabe");
  assert.equal(byId.approvals.href, "#/anfragen");
  assert.equal(byId["download-issues"].title, "2 Downloads brauchen Aufmerksamkeit");
  assert.equal(byId["download-issues"].reason, "Nur ein Beispielvideo.");
  assert.match(byId["docker-guard"].title, /hätte 1 Aufruf gesperrt/);
  assert.equal(byId["sources-failing"].title, "1 Suchquelle fällt aus");
  assert.equal(byId["sources-failing"].href, "#/qualitaet/quellen");
  // Fehler einzelner Prüfungen blenden nur diese aus
  hub.pendingCount = async () => { throw Error("Seerr weg"); };
  ops.dockerGuard = { status: async () => ({ mode: "observe", denied: 0 }) };
  const again = (await ops.inspect(true)).tasks.map((t) => t.id);
  assert.ok(!again.includes("approvals") && !again.includes("docker-guard") && again.includes("download-issues"));
});
