'use strict';
// Wiedergabe über mpv (JSON-IPC). Kümmert sich um Warteschlange, Fortschritts-
// meldungen an Jellyfin, Spur-Zuordnung, Intro/Abspann-Segmente und Autoplay.
const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const net = require('net');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { TICKS } = require('./jellyfin');
const sound = require('./sound');
const config = require('./config');
const { HlsTrimmer } = require('./hls');

const runtimeDir = process.env.XDG_RUNTIME_DIR || os.tmpdir();
const SOCKET = path.join(runtimeDir, `couchdeck-mpv-${process.pid}.sock`);
const INPUT_CONF = path.join(__dirname, '..', '..', 'deploy', 'mpv-input.conf');
const OSC_SCRIPT = path.join(__dirname, '..', '..', 'deploy', 'couchdeck_osc.lua');

class Mpv extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.sock = null;
    this.reqId = 0;
    this.pending = new Map();
    this.buf = '';
  }

  async start() {
    if (this.proc) return;
    try { fs.unlinkSync(SOCKET); } catch { /* nicht vorhanden */ }
    const p = config.get().player;
    const args = [
      '--idle=yes', '--force-window=no', '--keep-open=no',
      `--input-ipc-server=${SOCKET}`,
      '--fullscreen', '--quiet', '--msg-level=all=warn,ytdl_hook=warn', '--term-osd=no', '--term-status-msg=', '--osd-level=1', '--osd-bar=no', // keine zweite (weiße) Fortschrittsleiste
      `--hwdec=${p.hwdec}`, '--vo=gpu', '--ao=pipewire,pulse,alsa',
      '--cache=yes', '--demuxer-max-bytes=300MiB', '--demuxer-readahead-secs=30',
      '--sub-auto=no', '--audio-file-auto=no', '--volume-max=100',
      '--title=Couchdeck Player', '--wayland-app-id=couchdeck-player',
      `--input-conf=${INPUT_CONF}`,
      // Keine mpv-Standardtasten: sonst gäbe es eine zweite, eigene mpv-Lautstärke (9/0, Lautstärketasten …)
      '--input-default-bindings=no', '--volume=100',
      '--osc=no', `--script=${OSC_SCRIPT}`, // eigene Bedienleiste statt Standard-OSC
      '--osd-font-size=42', '--osd-duration=2500', '--sub-font-size=46',
      ...(this.extra || []), // z. B. yt-dlp-Einstellungen für YouTube
      ...(p.extraArgs || []),
    ];
    this.proc = spawn('mpv', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc.stdout.on('data', (d) => this.emit('log', d.toString().trim()));
    this.proc.stderr.on('data', (d) => this.emit('log', d.toString().trim()));
    this.proc.on('exit', (code) => {
      this.emit('log', `mpv beendet (${code})`);
      this.proc = null;
      this.sock = null;
      for (const { reject } of this.pending.values()) reject(new Error('mpv beendet'));
      this.pending.clear();
      this.emit('exit');
    });
    this.proc.on('error', (e) => this.emit('log', 'mpv-Start fehlgeschlagen: ' + e.message));
    await this.connect();
  }

  async connect() {
    for (let i = 0; i < 50; i++) {
      try {
        await new Promise((resolve, reject) => {
          const s = net.createConnection(SOCKET);
          s.once('connect', () => { this.sock = s; resolve(); });
          s.once('error', reject);
        });
        break;
      } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    if (!this.sock) throw new Error('mpv-IPC nicht erreichbar');
    this.sock.setEncoding('utf8');
    this.sock.on('data', (chunk) => {
      this.buf += chunk;
      let idx;
      while ((idx = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, idx);
        this.buf = this.buf.slice(idx + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.request_id && this.pending.has(msg.request_id)) {
          const { resolve, reject } = this.pending.get(msg.request_id);
          this.pending.delete(msg.request_id);
          if (msg.error === 'success') resolve(msg.data); else reject(new Error(msg.error));
        } else if (msg.event) {
          this.emit('event', msg);
        }
      }
    });
  }

  command(...cmd) {
    if (!this.sock) return Promise.reject(new Error('mpv läuft nicht'));
    const id = ++this.reqId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.sock.write(JSON.stringify({ command: cmd, request_id: id }) + '\n');
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('mpv-Timeout')); }
      }, 10000);
    });
  }

  set(prop, value) { return this.command('set_property', prop, value); }
  get(prop) { return this.command('get_property', prop); }
  observe(id, prop) { return this.command('observe_property', id, prop); }

  stopProcess() {
    if (this.proc) this.proc.kill('SIGTERM');
  }
}

const SKIPPABLE = ['Intro', 'Outro', 'Recap', 'Preview', 'Sponsor', 'SelfPromo', 'Interaction'];
const SEGMENT_LABELS = {
  Intro: 'Intro', Outro: 'Abspann', Recap: 'Rückblick', Preview: 'Vorschau',
  Sponsor: 'Werbung', SelfPromo: 'Eigenwerbung', Interaction: 'Abo-Aufruf',
};

const OBSERVED = ['time-pos', 'pause', 'duration', 'volume', 'mute', 'aid', 'sid', 'idle-active'];

