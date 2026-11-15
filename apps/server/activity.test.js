import { test } from "node:test";
import assert from "node:assert/strict";
import { ActivityMonitor, sessionSummary, torrentSummary } from "./activity.js";
test("Aktivitätsdaten enthalten nur benötigte Felder, keine Tokens, IP-Adressen, Pfade oder Tracker-Zugänge", () => {
  const session = sessionSummary({
    Id: "device",
    UserName: "Max",
    DeviceName: "TV",
    AccessToken: "secret-token",
    RemoteEndPoint: "private-ip",
    NowPlayingItem: { Name: "Film", Path: "/private/file", RunTimeTicks: 100 },
    PlayState: { PositionTicks: 50 },
  });
  assert.equal(session.progress, 0.5);
  assert.ok(!JSON.stringify(session).includes("secret"));
  assert.ok(!JSON.stringify(session).includes("/private"));
  const torrent = torrentSummary({
    hash: "a".repeat(40),
    name: "Film",
    progress: 4,
    tracker: "https://tracker/?passkey=secret",
    save_path: "/private",
  });
  assert.equal(torrent.progress, 1);
  assert.ok(!JSON.stringify(torrent).includes("secret"));
  assert.ok(!JSON.stringify(torrent).includes("/private"));
  assert.equal(
    sessionSummary({
      Client: "StackPilot",
      UserName: "admin",
      DeviceName: "API",
      IsActive: true,
    }),
    null,
  );
});
test("Nicht erreichbare Apps werden als unbekannt gemeldet; bestehende Warteschlangen werden nicht als leer ausgegeben", async () => {
  const plan = {
    id: "fixture",
    spec: { selected: ["Jellyfin", "Sonarr", "qBittorrent"] },
  };
  const engine = {
    current: () => ({ plan, job: { status: "completed" } }),
    relay: async () => {
      throw Error("unavailable");
    },
  };
  const result = await new ActivityMonitor(engine, {
    status: { state: "blocked" },
  }).get();
  assert.equal(result.jellyfin.state, "unavailable");
  assert.equal(result.downloads.state, "unavailable");
  assert.equal(result.arr[0].queued, null);
});
test("Echte API-Ergebnisse liefern Wiedergaben, getrennte ARR-Zähler und qBittorrent-Transfers", async () => {
  const plan = {
    id: "fixture",
    spec: { selected: ["Jellyfin", "Sonarr", "Radarr", "qBittorrent"] },
  };
  const services = {
    additional: { jellyfinLogin: async () => ({ AccessToken: "hidden" }) },
    request: async () => [
      {
        Id: "1",
        UserName: "Max",
        DeviceName: "TV",
        NowPlayingItem: { Name: "Film", RunTimeTicks: 100 },
        PlayState: { PositionTicks: 25 },
      },
    ],
    qbit: async (route) =>
      route.includes("torrents")
        ? [
            {
              name: "Film",
              hash: "a".repeat(40),
              progress: 0.5,
              state: "queuedDL",
            },
          ]
        : { dl_info_speed: 1000, up_info_speed: 200 },
    arr: async (name) => ({ totalRecords: name === "Sonarr" ? 7 : 2 }),
  };
  const result = await new ActivityMonitor(
    {
      current: () => ({ plan, job: { status: "completed" } }),
      relay: async () => "relay",
    },
    { status: { state: "connected" } },
    { services: () => services },
  ).get();
  assert.equal(result.jellyfin.sessions[0].title, "Film");
  assert.equal(result.downloads.queued, 1);
  assert.equal(result.downloads.downloadRate, 1000);
  assert.deepEqual(
    result.arr.map((a) => a.queued),
    [2, 7],
  );
  assert.ok(!JSON.stringify(result).includes("hidden"));
});

test("Der aktuelle Stack bleibt nach mehr als dreißig anderen Aufträgen auffindbar", async () => {
  const { StateStore } = await import("./state.js");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const dir = await mkdtemp("/tmp/sp-current-stack-");
  const store = new StateStore(dir);
  try {
    store.createOperation({
      id: "deployment",
      planId: "stack-plan",
      kind: "deployment",
      status: "completed",
    });
    for (let i = 0; i < 35; i++)
      store.createOperation({
        id: "retirement-" + i,
        planId: "plan-" + i,
        kind: "retirement",
        status: "completed",
      });
    assert.ok(!store.operations().some((j) => j.id === "deployment"));
    assert.equal(store.latestDeployment().id, "deployment");
  } finally {
    store.close();
    await rm(dir, { recursive: true });
  }
});
