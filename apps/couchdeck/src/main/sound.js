'use strict';
// Klangprofile: feste Klangeinstellungen statt dynamischem Nachregeln.
// Früherer Nachtmodus nutzte dynaudnorm → hörbares "Pumpen" (Hintergrund wurde beim Sprechen
// leiser und in Pausen lauter). Jetzt: feste EQ-Anhebung im Sprachbereich, feste Bass-Absenkung,
// bei 5.1 lauterer Center (Dialoge) und höchstens ein sanfter Kompressor mit langer Erholzeit.
const config = require('./config');

const DEFAULTS = [
  { id: 'standard', name: 'Standard', builtin: true, speech: 0, bass: 0, treble: 0, dynamics: 'aus', level: 0 },
  { id: 'nacht', name: 'Nacht', builtin: true, speech: 6, bass: -8, treble: 0, dynamics: 'mittel', level: 2 },
  { id: 'dialog', name: 'Dialog', builtin: true, speech: 5, bass: -3, treble: 1, dynamics: 'leicht', level: 0 },
  { id: 'kino', name: 'Kino', builtin: true, speech: 1, bass: 3, treble: 1, dynamics: 'aus', level: 0 },
];

// Kompressor-Stufen: langsame Erholzeit (>= 1 s) und weiches Knie gegen Pumpen
const DYNAMICS = {
  aus: null,
  leicht: 'acompressor=threshold=-18dB:ratio=2:attack=25:release=1000:knee=6:makeup=2dB',
  mittel: 'acompressor=threshold=-22dB:ratio=3:attack=20:release=1200:knee=8:makeup=4dB',
  stark: 'acompressor=threshold=-26dB:ratio=4.5:attack=15:release=1500:knee=8:makeup=6dB',
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, Number(v) || 0));

function state() {
  const a = config.get().audio || {};
  let profiles = Array.isArray(a.profiles) && a.profiles.length ? a.profiles : DEFAULTS.map((p) => ({ ...p }));
  // fehlende Standardprofile ergänzen (z. B. nach Updates)
  for (const d of DEFAULTS) if (!profiles.some((p) => p.id === d.id)) profiles = [...profiles, { ...d }];
  // alter Nachtmodus-Schalter → Profil "Nacht"
  const legacy = config.get().player?.nightMode ? 'nacht' : 'standard';
  const active = profiles.some((p) => p.id === a.activeProfile) ? a.activeProfile : legacy;
  return { profiles, active };
}

/** Abschnitt audio.profiles komplett ersetzen (config.update würde Listen zusammenführen). */
function save(profiles, active) {
  const c = config.get();
  c.audio = { ...(c.audio || {}), profiles, activeProfile: active };
  if (c.player) c.player.nightMode = false; // ersetzt durch Profile
  config.save();
}

function list() { return state(); }

function activeProfile() {
  const { profiles, active } = state();
  return profiles.find((p) => p.id === active) || profiles[0];
}

function setActive(id) {
  const { profiles } = state();
  if (!profiles.some((p) => p.id === id)) throw new Error('Profil nicht gefunden');
  save(profiles, id);
  return activeProfile();
}

function cycle() {
  const { profiles, active } = state();
  const i = profiles.findIndex((p) => p.id === active);
  return setActive(profiles[(i + 1) % profiles.length].id);
}

/** Nachtmodus an/aus (Profil "Nacht" bzw. "Standard"). */
function setNight(on) { return setActive(on ? 'nacht' : 'standard'); }
function isNight() { return state().active === 'nacht'; }
function toggleNight() { return setNight(!isNight()); }

/**
 * Regler "Sprache ↔ Rest" (0..12 dB) für den aktuellen Modus: Sprache wird um den Wert
 * angehoben, Bass/Effekte im gleichen Verhältnis abgesenkt.
 */
function balance() { return activeProfile().speech || 0; }
function setBalance(db) {
  const v = clamp(Math.round(db), 0, 12);
  return update(state().active, { speech: v, bass: -Math.min(15, Math.round(v * 1.3)) });
}

