'use strict';
// Couchdeck – Hauptprozess
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const config = require('./config');
const { Jellyfin, TICKS } = require('./jellyfin');
const { Player } = require('./player');
const { Gamepads } = require('./gamepad');
const system = require('./system');
const { Seerr } = require('./seerr');
const { YouTube } = require('./youtube');
const sound = require('./sound');

const windowed = process.argv.includes('--windowed');
// Wayland-Backend wird im Startskript per --ozone-platform=wayland gesetzt
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

config.get();
const jf = new Jellyfin();
const yt = new YouTube();
const player = new Player(jf, yt);
const pads = new Gamepads();
const seerr = new Seerr(jf);
let win = null;

function log(...a) { console.log('[couchdeck]', ...a); }
function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}
function toast(text, kind = 'info') { send('toast', { text, kind }); }

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().size;
  win = new BrowserWindow({
    width: windowed ? 1600 : width,
    height: windowed ? 900 : height,
    fullscreen: !windowed,
    frame: windowed,
    backgroundColor: '#0b0d12',
    autoHideMenuBar: true,
    title: 'Couchdeck',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.on('render-process-gone', (_e, d) => { log('Renderer weg:', d.reason); win.reload(); });
  win.webContents.on('unresponsive', () => log('Oberfläche meldet: reagiert nicht'));
  // Keine Navigation weg von der App
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

// ---------- Eingaben ----------

// A im Film: gedrückt halten + spulen = schnell spulen. Deshalb löst ein kurzer A-Druck
// (Pause / Überspringen) erst beim Loslassen aus – und nur, wenn währenddessen nicht gespult wurde.
const aHold = { down: false, seeked: false };

pads.on('action', (action) => {
  if (player.loading) { send('input', action.replace(/^stick-/, '')); return; } // Ladeanzeige: B bricht ab
  if (player.active && !audioOnly()) {
    if (action === 'select') { aHold.down = true; aHold.seeked = false; return; }
    player.osc('input', action); // Bedienleiste entscheidet (Menü offen?) und schickt sonst "pad" zurück
  } else send('input', action.replace(/^stick-/, '')); // in der Oberfläche navigiert der Stick wie das Kreuz
});
pads.on('action-up', (action) => {
  if (action !== 'select' || !aHold.down) return;
  aHold.down = false;
  if (!aHold.seeked && player.active && !audioOnly()) player.osc('input', 'select');
});
pads.on('connected', (name) => toast(`Controller verbunden: ${name}`));
pads.on('disconnected', (name) => toast(`Controller getrennt: ${name}`));
pads.on('log', log);
pads.on('raw', (r) => { if (!player.active) send('raw-input', r); });

/** Systemlautstärke (aktiver Ausgang, z. B. WiiM) ändern und anzeigen. */
async function volumeStep(delta) {
  try { publishVolume(await system.changeVolume(delta)); } catch (e) { toast('Lautstärke: ' + e.message, 'error'); }
}

/** Lautstärke an Oberfläche und Bedienleiste melden. */
/** Nachtmodus/Regler an die Player-Leiste melden. */
function publishSound() {
  player.osc('night', sound.isNight() ? 'yes' : 'no');
  player.osc('balance', String(sound.balance()));
}

function publishVolume(v) {
  send('volume', v);
  if (player.active && v) player.osc('volume', v.volume ?? '', v.mute ? 'yes' : 'no');
}

async function publishSinks() {
  const { sinks, default: def } = await system.listSinks();
  player.osc('sinks', JSON.stringify(sinks.map((x) => ({ name: x.name, description: x.description, active: x.name === def }))));
}

/**
 * Controller-Belegung während der Wiedergabe:
 *   Kreuz: ←/→ leiser/lauter · ↓ Audioausgang wählen · ↑ frei (reserviert)
 *   Linker Stick: ←/→ −10 s/+30 s spulen (↑/↓ ohne Funktion)
 *   LT/RT −10 s/+30 s spulen · LB/RB vorherige/nächste Folge
 *   A Pause bzw. Intro überspringen · B/Home beenden · X Untertitel · Y Tonspur · Start Menü
 */
let lastStopPress = 0;

/** Spulen: normal (Einstellungen, z. B. −10/+30 s) oder – mit gehaltenem A – schnell (−2/+5 min). */
function seek(dir) {
  const p = config.get().player;
  if (aHold.down) {
    aHold.seeked = true;
    const now = Date.now();
    if (now - (seek.last || 0) < 300) return; // max. ~3 Sprünge/s, damit Streams nicht überflutet werden
    seek.last = now;
    player.seekRelative(dir < 0 ? -120 : 300, { fast: true });
    player.osd(dir < 0 ? '⏪ −2 min' : '⏩ +5 min', 900);
  } else {
    player.seekRelative(dir < 0 ? -p.seekBack : p.seekForward);
  }
}

/** Wiedergabe ohne Bild (Musik): Bedienung über die Oberfläche statt über die mpv-Leiste. */
function audioOnly() {
  const it = player.current?.item;
  return !!it && (it.MediaType === 'Audio' || it.Type === 'Audio');
}

function handlePlayerInput(action) {
  const p = config.get().player;
  // Während des Countdowns: A = jetzt weiter, B = abbrechen (statt beenden)
  if (player.upNextActive && (action === 'select' || action === 'back')) {
    if (action === 'select') player.next(); else player.cancelUpNext();
    return;
  }
  switch (action) {
    case 'select': if (!player.skipSegment()) player.pauseToggle(); break;
    case 'playpause': player.pauseToggle(); break;
    case 'stop': player.stop(); break;
    case 'back': case 'home': {
      // Schutz vor versehentlichem Beenden: erst Leiste + Hinweis, zweites Drücken beendet
      const now = Date.now();
      if (now - lastStopPress < 3000) { lastStopPress = 0; player.stop(); }
      else { lastStopPress = now; player.osc('show'); player.osd('Nochmal B zum Beenden', 2500); }
      break;
    }
    case 'left': case 'voldown': volumeStep(-5); break;
    case 'right': case 'volup': volumeStep(5); break;
    case 'down': player.osc('open-outputs'); break;
    case 'up': break; // reserviert für eine spätere Funktion
    // Linker Stick: ←/→ spulen
    case 'stick-left': seek(-1); break;
    case 'stick-right': seek(1); break;
    case 'stick-up': case 'stick-down': break; // Stick ↑/↓ im Film ohne Funktion (keine Lautstärke)
    case 'lt': case 'rewind': seek(-1); break;
    case 'rt': case 'fastforward': seek(1); break;
    case 'mute': system.toggleMute().then(publishVolume); break;
    case 'west': player.cycle('subtitle'); break;
    case 'north': player.cycle('audio'); break;
    case 'rb': case 'next': player.next(); break;
    case 'lb': case 'previous': player.previous(); break;
    case 'menu': case 'view': player.osc('toggle-menu'); break;
    default: break;
  }
}

player.on('mpv-key', (k, args = []) => {
  if (k === 'pad') handlePlayerInput(args[0]);
  else if (k === 'seek-rel') player.seekRelative(Number(args[0]) || 0);
  else if (k === 'seek-abs') player.seekAbsolute(Number(args[0]) || 0);
  else if (k === 'sound-cycle' || k === 'toggle-night') {
    const prof = sound.toggleNight();
    player.applySound(prof);
    publishSound();
    player.osd(sound.isNight() ? 'Nachtmodus an' : 'Nachtmodus aus');
  } else if (k === 'balance-step') {
    const prof = sound.setBalance(sound.balance() + (Number(args[0]) || 0));
    player.applySound(prof);
    publishSound();
    player.osd(`Sprache ↔ Rest: ${prof.speech ? '+' + prof.speech + ' dB' : 'Original'}`);
  } else if (k === 'delay-step') changeDelay(Number(args[0]) || 0);
  else if (k === 'sleep-cycle') cycleSleep();
  else if (k === 'upnext-now') player.next();
  else if (k === 'upnext-cancel') player.cancelUpNext();
  else if (k === 'volume-step') volumeStep(Number(args[0]) || 0);
  else if (k === 'toggle-mute') system.toggleMute().then(publishVolume).catch(() => {});
  else if (k === 'set-sink') system.setDefaultSink(args[0]).then(async () => {
    applyDelay().catch(() => {});
    const { sinks } = await system.listSinks();
    const s = sinks.find((x) => x.name === args[0]);
    if (s) config.update({ audio: { preferredSink: s.description } });
    await publishSinks();
    publishVolume(await system.getVolume());
  }).catch((e) => player.osd('Ausgang: ' + e.message));
  else if (k === 'set-audio') player.setAudioByMpvId(args[0]);
  else if (k === 'set-sub') player.setSubByMpvId(args[0]);
  else if (k === 'stop') player.stop();
  else if (k === 'menu-open') { publishSinks().catch(() => {}); system.getVolume().then(publishVolume); }
  else if (k === 'select') { if (!player.skipSegment()) player.pauseToggle(); }
  else if (k === 'cycle-sub') player.cycle('subtitle');
  else if (k === 'cycle-audio') player.cycle('audio');
  else if (k === 'next') player.next();
  else if (k === 'previous') player.previous();
});

// ---------- Player-Ereignisse ----------

player.on('state', (s) => send('player-state', s));
player.on('started', (s) => {
  send('player-state', s);
  system.getVolume().then(publishVolume).catch(() => {});
  player.applySound(sound.activeProfile());
  publishSound();
  applyDelay().catch(() => {});
  player.osc('sleep', sleepLabel());
});

// ---------- Ton-Versatz je Ausgang (Lippensynchronität) ----------

async function currentSinkName() {
  const { default: def } = await system.listSinks();
  return def || 'standard';
}

async function applyDelay() {
  const sink = await currentSinkName();
  const d = config.get().audio.delays?.[sink] || 0;
  await player.setAudioDelay(d);
  return d;
}

async function changeDelay(step) {
  const sink = await currentSinkName();
  const delays = { ...(config.get().audio.delays || {}) };
  const d = Math.max(-5, Math.min(5, Math.round(((delays[sink] || 0) + step) * 100) / 100));
  delays[sink] = d;
  config.update({ audio: { delays } });
  await player.setAudioDelay(d);
  player.osd(`Ton-Versatz ${d > 0 ? '+' : ''}${d.toFixed(2)} s ${d > 0 ? '(Ton später)' : d < 0 ? '(Ton früher)' : ''}`);
}

// ---------- Schlaf-Timer ----------

const SLEEP_STEPS = [0, 15, 30, 60, 90, 'end'];
let sleep = { step: 0, timer: null, until: 0 };

function sleepLabel() {
  const v = SLEEP_STEPS[sleep.step];
  if (!v) return 'Aus';
  if (v === 'end') return 'Ende der Folge';
  return `${Math.max(1, Math.round((sleep.until - Date.now()) / 60000))} min`;
}

function cycleSleep() {
  clearTimeout(sleep.timer);
  sleep.step = (sleep.step + 1) % SLEEP_STEPS.length;
  const v = SLEEP_STEPS[sleep.step];
  if (player.current) player.current.stopAfter = v === 'end';
  if (typeof v === 'number' && v > 0) {
    sleep.until = Date.now() + v * 60000;
    sleep.timer = setTimeout(() => {
      log('Schlaf-Timer abgelaufen');
      sleep.step = 0;
      player.stop();
    }, v * 60000);
  }
  player.osc('sleep', sleepLabel());
  player.osd(v ? `Schlaf-Timer: ${sleepLabel()}` : 'Schlaf-Timer aus');
}
player.on('ended', () => {
  if (SLEEP_STEPS[sleep.step] === 'end') { sleep.step = 0; } send('player-state', player.publicState()); send('refresh'); if (win) win.focus(); });
player.on('error', (msg) => toast(msg, 'error'));
player.on('loading', (l) => send('player-loading', l));
player.on('notice', (msg) => { toast(msg); player.osd(msg, 4000); });
player.on('log', (l) => { if (l) log('mpv:', l); });

// ---------- Fernsteuerung von anderen Jellyfin-Geräten ----------

jf.on('remote-play', async (d) => {
  log('Fernstart:', JSON.stringify(d));
  try {
    const opts = {
      startIndex: d.StartIndex || 0,
      startTicks: d.StartPositionTicks ?? undefined,
      audioIndex: d.AudioStreamIndex ?? undefined,
      subtitleIndex: d.SubtitleStreamIndex ?? undefined,
      mediaSourceId: d.MediaSourceId || undefined,
    };
    if (d.PlayCommand === 'PlayNext' || d.PlayCommand === 'PlayLast') {
      await player.enqueue(d.ItemIds, d.PlayCommand === 'PlayNext');
    } else {
      if (d.PlayCommand === 'PlayShuffle') d.ItemIds = [...d.ItemIds].sort(() => Math.random() - 0.5);
      toast('Wiedergabe wird gestartet …');
      await player.playItems(d.ItemIds, opts);
    }
  } catch (e) { toast('Fernstart fehlgeschlagen: ' + e.message, 'error'); }
});

jf.on('remote-playstate', (d) => {
  switch (d.Command) {
    case 'Stop': player.stop(); break;
    case 'Pause': player.setPause(true); break;
    case 'Unpause': player.setPause(false); break;
    case 'PlayPause': player.pauseToggle(); break;
    case 'Seek': player.seekAbsolute((d.SeekPositionTicks || 0) / TICKS); break;
    case 'NextTrack': player.next(); break;
    case 'PreviousTrack': player.previous(); break;
    case 'FastForward': player.seekRelative(config.get().player.seekForward); break;
    case 'Rewind': player.seekRelative(-config.get().player.seekBack); break;
    default: break;
  }
});

jf.on('remote-command', (d) => {
  const a = d.Arguments || {};
  const nav = { MoveUp: 'up', MoveDown: 'down', MoveLeft: 'left', MoveRight: 'right', Select: 'select', Back: 'back', GoHome: 'home' };
  if (nav[d.Name]) {
    if (player.active) handlePlayerInput(nav[d.Name]); else send('input', nav[d.Name]);
    return;
  }
  switch (d.Name) {
    case 'SetVolume': system.setVolume(Number(a.Volume)).then(publishVolume); break;
    case 'VolumeUp': volumeStep(5); break;
    case 'VolumeDown': volumeStep(-5); break;
    case 'Mute': case 'Unmute': case 'ToggleMute': system.toggleMute().then(publishVolume); break;
    // Manche Apps schicken den Fernstart als GeneralCommand statt als Play-Nachricht
    case 'Play': case 'PlayNext': case 'PlayMediaSource': {
      const ids = String(a.ItemIds || a.ItemId || '').split(',').filter(Boolean);
      if (ids.length) {
        jf.emit('remote-play', {
          ItemIds: ids,
          PlayCommand: d.Name === 'PlayNext' ? 'PlayNext' : (a.PlayCommand || 'PlayNow'),
          StartPositionTicks: a.StartPositionTicks != null ? Number(a.StartPositionTicks) : undefined,
          StartIndex: a.StartIndex != null ? Number(a.StartIndex) : 0,
          AudioStreamIndex: a.AudioStreamIndex != null ? Number(a.AudioStreamIndex) : undefined,
          SubtitleStreamIndex: a.SubtitleStreamIndex != null ? Number(a.SubtitleStreamIndex) : undefined,
          MediaSourceId: a.MediaSourceId,
        });
      }
      break;
    }
    case 'PlayState':
      if (a.Command) jf.emit('remote-playstate', { Command: a.Command, SeekPositionTicks: Number(a.SeekPositionTicks) || 0 });
      break;
    case 'SetAudioStreamIndex': player.setAudioStream(Number(a.Index)); break;
    case 'SetSubtitleStreamIndex': player.setSubtitleStream(Number(a.Index)); break;
    case 'DisplayMessage': {
      const text = [a.Header, a.Text].filter(Boolean).join(': ');
      if (player.active) player.osd(text, Number(a.TimeoutMs) || 5000); else toast(text);
      break;
    }
    case 'ToggleOsd': player.mpv.command('show-progress').catch(() => {}); break;
    case 'ToggleStats': player.mpv.command('script-binding', 'stats/display-stats-toggle').catch(() => {}); break;
    default: break;
  }
});

jf.on('auth', (s) => send('auth', s));
jf.on('socket', (up) => { send('socket', up); if (up) log('Fernsteuerung bereit'); });
jf.on('library-changed', () => send('refresh'));
jf.on('log', log);

// ---------- IPC für die Oberfläche ----------

const handlers = {
  'app:state': () => ({
    auth: jf.authState(),
    deviceName: config.get().deviceName,
    server: config.get().jellyfinUrl,
    player: player.publicState(),
    socket: jf.ws?.readyState === 1,
    pads: pads.connectedNames(),
    settings: { player: config.get().player, audio: config.get().audio, ui: config.get().ui,
      youtube: { maxHeight: yt.settings.maxHeight, sponsorAuto: yt.settings.sponsorAuto } },
  }),
  'jf:publicInfo': () => jf.publicInfo(),
  'jf:qcInitiate': () => jf.quickConnectInitiate(),
  'jf:qcPoll': (secret) => jf.quickConnectPoll(secret),
  'jf:login': ({ username, password }) => jf.loginWithPassword(username, password),
  'jf:logout': () => jf.logout(),
  'jf:home': async () => {
    const views = (await jf.views()).Items || [];
    const [resume, nextUp, fresh] = await Promise.all([jf.resume(), jf.nextUp(), jf.newEpisodes().catch(() => [])]);
    const latest = await Promise.all(views
      .filter((v) => ['movies', 'tvshows', 'music', 'homevideos', 'boxsets', 'mixed', undefined].includes(v.CollectionType))
      .map(async (v) => ({ view: v, items: await jf.latest(v.Id, 24).catch(() => []) })));
    return { views, resume: resume.Items || [], nextUp: nextUp.Items || [], newEpisodes: fresh, latest };
  },
  'jf:items': (q) => jf.items(q),
  'jf:item': (id) => jf.item(id),
  'jf:similar': (id) => jf.similar(id),
  'jf:genres': (parentId) => jf.genres(parentId),
  'jf:person': (id) => jf.personItems(id),
  'jf:seasons': (id) => jf.seasons(id),
  'jf:episodes': ({ seriesId, seasonId }) => jf.episodes(seriesId, seasonId),
  'jf:search': (term) => jf.search(term),
  'jf:setPlayed': ({ id, played }) => jf.setPlayed(id, played),
  'jf:setFavorite': ({ id, fav }) => jf.setFavorite(id, fav),
  'jf:delete': async (id) => { const r = await jf.deleteItem(id); log('Gelöscht:', r.name, id); return r; },
  'jf:imageBase': () => jf.base,
  'player:play': ({ ids, startIndex, startTicks, audioIndex, subtitleIndex }) =>
    player.playItems(ids, { startIndex, startTicks, audioIndex, subtitleIndex }),
  'player:stop': () => player.stop(),
  'player:control': (cmd) => ({ toggle: () => player.pauseToggle(), next: () => player.next(), prev: () => player.previous(), stop: () => player.stop() }[cmd]?.()),
  'sys:sinks': () => system.listSinks(),
  'sys:setSink': async (name) => {
    await system.setDefaultSink(name);
    const { sinks } = await system.listSinks();
    const s = sinks.find((x) => x.name === name);
    // Wahl merken, damit sie nach Neustart wieder greift
    if (s) config.update({ audio: { preferredSink: s.description } });
  },
  'sys:volume': () => system.getVolume(),
  'sys:changeVolume': (d) => system.changeVolume(Number(d)),
  'sys:setVolume': async (v) => { const r = await system.setVolume(Number(v)); publishVolume(r); return r; },
  'sys:toggleMute': () => system.toggleMute(),
  'bt:devices': () => system.btDevices(),
  'bt:scan': () => system.btScan(30),
  'bt:connect': (mac) => system.btConnect(mac),
  'bt:disconnect': (mac) => system.btDisconnect(mac),
  'bt:remove': (mac) => system.btRemove(mac),
  'yt:status': () => ({ available: yt.available, favorites: yt.settings.favorites, sponsorAuto: yt.settings.sponsorAuto }),
  'yt:search': async ({ query, kind }) => { const r = await yt.search(query, kind); return { ...r, entries: yt.decorate(r.entries) }; },
  'yt:channel': async (fav) => { const r = await yt.channel(fav); return { ...r, entries: yt.decorate(r.entries) }; },
  'yt:channelPlaylists': (fav) => yt.channelPlaylists(fav),
  'yt:playlist': async (fav) => { const r = await yt.playlist(fav); return { ...r, entries: yt.decorate(r.entries) }; },
  'yt:feed': async () => yt.decorate(await yt.feed()),
  'yt:history': () => yt.decorate(yt.settings.history),
  'yt:continue': () => yt.continueWatching(),
  'yt:watchLater': () => yt.decorate(yt.settings.watchLater),
  'yt:toggleWatchLater': (entry) => yt.toggleWatchLater(entry),
  'yt:isWatchLater': (id) => yt.isWatchLater(id),
  'yt:toggleFavorite': (entry) => yt.toggleFavorite(entry),
  'yt:setting': ({ key, value }) => { yt.saveSettings({ [key]: value }); return yt.settings; },
  'yt:play': ({ entries, startIndex }) => player.playYouTube(entries, startIndex),
  'yt:prefetch': (entry) => { yt.prefetch(entry); },
  'seerr:status': () => seerr.status(),
  'seerr:trending': (page) => seerr.trending(page || 1),
  'seerr:search': ({ query, page }) => seerr.search(query, page || 1),
  'seerr:details': ({ mediaType, id }) => seerr.details(mediaType, id),
  'seerr:person': (id) => seerr.person(id),
  'seerr:request': (req) => seerr.createRequest(req),
  'seerr:mine': () => seerr.myRequests(),
  'seerr:cancel': (id) => seerr.cancelRequest(id),
  'seerr:season-episodes': (selection) => seerr.seasonEpisodes(selection),
  'seerr:episode-search': ({ requestId, season, episodeId }) =>
    seerr.managedMedia({ action: 'search', requestId, season, episodeId }),
  'seerr:season-search': ({ requestId, season }) =>
    seerr.managedMedia({ action: 'search-season', requestId, season }),
  'seerr:episode-delete': ({ requestId, season, episodeId, fileId }) =>
    seerr.managedMedia({ action: 'delete', requestId, season, episodeId, fileId, confirmation: 'OK' }),
  'seerr:cancel-season': (selection) => seerr.cancelSeason(selection),
  'seerr:film-limit': (value) => seerr.filmLimit(value),
  'seerr:quality': (requestId) => seerr.managedMedia({ action: 'quality', requestId }),
  'seerr:quality-save': ({ requestId, profile, previousProfileId }) =>
    seerr.managedMedia({ action: 'quality-save', requestId, profile, previousProfileId, confirmation: 'OK' }),
  'seerr:season-transfer': ({ requestId, season }) => seerr.managedMedia({ action: 'season-transfer', requestId, season }),
  'seerr:season-pause': ({ requestId, season, review }) =>
    seerr.managedMedia({ action: 'season-pause', requestId, season, review, confirmation: 'OK' }),
  'seerr:activity': () => lastActivity || refreshActivity(),
  // Nachtmodus + Regler Sprache ↔ Rest
  'sound:state': () => ({ night: sound.isNight(), balance: sound.balance() }),
  'sound:setNight': (on) => { const p = sound.setNight(!!on); if (player.active) player.applySound(p); publishSound(); return { night: sound.isNight(), balance: sound.balance() }; },
  'sound:setBalance': (db) => { const p = sound.setBalance(db); if (player.active) player.applySound(p); publishSound(); return { night: sound.isNight(), balance: sound.balance() }; },
  // Klangprofile (intern)
  'sound:list': () => sound.list(),
  'sound:setActive': (id) => { const p = sound.setActive(id); if (player.active) player.applySound(p); return sound.list(); },
  'sound:update': ({ id, patch }) => {
    const p = sound.update(id, patch);
    if (player.active && sound.activeProfile().id === id) player.applySound(p); // sofort hörbar
    return p;
  },
  'sound:create': (baseId) => sound.create(baseId),
  'sound:remove': (id) => { const r = sound.remove(id); if (player.active) player.applySound(sound.activeProfile()); return r; },
  'sound:reset': (id) => { const p = sound.reset(id); if (player.active && sound.activeProfile().id === id) player.applySound(p); return p; },
  'sys:status': () => system.serverStatus(),
  'sys:services': () => system.serviceStatus(),
  'sys:power': (action) => system.power(action),
  'sys:setting': ({ section, key, value }) => {
    config.update({ [section]: { [key]: value } });
    return config.get()[section];
  },
  'app:restart': () => { app.relaunch(); app.exit(0); },
  'app:heartbeat': (hb) => { watchdog.beat(hb); },
  // Couchdeck ausschalten: Merker setzen, den die Startschleife (bash_profile) auswertet
  'app:off': async () => {
    // Mit StackPilot liegt der Merker im gemeinsamen Steuerordner (gleiche Regel wie in bash_profile)
    const fs = require('fs');
    let dir = config.CONTROL_DIR;
    try { fs.accessSync(dir, fs.constants.W_OK); } catch {
      dir = require('path').join(require('os').homedir(), '.local', 'state', 'couchdeck');
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(require('path').join(dir, 'off'), new Date().toISOString() + '\n');
    log('Ausgeschaltet über das Menü');
    if (player.active) await Promise.race([player.stop(), new Promise((r) => setTimeout(r, 3000))]);
    setTimeout(() => app.quit(), 200);
  },
};

for (const [ch, fn] of Object.entries(handlers)) {
  ipcMain.handle(ch, async (_e, arg) => {
    try { return { ok: true, data: await fn(arg) }; } catch (e) { return { ok: false, error: e.message }; }
  });
}

// ---------- Start ----------

// ---------- Seerr-Aktivität: Downloads + "Deine Anfrage ist da" ----------

let lastActivity = null;
let knownAvailable = null; // Set der Schlüssel, die beim letzten Abruf schon verfügbar waren

async function refreshActivity() {
  if (!seerr.configured || !jf.loggedIn) return { downloads: [], available: [] };
  const act = await seerr.activity();
  const nowAvail = new Set(act.available.filter((a) => a.status === 5).map((a) => a.key));
  if (knownAvailable) {
    for (const a of act.available) {
      if (a.status === 5 && !knownAvailable.has(a.key)) {
        toast(`🎉 „${a.title}“ ist jetzt verfügbar`);
        log('Verfügbar geworden:', a.title);
      }
    }
  }
  knownAvailable = nowAvail;
  const changed = JSON.stringify(act) !== JSON.stringify(lastActivity);
  lastActivity = act;
  if (changed) send('activity', act);
  return act;
}

setInterval(() => refreshActivity().catch(() => {}), 60_000);

// ---------- Neue Folgen deiner Serien: Hinweis, sobald eine dazukommt ----------

async function checkNewEpisodes() {
  if (!jf.loggedIn) return;
  const eps = await jf.newEpisodes(2, 30);
  const known = new Set(config.get().ui?.notifiedEpisodes || []);
  const first = !config.get().ui?.notifiedEpisodes; // erster Lauf: nur merken, nicht melden
  const fresh = eps.filter((e) => !known.has(e.Id));
  if (fresh.length && !first) {
    const code = (e) => `S${String(e.ParentIndexNumber ?? 0).padStart(2, '0')}E${String(e.IndexNumber ?? 0).padStart(2, '0')}`;
    if (fresh.length <= 2) fresh.forEach((e) => toast(`🆕 Neue Folge: ${e.SeriesName} ${code(e)}`));
    else toast(`🆕 ${fresh.length} neue Folgen deiner Serien`);
    send('refresh');
    log('Neue Folgen:', fresh.map((e) => `${e.SeriesName} ${code(e)}`).join(', '));
  }
  const ids = [...new Set([...fresh.map((e) => e.Id), ...known])].slice(0, 300);
  config.update({ ui: { notifiedEpisodes: ids } });
}
setTimeout(() => checkNewEpisodes().catch(() => {}), 20_000);
setInterval(() => checkNewEpisodes().catch(() => {}), 15 * 60_000);

// ---------- Selbstheilung ----------
// 1) Oberfläche hängt (kein Lebenszeichen): Renderer neu laden.
// 2) Bild steht, Oberfläche läuft aber (keine requestAnimationFrame-Bilder mehr, z. B. weil
//    der Compositor einen Bildwechsel verloren hat): ganze Anzeige neu starten – Couchdeck
//    beendet sich, die Startschleife startet cage + Couchdeck sofort neu.
/** Sauber beenden (mpv + Controller-Leser mit), die Startschleife startet alles neu. */
function restartSession(reason) {
  log('Selbstheilung: ' + reason);
  try { player.shutdown(); } catch { /* egal */ }
  try { pads.stop(); } catch { /* egal */ }
  setTimeout(() => app.exit(75), 300);
}

const watchdog = {
  startedAt: Date.now(),
  lastBeat: Date.now(),
  rafAge: 0,
  stuckChecks: 0,
  reloads: [],
  beat(hb) {
    this.lastBeat = Date.now(); this.rafAge = Number(hb?.rafAge) || 0;
    if (process.env.COUCHDECK_WATCHDOG_DEBUG) log(`Herzschlag: letztes Bild vor ${this.rafAge} ms`);
  },
  check() {
    const grace = Number(process.env.COUCHDECK_WATCHDOG_GRACE_MS) || 60000;
    if (!win || win.isDestroyed() || Date.now() - this.startedAt < grace) return;
    const silent = Date.now() - this.lastBeat;
    if (silent > 30000) {
      this.reloads = this.reloads.filter((t) => Date.now() - t < 10 * 60000);
      if (this.reloads.length >= 3) { restartSession('Oberfläche hängt wiederholt – Neustart'); return; }
      this.reloads.push(Date.now());
      log(`Selbstheilung: Oberfläche reagiert seit ${Math.round(silent / 1000)} s nicht – lade neu`);
      this.lastBeat = Date.now();
      try { win.webContents.forcefullyCrashRenderer(); } catch { win.webContents.reload(); }
      return;
    }
    // Bild steht? Nur prüfen, wenn kein Film läuft (dann ist mpv vorne und Couchdeck verdeckt)
    if (!player.active && this.rafAge > 20000) {
      this.stuckChecks += 1;
      if (this.stuckChecks >= 2) { this.stuckChecks = -1000; restartSession(`seit ${Math.round(this.rafAge / 1000)} s kein neues Bild – starte Anzeige neu`); }
    } else this.stuckChecks = 0;
  },
};
setInterval(() => watchdog.check(), 10000);

app.whenReady().then(async () => {
  createWindow();
  pads.start();
  if (jf.loggedIn) jf.connectSocket();
  player.ensureMpv().catch((e) => toast('mpv konnte nicht gestartet werden: ' + e.message, 'error'));
  // Im Fenster-/Entwicklungsmodus den Standard-Audioausgang des Rechners nicht anfassen
  if (!windowed) {
    const startVolume = config.get().audio.startVolume;
    const setStartVolume = () => (startVolume != null
      ? system.setVolume(startVolume).then((v) => log('Startlautstärke:', v.volume)).catch(() => {}) : null);
    setStartVolume();
    // Sobald der bevorzugte Ausgang (WiiM) da ist, auch dort die Startlautstärke setzen
    system.applyPreferredSink().then((s) => { if (s) { log('Audioausgang:', s.description); setStartVolume(); } });
  }
  // Diagnose: COUCHDECK_SCREENSHOT=/pfad.png speichert nach ein paar Sekunden ein Bild der Oberfläche
  if (process.env.COUCHDECK_SCREENSHOT) {
    setTimeout(async () => {
      const image = await win.webContents.capturePage();
      require('fs').writeFileSync(process.env.COUCHDECK_SCREENSHOT, image.toPNG());
      log('Screenshot gespeichert:', process.env.COUCHDECK_SCREENSHOT);
      if (process.env.COUCHDECK_SCREENSHOT_QUIT) app.quit();
    }, Number(process.env.COUCHDECK_SCREENSHOT_DELAY) || 5000);
  }
  win.webContents.on('console-message', (e) => {
    if (e.level === 'error' || e.level === 3) log('UI-Fehler:', e.message);
  });
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  player.shutdown();
  pads.stop();
  jf.disconnectSocket();
});
process.on('unhandledRejection', (e) => log('Unbehandelt:', e?.message || e));

// Beenden von außen (z. B. Bildschirm getrennt): Wiedergabe an Jellyfin abmelden, dann schließen
let quitting = false;
process.on('SIGTERM', async () => {
  if (quitting) return;
  quitting = true;
  log('SIGTERM – beende');
  try {
    if (player.active) await Promise.race([player.stop(), new Promise((r) => setTimeout(r, 3000))]);
  } finally { app.quit(); }
});
