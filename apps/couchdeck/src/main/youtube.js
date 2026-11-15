'use strict';
// YouTube über yt-dlp: Suche (Videos, Kanäle, Playlists), Kanal-/Playlist-Inhalte,
// Favoriten, Verlauf und ein "Neu von deinen Kanälen"-Feed. Kein Google-Konto nötig.
// Abgespielt wird über mpv (ytdl-Hook) – dabei gibt es keine Werbespots.
const { execFile } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');
const config = require('./config');

const BIN = process.env.COUCHDECK_YTDLP || '/opt/couchdeck/bin/yt-dlp';
// yt-dlp braucht für YouTube eine JS-Laufzeit: Electron dient als Node (ELECTRON_RUN_AS_NODE)
const NODE_WRAPPER = process.env.COUCHDECK_NODE || '/opt/couchdeck/bin/node';

const SEARCH_FILTER = { channel: 'EgIQAg%3D%3D', playlist: 'EgIQAw%3D%3D' };

function run(args, timeout = 45000) {
  return new Promise((resolve, reject) => {
    execFile(BIN, args, { timeout, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).split('\n').filter(Boolean).slice(-1)[0] || 'yt-dlp-Fehler'));
      else resolve(stdout);
    });
  });
}

function bestThumb(e) {
  const list = (e.thumbnails || []).filter((t) => t.url);
  if (list.length) {
    const sorted = list.sort((a, b) => (a.width || 0) - (b.width || 0));
    const pick = sorted.find((t) => (t.width || 0) >= 320) || sorted.at(-1);
    return pick.url.startsWith('//') ? 'https:' + pick.url : pick.url;
  }
  return null;
}

/** Einheitliches Format für Videos, Kanäle und Playlists. */
function normalize(e) {
  const url = e.url || e.webpage_url || '';
  let kind = 'video';
  if (/\/(channel\/|@|c\/|user\/)/.test(url) && !/watch\?/.test(url)) kind = 'channel';
  else if (/playlist\?list=/.test(url)) kind = 'playlist';
  const id = e.id;
  return {
    kind,
    id,
    url: kind === 'video' ? `https://www.youtube.com/watch?v=${id}` : url,
    title: e.title || '',
    channel: e.channel || e.uploader || (kind === 'channel' ? e.title : '') || '',
    channelId: e.channel_id || (kind === 'channel' ? id : null),
    channelUrl: e.channel_url || e.uploader_url || (kind === 'channel' ? url : null),
    duration: e.duration || null,
    views: e.view_count || null,
    live: e.live_status === 'is_live',
    timestamp: e.timestamp || null,
    count: e.playlist_count || null,
    thumb: bestThumb(e) || (kind === 'video' ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null),
  };
}

class YouTube {
  constructor() {
    this.jsArgs = null;
    this.feedCache = null;
  }

  get available() {
    try { fs.accessSync(BIN, fs.constants.X_OK); return true; } catch { return false; }
  }

  get settings() {
    return { favorites: [], history: [], watchLater: [], progress: {}, sponsorAuto: false, maxHeight: 1440, ...(config.get().youtube || {}) };
  }

  /** Abschnitt komplett ersetzen (config.update würde Objekte zusammenführen – gelöschte Einträge blieben). */
  saveSettings(patch) {
    const c = config.get();
    c.youtube = { ...this.settings, ...patch };
    config.save();
  }

  /** Argumente für die JS-Laufzeit, falls diese yt-dlp-Version sie kennt. */
  async baseArgs() {
    if (this.jsArgs === null) {
      try {
        const help = await run(['--help'], 15000);
        this.jsArgs = help.includes('--js-runtimes') && fs.existsSync(NODE_WRAPPER) ? ['--js-runtimes', `node:${NODE_WRAPPER}`] : [];
      } catch { this.jsArgs = []; }
    }
    return [...this.jsArgs, '--no-warnings', '--ignore-config'];
  }