function update(id, patch) {
  const { profiles, active } = state();
  const next = profiles.map((p) => (p.id !== id ? p : {
    ...p,
    name: patch.name != null ? String(patch.name).slice(0, 30) || p.name : p.name,
    speech: patch.speech != null ? clamp(patch.speech, 0, 12) : p.speech,
    bass: patch.bass != null ? clamp(patch.bass, -15, 9) : p.bass,
    treble: patch.treble != null ? clamp(patch.treble, -9, 9) : p.treble,
    level: patch.level != null ? clamp(patch.level, -9, 9) : p.level,
    dynamics: patch.dynamics in DYNAMICS ? patch.dynamics : p.dynamics,
  }));
  save(next, active);
  return next.find((p) => p.id === id);
}

function create(baseId) {
  const { profiles, active } = state();
  const base = profiles.find((p) => p.id === baseId) || profiles.find((p) => p.id === active) || DEFAULTS[0];
  let n = 1;
  while (profiles.some((p) => p.name === `Eigenes ${n}`)) n++;
  const p = { ...base, id: `eigen-${Date.now().toString(36)}`, name: `Eigenes ${n}`, builtin: false };
  save([...profiles, p], active);
  return p;
}

function remove(id) {
  const { profiles, active } = state();
  const p = profiles.find((x) => x.id === id);
  if (!p) return state();
  if (p.builtin) throw new Error('Standardprofile können nicht gelöscht werden – nur zurückgesetzt');
  save(profiles.filter((x) => x.id !== id), active === id ? 'standard' : active);
  return state();
}

function reset(id) {
  const d = DEFAULTS.find((x) => x.id === id);
  if (!d) throw new Error('Nur Standardprofile lassen sich zurücksetzen');
  const { profiles, active } = state();
  save(profiles.map((p) => (p.id === id ? { ...d } : p)), active);
  return d;
}

/**
 * ffmpeg-Filterkette (für mpv: af=@sound:lavfi=[…]) für ein Profil.
 * channels = Kanalzahl der Quelle; ab 5.1 wird der Center (Dialog) vor dem Abmischen angehoben.
 * Leerer String = kein Filter (Standard).
 */
function buildFilter(p, channels = 2) {
  if (!p) return '';
  const parts = [];
  const speech = clamp(p.speech, 0, 12);
  const bass = clamp(p.bass, -15, 9);
  const treble = clamp(p.treble, -9, 9);
  const level = clamp(p.level, -9, 9);
  // 5.1/7.1: Center lauter in die Stereo-Mischung, LFE gemäß Bass-Einstellung
  if (channels >= 6 && (speech > 0 || bass < 0)) {
    const c = Math.min(1.6, 0.707 * 10 ** (speech / 20)).toFixed(3);
    const lfe = Math.max(0, 0.5 * 10 ** (Math.min(0, bass) / 20)).toFixed(3);
    const extra = channels >= 8 ? '+0.35*c6' : '';
    const extraR = channels >= 8 ? '+0.35*c7' : '';
    parts.push(`pan=stereo|c0=0.6*c0+${c}*c2+${lfe}*c3+0.45*c4${extra}|c1=0.6*c1+${c}*c2+${lfe}*c3+0.45*c5${extraR}`);
  }
  if (speech) parts.push(`equalizer=f=1800:t=o:w=1.6:g=${(speech * 0.8).toFixed(1)}`, `equalizer=f=3200:t=o:w=1.2:g=${(speech * 0.5).toFixed(1)}`);
  if (bass) parts.push(`bass=g=${bass}:f=110:w=0.7`);
  if (treble) parts.push(`treble=g=${treble}:f=7500:w=0.7`);
  if (DYNAMICS[p.dynamics]) parts.push(DYNAMICS[p.dynamics]);
  if (level) parts.push(`volume=${level}dB`);
  if (!parts.length) return '';
  parts.push('alimiter=limit=0.95:attack=5:release=80:level=0'); // gegen Übersteuern, ohne Auto-Pegel
  return parts.join(',');
}

module.exports = {
  list, activeProfile, setActive, cycle, update, create, remove, reset, buildFilter, DYNAMICS: Object.keys(DYNAMICS),
  setNight, isNight, toggleNight, balance, setBalance,
};
