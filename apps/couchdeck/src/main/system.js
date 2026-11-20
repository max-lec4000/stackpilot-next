'use strict';
// Systemfunktionen: Audioausgänge (PipeWire über pactl), Server-Status,
// Dienst-Status (nur lesend) und Ein/Aus.
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const config = require('./config');

function run(cmd, args, timeout = 8000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr?.trim() || err.message)); else resolve(stdout);
    });
  });
}

// ---------- Audio ----------

async function listSinks() {
  let sinks = [];
  try {
    sinks = JSON.parse(await run('pactl', ['-f', 'json', 'list', 'sinks']));
  } catch {
    return { sinks: [], default: null };
  }
  let def = null;
  try { def = (await run('pactl', ['get-default-sink'])).trim(); } catch { /* egal */ }
  return {
    default: def,
    sinks: sinks.map((s) => ({
      name: s.name,
      description: s.description || s.name,
      kind: /raop/i.test(s.name) || /airplay/i.test(s.description || '') ? 'airplay'
        : /hdmi|displayport/i.test(s.name + (s.description || '')) ? 'monitor'
          : /bluez/i.test(s.name) ? 'bluetooth' : 'other',
    })),
  };
}

async function setDefaultSink(name) {
  await run('pactl', ['set-default-sink', name]);
  // laufende Streams mitnehmen
  try {
    const inputs = JSON.parse(await run('pactl', ['-f', 'json', 'list', 'sink-inputs']));
    for (const i of inputs) await run('pactl', ['move-sink-input', String(i.index), name]).catch(() => {});
  } catch { /* keine Streams */ }
}

/**
 * Wartet bis zu `timeoutMs`, ob ein Ausgang mit dem bevorzugten Namen auftaucht
 * (AirPlay-Geräte erscheinen erst nach einigen Sekunden), und setzt ihn als Standard.
 */