  /** mpv-Optionen, damit mpv dieselbe yt-dlp-Installation nutzt. */
  async mpvArgs() {
    if (!this.available) return [];
    const base = await this.baseArgs();
    const raw = [];
    for (let i = 0; i < base.length; i++) {
      if (base[i] === '--js-runtimes') { raw.push(`js-runtimes=${base[i + 1]}`); i++; }
    }
    return [
      `--script-opts=ytdl_hook-ytdl_path=${BIN}`,
      `--ytdl-format=${this.formatString()}`,
      ...(raw.length ? [`--ytdl-raw-options=${raw.join(',')}`] : []),
    ];
  }

  /**
   * Formatwahl für mpv/yt-dlp mit der eingestellten Höchstauflösung.
   * YouTube verweigert direkte Dateiabrufe ohne PO-Token (HTTP 403) – HLS-Streams (m3u8)
   * funktionieren und lassen sich spulen. Daher zuerst HLS, sonst die klassischen Formate.
   * Intel UHD 630: kein AV1 in Hardware -> VP9/H.264.
   */
  formatString() {
    const h = Number(this.settings.maxHeight) || 1440;
    return `bv*[protocol^=m3u8][height<=?${h}][vcodec!^=av01]+ba[protocol^=m3u8]`
      + `/b[protocol^=m3u8][height<=?${h}]/bv*[height<=?${h}][vcodec!^=av01]+ba/b[height<=?${h}]`;
  }

  // ---------- Schneller Start: Stream-Adressen vorab ermitteln ----------

  /**
   * Ermittelt die direkten HLS-Adressen (Video + Ton) eines Videos und hält sie 30 min vor.
   * Nur der Client "visionos" liefert die HLS-Streams – ihn allein abzufragen spart ~1,5 s
   * gegenüber allen Clients; schlägt er fehl, wird mit den Standard-Clients nachgefragt.
   * mpv kann die Adressen dann direkt öffnen (~3 s bis zum Bild statt ~8 s über den ytdl-Hook).
   */
  resolve(entry) {
    if (!this.available || !entry?.id) return Promise.resolve(null);
    this.resolved ||= new Map();
    this.inflight ||= new Map();
    const key = `${entry.id}@${this.settings.maxHeight}`;
    const hit = this.resolved.get(key);
    if (hit && Date.now() - hit.at < 30 * 60000) return Promise.resolve(hit);
    if (this.inflight.has(key)) return this.inflight.get(key);
    const url = `https://www.youtube.com/watch?v=${entry.id}`;
    const attempt = async (extra) => {
      const out = await run([...(await this.baseArgs()), ...extra, '-f', this.formatString(), '-J', url], 40000);
      const d = JSON.parse(out);
      const parts = d.requested_formats || [d];
      const video = parts.find((f) => f.vcodec && f.vcodec !== 'none') || parts[0];
      // Ton = die andere angeforderte Spur. Achtung: yt-dlp meldet bei HLS-Tonspuren den Codec oft
      // als unbekannt (acodec leer) – eine Suche nach "acodec" fand sie nicht, das Video lief stumm.
      const audio = parts.find((f) => f !== video) || null;
      if (!video?.url) throw new Error('keine Stream-Adresse');
      if (parts.length > 1 && !audio?.url) throw new Error('keine Ton-Adresse');
      return { at: Date.now(), video: video.url, audio: audio?.url || null, duration: d.duration || null, height: video.height || null };
    };
    const p = attempt(['--extractor-args', 'youtube:player_client=visionos'])
      .catch(() => attempt([]))
      .then((r) => { this.resolved.set(key, r); return r; })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    // Zwischenspeicher klein halten
    if (this.resolved.size > 60) { for (const k of [...this.resolved.keys()].slice(0, 20)) this.resolved.delete(k); }
    return p;
  }

  /** Zwischengespeicherte Adressen eines Videos verwerfen (z. B. nachdem der Stream hing). */
  forget(entry) {
    if (!entry?.id || !this.resolved) return;
    for (const k of [...this.resolved.keys()]) if (k.startsWith(`${entry.id}@`)) this.resolved.delete(k);
  }

