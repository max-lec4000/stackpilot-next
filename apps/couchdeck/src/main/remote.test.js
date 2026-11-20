'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Remote } = require('./remote');
const { testToneWav } = require('./system');

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-remote-'));
  const calls = [];
  const system = {
    listSinks: async () => ({ default: 'hdmi', sinks: [{ name: 'hdmi', description: 'Fernseher', kind: 'monitor' }, { name: 'raop.wiim', description: 'WiiM', kind: 'airplay' }] }),
    getVolume: async () => ({ volume: 40, mute: false }),
    setDefaultSink: async (n) => calls.push(['sink', n]),
    playTestTone: async (n) => calls.push(['tone', n]),
    setVolume: async (v) => { calls.push(['volume', v]); return { volume: v }; },
  };
  let restarted = 0, chosen = null;
  const remote = new Remote({ dir, system, checks: async () => ({ jellyfin: { ok: true } }), restart: () => restarted++, onSinkChosen: (s) => { chosen = s.description; }, version: '0.2.11' });
  const ask = (action, args = {}, extra = {}) => {
    const id = require('crypto').randomUUID();
    fs.writeFileSync(path.join(dir, `request-${id}.json`), JSON.stringify({ id, action, args, at: new Date().toISOString(), ...extra }));
    return id;
  };
  const answer = (id) => JSON.parse(fs.readFileSync(path.join(dir, `response-${id}.json`), 'utf8'));
  return { dir, remote, calls, ask, answer, get restarted() { return restarted; }, get chosen() { return chosen; } };
}

test('Zustandsbericht mit Ausgängen, Lautstärke und Verbindungen', async () => {
  const f = setup();
  await f.remote.tick();
  const st = JSON.parse(fs.readFileSync(path.join(f.dir, 'status.json'), 'utf8'));
  assert.equal(st.version, '0.2.11');
  assert.equal(st.audio.default, 'hdmi');
  assert.equal(st.audio.sinks.length, 2);
  assert.equal(st.audio.volume.volume, 40);
  assert.deepEqual(st.connections, { jellyfin: { ok: true } });
  assert.equal((fs.statSync(path.join(f.dir, 'status.json')).mode & 0o777), 0o660);
});

test('Erlaubte Befehle, nur bekannte Ausgänge, alte und fremde Befehle abgelehnt', async () => {
  const f = setup();
  const a = f.ask('set-sink', { name: 'raop.wiim' }), b = f.ask('tone', { name: 'hdmi' }), c = f.ask('volume', { percent: 55 });
  const d = f.ask('tone', { name: 'erfunden' }), e = f.ask('shell', { cmd: 'rm -rf /' }), g = f.ask('volume', { percent: 500 });
  const old = f.ask('volume', { percent: 10 }, { at: '2020-01-01T00:00:00Z' });
  await f.remote.tick();
  assert.equal(f.answer(a).ok, true); assert.equal(f.chosen, 'WiiM');
  assert.equal(f.answer(b).ok, true); assert.equal(f.answer(c).ok, true);
  assert.deepEqual(f.calls.map(String).sort(), [['sink', 'raop.wiim'], ['tone', 'hdmi'], ['volume', 55]].map(String).sort());
  assert.match(f.answer(d).message, /gibt es gerade nicht/);
  assert.match(f.answer(e).message, /Unbekannter Befehl/);
  assert.match(f.answer(g).message, /0–100/);
  assert.match(f.answer(old).message, /zu alt/);
  assert.ok(!fs.readdirSync(f.dir).some((n) => n.startsWith('request-')), 'Anfragen werden entfernt');
});

test('Neustart erst nach der Antwort', async () => {
  const f = setup();
  const id = f.ask('restart');
  await f.remote.tick();
  assert.equal(f.answer(id).ok, true);
  assert.equal(f.restarted, 0);
  await new Promise((r) => setTimeout(r, 1700));
  assert.equal(f.restarted, 1);
});

test('Testton ist ein gültiges, kurzes WAV', () => {
  const w = testToneWav();
  assert.equal(w.toString('ascii', 0, 4), 'RIFF');
  assert.equal(w.toString('ascii', 8, 12), 'WAVE');
  assert.equal(w.readUInt32LE(24), 44100);
  assert.ok(w.length > 100000 && w.length < 120000);
});
