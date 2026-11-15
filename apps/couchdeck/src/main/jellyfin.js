'use strict';
// Jellyfin-Client: REST-Aufrufe, Quick-Connect-Login und die WebSocket-Sitzung,
// über die andere Jellyfin-Geräte Couchdeck fernsteuern ("Abspielen auf ...").
const { EventEmitter } = require('events');
const os = require('os');
const config = require('./config');

const VERSION = require('../../package.json').version;
const TICKS = 10_000_000; // 1 Sekunde in Jellyfin-Ticks

const ITEM_FIELDS = 'Overview,Genres,MediaStreams,ProviderIds,ChildCount,RecursiveItemCount,PrimaryImageAspectRatio,Chapters,CanDelete,DateCreated';

class Jellyfin extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.keepAliveTimer = null;
    this.reconnectTimer = null;
    this.closing = false;
  }

  get cfg() { return config.get(); }
  get base() { return this.cfg.jellyfinUrl.replace(/\/$/, ''); }
  get token() { return this.cfg.auth?.token || null; }
  get userId() { return this.cfg.auth?.userId || null; }
  get loggedIn() { return !!this.token; }

  authHeader() {
    const c = this.cfg;
    const parts = [
      `Client="Couchdeck"`,
      `Device="${(c.deviceName || os.hostname()).replace(/"/g, '')}"`,
      `DeviceId="${c.deviceId}"`,
      `Version="${VERSION}"`,
    ];
    if (this.token) parts.push(`Token="${this.token}"`);
    return 'MediaBrowser ' + parts.join(', ');
  }

  async request(method, path, { query, body, raw } = {}) {
    const url = new URL(this.base + path);
    for (const [k, v] of Object.entries(query || {})) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: this.authHeader(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 401 && this.token) {
      // Token wurde widerrufen (z. B. Gerät in Jellyfin gelöscht)
      this.logout();
    }
    if (!res.ok) throw new Error(`Jellyfin ${method} ${path}: HTTP ${res.status}`);
    if (raw) return res;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  get(path, query) { return this.request('GET', path, { query }); }
  post(path, body, query) { return this.request('POST', path, { body, query }); }

  // ---------- Anmeldung ----------

  async publicInfo() {
    return this.get('/System/Info/Public');
  }

  async quickConnectInitiate() {
    return this.post('/QuickConnect/Initiate');
  }

  /** Fragt den Quick-Connect-Status ab und meldet an, sobald bestätigt. */
  async quickConnectPoll(secret) {
    const st = await this.get('/QuickConnect/Connect', { secret });
    if (!st?.Authenticated) return { authenticated: false };
    const res = await this.post('/Users/AuthenticateWithQuickConnect', { Secret: secret });
    this.setAuth(res);
    return { authenticated: true };
  }

  async loginWithPassword(username, password) {
    const res = await this.post('/Users/AuthenticateByName', { Username: username, Pw: password });
    this.setAuth(res);
  }

  setAuth(res) {
    config.update({ auth: { userId: res.User.Id, userName: res.User.Name, token: res.AccessToken } });
    this.emit('auth', this.authState());
    this.connectSocket();
  }

  logout() {
    const header = this.authHeader(); // enthält noch das Token
    const hadToken = !!this.token;
    config.update({ auth: null });
    this.disconnectSocket();
    if (hadToken) {
      fetch(this.base + '/Sessions/Logout', { method: 'POST', headers: { Authorization: header } }).catch(() => {});
    }
    this.emit('auth', this.authState());
  }

  authState() {
    const a = this.cfg.auth;
    return a ? { loggedIn: true, userName: a.userName, userId: a.userId } : { loggedIn: false };
  }

  // ---------- Fernsteuerung (WebSocket + Capabilities) ----------

  connectSocket() {
    if (!this.token) return;
    this.disconnectSocket();
    this.closing = false;
    const wsUrl = this.base.replace(/^http/, 'ws') +
      `/socket?api_key=${encodeURIComponent(this.token)}&deviceId=${encodeURIComponent(this.cfg.deviceId)}`;
    // Token sowohl als Header (neuere Jellyfin-Versionen) als auch als Parameter (ältere)
    const ws = new WebSocket(wsUrl, { headers: { Authorization: this.authHeader() } });
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.emit('socket', true);
      this.reportCapabilities().catch((e) => this.emit('log', 'Capabilities: ' + e.message));
    });
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      this.handleSocketMessage(msg);
    });
    ws.addEventListener('close', () => {
      clearInterval(this.keepAliveTimer);
      this.emit('socket', false);
      if (this.ws === ws && !this.closing && this.token) {
        this.reconnectTimer = setTimeout(() => this.connectSocket(), 5000);
      }
    });
    ws.addEventListener('error', () => { /* close folgt */ });
  }

  disconnectSocket() {
    this.closing = true;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.keepAliveTimer);
    if (this.ws) { try { this.ws.close(); } catch { /* egal */ } }
    this.ws = null;
  }

  send(type, data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ MessageType: type, Data: data }));
    }
  }

  handleSocketMessage(msg) {
    if (msg.MessageType !== 'KeepAlive' && msg.MessageType !== 'ForceKeepAlive') {
      this.emit('log', `WebSocket: ${msg.MessageType}${msg.Data && typeof msg.Data === 'object' ? ' ' + JSON.stringify(msg.Data).slice(0, 300) : ''}`);
    }
    switch (msg.MessageType) {
      case 'ForceKeepAlive': {
        const secs = Math.max(5, Number(msg.Data) || 60);
        clearInterval(this.keepAliveTimer);
        this.send('KeepAlive');
        this.keepAliveTimer = setInterval(() => this.send('KeepAlive'), (secs * 1000) / 2);
        break;
      }
      case 'Play':
        this.emit('remote-play', msg.Data);
        break;
      case 'Playstate':
        this.emit('remote-playstate', msg.Data);
        break;
      case 'GeneralCommand':
        this.emit('remote-command', msg.Data);
        break;
      case 'UserDataChanged':
      case 'LibraryChanged':
        this.emit('library-changed');
        break;
      default:
        break;
    }
  }

  reportCapabilities() {
    return this.post('/Sessions/Capabilities/Full', {
      PlayableMediaTypes: ['Video', 'Audio'],
      SupportedCommands: [
        'MoveUp', 'MoveDown', 'MoveLeft', 'MoveRight', 'Select', 'Back', 'GoHome',
        'VolumeUp', 'VolumeDown', 'Mute', 'Unmute', 'ToggleMute', 'SetVolume',
        'SetAudioStreamIndex', 'SetSubtitleStreamIndex', 'DisplayMessage',
        'PlayState', 'PlayNext', 'Play', 'PlayMediaSource', 'ToggleOsd', 'ToggleStats',
      ],
      SupportsMediaControl: true,
      SupportsPersistentIdentifier: true,
    });
  }

  // ---------- Bibliothek ----------

  views() {
    return this.get('/UserViews', { userId: this.userId });
  }

  resume(limit = 20) {
    return this.get('/UserItems/Resume', {
      userId: this.userId, limit, mediaTypes: 'Video', fields: ITEM_FIELDS, enableImageTypes: 'Primary,Backdrop,Thumb',
    });
  }

  nextUp(limit = 20) {
    return this.get('/Shows/NextUp', {
      userId: this.userId, limit, fields: ITEM_FIELDS, enableResumable: false, enableRewatching: false,
    });
  }

  /**
   * Neue Folgen "deiner" Serien: in den letzten `days` Tagen hinzugekommen, noch nicht gesehen,
   * und die Serie hast du schon angefangen.
   */
  async newEpisodes(days = 7, limit = 20) {
    const since = Date.now() - days * 864e5;
    const res = await this.items({
      includeItemTypes: 'Episode', recursive: true, isPlayed: false,
      sortBy: 'DateCreated', sortOrder: 'Descending', limit: 80,
    });
    const recent = (res.Items || []).filter((e) => e.DateCreated && new Date(e.DateCreated).getTime() >= since && e.SeriesId);
    if (!recent.length) return [];
    const ids = [...new Set(recent.map((e) => e.SeriesId))];
    const series = await this.items({ ids: ids.join(','), enableTotalRecordCount: false });
    const started = new Set((series.Items || []).filter((x) => (x.UserData?.PlayedPercentage || 0) > 0 || (x.UserData?.PlayCount || 0) > 0).map((x) => x.Id));
    return recent.filter((e) => started.has(e.SeriesId)).slice(0, limit);
  }

  latest(parentId, limit = 20) {
    return this.get('/Items/Latest', { userId: this.userId, parentId, limit, fields: ITEM_FIELDS });
  }

  items(query) {
    return this.get('/Items', {
      userId: this.userId, fields: ITEM_FIELDS, enableTotalRecordCount: true, ...query,
    });
  }

  item(id) {
    return this.get(`/Items/${id}`, { userId: this.userId, fields: ITEM_FIELDS + ',People,Studios,Taglines' });
  }

  similar(id, limit = 16) {
    return this.get(`/Items/${id}/Similar`, { userId: this.userId, limit, fields: ITEM_FIELDS });
  }

  genres(parentId) {
    return this.get('/Genres', { userId: this.userId, parentId, sortBy: 'SortName', enableImages: false });
  }

  personItems(personId, limit = 40) {
    return this.items({ personIds: personId, recursive: true, includeItemTypes: 'Movie,Series', sortBy: 'ProductionYear,SortName', sortOrder: 'Descending', limit });
  }

  seasons(seriesId) {
    return this.get(`/Shows/${seriesId}/Seasons`, { userId: this.userId, fields: ITEM_FIELDS });
  }

  episodes(seriesId, seasonId) {
    return this.get(`/Shows/${seriesId}/Episodes`, { userId: this.userId, seasonId, fields: ITEM_FIELDS });
  }

  /** Nächste Folge nach itemId (für Autoplay). */
  async nextEpisode(item) {
    if (item.Type !== 'Episode' || !item.SeriesId) return null;
    const res = await this.get(`/Shows/${item.SeriesId}/Episodes`, {
      userId: this.userId, startItemId: item.Id, limit: 2, fields: ITEM_FIELDS,
    });
    return res?.Items?.[1] || null;
  }

  search(term) {
    return this.items({
      searchTerm: term, recursive: true, limit: 60,
      includeItemTypes: 'Movie,Series,Episode,BoxSet,MusicAlbum',
    });
  }

  setPlayed(id, played) {
    return this.request(played ? 'POST' : 'DELETE', `/UserPlayedItems/${id}`, { query: { userId: this.userId } });
  }

  /** Löscht ein Element samt Dateien – nur möglich, wenn Jellyfin es dem Benutzer erlaubt (CanDelete). */
  async deleteItem(id) {
    const item = await this.get(`/Items/${id}`, { userId: this.userId, fields: 'CanDelete' });
    if (!item?.CanDelete) throw new Error('Keine Berechtigung zum Löschen');
    await this.request('DELETE', `/Items/${id}`);
    return { name: item.Name };
  }

  setFavorite(id, fav) {
    return this.request(fav ? 'POST' : 'DELETE', `/UserFavoriteItems/${id}`, { query: { userId: this.userId } });
  }

  mediaSegments(id) {
    return this.get(`/MediaSegments/${id}`).catch(() => ({ Items: [] }));
  }

  imageUrl(id, type = 'Primary', { tag, height, width } = {}) {
    const u = new URL(`${this.base}/Items/${id}/Images/${type}`);
    if (tag) u.searchParams.set('tag', tag);
    if (height) u.searchParams.set('fillHeight', height);
    if (width) u.searchParams.set('fillWidth', width);
    u.searchParams.set('quality', '90');
    return u.toString();
  }

  // ---------- Wiedergabe ----------

  /**
   * Holt Wiedergabe-Infos. mpv spielt praktisch alles direkt ab,
   * daher wird immer Direct Play angefragt (keine Last für den Server).
   */
  async playbackInfo(itemId, { startTicks, audioIndex, subtitleIndex, mediaSourceId } = {}) {
    const info = await this.post(`/Items/${itemId}/PlaybackInfo`, {
      UserId: this.userId,
      StartTimeTicks: startTicks || 0,
      AudioStreamIndex: audioIndex,
      SubtitleStreamIndex: subtitleIndex,
      MediaSourceId: mediaSourceId,
      AutoOpenLiveStream: true,
      EnableDirectPlay: true,
      EnableDirectStream: true,
      EnableTranscoding: false,
      DeviceProfile: {
        Name: 'Couchdeck (mpv)',
        MaxStreamingBitrate: 1_000_000_000,
        DirectPlayProfiles: [{ Type: 'Video' }, { Type: 'Audio' }],
        TranscodingProfiles: [],
        SubtitleProfiles: ['srt', 'subrip', 'ass', 'ssa', 'vtt', 'webvtt', 'pgs', 'pgssub', 'dvdsub', 'dvbsub', 'sub']
          .flatMap((f) => [{ Format: f, Method: 'Embed' }, { Format: f, Method: 'External' }]),
      },
    });
    const source = (mediaSourceId && info.MediaSources.find((s) => s.Id === mediaSourceId)) || info.MediaSources[0];
    if (!source) throw new Error('Keine Medienquelle gefunden');
    const streamUrl = `${this.base}/Videos/${itemId}/stream?static=true&mediaSourceId=${source.Id}` +
      `&deviceId=${this.cfg.deviceId}&api_key=${this.token}`;
    const externalSubs = (source.MediaStreams || [])
      .filter((s) => s.Type === 'Subtitle' && s.IsExternal && s.DeliveryUrl)
      .map((s) => ({ index: s.Index, url: this.base + s.DeliveryUrl, title: s.DisplayTitle, lang: s.Language }));
    return { playSessionId: info.PlaySessionId, source, streamUrl, externalSubs, authHeader: `Authorization: MediaBrowser Token="${this.token}"` };
  }

  reportStart(state) { return this.post('/Sessions/Playing', state).catch(() => {}); }
  reportProgress(state) { return this.post('/Sessions/Playing/Progress', state).catch(() => {}); }
  reportStopped(state) { return this.post('/Sessions/Playing/Stopped', state).catch(() => {}); }
}

module.exports = { Jellyfin, TICKS };