  /** Im Hintergrund vorbereiten (z. B. sobald eine Kachel markiert ist). */
  prefetch(entry) {
    if (!entry || entry.kind !== 'video' || entry.live) return;
    // höchstens 2 Vorlade-Vorgänge gleichzeitig – sonst bremsen viele yt-dlp-Prozesse den Server
    if ((this.inflight?.size || 0) >= 2 && !this.inflight.has(`${entry.id}@${this.settings.maxHeight}`)) return;
    this.resolve(entry).catch(() => {});
  }

  // ---------- Weiterschauen & Später ansehen ----------

  /** Position merken; fast fertig gesehen (>= 95 % bzw. < 30 s Rest) gilt als gesehen. */
  saveProgress(entry, pos, dur) {
    if (!entry?.id || !dur || dur < 60) return;
    const progress = { ...this.settings.progress };
    const done = pos >= dur * 0.95 || dur - pos < 30;
    if (done) {
      delete progress[entry.id];
      const watchLater = this.settings.watchLater.filter((w) => w.id !== entry.id); // gesehen -> von der Liste
      this.saveSettings({ progress, watchLater, watched: { ...(this.settings.watched || {}), [entry.id]: Date.now() } });
      return;
    }
    if (pos < 15) return;
    progress[entry.id] = { pos: Math.round(pos), dur: Math.round(dur), at: Date.now() };
    // höchstens 200 Einträge behalten (älteste raus)
    const keys = Object.keys(progress).sort((a, b) => progress[b].at - progress[a].at);
    for (const k of keys.slice(200)) delete progress[k];
    this.saveSettings({ progress });
  }

  resumePosition(id) {
    const p = this.settings.progress[id];
    return p && p.pos > 15 && p.dur - p.pos > 30 ? p.pos : 0;
  }

  /** Einträge mit Fortschritt (0..1) und "gesehen"-Markierung anreichern. */
  decorate(list) {
    const { progress, watched = {} } = this.settings;
    return (list || []).map((e) => (e?.kind === 'video' || !e?.kind
      ? { ...e, progress: progress[e.id] ? progress[e.id].pos / progress[e.id].dur : null, watched: !!watched[e.id] }
      : e));
  }

  continueWatching() {
    const { progress, history } = this.settings;
    const byId = new Map(history.map((h) => [h.id, h]));
    return this.decorate(Object.entries(progress)
      .sort((a, b) => b[1].at - a[1].at)
      .map(([id]) => byId.get(id))
      .filter(Boolean));
  }

  isWatchLater(id) { return this.settings.watchLater.some((w) => w.id === id); }

  toggleWatchLater(entry) {
    const list = this.settings.watchLater.filter((w) => w.id !== entry.id);
    const added = list.length === this.settings.watchLater.length;
    if (added) list.unshift({ ...entry, kind: 'video', addedAt: Date.now() });
    this.saveSettings({ watchLater: list.slice(0, 200) });
    return { watchLater: added };
  }

  async flat(url, { limit = 40, extra = [] } = {}) {
    if (!this.available) throw new Error('yt-dlp ist nicht installiert');
    const out = await run([...(await this.baseArgs()), '--flat-playlist', '-J', '--playlist-end', String(limit), ...extra, url]);
    const d = JSON.parse(out);
    const channel = d.channel || d.uploader || '';
    const entries = (d.entries || []).filter((e) => e && e.id).map(normalize)
      .map((e) => (e.kind === 'video' && !e.channel ? { ...e, channel, channelUrl: e.channelUrl || d.channel_url || null, channelId: e.channelId || d.channel_id || null } : e));
    return { title: d.title || '', channel, entries };
  }