class Player extends EventEmitter {
  constructor(jf, yt = null) {
    super();
    this.jf = jf;
    this.yt = yt;
    this.mpv = new Mpv();
    this.mpv.on('log', (l) => this.emit('log', l));
    this.mpv.on('event', (e) => this.onEvent(e));
    this.mpv.on('exit', () => {
      this.soundKey = null; // neuer mpv-Prozess hat keine Filter mehr
      if (this.mpvRestarting) return; // gewollter Neustart (restartMpv)
      if (this.current) this.finish('error');
      // Neustart mit wachsender Pause, damit ein fehlendes mpv nicht im Sekundentakt neu versucht wird
      this.restarts = (this.restarts || 0) + 1;
      const delay = Math.min(60000, 2000 * 2 ** Math.min(this.restarts, 5));
      setTimeout(() => this.ensureMpv().then(() => { this.restarts = 0; }).catch(() => {}), delay);
    });
    this.queue = [];
    this.index = 0;
    this.current = null; // { item, info, audioMap, subMap, segments, ... }
    this.state = { pos: 0, paused: false, duration: 0, volume: 100, mute: false, aid: null, sid: null };
    this.progressTimer = null;
    this.ready = false;
    this.hls = new HlsTrimmer(); // gekürzte YouTube-Playlists (Start/Sprung tief im Video)
  }

  get active() { return !!this.current; }

  async ensureMpv() {
    if (this.mpv.proc && this.mpv.sock) return;
    this.mpv.extra = this.yt ? await this.yt.mpvArgs().catch(() => []) : [];
    await this.mpv.start();
    for (const [i, prop] of OBSERVED.entries()) await this.mpv.observe(i + 1, prop);
    this.ready = true;
  }