async function applyPreferredSink(timeoutMs = 45000) {
  const want = (config.get().audio.preferredSink || '').toLowerCase();
  if (!want) return null;
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const { sinks, default: def } = await listSinks();
    const match = sinks.find((s) => s.description.toLowerCase().includes(want) || s.name.toLowerCase().includes(want));
    if (match) {
      if (match.name !== def) await setDefaultSink(match.name).catch(() => {});
      return match;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return null;
}

/** Lautstärke des aktiven Ausgangs in Prozent + Stummschaltung. */
async function getVolume() {
  try {
    const out = await run('pactl', ['get-sink-volume', '@DEFAULT_SINK@']);
    const m = /(\d+)%/.exec(out);
    const mute = /yes/i.test(await run('pactl', ['get-sink-mute', '@DEFAULT_SINK@']));
    return { volume: m ? Number(m[1]) : null, mute };
  } catch { return { volume: null, mute: false }; }
}

async function setVolume(percent) {
  const v = Math.max(0, Math.min(100, Math.round(percent)));
  await run('pactl', ['set-sink-volume', '@DEFAULT_SINK@', `${v}%`]);
  if (v > 0) await run('pactl', ['set-sink-mute', '@DEFAULT_SINK@', '0']).catch(() => {});
  return getVolume();
}

async function changeVolume(delta) {
  const { volume } = await getVolume();
  return setVolume((volume ?? 50) + delta);
}

async function toggleMute() {
  await run('pactl', ['set-sink-mute', '@DEFAULT_SINK@', 'toggle']);
  return getVolume();
}

/** Kurzer, leiser Testton (440 Hz, 1,2 s, sanft ein-/ausgeblendet) als WAV. */
function testToneWav(seconds = 1.2, rate = 44100) {
  const n = Math.round(seconds * rate), data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const fade = Math.min(1, i / (rate * 0.05), (n - i) / (rate * 0.05));
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 0.25 * fade * 32767), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** Testton gezielt auf einem Ausgang abspielen (ändert den Standardausgang nicht). */
async function playTestTone(sink) {
  const file = require('path').join(os.tmpdir(), `couchdeck-testton-${process.pid}.wav`);
  fs.writeFileSync(file, testToneWav(), { mode: 0o600 });
  try { await run('paplay', ['--device=' + sink, file], 15000); } finally { fs.rmSync(file, { force: true }); }
}

// ---------- Bluetooth (über bluetoothctl) ----------

const MAC_RE = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i;
function checkMac(mac) {
  if (!MAC_RE.test(mac || '')) throw new Error('Ungültige Geräteadresse');
  return mac;
}

async function btInfo(mac) {
  const out = await run('bluetoothctl', ['info', mac]).catch(() => '');
  const get = (k) => new RegExp(`^\\s*${k}: (.*)$`, 'm').exec(out)?.[1]?.trim();
  return {
    mac,
    name: get('Alias') || get('Name') || mac,
    icon: get('Icon') || '',
    paired: get('Paired') === 'yes',
    bonded: get('Bonded') === 'yes',
    trusted: get('Trusted') === 'yes',
    connected: get('Connected') === 'yes',
    battery: Number(/Battery Percentage: 0x[0-9a-f]+ \((\d+)\)/i.exec(out)?.[1]) || null,
  };
}

async function btDevices() {
  await run('bluetoothctl', ['power', 'on']).catch(() => {});
  const out = await run('bluetoothctl', ['devices']).catch(() => '');
  const macs = [...out.matchAll(/^Device (\S+) /gm)].map((m) => m[1]);
  const list = await Promise.all(macs.map(btInfo));
  // Unbenannte Geräte (nur Adresse) ausblenden, außer sie sind gekoppelt
  return list.filter((d) => d.paired || d.name.replace(/-/g, ':') !== d.mac)
    .sort((a, b) => (b.connected - a.connected) || (b.paired - a.paired) || a.name.localeCompare(b.name));
}

async function btScan(seconds = 12) {
  await run('bluetoothctl', ['power', 'on']).catch(() => {});
  await run('bluetoothctl', ['--timeout', String(seconds), 'scan', 'on'], (seconds + 5) * 1000).catch(() => {});
  return btDevices();
}

/** Wartet (mit laufender Suche), bis das Gerät sichtbar ist. */
async function btWaitVisible(mac, seconds = 30) {
  const scan = execFile('bluetoothctl', ['--timeout', String(seconds), 'scan', 'on'], () => {});
  try {
    for (let i = 0; i < seconds; i++) {
      const out = await run('bluetoothctl', ['devices']).catch(() => '');
      if (out.includes(mac)) return true;
      await new Promise((r) => setTimeout(r, 1000));
    }
    return false;
  } finally { scan.kill(); }
}

async function btConnect(mac) {
  checkMac(mac);
  // Ohne "pairable" koppelt bluez nur vorübergehend (Bonded: no) und verwirft dann
  // die Eingaben von Controllern ("Rejected connection from !bonded device").
  await run('bluetoothctl', ['pairable', 'on']).catch(() => {});
  let d = await btInfo(mac);
  if (d.paired && !d.bonded) {
    await run('bluetoothctl', ['remove', mac]).catch(() => {});
    d = { ...d, paired: false };
  }
  if (!d.paired) {
    if (!(await btWaitVisible(mac))) throw new Error('Gerät nicht gefunden – ist es im Kopplungsmodus?');
    await run('bluetoothctl', ['--agent', 'NoInputNoOutput', '--timeout', '25', 'pair', mac], 30000);
  }
  await run('bluetoothctl', ['trust', mac]).catch(() => {});
  await run('bluetoothctl', ['--timeout', '15', 'connect', mac], 20000);
  return btInfo(mac);
}

async function btDisconnect(mac) {
  await run('bluetoothctl', ['disconnect', checkMac(mac)]);
  return btInfo(mac);
}

async function btRemove(mac) {
  await run('bluetoothctl', ['remove', checkMac(mac)]);
}

// ---------- Status ----------

function readNum(file) {
  try { return Number(fs.readFileSync(file, 'utf8').trim()); } catch { return null; }
}

function cpuTemp() {
  // Bevorzugt x86_pkg_temp bzw. coretemp, sonst erste thermische Zone
  try {
    const zones = fs.readdirSync('/sys/class/thermal').filter((z) => z.startsWith('thermal_zone'));
    let best = null;
    for (const z of zones) {
      const type = fs.readFileSync(`/sys/class/thermal/${z}/type`, 'utf8').trim();
      const t = readNum(`/sys/class/thermal/${z}/temp`);
      if (t == null) continue;
      if (type === 'x86_pkg_temp') return t / 1000;
      if (best == null) best = t / 1000;
    }
    return best;
  } catch { return null; }
}

async function diskUsage(mount = '/') {
  try {
    const st = await fs.promises.statfs(mount);
    const total = st.blocks * st.bsize;
    const free = st.bavail * st.bsize;
    return { total, used: total - free, free };
  } catch { return null; }
}

/** Alle echten Datenträger (keine Docker-/Snap-/Boot-Mounts) mit Belegung. */
async function disks() {
  let mounts = '';
  try { mounts = fs.readFileSync('/proc/mounts', 'utf8'); } catch { return []; }
  const FS = /^(ext[234]|xfs|btrfs|zfs|nfs4?|cifs|smb3|fuseblk|ntfs3?|exfat|vfat)$/;
  const seen = new Set(); const out = [];
  for (const line of mounts.split('\n')) {
    const [dev, mnt, type] = line.split(' ');
    if (!mnt || !FS.test(type || '')) continue;
    const m = mnt.replace(/\\040/g, ' ');
    if (/^\/(boot|snap|var\/lib\/docker|run|proc|sys)/.test(m) || seen.has(dev)) continue;
    seen.add(dev);
    const u = await diskUsage(m);
    if (u && u.total > 2 * 1024 ** 3) out.push({ mount: m, ...u });
  }
  return out;
}

async function serverStatus() {
  const [l1, l5] = os.loadavg();
  return {
    hostname: os.hostname(),
    uptime: os.uptime(),
    load: { l1, l5, cores: os.cpus().length },
    memory: { total: os.totalmem(), free: os.freemem() },
    temp: cpuTemp(),
    disk: await diskUsage('/'),
    disks: await disks(),
  };
}

/** Pingt die Dienste an (GET, kurzer Timeout). Jede HTTP-Antwort zählt als "läuft". */
async function serviceStatus() {
  const entries = Object.entries(config.get().services || {});
  return Promise.all(entries.map(async ([name, url]) => {
    const t0 = Date.now();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000), redirect: 'manual' });
      return { name, up: true, status: res.status, ms: Date.now() - t0 };
    } catch (e) {
      return { name, up: false, error: e.name === 'TimeoutError' ? 'Zeitüberschreitung' : 'nicht erreichbar' };
    }
  }));
}

// ---------- Ein/Aus ----------

function power(action) {
  const map = { poweroff: ['poweroff'], reboot: ['reboot'] };
  if (!map[action]) throw new Error('Unbekannte Aktion');
  return run('systemctl', map[action]);
}

module.exports = {
  playTestTone,
  testToneWav,
  listSinks, setDefaultSink, applyPreferredSink,
  getVolume, setVolume, changeVolume, toggleMute,
  btDevices, btScan, btConnect, btDisconnect, btRemove,
  serverStatus, serviceStatus, power,
};
