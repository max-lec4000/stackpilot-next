// Downloads → Seeding und Geschwindigkeit (Phase 7.2b): ausgewählte qBittorrent-Einstellungen
// lesen und schreiben – Seedingziel, Dauerlimits und ein Zeitplan für gedrosselte
// Geschwindigkeit. Nur diese Schlüssel werden geändert, danach wird zurückgelesen.
// Nie „Torrent samt Dateien löschen“: ein noch nicht importierter Download wäre sonst weg.

const KIB = 1024;
const DAYS = { all: 0, weekdays: 1, weekends: 2 };
const clock = (h, m) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/** qBittorrent-Einstellungen → einfache Darstellung. */
export function project(p) {
  const days = Object.entries(DAYS).find(([, v]) => v === p.scheduler_days)?.[0] || "custom";
  return {
    seeding: {
      ratio: p.max_ratio_enabled ? Math.round(num(p.max_ratio) * 100) / 100 : null,
      hours: p.max_seeding_time_enabled ? Math.round((num(p.max_seeding_time) / 60) * 10) / 10 : null,
      // 0 anhalten, 1 entfernen (Dateien bleiben); 2/3 (Superseeding, mit Dateien) zeigt
      // StackPilot nur an und überschreibt sie nicht ungefragt.
      action: p.max_ratio_act === 1 ? "remove" : p.max_ratio_act === 0 ? "stop" : "other",
    },
    limits: {
      downKiB: Math.round(num(p.dl_limit) / KIB) || 0,
      upKiB: Math.round(num(p.up_limit) / KIB) || 0,
    },
    schedule: {
      enabled: p.scheduler_enabled === true,
      from: clock(p.schedule_from_hour || 0, p.schedule_from_min || 0),
      to: clock(p.schedule_to_hour || 0, p.schedule_to_min || 0),
      days,
      downKiB: Math.round(num(p.alt_dl_limit) / KIB) || 0,
      upKiB: Math.round(num(p.alt_up_limit) / KIB) || 0,
    },
  };
}

const kib = (v, name) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 0 || n > 10_000_000) throw Error(`${name}: ganze Zahl in KiB/s (0 = unbegrenzt).`);
  return n;
};
const time = (v, name) => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(v));
  if (!m) throw Error(`${name}: Uhrzeit als HH:MM.`);
  return [Number(m[1]), Number(m[2])];
};

/** Eingaben prüfen → qBittorrent-Schlüssel. */
export function toPreferences(body) {
  const s = body.seeding || {}, l = body.limits || {}, z = body.schedule || {};
  const ratio = s.ratio === null || s.ratio === "" || s.ratio === undefined ? null : Number(s.ratio);
  if (ratio !== null && !(ratio >= 0.1 && ratio <= 100)) throw Error("Verhältnis zwischen 0,1 und 100.");
  const hours = s.hours === null || s.hours === "" || s.hours === undefined ? null : Number(s.hours);
  if (hours !== null && !(hours >= 0.5 && hours <= 8760)) throw Error("Seedingdauer zwischen 0,5 und 8760 Stunden.");
  if (!["stop", "remove"].includes(s.action)) throw Error("Was nach dem Seedingziel passiert: anhalten oder entfernen.");
  if (typeof z.enabled !== "boolean") throw Error("Zeitplan an oder aus angeben.");
  if (!Object.hasOwn(DAYS, z.days)) throw Error("Tage: täglich, werktags oder am Wochenende.");
  const [fh, fm] = time(z.from, "Beginn"), [th, tm] = time(z.to, "Ende");
  if (z.enabled && fh === th && fm === tm) throw Error("Beginn und Ende des Zeitplans müssen sich unterscheiden.");
  return {
    max_ratio_enabled: ratio !== null,
    max_ratio: ratio ?? -1,
    max_seeding_time_enabled: hours !== null,
    max_seeding_time: hours === null ? -1 : Math.round(hours * 60),
    max_ratio_act: s.action === "remove" ? 1 : 0,
    dl_limit: kib(l.downKiB, "Download-Limit") * KIB,
    up_limit: kib(l.upKiB, "Upload-Limit") * KIB,
    scheduler_enabled: z.enabled,
    schedule_from_hour: fh, schedule_from_min: fm, schedule_to_hour: th, schedule_to_min: tm,
    scheduler_days: DAYS[z.days],
    alt_dl_limit: kib(z.downKiB, "Gedrosselt Download") * KIB,
    alt_up_limit: kib(z.upKiB, "Gedrosselt Upload") * KIB,
  };
}

export class DownloadSettings {
  constructor(hub) {
    this.hub = hub;
  }
  ready() {
    const current = this.hub.engine.current();
    if (current?.job.status !== "completed" || !current.plan.spec.selected.includes("qBittorrent"))
      throw Object.assign(Error("Kein eingerichteter Downloadclient."), { userFacing: true });
  }
  async read() {
    this.ready();
    const { s } = await this.hub.context(["qBittorrent"]);
    const p = await s.qbit("/app/preferences");
    if (!p || typeof p !== "object") throw Error("qBittorrent-Einstellungen nicht lesbar.");
    return project(p);
  }
  async change(body) {
    if (body.confirmation !== "OK") throw Error("Einstellungen mit OK bestätigen.");
    this.ready();
    const prefs = toPreferences(body);
    return this.hub.mutate(["qBittorrent"], async ({ s }) => {
      await s.qbit("/app/setPreferences", { json: JSON.stringify(prefs) });
      const after = await s.qbit("/app/preferences");
      // qBittorrent meldet ausgeschaltete Ziele selbst als -1 – daher genügt ein direkter Vergleich
      const wrong = Object.entries(prefs).filter(([k, v]) =>
        typeof v === "boolean" ? after[k] !== v : !(Math.abs(Number(after[k]) - v) < 0.001));
      if (wrong.length) throw Error("qBittorrent hat nicht alle Einstellungen übernommen: " + wrong.map(([k]) => k).join(", "));
      return project(after);
    });
  }
}
