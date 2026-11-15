'use strict';
// Liest Gamepads direkt über evdev (/dev/input/event*), unabhängig davon,
// welches Fenster (Oberfläche oder mpv) gerade im Vordergrund ist.
// Erzeugt abstrakte Aktionen: up/down/left/right/select/back/menu/home/...
const { EventEmitter } = require('events');
const fs = require('fs');
const { spawn } = require('child_process');
const { execFileSync } = require('child_process');

/**
 * Liest die echten Achsenbereiche (min/max/flat) per EVIOCGABS-ioctl.
 * Node kann kein ioctl, deshalb ein kurzer python3-Aufruf (ist auf Ubuntu immer da).
 */
const ABSINFO_PY = `
import fcntl, struct, json, sys
fd = open(sys.argv[1], 'rb', buffering=0)
out = {}
for code in (0, 1, 2, 3, 4, 5, 16, 17):
    req = (2 << 30) | (24 << 16) | (0x45 << 8) | (0x40 + code)
    try:
        v, mn, mx, fuzz, flat, res = struct.unpack('6i', fcntl.ioctl(fd, req, bytes(24)))
        out[code] = {'min': mn, 'max': mx, 'flat': flat, 'value': v}
    except OSError:
        pass
print(json.dumps(out))
`;

function readAbsInfo(devPath) {
  try {
    return JSON.parse(execFileSync('python3', ['-c', ABSINFO_PY, devPath], { timeout: 3000 }).toString());
  } catch { return null; }
}

const EV_KEY = 1;
const EV_ABS = 3;
const EVENT_SIZE = 24; // struct input_event auf 64-Bit

// Linux-Tastencodes (input-event-codes.h)
const BUTTONS = {
  304: 'select', // BTN_SOUTH: A / Kreuz
  305: 'back', // BTN_EAST: B / Kreis
  307: 'north', // BTN_NORTH: Y bzw. Dreieck (Xbox über xpad: X)
  308: 'west', // BTN_WEST: X bzw. Quadrat (Xbox über xpad: Y)
  310: 'lb',
  311: 'rb',
  312: 'lt',
  313: 'rt',
  314: 'view', // Select / Share / View
  315: 'menu', // Start / Options / Menu
  316: 'home', // Xbox- / PS-Taste
  317: 'ls',
  318: 'rs',
  544: 'up', 545: 'down', 546: 'left', 547: 'right', // BTN_DPAD_*
  // Manche Fernbedienungen / CEC melden Tastaturcodes
  103: 'up', 108: 'down', 105: 'left', 106: 'right', 28: 'select', 352: 'select', 1: 'back', 158: 'back', 172: 'home',
  164: 'playpause', 207: 'playpause', 119: 'playpause', 128: 'stop', 166: 'stop', 163: 'next', 165: 'previous',
  168: 'rewind', 208: 'fastforward', 115: 'volup', 114: 'voldown', 113: 'mute',
};
// Pads im DirectInput-Schema (z. B. EasySMX D10 / Xbox One S über Bluetooth mit hid-generic)
// melden ihre Tasten fortlaufend ab 304: A B X Y LB RB View Menü LS RS (+ Guide als KEY_MENU 139).
// Erkennbar daran, dass sie BTN_C (306) und BTN_Z (309) haben, die echte XInput-Pads nie melden.
const DINPUT_BUTTONS = {
  304: 'select', 305: 'back', 306: 'west', 307: 'north', 308: 'lb', 309: 'rb',
  310: 'view', 311: 'menu', 312: 'ls', 313: 'rs', 139: 'home', 172: 'home', 316: 'home',
};
const ABS_Z = 2, ABS_RZ = 5;
const TRIGGER_THRESHOLD = 0.5;

const REPEATABLE = new Set(['up', 'down', 'left', 'right', 'volup', 'voldown', 'rewind', 'fastforward',
  'stick-up', 'stick-down', 'stick-left', 'stick-right', 'lt', 'rt']);
const ABS_X = 0, ABS_Y = 1, ABS_HAT0X = 16, ABS_HAT0Y = 17;

/** Prüft im "B: KEY=" Bitfeld aus /proc/bus/input/devices, ob ein Tastencode vorhanden ist. */
function hasKey(block, code) {
  const m = /B: KEY=([0-9a-f ]+)/.exec(block);
  if (!m) return false;
  const words = m[1].trim().split(/\s+/).reverse(); // letztes Wort = Bits 0..63
  const word = words[Math.floor(code / 64)];
  if (!word) return false;
  return ((BigInt('0x' + word) >> BigInt(code % 64)) & 1n) === 1n;
}

const REPEAT_DELAY = 380;
const REPEAT_RATE = 110;
const STICK_THRESHOLD = 0.6;

class Gamepads extends EventEmitter {
  constructor() {
    super();
    this.devices = new Map(); // eventN -> { Leseprozess, Name, Inode }
    this.held = new Map(); // action -> timer
    this.axes = new Map(); // `${dev}:${code}` -> { min, max }
    this.scanTimer = null;
  }

