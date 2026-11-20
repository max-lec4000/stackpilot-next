import { test } from "node:test";
import assert from "node:assert/strict";
import { Playback, projectSession } from "./playback.js";

const plan = { id: "p", spec: { selected: ["Jellyfin"] } };
const session = (over = {}) => ({
  Id: "abc123def456", UserName: "familie", DeviceName: "Wohnzimmer-TV", Client: "Jellyfin Android TV", RemoteEndPoint: "10.1.2.3",
  NowPlayingItem: { Type: "Episode", SeriesName: "Serie", Name: "Pilot", ParentIndexNumber: 1, IndexNumber: 2, RunTimeTicks: 36000000000 },
  PlayState: { PositionTicks: 9000000000, IsPaused: false, PlayMethod: "Transcode" },
  TranscodingInfo: { VideoCodec: "h264", AudioCodec: "aac", Bitrate: 8123456, Height: 1080, IsVideoDirect: false, TranscodeReasons: ["SubtitleCodecNotSupported", "Neu"] },
  ...over,
});

test("Wiedergabe darstellen: Art, Grund, ohne IP", () => {
  const r = projectSession(session());
  assert.equal(r.title, "Serie · S01E02 · Pilot");
  assert.deepEqual([r.method, r.position, r.duration, r.progress], ["transcode", "15:00", "1:00:00", 0.25]);
  assert.deepEqual(r.reasons.map((x) => x.label), ["Untertitel werden ins Bild eingebrannt", "Neu"]);
  assert.equal(r.transcode.bitrateMbit, 8.1);
  assert.ok(!JSON.stringify(r).includes("10.1.2.3"));
  assert.equal(projectSession(session({ PlayState: { PlayMethod: "DirectPlay" }, TranscodingInfo: null })).method, "direct");
  assert.equal(projectSession(session({ TranscodingInfo: { IsVideoDirect: true } })).method, "remux");
  assert.equal(projectSession({ Id: "x" }), null, "ohne Wiedergabe");
});

function setup() {
  let config = { RemoteClientBitrateLimit: 0, Other: 1 };
  const calls = [];
  const hub = {
    engine: { current: () => ({ job: { status: "completed" }, plan }) },
    context: async () => ({ s: {}, plan }), mutate: async (_n, fn) => fn(),
    library: { request: async (_s, _p, route, o = {}) => {
      calls.push([o.method || "GET", route]);
      if (route.startsWith("/Sessions") && !o.method) return [session(), { Id: "idle" }];
      if (route === "/System/Configuration" && o.method === "POST") { config = o.body; return null; }
      if (route === "/System/Configuration") return structuredClone(config);
      if (route === "/System/Configuration/encoding") return { HardwareAccelerationType: "vaapi" };
      return null;
    } },
  };
  return { p: new Playback(hub), calls, config: () => config };
}

test("Liste, beenden, Grenze für unterwegs", async () => {
  const { p, calls, config } = setup();
  const r = await p.read();
  assert.deepEqual([r.sessions.length, r.transcoding, r.remoteLimitMbit, r.hardware], [1, 1, 0, "vaapi"]);
  await assert.rejects(p.stop({ id: "abc123def456" }), /mit OK/);
  await assert.rejects(p.stop({ id: "ffffffff", confirmation: "OK" }), /läuft nicht mehr/);
  const s = await p.stop({ id: "abc123def456", confirmation: "OK" });
  assert.match(s.message, /Wohnzimmer-TV/);
  assert.deepEqual(calls.at(-1), ["POST", "/Sessions/abc123def456/Playing/Stop"]);
  await assert.rejects(p.setLimit({ mbit: 7, confirmation: "OK" }), /Ungültige Bitrate/);
  const l = await p.setLimit({ mbit: 15, confirmation: "OK" });
  assert.equal(l.remoteLimitMbit, 15);
  assert.deepEqual(config(), { RemoteClientBitrateLimit: 15000000, Other: 1 }, "übrige Einstellungen bleiben");
});