  search(query, kind = 'video') {
    if (kind === 'video') return this.flat(`ytsearch30:${query}`, { limit: 30 });
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=${SEARCH_FILTER[kind]}`;
    return this.flat(url, { limit: 30 }).then((r) => ({ ...r, entries: r.entries.filter((e) => e.kind === kind) }));
  }

  channel(fav, limit = 40) {
    const base = (fav.url || `https://www.youtube.com/channel/${fav.id}`).replace(/\/(videos|featured|streams)?\/?$/, '');
    return this.flat(`${base}/videos`, { limit, extra: ['--extractor-args', 'youtubetab:approximate_date'] });
  }

  /** Playlists eines Kanals (Reiter "Playlists"). */
  channelPlaylists(fav, limit = 60) {
    const base = (fav.url || `https://www.youtube.com/channel/${fav.id}`).replace(/\/(videos|featured|streams|playlists)?\/?$/, '');
    return this.flat(`${base}/playlists`, { limit }).then((r) => ({ ...r, entries: r.entries.filter((e) => e.kind === 'playlist').map((e) => ({ ...e, channel: e.channel || r.channel })) }));
  }

  playlist(fav, limit = 200) {
    return this.flat(fav.url || `https://www.youtube.com/playlist?list=${fav.id}`, { limit });
  }

  // ---------- Favoriten & Verlauf ----------

  isFavorite(id) { return this.settings.favorites.some((f) => f.id === id); }

  toggleFavorite(entry) {
    const favs = this.settings.favorites.filter((f) => f.id !== entry.id);
    const added = favs.length === this.settings.favorites.length;
    if (added) favs.unshift({ kind: entry.kind, id: entry.id, url: entry.url, title: entry.title || entry.channel, thumb: entry.thumb });
    this.saveSettings({ favorites: favs });
    this.feedCache = null;
    return { favorite: added, favorites: favs };
  }

  addHistory(entry) {
    const hist = [{ ...entry, watchedAt: new Date().toISOString() }, ...this.settings.history.filter((h) => h.id !== entry.id)].slice(0, 60);
    this.saveSettings({ history: hist });
  }

  /** Neueste Videos aller favorisierten Kanäle (20 min zwischengespeichert). */
  async feed() {
    if (this.feedCache && Date.now() - this.feedCache.at < 20 * 60000) return this.feedCache.data;
    const chans = this.settings.favorites.filter((f) => f.kind === 'channel');
    const lists = await Promise.all(chans.map((c) => this.channel(c, 8).then((r) => r.entries.map((e) => ({ ...e, channel: e.channel || c.title }))).catch(() => [])));
    const data = lists.flat().sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, 60);
    this.feedCache = { at: Date.now(), data };
    return data;
  }

  // ---------- SponsorBlock ----------

  /**
   * Sponsor-, Eigenwerbungs- und Intro-Abschnitte. Datenschutzfreundlich: Es wird nur ein
   * 4-stelliger Hash-Anfang der Video-ID an sponsor.ajay.app geschickt.
   */
  async sponsorSegments(videoId) {
    const hash = crypto.createHash('sha256').update(videoId).digest('hex');
    const cats = ['sponsor', 'selfpromo', 'interaction', 'intro', 'outro', 'preview'];
    const url = `https://sponsor.ajay.app/api/skipSegments/${hash.slice(0, 4)}?categories=${encodeURIComponent(JSON.stringify(cats))}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return [];
      const list = await res.json();
      const mine = list.find((x) => x.videoID === videoId);
      const TYPE = { sponsor: 'Sponsor', selfpromo: 'SelfPromo', interaction: 'Interaction', intro: 'Intro', outro: 'Outro', preview: 'Preview' };
      return (mine?.segments || []).filter((s) => s.actionType === 'skip' || !s.actionType).map((s) => ({
        Id: s.UUID, Type: TYPE[s.category] || 'Sponsor', StartTicks: Math.round(s.segment[0] * 1e7), EndTicks: Math.round(s.segment[1] * 1e7),
      }));
    } catch { return []; }
  }
}

module.exports = { YouTube };
