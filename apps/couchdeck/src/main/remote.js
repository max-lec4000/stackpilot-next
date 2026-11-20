'use strict';
// Fernsteuerung und Diagnose durch StackPilot (Phase 7.6) über den gemeinsamen Steuerordner
// (/var/lib/couchdeck/control, Gruppe couchdeck-link):
//   status.json            – schreibt Couchdeck alle 15 s (Audioausgänge, Lautstärke, Verbindungen)
//   request-<uuid>.json    – legt StackPilot an: { id, action, args, at }
//   response-<uuid>.json   – Antwort von Couchdeck: { id, ok, message, data, at }
// Nur fest erlaubte Befehle; Ausgänge nur aus der aktuellen Liste; nichts wird ausgeführt,
// was nicht hier steht.
const fs = require('fs');
const path = require('path');

const ACTIONS = new Set(['set-sink', 'tone', 'volume', 'restart', 'check']);
const ID = /^[a-f0-9-]{36}$/;
const MAX_AGE_MS = 2 * 60 * 1000;

class Remote {
  constructor({ dir, system, checks, restart, log = () => {}, version = null, onSinkChosen = () => {}, now = () => Date.now() }) {
    Object.assign(this, { dir, system, checks, restart, log, version, onSinkChosen, now });
    this.startedAt = now();
    this.lastStatus = 0;
    this.checkCache = null;
    this.busy = false;
  }
  start(intervalMs = 3000) {
    this.timer = setInterval(() => { this.tick().catch(() => {}); }, intervalMs);
    this.timer.unref?.();
    this.tick().catch(() => {});
  }
  stop() { clearInterval(this.timer); }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const handled = await this.processRequests();
      if (handled || this.now() - this.lastStatus > 15000) await this.writeStatus();
    } finally { this.busy = false; }
  }

  async connectionChecks(force = false) {
    if (!force && this.checkCache && this.now() - this.checkCache.at < 60000) return this.checkCache.value;
    let value;
    try { value = await this.checks(); } catch (e) { value = { error: String(e.message || e).slice(0, 200) }; }
    this.checkCache = { at: this.now(), value };
    return value;
  }

  async snapshot(force = false) {
    const [audio, volume, connections] = await Promise.all([
      this.system.listSinks().catch(() => ({ sinks: [], default: null })),
      this.system.getVolume().catch(() => null),
      this.connectionChecks(force),
    ]);
    return {
      at: new Date(this.now()).toISOString(),
      version: this.version,
      uptimeSeconds: Math.round((this.now() - this.startedAt) / 1000),
      audio: { default: audio.default, sinks: (audio.sinks || []).slice(0, 30), volume },
      connections,
    };
  }

  write(name, value) {
    const file = path.join(this.dir, name), tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(value), { mode: 0o660 });
    try { fs.chmodSync(tmp, 0o660); } catch { /* egal */ }
    fs.renameSync(tmp, file);
  }

  async writeStatus(force = false) {
    this.write('status.json', await this.snapshot(force));
    this.lastStatus = this.now();
  }

  async processRequests() {
    let names;
    try { names = fs.readdirSync(this.dir); } catch { return 0; }
    let handled = 0;
    for (const name of names) {
      const m = /^request-([a-f0-9-]{36})\.json$/.exec(name);
      if (!m) continue;
      const file = path.join(this.dir, name);
      let req = null;
      try { req = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* unlesbar */ }
      try { fs.unlinkSync(file); } catch { continue; } // schon von jemand anderem genommen
      if (!req || req.id !== m[1]) continue;
      handled++;
      let response;
      try {
        if (!ID.test(req.id) || !ACTIONS.has(req.action)) throw new Error('Unbekannter Befehl.');
        if (!(Math.abs(this.now() - Date.parse(req.at)) < MAX_AGE_MS)) throw new Error('Befehl ist zu alt.');
        response = { ok: true, ...(await this.handle(req.action, req.args || {})) };
      } catch (e) {
        response = { ok: false, message: String(e.message || e).slice(0, 300) };
      }
      this.write(`response-${req.id}.json`, { id: req.id, at: new Date(this.now()).toISOString(), ...response });
      this.log(`StackPilot: ${req.action} → ${response.ok ? 'ok' : response.message}`);
      if (response.ok && req.action === 'restart') setTimeout(() => this.restart(), 1500);
    }
    return handled;
  }

  async sink(name) {
    const { sinks } = await this.system.listSinks();
    const s = (sinks || []).find((x) => x.name === name);
    if (!s) throw new Error('Diesen Audioausgang gibt es gerade nicht.');
    return s;
  }

  async handle(action, args) {
    if (action === 'set-sink') {
      const s = await this.sink(args.name);
      await this.system.setDefaultSink(s.name);
      this.onSinkChosen(s);
      return { message: `Ton kommt jetzt über „${s.description}“.` };
    }
    if (action === 'tone') {
      const s = await this.sink(args.name);
      await this.system.playTestTone(s.name);
      return { message: `Testton über „${s.description}“ abgespielt.` };
    }
    if (action === 'volume') {
      const v = Number(args.percent);
      if (!Number.isInteger(v) || v < 0 || v > 100) throw new Error('Lautstärke 0–100.');
      const r = await this.system.setVolume(v);
      return { message: `Lautstärke ${r?.volume ?? v} %.` };
    }
    if (action === 'restart') return { message: 'Couchdeck startet neu.' };
    // check: Verbindungen sofort neu prüfen
    return { message: 'Geprüft.', data: await this.snapshot(true) };
  }
}

module.exports = { Remote, ACTIONS };