  start() {
    this.scan();
    this.scanTimer = setInterval(() => this.scan(), 3000);
  }

  stop() {
    clearInterval(this.scanTimer);
    for (const d of this.devices.values()) d.close();
    this.devices.clear();
  }

  /** Findet Joystick-Geräte über /proc/bus/input/devices. */
  scan() {
    let text = '';
    try { text = fs.readFileSync('/proc/bus/input/devices', 'utf8'); } catch { return; }
    const found = new Map();
    for (const block of text.split(/\n\n+/)) {
      const name = /N: Name="([^"]*)"/.exec(block)?.[1] || 'Gamepad';
      const handlers = /H: Handlers=([^\n]*)/.exec(block)?.[1] || '';
      const ev = /\bevent(\d+)\b/.exec(handlers);
      if (!ev) continue;
      // Echtes Gamepad: meldet BTN_SOUTH (304). Touchpads mit js-Handler fallen so raus.
      const isJoystick = /\bjs\d+\b/.test(handlers) && hasKey(block, 304);
      // Fernbedienungen (CEC, IR) melden sich als Tastatur mit "remote"/"CEC" im Namen
      const isRemote = /cec|remote|ir receiver/i.test(name);
      if (isJoystick || isRemote) {
        found.set('event' + ev[1], { name, dinput: hasKey(block, 306) && hasKey(block, 309) });
      }
    }
    for (const [dev, d] of this.devices) {
      let replaced = false;
      if (found.has(dev)) {
        // Gleiche Nummer, aber neu angelegtes Gerät (Controller hat sich neu verbunden)?
        try { replaced = fs.statSync('/dev/input/' + dev).ino !== d.ino; } catch { replaced = true; }
      }
      if (!found.has(dev) || replaced) {
        d.close();
        this.devices.delete(dev);
        this.emit('log', `Controller ${d.name} (${dev}) ${replaced ? 'neu verbunden – öffne neu' : 'entfernt'}`);
        if (!replaced) this.emit('disconnected', d.name);
      }
    }
    for (const [dev, info] of found) {
      if (!this.devices.has(dev)) this.open(dev, info.name, info.dinput);
    }
  }

  /**
   * Gerät öffnen. Gelesen wird in einem eigenen kleinen Prozess (cat), der Daten über eine
   * Pipe liefert. Früher: fs.createReadStream = blockierende Lesevorgänge im libuv-Threadpool
   * (nur 4 Threads). Nach mehreren Schlaf-/Aufwach-Zyklen des Controllers konnten hängende
   * Lesevorgänge den Pool füllen – danach kamen keine Tasten mehr an, auch nicht nach dem
   * Wiederverbinden. Ein Hilfsprozess kann Couchdeck nicht blockieren und endet von selbst,
   * wenn das Gerät verschwindet.
   */
  open(dev, name, dinput = false) {
    const path = '/dev/input/' + dev;
    let ino = null;
    try {
      fs.accessSync(path, fs.constants.R_OK);
      ino = fs.statSync(path).ino;
    } catch (e) {
      // Direkt nach dem Verbinden setzt udev die Rechte evtl. noch – der nächste Scan versucht es erneut
      if (e.code === 'EACCES') this.emit('log', `Noch kein Zugriff auf ${path} (${name}), neuer Versuch …`);
      return;
    }
    const child = spawn('cat', [path], { stdio: ['ignore', 'pipe', 'pipe'] });
    const sock = child.stdout;
    // xpad (Xbox per USB/Dongle) meldet X als BTN_NORTH und Y als BTN_WEST – umgekehrt zur Norm.
    const swapXY = !dinput && /xbox|x-box|microsoft/i.test(name);
    const entry = { sock, ino, name, rest: Buffer.alloc(0), swapXY, dinput, triggers: new Set(), seen: new Set(), closed: false };
    entry.close = () => {
      if (entry.closed) return;
      entry.closed = true;
      for (const a of [...this.held.keys()]) this.release(a); // gedrückte Richtungen nicht "weiterlaufen" lassen
      try { child.kill('SIGKILL'); } catch { /* egal */ }
    };
    this.devices.set(dev, entry);

    // Echte Achsenbereiche übernehmen (z. B. Xbox über Bluetooth: 0..65535, Mitte 32768)
    const info = readAbsInfo(path);
    if (info) {
      for (const [code, a] of Object.entries(info)) {
        if (a.max > a.min) this.axes.set(`${dev}:${code}`, { min: a.min, max: a.max, fixed: true });
        // Z/RZ in Ruhe am Minimum = Trigger (LT/RT); mittig = rechter Stick
        if ((+code === ABS_Z || +code === ABS_RZ) && a.max > a.min && a.value - a.min < (a.max - a.min) * 0.2) entry.triggers.add(+code);
      }
    }
    // alte Richtungszustände dieses Gerätes vergessen
    for (const k of [...this.axes.keys()]) if (k.startsWith(dev + ':') && k.endsWith(':dir')) this.axes.delete(k);
    this.emit('log', `Controller ${name} (${dev}): ${dinput ? 'DirectInput-Belegung' : 'Standard-Belegung'}, Trigger ${[...entry.triggers].join('/') || '-'}, Achsen ${JSON.stringify(info)}`);
    this.emit('connected', name);

    sock.on('data', (chunk) => {
      const buf = entry.rest.length ? Buffer.concat([entry.rest, chunk]) : chunk;
      let off = 0;
      for (; off + EVENT_SIZE <= buf.length; off += EVENT_SIZE) {
        const type = buf.readUInt16LE(off + 16);
        const code = buf.readUInt16LE(off + 18);
        const value = buf.readInt32LE(off + 20);
        this.handle(dev, type, code, value, entry);
      }
      entry.rest = buf.subarray(off);
    });
    const gone = (why) => {
      if (entry.closed) return;
      entry.close();
      if (this.devices.get(dev) === entry) this.devices.delete(dev);
      this.emit('log', `Controller ${name} (${dev}) getrennt (${why})`);
      this.emit('disconnected', name);
    };
    let errText = '';
    child.stderr.on('data', (d) => { errText += d.toString(); });
    child.on('error', (e) => gone(e.code || e.message));
    child.on('exit', (code) => gone(errText.trim() || `Lesen beendet (${code})`));
  }

  handle(dev, type, code, value, entry) {
    if (type === EV_KEY) {
      let action = entry?.dinput ? (DINPUT_BUTTONS[code] ?? BUTTONS[code]) : BUTTONS[code];
      if (entry?.swapXY && (action === 'north' || action === 'west')) action = action === 'north' ? 'west' : 'north';
      if (entry && value === 1 && !entry.seen.has(code)) {
        entry.seen.add(code); // jede Taste einmal protokollieren (Diagnose der Belegung)
        this.emit('log', `Taste ${code} (${entry.name}) -> ${action || 'nicht belegt'}`);
      }
      if (value === 1) this.emit('raw', { code, action: action || null, device: entry?.name || '' });
      if (!action) return;
      if (value === 1) this.press(action);
      else if (value === 0) { this.release(action); this.emit('action-up', action); }
      // value 2 = Autorepeat des Kernels: ignorieren, wir wiederholen selbst
    } else if (type === EV_ABS) {
      if (code === ABS_HAT0X) this.axisDir(`${dev}:hx`, value, 'left', 'right', true);
      else if (code === ABS_HAT0Y) this.axisDir(`${dev}:hy`, value, 'up', 'down', true);
      else if (entry?.triggers.has(code)) {
        // Analoge Trigger als Tasten LT/RT
        const r = this.axes.get(`${dev}:${code}`);
        const t = r ? (value - r.min) / (r.max - r.min) : 0;
        this.axisDir(`${dev}:t${code}`, t >= TRIGGER_THRESHOLD ? 1 : 0, 'none', code === ABS_Z ? 'lt' : 'rt');
      } else if (code === ABS_X || code === ABS_Y) {
        const n = this.normalize(dev, code, value);
        const dir = n <= -STICK_THRESHOLD ? -1 : n >= STICK_THRESHOLD ? 1 : 0;
        // Linker Stick meldet eigene Aktionen (im Film: spulen statt Lautstärke wie das Kreuz)
        if (code === ABS_X) this.axisDir(`${dev}:sx`, dir, 'stick-left', 'stick-right');
        else this.axisDir(`${dev}:sy`, dir, 'stick-up', 'stick-down');
      }
    }
  }

  normalize(dev, code, value) {
    const key = `${dev}:${code}`;
    let r = this.axes.get(key);
    if (!r) {
      // Notlösung ohne ioctl-Daten: Bereich am Wert erraten
      r = value < 0 ? { min: -32768, max: 32767 } : value > 32767 ? { min: 0, max: 65535 } : value > 255 ? { min: -32768, max: 32767 } : { min: 0, max: 255 };
      this.axes.set(key, r);
    }
    if (!r.fixed && (value < r.min || value > r.max)) {
      r.min = Math.min(r.min, value); r.max = Math.max(r.max, value);
    }
    return ((value - r.min) / (r.max - r.min)) * 2 - 1;
  }

  axisDir(key, value, neg, pos) {
    const prev = this.axes.get(key + ':dir') || 0;
    const dir = Math.sign(value);
    if (dir === prev) return;
    this.axes.set(key + ':dir', dir);
    if (prev) this.release(prev < 0 ? neg : pos);
    if (dir) this.press(dir < 0 ? neg : pos);
  }

  press(action) {
    this.emit('action', action);
    if (REPEATABLE.has(action)) {
      clearTimeout(this.held.get(action));
      const tick = () => { this.emit('action', action); this.held.set(action, setTimeout(tick, REPEAT_RATE)); };
      this.held.set(action, setTimeout(tick, REPEAT_DELAY));
    }
  }

  release(action) {
    clearTimeout(this.held.get(action));
    this.held.delete(action);
  }

  connectedNames() {
    return [...this.devices.values()].map((d) => d.name);
  }
}

module.exports = { Gamepads };
