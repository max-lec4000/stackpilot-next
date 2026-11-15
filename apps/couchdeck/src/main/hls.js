'use strict';
/**
 * Gekürzte YouTube-HLS-Playlists für mpv.
 *
 * Problem: ffmpeg bleibt bei YouTube-HLS (Video als fMP4) hängen, sobald mehr als ein
 * Segment weit gesprungen wird – es liest dann Segment für Segment ab dem Anfang und
 * verwirft alles (bei einem 5-h-Video ab 3:00 h: > 2,5 min ohne Bild). Ein Start an der
 * ersten Stelle der Playlist klappt dagegen in ~1 s, ebenso ein Sprung innerhalb des
 * ersten Segments.
 *
 * Lösung: Couchdeck holt die Segmentliste einmal und liefert mpv über einen lokalen
 * HTTP-Dienst (nur 127.0.0.1) eine Playlist, die genau beim Zielsegment beginnt. mpv läuft
 * dafür mit rebase-start-time=no – die Zeitstempel der Segmente sind absolut, time-pos
 * zeigt also die echte Position im Video.
 */
const http = require('http');
const crypto = require('crypto');

const MAX_ENTRIES = 12;

class HlsTrimmer {
  constructor() {
    this.entries = new Map(); // key -> { video, audio, at }
    this.byUrl = new Map(); // video-URL -> key
    this.server = null;
    this.port = 0;
    this.starting = null;
  }

  start() {
    if (this.port) return Promise.resolve();
    if (this.starting) return this.starting;
    this.starting = new Promise((resolve, reject) => {
      const srv = http.createServer((req, res) => this.handle(req, res));
      srv.on('error', reject);
      srv.listen(0, '127.0.0.1', () => { this.server = srv; this.port = srv.address().port; resolve(); });
    }).finally(() => { this.starting = null; });
    return this.starting;
  }

  /**
   * Segmentlisten für ein Video (direkte Adressen aus yt-dlp) laden und vorhalten.
   * Liefert null, wenn die Adressen keine einfachen Medien-Playlists sind.
   */
  async prepare(direct, { timeoutMs = 10000 } = {}) {
    if (!direct?.video || !/m3u8|playlist|index/i.test(direct.video)) return null;
    const known = this.byUrl.get(direct.video);
    if (known && this.entries.has(known)) return this.handleFor(known);
    await this.start();
    const [video, audio] = await Promise.all([
      fetchPlaylist(direct.video, timeoutMs),
      direct.audio ? fetchPlaylist(direct.audio, timeoutMs) : null,
    ]);
    if (!video || (direct.audio && !audio)) return null;
    const key = crypto.randomBytes(9).toString('hex');
    this.entries.set(key, { video, audio, at: Date.now() });
    this.byUrl.set(direct.video, key);
    // klein halten
    if (this.entries.size > MAX_ENTRIES) {
      const oldest = [...this.entries.entries()].sort((a, b) => a[1].at - b[1].at)[0][0];
      this.entries.delete(oldest);
      for (const [u, k] of this.byUrl) if (k === oldest) this.byUrl.delete(u);
    }
    return this.handleFor(key);
  }

  forget(direct) {
    const key = direct?.video && this.byUrl.get(direct.video);
    if (!key) return;
    this.entries.delete(key);
    this.byUrl.delete(direct.video);
  }

  handleFor(key) {
    const e = this.entries.get(key);
    const total = e.video.segs.length ? e.video.segs[e.video.segs.length - 1].end : 0;
    return {
      total,
      /** Adressen + Startoption für die Wiedergabe ab Sekunde t. */
      at: (t) => {
        t = Math.max(0, Math.min(Number(t) || 0, Math.max(0, total - 1)));
        const vi = segIndex(e.video.segs, t);
        const segStart = e.video.segs[vi]?.start || 0;
        const ai = e.audio ? segIndex(e.audio.segs, segStart + 0.05) : 0;
        const base = `http://127.0.0.1:${this.port}/${key}`;
        return {
          video: `${base}/v.m3u8?from=${vi}`,
          audio: e.audio ? `${base}/a.m3u8?from=${ai}` : null,
          segStart,
          // innerhalb des ersten Segments springt ffmpeg problemlos; ganz am Anfang gar nicht
          start: t - segStart > 0.5 ? t : null,
        };
      },
    };
  }

  handle(req, res) {
    const m = /^\/([0-9a-f]+)\/([va])\.m3u8(?:\?from=(\d+))?$/.exec(req.url || '');
    const e = m && this.entries.get(m[1]);
    const pl = e && (m[2] === 'v' ? e.video : e.audio);
    if (!pl) { res.writeHead(404); res.end(); return; }
    e.at = Date.now();
    const from = Math.min(Number(m[3]) || 0, Math.max(0, pl.segs.length - 1));
    const out = [...pl.header];
    if (pl.segs[from]?.map) out.push(pl.segs[from].map);
    for (let i = from; i < pl.segs.length; i++) out.push(...pl.segs[i].lines);
    out.push('#EXT-X-ENDLIST', '');
    const body = out.join('\n');
    res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
    res.end(body);
  }

  stop() { try { this.server?.close(); } catch { /* egal */ } }
}

/** Index des Segments, das Sekunde t enthält. */
function segIndex(segs, t) {
  let lo = 0; let hi = segs.length - 1;
  if (hi < 0) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segs[mid].start <= t) lo = mid; else hi = mid - 1;
  }
  return lo;
}

async function fetchPlaylist(url, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) return null;
    return parsePlaylist(await r.text(), url);
  } catch { return null; } finally { clearTimeout(timer); }
}

/**
 * Medien-Playlist zerlegen: Kopfzeilen (ohne EXT-X-MAP), Segmente mit Start/Ende und
 * jeweils gültigem EXT-X-MAP. Master-Playlists und Live-Streams → null.
 */
function parsePlaylist(text, baseUrl) {
  if (!text.startsWith('#EXTM3U') || text.includes('#EXT-X-STREAM-INF')) return null;
  if (!text.includes('#EXT-X-ENDLIST') && !/#EXT-X-PLAYLIST-TYPE:VOD/.test(text)) return null;
  const abs = (u) => { try { return new URL(u, baseUrl).href; } catch { return u; } };
  const header = [];
  const segs = [];
  let map = null;
  let pending = [];
  let dur = null;
  let t = 0;
  let inBody = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line === '#EXT-X-ENDLIST') continue;
    if (line.startsWith('#EXT-X-MAP:')) {
      map = line.replace(/URI="([^"]+)"/, (_, u) => `URI="${abs(u)}"`);
      if (inBody) pending.push(map);
      continue;
    }
    if (line.startsWith('#EXTINF:')) {
      inBody = true;
      dur = parseFloat(line.slice(8)) || 0;
      pending.push(line);
      continue;
    }
    if (line.startsWith('#')) {
      if (inBody) pending.push(line); else if (!/^#EXT-X-(MEDIA-SEQUENCE|DISCONTINUITY-SEQUENCE)/.test(line)) header.push(line);
      continue;
    }
    // Segment-Adresse
    if (dur == null) return null;
    segs.push({ start: t, end: t + dur, map, lines: [...pending, abs(line)] });
    t += dur;
    pending = [];
    dur = null;
  }
  if (!segs.length) return null;
  return { header, segs };
}

module.exports = { HlsTrimmer, parsePlaylist, segIndex };