  /**
   * mpv-Prozess frisch starten. Hängt ein YouTube-HLS-Stream (ffmpeg), bleiben die hängenden
   * Verbindungen bzw. der Decoder im Prozess zurück – danach blieb bei jedem weiteren Video das
   * Bild schwarz, obwohl der Ton lief. Ein neuer Prozess startet sauber (~0,3 s).
   */
  async restartMpv(reason) {
    this.emit('log', `mpv wird neu gestartet (${reason})`);
    this.mpvTainted = false;
    const proc = this.mpv.proc;
    if (proc) {
      this.mpvRestarting = true;
      const gone = new Promise((r) => proc.once('exit', r));
      proc.kill('SIGTERM');
      const hard = setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* schon weg */ } }, 3000);
      await gone;
      clearTimeout(hard);
      this.mpvRestarting = false;
    }
    this.soundKey = null;
    await this.ensureMpv();
  }

  // ---------- Steuerung von außen ----------

  /** Spielt eine Liste von Item-IDs ab (aus der Oberfläche oder per Fernstart). */
  async playItems(ids, { startIndex = 0, startTicks, audioIndex, subtitleIndex, mediaSourceId } = {}) {
    if (!ids?.length) return;
    if (this.current) await this.stop({ keepQueue: false, silent: true });
    // Ordner/Serien/Staffeln zu abspielbaren Items auflösen
    const resolved = [];
    for (const id of ids) resolved.push(...(await this.expand(id)));
    if (!resolved.length) throw new Error('Nichts Abspielbares gefunden');
    this.queue = resolved;
    this.index = Math.min(startIndex, resolved.length - 1);
    await this.playCurrent({ startTicks, audioIndex, subtitleIndex, mediaSourceId });
  }

  enqueue(ids, next) {
    if (!this.current) return this.playItems(ids);
    if (next) this.queue.splice(this.index + 1, 0, ...ids);
    else this.queue.push(...ids);
    this.osd(next ? 'Wird als Nächstes gespielt' : 'Zur Warteschlange hinzugefügt');
  }

  async expand(id) {
    const item = await this.jf.item(id);
    if (['Series', 'Season', 'BoxSet', 'Folder', 'MusicAlbum', 'Playlist'].includes(item.Type)) {
      const res = await this.jf.items({
        parentId: id, recursive: true, isFolder: false, mediaTypes: 'Video,Audio',
        sortBy: item.Type === 'BoxSet' ? 'ProductionYear,SortName' : 'ParentIndexNumber,IndexNumber,SortName',
      });
      return (res.Items || []).map((i) => i.Id);
    }
    return [id];
  }

  /** YouTube-Videos abspielen (Liste aus Suche, Kanal oder Playlist). */
  async playYouTube(entries, startIndex = 0) {
    if (!entries?.length) return;
    if (this.current) await this.stop({ silent: true });
    this.queue = entries.map((e) => ({ yt: true, ...e }));
    this.index = Math.min(startIndex, this.queue.length - 1);
    await this.playCurrent();
  }

  async playYtCurrent(entry, { start = null, recoveries = 0 } = {}) {
    const t0 = Date.now();
    await this.ensureMpv();
    // SponsorBlock parallel abfragen – nicht auf die Antwort warten
    const segP = this.yt.sponsorSegments(entry.id).catch(() => []);
    this.current = {
      yt: true,
      item: { Id: entry.id, Name: entry.title, Type: 'YouTube', channel: entry.channel },
      entry, info: null, audioMap: new Map(), subMap: new Map(), segments: [],
      audioIndex: null, subtitleIndex: -1, started: false, skippedSegments: new Set(), endReason: null,
      recoveries,
    };
    const cur = this.current;
    segP.then((segs) => { if (this.current === cur) cur.segments = segs; });
    this.state.pos = 0;
    const t = this.title(cur.item);
    await this.mpv.set('http-header-fields', []).catch(() => {});
    // Weiterschauen: an der gemerkten Stelle fortsetzen
    const resume = start != null ? Math.floor(start) : this.yt.resumePosition(entry.id);
    // Schneller Weg: vorab ermittelte direkte Stream-Adressen; sonst wie bisher über den ytdl-Hook
    const gen = this.loadGen;
    let resolveError = null;
    const direct = await this.yt.resolve(entry).catch((e) => { resolveError = e.message; return null; });
    if (this.current !== cur || gen !== this.loadGen) return; // inzwischen abgebrochen oder etwas anderes gestartet
    if (resolveError && /not a bot|confirm you|sign in/i.test(resolveError)) {
      this.emit('error', 'YouTube blockiert gerade Anfragen von diesem Server (Bot-Schutz). Das legt sich meist nach einiger Zeit von selbst.');
      await this.finish('error');
      return;
    }
    // YouTube-HLS: keine Verbindungs-Wiederverwendung – YouTube verteilt Segmente auf wechselnde
    // Server; mit Keepalive scheiterten auf medienserver 71 Segmente pro Minute (kein Ton bzw.
    // "no audio or video data played"), ohne: 0.
    cur.titleOpts = `force-media-title=%${Buffer.byteLength(t)}%${t},demuxer-lavf-o=%17%http_persistent=0`;
    if (direct?.video) {
      cur.direct = direct;
      // Segmentliste holen → Start/Sprünge über gekürzte Playlists (siehe hls.js)
      cur.trim = await this.hls.prepare(direct).catch(() => null);
      if (this.current !== cur || gen !== this.loadGen) return;
      cur.fullDuration = cur.trim?.total || direct.duration || 0;
      if (cur.fullDuration) { this.state.duration = cur.fullDuration; this.osc('duration', cur.fullDuration); }
      const [url, opts] = this.ytLoadArgs(cur, resume);
      await this.mpv.command('loadfile', url, 'replace', opts);
    } else {
      const opts = cur.titleOpts + (resume ? `,start=${resume}` : '');
      await this.mpv.set('ytdl-format', this.yt.formatString()).catch(() => {});
      await this.mpv.command('loadfile', entry.url, 'replace', opts);
    }
    this.emit('log', `YouTube: Adressen ${direct?.video ? (cur.trim ? 'direkt, gekürzte Playlist' : 'direkt') : 'über ytdl-Hook'} nach ${Date.now() - t0} ms${resume ? `, Start bei ${resume} s` : ''}`);
    // Sicherheitsnetz: Bei sehr langen Videos hängt der Start tief im Video in ffmpeg manchmal.
    // Kommt beim Fortsetzen nach 20 s kein Bild, von vorn starten statt ewig zu warten.
    // Neustart von mpv + frische Adressen statt nur neu laden: der hängende Stream blockiert sonst
    // auch alle weiteren Videos.
    if (direct?.video) {
      cur.startTimer = setTimeout(() => {
        if (this.current !== cur || !this.loading) return;
        if (resume) this.emit('notice', 'Fortsetzen klappt bei diesem Video gerade nicht – es startet von vorn.');
        this.ytRecover(cur, resume ? `Fortsetzen bei ${resume} s hängt` : 'Start hängt', 0);
      }, 20000);
    }
    this.startYtHealth(cur);
    if (resume) this.osd(`Fortgesetzt bei ${Math.floor(resume / 60)}:${String(Math.floor(resume % 60)).padStart(2, '0')}`);
    this.osc('theme', 'yt'); // Bedienleiste in YouTube-Rot
    await this.mpv.set('volume', 100).catch(() => {});
    await this.mpv.set('pause', false).catch(() => {});
    this.yt.addHistory(entry);
    this.emit('started', this.publicState());
    // nächstes Video der Warteschlange schon vorbereiten
    const next = this.queue[this.index + 1];
    if (next && typeof next === 'object' && next.yt) this.yt.prefetch(next);
  }

  async playCurrent(opts = {}) {
    const gen = this.loadGen = (this.loadGen || 0) + 1;
    const id = this.queue[this.index];
    this.setLoading(true, id && typeof id === 'object' ? id.title : '');
    if (this.mpvTainted) await this.restartMpv('vorige YouTube-Wiedergabe hing').catch(() => {});
    await this.ensureMpv();
    if (id && typeof id === 'object' && id.yt) return this.playYtCurrent(id);
    const item = await this.jf.item(id);
    const resumeTicks = opts.startTicks ?? (item.UserData?.PlaybackPositionTicks || 0);
    const info = await this.jf.playbackInfo(id, {
      startTicks: resumeTicks, audioIndex: opts.audioIndex,
      subtitleIndex: opts.subtitleIndex, mediaSourceId: opts.mediaSourceId,
    });
    if (gen !== this.loadGen) return; // inzwischen abgebrochen
    const streams = info.source.MediaStreams || [];
    // Jellyfin-Stream-Index -> mpv-Track-ID
    const audioMap = new Map();
    streams.filter((s) => s.Type === 'Audio' && !s.IsExternal).forEach((s, i) => audioMap.set(s.Index, i + 1));
    const subMap = new Map();
    const embeddedSubs = streams.filter((s) => s.Type === 'Subtitle' && !s.IsExternal);
    embeddedSubs.forEach((s, i) => subMap.set(s.Index, i + 1));
    info.externalSubs.forEach((s, i) => subMap.set(s.index, embeddedSubs.length + i + 1));

    const segments = (await this.jf.mediaSegments(id)).Items || [];

    this.current = {
      item, info, audioMap, subMap, segments,
      audioIndex: opts.audioIndex ?? info.source.DefaultAudioStreamIndex,
      subtitleIndex: opts.subtitleIndex ?? info.source.DefaultSubtitleStreamIndex ?? -1,
      started: false, skippedSegments: new Set(), endReason: null,
    };
    this.state.pos = resumeTicks / TICKS;

    // Token zusätzlich als HTTP-Header an mpv geben (Stream + externe Untertitel)
    await this.mpv.set('http-header-fields', [info.authHeader]).catch(() => {});
    const start = resumeTicks > 0 ? `,start=${(resumeTicks / TICKS).toFixed(2)}` : '';
    const aid = audioMap.get(this.current.audioIndex);
    const sid = this.current.subtitleIndex >= 0 ? subMap.get(this.current.subtitleIndex) : null;
    const t = this.title(item);
    const opt = [`force-media-title=%${Buffer.byteLength(t)}%${t}`]; // mpv-Escaping für Sonderzeichen
    if (aid) opt.push(`aid=${aid}`);
    opt.push(`sid=${sid || 'no'}`);
    await this.mpv.command('loadfile', info.streamUrl, 'replace', -1, opt.join(',') + start).catch(async () =>
      // ältere mpv-Versionen: Optionen als 3. Parameter
      this.mpv.command('loadfile', info.streamUrl, 'replace', opt.join(',') + start));
    this.osc('theme', item.MediaType === 'Audio' ? 'music' : 'kino'); // Bedienleiste in Bereichsfarbe
    this.osc('duration', 0); // Dauer wieder von mpv
    for (const s of info.externalSubs) {
      await this.mpv.command('sub-add', s.url, 'auto', s.title || 'Extern', s.lang || '').catch(() => {});
    }
    if (sid) await this.mpv.set('sid', sid).catch(() => {});
    else await this.mpv.set('sid', 'no').catch(() => {});
    // mpv-interne Lautstärke immer 100 % – geregelt wird nur die Systemlautstärke
    await this.mpv.set('volume', 100).catch(() => {});
    await this.mpv.set('mute', false).catch(() => {});
    await this.mpv.set('pause', false).catch(() => {});
    this.emit('started', this.publicState());
  }

  title(item) {
    if (item.Type === 'YouTube') return item.channel ? `${item.channel} · ${item.Name}` : item.Name;
    if (item.Type === 'Episode') {
      const se = `S${String(item.ParentIndexNumber ?? 0).padStart(2, '0')}E${String(item.IndexNumber ?? 0).padStart(2, '0')}`;
      return `${item.SeriesName} · ${se} · ${item.Name}`;
    }
    return item.ProductionYear ? `${item.Name} (${item.ProductionYear})` : item.Name;
  }

  async stop({ silent } = {}) {
    this.loadGen = (this.loadGen || 0) + 1; // laufende Starts abbrechen
    if (!this.current) { this.setLoading(false); await this.mpv.command('stop').catch(() => {}); return; }
    this.current.endReason = 'stop';
    await this.mpv.command('stop').catch(() => {});
    await this.finish('stop', silent);
  }

  pauseToggle() { return this.mpv.command('cycle', 'pause').catch(() => {}); }
  setPause(p) { return this.mpv.set('pause', p).catch(() => {}); }
  // Spulen ohne mpv-eigene Fortschrittsanzeige – stattdessen kurz die Couchdeck-Leiste zeigen
  /** Relativ spulen; fast = Sprung zum nächsten Schlüsselbild (deutlich schneller als framegenau). */
  seekRelative(s, { fast = false } = {}) {
    if (this.current?.yt && this.current.direct) return this.ytSeekTo((this.current.pendingSeek ?? this.state.pos) + s);
    return this.mpv.command('seek', s, fast ? 'relative+keyframes' : 'relative+exact').then(() => this.osc('show')).catch(() => {});
  }
  seekAbsolute(s) {
    if (this.current?.yt && this.current.direct) return this.ytSeekTo(s);
    return this.mpv.command('seek', s, 'absolute').then(() => this.osc('show')).catch(() => {});
  }

  /**
   * YouTube-Spulen. ffmpeg bleibt bei YouTube-HLS hängen, wenn während der Wiedergabe
   * außerhalb des bereits geladenen Bereichs gesprungen wird (auf medienserver: > 150 s ohne
   * Ergebnis), startet aber direkt an einer Stelle in ~2–3 s. Daher: innerhalb des Puffers
   * normal springen, sonst den Stream an der Zielposition neu laden. Mehrere Spulschritte
   * hintereinander werden zusammengefasst.
   */
  async ytSeekTo(target) {
    const cur = this.current;
    const dur = this.state.duration || cur.direct?.duration || 0;
    target = Math.max(0, dur ? Math.min(target, dur - 3) : target);
    const ranges = (await this.mpv.get('demuxer-cache-state').catch(() => null))?.['seekable-ranges'] || [];
    if (cur.pendingSeek == null && ranges.some((r) => target >= r.start && target <= r.end - 1)) {
      return this.mpv.command('seek', target, 'absolute+exact').then(() => this.osc('show')).catch(() => {});
    }
    cur.pendingSeek = target;
    const hms = (x) => { x = Math.floor(x); const h = Math.floor(x / 3600); const m = Math.floor((x % 3600) / 60); const s2 = x % 60;
      return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(s2).padStart(2, '0')}`; };
    this.osd(`→ ${hms(target)}`, 1500);
    clearTimeout(cur.seekTimer);
    cur.seekTimer = setTimeout(async () => {
      if (this.current !== cur) return;
      const to = cur.pendingSeek;
      cur.pendingSeek = null;
      cur.endReason = 'switch'; // end-file des alten Streams nicht als Ende werten
      cur.reloading = true;
      cur.didReload = true;
      await this.mpv.set('force-window', 'yes').catch(() => {}); // Fenster bleibt offen (kein Flackern zur Oberfläche)
      const [url, opts] = this.ytLoadArgs(cur, to);
      const from = this.state.pos;
      this.state.pos = to;
      cur.seekStarted = Date.now();
      await this.mpv.command('loadfile', url, 'replace', opts).catch((e) => this.emit('log', 'YouTube-Sprung: ' + e.message));
      this.osd(`Springe zu ${hms(to)} …`, 3000);
      // Sicherheitsnetz: kommt nach 20 s kein Bild, mpv frisch starten und zurück an die alte Stelle
      const started = cur.seekStarted;
      cur.seekWatch = setTimeout(() => {
        if (this.current !== cur || cur.seekStarted !== started || !cur.reloading) return;
        this.emit('notice', 'Dorthin springen klappt gerade nicht – zurück zur alten Stelle.');
        this.ytRecover(cur, `Sprung auf ${Math.round(to)} s hängt`, from);
      }, 20000);
    }, 450);
  }
  /**
   * loadfile-Adresse + Optionen für YouTube ab Sekunde `at`. Mit Segmentliste: gekürzte
   * Playlists ab dem Zielsegment (ffmpeg springt nur innerhalb des ersten Segments
   * zuverlässig), absolute Zeitstempel (rebase-start-time=no) → time-pos = echte Position.
   */
  ytLoadArgs(cur, at) {
    let opts = cur.titleOpts + ',ytdl=no';
    const len = (u) => Buffer.byteLength(u);
    if (cur.trim) {
      const p = cur.trim.at(at || 0);
      opts += ',rebase-start-time=no';
      if (p.start != null) opts += `,start=${p.start.toFixed(2)}`;
      if (p.audio) opts += `,audio-file=%${len(p.audio)}%${p.audio}`;
      return [p.video, opts];
    }
    if (at) opts += `,start=${Math.floor(at)}`;
    if (cur.direct.audio) opts += `,audio-file=%${len(cur.direct.audio)}%${cur.direct.audio}`;
    return [cur.direct.video, opts];
  }

  /**
   * YouTube-Selbstheilung: mpv neu starten, frische Stream-Adressen holen und an der Stelle `at`
   * weiterspielen. Höchstens zweimal pro Video, dann Fehlermeldung.
   */
  async ytRecover(cur, why, at) {
    if (this.current !== cur || cur.recovering) return;
    const n = (cur.recoveries || 0) + 1;
    this.emit('log', `YouTube: ${why} – starte Player neu (Versuch ${n})`);
    this.yt?.forget(cur.entry);
    this.hls.forget(cur.direct);
    this.clearYtTimers(cur);
    if (n > 2) {
      this.emit('error', 'Dieses YouTube-Video hängt gerade immer wieder. Bitte später nochmal probieren.');
      this.mpvTainted = true;
      await this.finish('error');
      return;
    }
    cur.recovering = true;
    cur.endReason = 'switch';
    this.setLoading(true, cur.entry.title);
    await this.restartMpv(why).catch((e) => this.emit('log', 'mpv-Neustart: ' + e.message));
    if (this.current !== cur) return; // inzwischen abgebrochen
    await this.playYtCurrent(cur.entry, { start: Math.max(0, at || 0), recoveries: n })
      .catch((e) => { this.emit('error', e.message); this.finish('error'); });
  }

  clearYtTimers(cur) {
    if (!cur) return;
    clearTimeout(cur.seekTimer); clearTimeout(cur.seekWatch); clearTimeout(cur.startTimer);
    clearInterval(cur.healthTimer);
  }

  /**
   * Wächter während YouTube-Wiedergabe: läuft der Ton weiter, aber das Bild steht (oder es gibt
   * gar kein Bild), wird nach ~6 s neu gestartet – an der Stelle, an der der Ton gerade ist.
   */
  startYtHealth(cur) {
    clearInterval(cur.healthTimer);
    cur.healthTimer = setInterval(async () => {
      if (this.current !== cur) { clearInterval(cur.healthTimer); return; }
      const props = ['audio-pts', 'time-pos', 'vo-configured', 'pause', 'paused-for-cache', 'avsync'];
      const [apts, tpos, vo, pause, pfc, avsync] = await Promise.all(props.map((p) => this.mpv.get(p).catch(() => null)));
      if (this.current !== cur) return;
      const busy = this.loading || cur.reloading || cur.recovering || cur.pendingSeek != null;
      if (busy || pause || pfc || typeof apts !== 'number') {
        cur.stall = 0; cur.lastA = apts; cur.lastT = tpos; return;
      }
      const da = typeof cur.lastA === 'number' ? apts - cur.lastA : 0;
      const dt = typeof tpos === 'number' && typeof cur.lastT === 'number' ? tpos - cur.lastT : 0;
      cur.lastA = apts; cur.lastT = tpos;
      const audioRuns = da > 1.2; // Prüfung alle 2 s
      const frozen = audioRuns && (vo === false || dt < 0.3 || Math.abs(Number(avsync) || 0) > 3);
      cur.stall = frozen ? (cur.stall || 0) + 1 : 0;
      if (cur.stall >= 3) {
        this.emit('log', `YouTube: Bild steht (vo=${vo}, Δton=${da.toFixed(1)}, Δbild=${dt.toFixed(1)}, avsync=${avsync})`);
        this.emit('notice', 'Bild hing – Player wird neu gestartet …');
        this.ytRecover(cur, 'Bild hängt, Ton läuft', apts);
      }
    }, 2000);
  }

  setVolume(v) { return this.mpv.set('volume', Math.max(0, Math.min(100, v))).catch(() => {}); }
  changeVolume(d) { return this.mpv.command('add', 'volume', d).then(() => this.osd(`Lautstärke ${Math.round(this.state.volume + d)} %`)).catch(() => {}); }
  setMute(m) { return this.mpv.set('mute', m).catch(() => {}); }
  osd(text, ms = 2500) { return this.mpv.command('show-text', text, ms).catch(() => {}); }
  /**
   * Klangprofil anwenden (feste Filterkette, kein dynamisches Nachregeln → kein Pumpen).
   * Die Kanalzahl der Quelle bestimmt, ob der Center (Dialog) einer 5.1-Spur angehoben wird.
   */
  async applySound(profile) {
    this.soundProfile = profile || this.soundProfile;
    const ch = Number(await this.mpv.get('audio-params/channel-count').catch(() => 2)) || 2;
    const graph = sound.buildFilter(this.soundProfile, ch);
    const key = `${graph}`;
    if (key === this.soundKey) { this.osc('sound', this.soundProfile?.name || 'Standard'); return; }
    this.soundKey = key;
    await this.mpv.command('af', 'remove', '@sound').catch(() => {});
    await this.mpv.command('af', 'remove', '@night').catch(() => {}); // alter Nachtmodus
    if (graph) {
      await this.mpv.command('af', 'add', `@sound:lavfi=[${graph}]`)
        .catch((e) => this.emit('log', 'Klangprofil: ' + e.message));
    }
    this.osc('sound', this.soundProfile?.name || 'Standard');
  }

  setAudioDelay(sec) {
    return this.mpv.set('audio-delay', Math.round(sec * 100) / 100).catch(() => {});
  }

  /** Nachricht an die Bedienleiste (couchdeck_osc.lua). */
  osc(...args) { return this.mpv.command('script-message-to', 'couchdeck_osc', ...args.map(String)).catch(() => {}); }

  /** mpv-Spur-ID -> Jellyfin-Index (für Auswahl über die Bedienleiste). */
  setAudioByMpvId(aid) {
    if (!this.current) return;
    if (this.current.yt) return this.mpv.set('aid', Number(aid)).catch(() => {});
    for (const [jf, id] of this.current.audioMap) if (id === Number(aid)) return this.setAudioStream(jf);
  }

  setSubByMpvId(sid) {
    if (!this.current) return;
    if (this.current.yt) return this.mpv.set('sid', sid === 'no' ? 'no' : Number(sid)).catch(() => {});
    if (sid === 'no') return this.setSubtitleStream(-1);
    for (const [jf, id] of this.current.subMap) if (id === Number(sid)) return this.setSubtitleStream(jf);
  }

  async next() {
    if (this.index + 1 < this.queue.length) {
      await this.finishForSwitch();
      this.index++;
      await this.playCurrent({ startTicks: 0 });
    } else if (this.current) {
      const nxt = await this.jf.nextEpisode(this.current.item).catch(() => null);
      if (nxt) { await this.finishForSwitch(); this.queue.push(nxt.Id); this.index++; await this.playCurrent({ startTicks: 0 }); }
      else this.osd('Keine weitere Folge');
    }
  }

  async previous() {
    if (this.state.pos > 15 || this.index === 0) return this.seekAbsolute(0);
    await this.finishForSwitch();
    this.index--;
    await this.playCurrent({ startTicks: 0 });
  }

  async finishForSwitch() {
    if (!this.current) return;
    this.current.endReason = 'switch';
    this.clearYtTimers(this.current);
    await this.report('stopped');
    this.current = null;
  }

  async setAudioStream(jfIndex) {
    if (!this.current) return;
    const aid = this.current.audioMap.get(jfIndex);
    if (!aid) return;
    this.current.audioIndex = jfIndex;
    await this.mpv.set('aid', aid).catch(() => {});
    this.report('progress');
  }

  async setSubtitleStream(jfIndex) {
    if (!this.current) return;
    this.current.subtitleIndex = jfIndex;
    const sid = jfIndex >= 0 ? this.current.subMap.get(jfIndex) : null;
    await this.mpv.set('sid', sid || 'no').catch(() => {});
    this.report('progress');
  }

  async cycle(kind) {
    if (!this.current) return;
    if (this.current.yt) {
      await this.mpv.command('cycle', kind === 'audio' ? 'aid' : 'sid').catch(() => {});
      return this.osd(kind === 'audio' ? 'Tonspur gewechselt' : 'Untertitel gewechselt');
    }
    const streams = this.current.info.source.MediaStreams || [];
    if (kind === 'audio') {
      const list = streams.filter((s) => s.Type === 'Audio' && this.current.audioMap.has(s.Index));
      if (list.length < 2) return this.osd('Nur eine Tonspur');
      const i = list.findIndex((s) => s.Index === this.current.audioIndex);
      const n = list[(i + 1) % list.length];
      await this.setAudioStream(n.Index);
      this.osd('Ton: ' + (n.DisplayTitle || n.Language || n.Index));
    } else {
      const list = [{ Index: -1, DisplayTitle: 'Aus' },
        ...streams.filter((s) => s.Type === 'Subtitle' && this.current.subMap.has(s.Index))];
      const i = list.findIndex((s) => s.Index === this.current.subtitleIndex);
      const n = list[(i + 1) % list.length];
      await this.setSubtitleStream(n.Index);
      this.osd('Untertitel: ' + (n.DisplayTitle || n.Language || n.Index));
    }
  }

  /** Aktives Intro/Abspann-Segment an der aktuellen Position. */
  activeSegment() {
    if (!this.current) return null;
    const t = this.state.pos * TICKS;
    return this.current.segments.find((s) => SKIPPABLE.includes(s.Type)
      && t >= s.StartTicks && t < s.EndTicks - TICKS) || null;
  }

  skipSegment() {
    const seg = this.activeSegment();
    if (!seg) return false;
    this.current.skippedSegments.add(seg.Id || seg.StartTicks);
    this.osc('skip', 'clear');
    if (seg.Type === 'Outro' && config.get().player.autoplayNext && this.hasNextCandidate()) {
      this.next();
    } else {
      this.seekAbsolute(seg.EndTicks / TICKS);
    }
    return true;
  }

  hasNextCandidate() {
    return this.index + 1 < this.queue.length || (!this.current?.yt && this.current?.item.Type === 'Episode');
  }

  // ---------- mpv-Ereignisse ----------

  onEvent(e) {
    if (e.event === 'property-change') {
      const v = e.data;
      switch (e.name) {
        case 'time-pos': if (typeof v === 'number') { this.state.pos = v; this.onTime(); } break;
        case 'pause': this.state.paused = !!v; if (this.current?.started) this.report('progress'); break;
        case 'duration': this.state.duration = this.current?.fullDuration || v || 0; break;
        case 'volume': this.state.volume = v ?? 100; break;
        case 'mute': this.state.mute = !!v; break;
        case 'aid': this.state.aid = v; break;
        case 'sid': this.state.sid = v; break;
        default: break;
      }
      this.emit('state', this.publicState());
    } else if (e.event === 'audio-reconfig') {
      if (this.current && this.soundProfile) this.applySound().catch(() => {});
    } else if (e.event === 'playback-restart') {
      this.setLoading(false); // erstes Bild ist da
      if (this.current?.reloading) { this.current.reloading = false; this.current.endReason = null; }
    } else if (e.event === 'file-loaded') {
      if (this.current?.reloading) this.osc('show');
      if (this.current?.fullDuration) this.osc('duration', this.current.fullDuration); // nach mpv-Neustart erneut
      if (this.current && !this.current.started) {
        this.current.started = true;
        this.report('start');
        clearInterval(this.progressTimer);
        this.progressTimer = setInterval(() => this.report('progress'), 10000);
      }
    } else if (e.event === 'end-file') {
      const c = this.current;
      if (!c) return;
      // YouTube: Laden/Neuladen (Fortsetzen, Spulen) gescheitert → mpv neu + frische Adressen.
      // Früher wurde ein Fehler beim Neuladen ignoriert und der Player hing für immer.
      if (c.yt && e.reason === 'error' && !c.recovering && (c.endReason === 'switch' ? c.reloading : true)) {
        this.ytRecover(c, `Laden fehlgeschlagen (${e.file_error || 'unbekannt'})`, this.state.pos);
        return;
      }
      if (c.endReason === 'switch') return;
      if (e.reason === 'eof') this.onEof();
      else if (e.reason === 'error') { this.emit('error', 'Wiedergabe fehlgeschlagen: ' + (e.file_error || 'unbekannt')); this.finish('error'); }
      else if (e.reason === 'quit' || e.reason === 'stop') {
        if (this.current.endReason !== 'stop') this.finish('stop');
      }
    } else if (e.event === 'client-message' && e.args?.[0] === 'couchdeck') {
      this.emit('mpv-key', e.args[1], e.args.slice(2));
    }
  }

  onTime() {
    if (!this.current) return; // mpv meldet noch Zeiten, obwohl die Wiedergabe schon beendet ist
    this.checkUpNext();
    const seg = this.activeSegment();
    const key = seg && (seg.Id || seg.StartTicks);
    // Beim Abspann übernimmt der Countdown zur nächsten Folge
    const upNextHandles = seg?.Type === 'Outro' && this.upNextEnabled();
    if (seg && !upNextHandles && !this.current.skippedSegments.has(key)) {
      const ytAuto = this.current.yt && this.yt?.settings.sponsorAuto && ['Sponsor', 'SelfPromo', 'Interaction'].includes(seg.Type);
      if ((config.get().player.autoSkipIntro && seg.Type === 'Intro') || ytAuto) {
        this.skipSegment();
        this.osd(`${SEGMENT_LABELS[seg.Type]} übersprungen`);
      } else if (this.current.promptedSegment !== key) {
        this.current.promptedSegment = key;
        const label = SEGMENT_LABELS[seg.Type] || 'Abschnitt';
        this.osc('skip', label); // klickbarer Knopf in der Bedienleiste, A/Enter überspringt
      }
    } else if (this.current.promptedSegment) {
      this.current.promptedSegment = null;
      this.osc('skip', 'clear');
    }
  }

  // ---------- Countdown zur nächsten Folge ----------

  upNextEnabled() {
    const c = this.current;
    return !!c && config.get().player.autoplayNext && !c.upNextCancelled && !c.stopAfter && this.hasNextCandidate();
  }

  /** Startet kurz vor Schluss (Abspann-Segment bzw. 25 s vor Ende) einen Countdown. */
  checkUpNext() {
    const c = this.current;
    const dur = this.state.duration;
    if (!c || !dur || dur < 120 || !this.upNextEnabled()) {
      if (c?.upNext) { c.upNext = null; this.osc('upnext', 'clear'); }
      return;
    }
    const outro = c.segments.find((x) => x.Type === 'Outro' && x.StartTicks / 10_000_000 > dur * 0.5);
    const startAt = outro ? outro.StartTicks / 10_000_000 : dur - 25;
    if (this.state.pos < startAt) {
      if (c.upNext) { c.upNext = null; this.osc('upnext', 'clear'); } // zurückgespult
      return;
    }
    if (!c.upNext) {
      c.upNext = { deadline: Date.now() + config.get().player.upNextSeconds * 1000, shown: -1, title: '' };
      this.nextTitle().then((t) => { if (c.upNext) c.upNext.title = t; });
    }
    const left = Math.max(0, Math.ceil((c.upNext.deadline - Date.now()) / 1000));
    if (left !== c.upNext.shown) {
      c.upNext.shown = left;
      this.osc('upnext', left, c.upNext.title || '');
    }
    if (left === 0 && !c.upNext.fired) { c.upNext.fired = true; this.next(); }
  }

  async nextTitle() {
    try {
      const id = this.queue[this.index + 1];
      const it = id ? await this.jf.item(id) : await this.jf.nextEpisode(this.current.item);
      return it ? this.title(it) : '';
    } catch { return ''; }
  }

  get upNextActive() { return !!this.current?.upNext; }

  cancelUpNext() {
    if (!this.current) return;
    this.current.upNextCancelled = true;
    this.current.upNext = null;
    this.osc('upnext', 'clear');
    this.osd('Automatisches Weiterspielen abgebrochen');
  }

  async onEof() {
    const cur = this.current;
    cur.endReason = 'eof';
    this.clearYtTimers(cur);
    if (cur.yt && (cur.recoveries || cur.didReload)) this.mpvTainted = true;
    this.state.pos = this.state.duration || this.state.pos;
    await this.report('stopped');
    clearInterval(this.progressTimer);
    if (config.get().player.autoplayNext && !cur.upNextCancelled && !cur.stopAfter) {
      let nextId = this.queue[this.index + 1];
      if (!nextId) {
        const nxt = await this.jf.nextEpisode(cur.item).catch(() => null);
        if (nxt) { this.queue.push(nxt.Id); nextId = nxt.Id; }
      }
      if (nextId) {
        this.current = null;
        this.index++;
        try { await this.playCurrent({ startTicks: 0 }); return; } catch (err) { this.emit('error', err.message); }
      }
    }
    this.current = null;
    this.setLoading(false);
    this.mpv.set('force-window', 'no').catch(() => {});
    this.emit('ended', { item: cur.item });
  }

  async finish(reason, silent) {
    const cur = this.current;
    if (!cur) return;
    clearInterval(this.progressTimer);
    this.clearYtTimers(cur);
    // YouTube mit Hängern/Abbruch beim Laden/Neuladen: vor dem nächsten Video mpv frisch starten
    if (cur.yt && (reason === 'error' || this.loading || cur.reloading || cur.recoveries || cur.didReload)) this.mpvTainted = true;
    await this.report('stopped');
    this.current = null;
    this.setLoading(false);
    this.mpv.set('force-window', 'no').catch(() => {});
    // Nach einem Fehler darf mpv nicht im Hintergrund weiterladen (sonst kam Minuten später
    // plötzlich Ton). YouTube: hängender Stream → Prozess gleich frisch starten.
    if (reason === 'error') {
      if (cur.yt && this.mpv.proc) this.restartMpv('Fehler bei YouTube-Wiedergabe').catch(() => {});
      else this.mpv.command('stop').catch(() => {});
    }
    if (!silent) this.emit('ended', { item: cur.item, reason });
  }

  /** Lade-Zustand (bis zum ersten Bild) – die Oberfläche zeigt dann eine Ladeanzeige mit Abbrechen. */
  setLoading(on, title = '') {
    if (!!this.loading === !!on) return;
    this.loading = on ? { title, since: Date.now() } : null;
    this.emit('loading', this.loading);
  }

  stateBody() {
    const c = this.current;
    return {
      ItemId: c.item.Id,
      MediaSourceId: c.info.source.Id,
      PlaySessionId: c.info.playSessionId,
      PositionTicks: Math.round(this.state.pos * TICKS),
      IsPaused: this.state.paused,
      IsMuted: this.state.mute,
      VolumeLevel: Math.round(this.state.volume),
      AudioStreamIndex: c.audioIndex,
      SubtitleStreamIndex: c.subtitleIndex,
      PlayMethod: 'DirectPlay',
      CanSeek: true,
      RepeatMode: 'RepeatNone',
      NowPlayingQueue: this.queue.map((id, i) => ({ Id: id, PlaylistItemId: `q${i}` })),
      PlaylistItemId: `q${this.index}`,
    };
  }

  report(kind) {
    if (!this.current) return Promise.resolve();
    if (this.current.yt) {
      // YouTube: nichts an Jellyfin melden, aber Position für "Weiterschauen" merken
      if (kind !== 'start' && this.current.started) this.yt.saveProgress(this.current.entry, this.state.pos, this.state.duration);
      return Promise.resolve();
    }
    const body = this.stateBody();
    if (kind === 'start') return this.jf.reportStart(body);
    if (kind === 'stopped') return this.jf.reportStopped(body);
    return this.jf.reportProgress(body);
  }

  publicState() {
    const c = this.current;
    return {
      active: !!c,
      title: c ? this.title(c.item) : null,
      audio: !!c && (c.item.MediaType === 'Audio' || c.item.Type === 'Audio'),
      itemId: c?.item.Id || null,
      ...this.state,
    };
  }

  shutdown() {
    clearInterval(this.progressTimer);
    this.mpv.stopProcess();
  }
}

module.exports = { Player };
