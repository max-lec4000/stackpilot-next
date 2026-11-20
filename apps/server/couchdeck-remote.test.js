import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { Couchdeck } from "./couchdeck.js";

const require = createRequire(import.meta.url);
const { Remote } = require("../couchdeck/src/main/remote.js");

function setup() {
  const linkDir = mkdtempSync(path.join(tmpdir(), "sp-cd-"));
  const dir = path.join(linkDir, "control");
  mkdirSync(dir);
  const calls = [];
  const system = {
    listSinks: async () => ({ default: "hdmi", sinks: [{ name: "hdmi", description: "Fernseher", kind: "monitor" }, { name: "bluez.box", description: "Box", kind: "bluetooth" }] }),
    getVolume: async () => ({ volume: 35, mute: false }),
    setDefaultSink: async (n) => calls.push(["sink", n]),
    playTestTone: async (n) => calls.push(["tone", n]),
    setVolume: async (v) => { calls.push(["volume", v]); return { volume: v }; },
  };
  const remote = new Remote({ dir, system, checks: async () => ({ jellyfin: { ok: true, user: "wohnzimmer", ms: 12, signedIn: true }, seerr: { ok: false, error: "Nicht verbunden" }, youtube: { available: true }, player: { active: false } }), restart: () => calls.push(["restart"]), version: "0.2.11" });
  const couchdeck = new Couchdeck({}, { linkDir, systemctl: async () => ({ ok: false }) });
  return { linkDir, dir, remote, couchdeck, calls };
}

test("Couchdeck-Fernsteuerung: Zustand lesen, Befehle hin und zurück", async () => {
  const f = setup();
  const timer = setInterval(() => void f.remote.tick(), 100);
  try {
    assert.equal((await f.couchdeck.remoteStatus()).live, false, "ohne Bericht nicht live");
    await assert.rejects(f.couchdeck.remoteCommand("tone", { name: "hdmi" }), /läuft gerade nicht/);
    await f.remote.tick();
    const st = await f.couchdeck.remoteStatus();
    assert.equal(st.live, true);
    assert.equal(st.version, "0.2.11");
    assert.equal(st.audio.default, "hdmi");
    assert.equal(st.audio.volume, 35);
    assert.deepEqual(st.connections.jellyfin, { ok: true, error: null, user: "wohnzimmer", ms: 12, signedIn: true });
    assert.equal(st.connections.seerr.ok, false);
    const opts = { pollMs: 50 };
    assert.match((await f.couchdeck.remoteCommand("set-sink", { name: "bluez.box" }, opts)).message, /Box/);
    assert.match((await f.couchdeck.remoteCommand("tone", { name: "hdmi" }, opts)).message, /Testton/);
    await assert.rejects(f.couchdeck.remoteCommand("tone", { name: "gibtsnicht" }, opts), /gibt es gerade nicht/);
    await assert.rejects(f.couchdeck.remoteCommand("shell", {}, opts), /Unbekannter Befehl/);
    assert.deepEqual(f.calls, [["sink", "bluez.box"], ["tone", "hdmi"]]);
  } finally { clearInterval(timer); rmSync(f.linkDir, { recursive: true, force: true }); }
});

test("Couchdeck-Fernsteuerung: veralteter Bericht gilt nicht als live, keine Antwort → Fehler", async () => {
  const f = setup();
  try {
    writeFileSync(path.join(f.dir, "status.json"), JSON.stringify({ at: new Date(Date.now() - 5 * 60000).toISOString() }));
    assert.equal((await f.couchdeck.remoteStatus()).live, false);
    writeFileSync(path.join(f.dir, "status.json"), JSON.stringify({ at: new Date().toISOString() }));
    await assert.rejects(f.couchdeck.remoteCommand("check", {}, { timeoutMs: 300, pollMs: 50 }), /nicht geantwortet/);
  } finally { rmSync(f.linkDir, { recursive: true, force: true }); }
});
