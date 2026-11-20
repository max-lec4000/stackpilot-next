// System → Updates & Sicherungen → Wartungsfenster (Phase 7 Paket 7.5): bereitstehende
// App-Updates automatisch zu einer festen Zeit einspielen (jede Nacht oder an einem Wochentag,
// zur gewählten Stunde). Nur wenn nichts abgespielt wird, keine Sicherung/Wiederherstellung und
// kein anderer Auftrag läuft; sonst innerhalb der Stunde erneut versucht, danach übersprungen.
// Eingespielt wird über denselben geprüften Weg wie per Knopf (mit Prüfung und Rückweg je App).
// Couchdeck bleibt beim manuellen Update.

const SETTINGS = "update-window:settings", LAST = "update-window:last";
export const DAYS = ["daily", 0, 1, 2, 3, 4, 5, 6]; // täglich oder Sonntag … Samstag
const userFacing = (m) => Object.assign(Error(m), { userFacing: true });
const localDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Liegt `now` im Fenster (gewählter Tag, gewählte Stunde)? */
export function inWindow(now, s) {
  return !!s?.enabled && (s.day === "daily" || now.getDay() === s.day) && now.getHours() === s.hour;
}
/** Nächster Fensterbeginn ab `from`. */
export function nextWindow(from, s) {
  if (!s?.enabled) return null;
  const d = new Date(from);
  d.setMinutes(0, 0, 0);
  d.setHours(s.hour);
  for (let i = 0; i < 8; i++) {
    if (d > from && (s.day === "daily" || d.getDay() === s.day)) return d;
    d.setDate(d.getDate() + 1);
    d.setHours(s.hour, 0, 0, 0);
  }
  return null;
}

export class UpdateWindow {
  constructor(hub, maintenance, options = {}) {
    Object.assign(this, { hub, maintenance, engine: hub.engine });
    this.now = options.now || (() => new Date());
    this.busy = options.busy || (() => false); // Sicherung oder Wiederherstellung läuft
    this.running = false;
  }
  settings() {
    return this.engine.vault.get(SETTINGS) || { enabled: false, day: 0, hour: 5 };
  }
  async pending() {
    try { return (await this.maintenance.list()).services.filter((x) => x.update).map((x) => x.name); } catch { return []; }
  }
  async status() {
    const s = this.settings();
    return { ...s, nextRun: nextWindow(this.now(), s)?.toISOString() || null, running: this.running,
      pending: await this.pending(), last: this.engine.vault.get(LAST) || null, days: DAYS };
  }
  save(body) {
    if (body.confirmation !== "OK") throw userFacing("Wartungsfenster mit OK bestätigen.");
    if (typeof body.enabled !== "boolean") throw userFacing("Ungültige Angabe.");
    const day = body.day === "daily" ? "daily" : Number(body.day), hour = Number(body.hour);
    if (!DAYS.includes(day) || !Number.isSafeInteger(hour) || hour < 0 || hour > 23) throw userFacing("Tag und Stunde wählen.");
    const prev = this.settings();
    this.engine.vault.set(SETTINGS, { enabled: body.enabled, day, hour, lastDay: prev.lastDay, updatedAt: new Date().toISOString() });
    return this.status();
  }
  /** Läuft gerade eine Wiedergabe? (Fehler zählen als „ja“ – lieber später.) */
  async playing() {
    const current = this.engine.current();
    if (!current?.plan.spec.selected.includes("Jellyfin")) return false;
    try {
      const { s, plan } = await this.hub.context(["Jellyfin"]);
      const sessions = await this.hub.library.request(s, plan, "/Sessions?ActiveWithinSeconds=960");
      return (Array.isArray(sessions) ? sessions : []).some((x) => x?.NowPlayingItem);
    } catch { return true; }
  }
  /** Ein Takt (jede Minute): im Fenster und frei → Updates einspielen. */
  async tick() {
    const s = this.settings(), now = this.now();
    if (this.running || !inWindow(now, s) || s.lastDay === localDay(now)) return null;
    const lastMinute = now.getMinutes() >= 55;
    const reason = this.engine.store.activeLease() || this.busy() ? "Ein anderer Auftrag lief." : (await this.playing()) ? "Es wurde gerade etwas abgespielt." : null;
    if (reason) {
      if (!lastMinute) return null; // innerhalb der Stunde erneut versuchen
      this.engine.vault.set(SETTINGS, { ...s, lastDay: localDay(now) });
      const record = { at: now.toISOString(), skipped: reason, results: [] };
      this.engine.vault.set(LAST, record);
      return record;
    }
    this.engine.vault.set(SETTINGS, { ...s, lastDay: localDay(now) });
    this.running = true;
    try {
      const list = (await this.maintenance.list()).services.filter((x) => x.update);
      const record = { at: now.toISOString(), results: [] };
      if (list.length) {
        const r = await this.maintenance.applyBatch({ confirmation: "OK", targets: list.map(({ name, review }) => ({ name, review })) }, null);
        record.results = r.results;
      }
      record.failed = record.results.filter((x) => x.phase === "failed").length;
      this.engine.vault.set(LAST, record);
      return record;
    } catch (e) {
      const record = { at: now.toISOString(), results: [], failed: 1, error: String(e?.message || e).slice(0, 300) };
      this.engine.vault.set(LAST, record);
      return record;
    } finally { this.running = false; }
  }
  start() {
    this.timer = setInterval(() => void this.tick().catch(() => {}), 60000);
    this.timer.unref?.();
  }
  close() { clearInterval(this.timer); }
}
