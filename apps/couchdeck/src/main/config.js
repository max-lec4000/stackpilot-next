'use strict';
// Persistente Einstellungen in ~/.config/couchdeck/config.json
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const DIR = process.env.COUCHDECK_CONFIG_DIR || path.join(os.homedir(), '.config', 'couchdeck');
const FILE = path.join(DIR, 'config.json');

// Übergabe von StackPilot: Adressen der Dienste, Seerr-Zugang und das Wohnzimmer-Konto.
// StackPilot schreibt die Datei, Couchdeck liest sie nur.
const LINK_DIR = process.env.COUCHDECK_LINK_DIR || '/var/lib/couchdeck';
const INTEGRATION_FILE = path.join(LINK_DIR, 'integration.json');
const CONTROL_DIR = path.join(LINK_DIR, 'control');

/** Aktuelle Übergabe von StackPilot oder null. Wird bei jedem Aufruf frisch gelesen. */
function integration() {
  try {
    const data = JSON.parse(fs.readFileSync(INTEGRATION_FILE, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch { return null; }
}

/** VPN-Weg für YouTube von StackPilot (youtube-vpn.json) oder null. Frisch gelesen. */
function youtubeVpn() {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(LINK_DIR, 'youtube-vpn.json'), 'utf8'));
    return d && d.version === 1 && /^http:\/\/127\.0\.0\.1:\d+$/.test(d.proxy) && typeof d.token === 'string' ? d : null;
  } catch { return null; }
}

const isHttpUrl = (v) => typeof v === 'string' && /^https?:\/\/[^\s]+$/.test(v);

/**
 * Übergabe in die Einstellungen übernehmen. Adressen gelten immer; das Konto wird je
 * ausgestelltem Zugang genau einmal übernommen – wer sich danach in Couchdeck ab- oder
 * mit einem anderen Benutzer anmeldet, wird nicht wieder überschrieben.
 */
function applyIntegration(c) {
  const link = integration();
  if (!link) return false;
  let changed = false;
  if (isHttpUrl(link.jellyfinUrl) && c.jellyfinUrl !== link.jellyfinUrl) {
    c.jellyfinUrl = link.jellyfinUrl;
    changed = true;
  }
  if (link.services && typeof link.services === 'object') {
    // Gilt für die laufende Sitzung; die Liste kommt bei jedem Start frisch aus der Übergabe.
    c.services = Object.fromEntries(Object.entries(link.services).filter(([, url]) => isHttpUrl(url)));
  }
  const a = link.auth;
  if (a && [a.userId, a.userName, a.token].every((v) => typeof v === 'string' && v)) {
    const seen = crypto.createHash('sha256').update(a.token).digest('hex');
    if (c.integrationAuthSeen !== seen) {
      c.auth = { userId: a.userId, userName: a.userName, token: a.token };
      if (typeof link.deviceId === 'string' && /^[\w-]{8,64}$/.test(link.deviceId)) c.deviceId = link.deviceId;
      c.integrationAuthSeen = seen;
      changed = true;
    }
  }
  return changed;
}

const DEFAULTS = {
  jellyfinUrl: 'http://127.0.0.1:8096',
  deviceName: 'Couchdeck',
  deviceId: null,
  auth: null, // { userId, userName, token }
  audio: {
    // Bevorzugter Ausgang: Teil der Sink-Beschreibung (z. B. WiiM über AirPlay)
    preferredSink: 'WiiM',
    // Lautstärke beim Start von Couchdeck (Prozent, null = unverändert lassen)
    startVolume: 40,
    // Ton-Versatz (Sekunden) je Ausgang, z. B. für AirPlay-Lippensynchronität
    delays: {},
  },
  player: {
    autoplayNext: true,
    upNextSeconds: 10, // Countdown bis zur nächsten Folge
    nightMode: false, // Dynamik-Kompression: Explosionen leiser, Stimmen lauter
    autoSkipIntro: false,
    seekBack: 10,
    seekForward: 30,
    hwdec: 'vaapi',
    extraArgs: [],
  },
  ui: {
    screensaverMin: 5, // Bildschirmschoner nach X Minuten ohne Eingabe (0 = aus)
    accent: 'violett',
  },
  // Nur lesender Zugriff (Status-Pings). Nichts davon wird verändert.
  services: {
    Jellyfin: 'http://127.0.0.1:8096/health',
    Seerr: 'http://127.0.0.1:5055/api/v1/status',
    Sonarr: 'http://127.0.0.1:8989/ping',
    Radarr: 'http://127.0.0.1:7878/ping',
    Lidarr: 'http://127.0.0.1:8686/ping',
    Prowlarr: 'http://127.0.0.1:9696/ping',
    Bazarr: 'http://127.0.0.1:6767/',
    qBittorrent: 'http://127.0.0.1:8080/',
  },
};

function merge(base, over) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object'
      ? merge(base[k], v) : v;
  }
  return out;
}

let current = null;

const CONFIG_VERSION = 2;

/** Einmalige Anpassungen gespeicherter Einstellungen an neue Vorgaben. */
function migrate(c) {
  const v = c.configVersion || 1;
  if (v >= CONFIG_VERSION) return;
  // v2: Startlautstärke 20 % -> 40 % (nur wenn noch der alte Standardwert gespeichert ist)
  if (v < 2 && c.audio?.startVolume === 20) c.audio.startVolume = 40;
  c.configVersion = CONFIG_VERSION;
  save();
}

function load() {
  let stored = {};
  try { stored = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* erster Start */ }
  current = merge(DEFAULTS, stored);
  migrate(current);
  let dirty = applyIntegration(current);
  if (!current.deviceId) {
    current.deviceId = 'couchdeck-' + crypto.randomBytes(8).toString('hex');
    dirty = true;
  }
  if (dirty) save();
  return current;
}

function save() {
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(current, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
}

function get() { return current || load(); }

function update(patch) {
  current = merge(get(), patch);
  save();
  return current;
}

module.exports = { get, update, save, integration, youtubeVpn, DIR, CONTROL_DIR };
