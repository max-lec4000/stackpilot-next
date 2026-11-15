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
