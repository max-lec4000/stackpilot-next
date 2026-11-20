// System → Updates & Sicherungen → Gesamtsicherung wiederherstellen (Phase 7 Paket 7.5).
// Spielt die App-Einstellungen und -Datenbanken aus einer Gesamtsicherung auf DIESEN Stack
// zurück – per Knopf, mit automatischer Rückkehr:
//   prüfen → neben die App-Daten entpacken → Dienstschlüssel vergleichen → Besitz prüfen →
//   Apps anhalten → Ordner tauschen (bisheriger Stand bleibt als „<appdata>-vorher-…“) →
//   Apps starten → Dienste prüfen → bei Fehler zurücktauschen und wieder starten.
// Bewusst NICHT zurückgespielt: der StackPilot-Zustand (Anmeldungen, Tresor, Zuschauer) und die
// Streamystats-Datenbank (Wiedergabe-Statistik) – beide bleiben auf aktuellem Stand.
import { randomUUID } from "node:crypto";
import { lstat, readFile, readdir, realpath, rename, rm, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { verifyStackArchive, restoreStackArchive } from "./stack-archive.js";
import { stackBackupPlan, freezeStackForBackup } from "./stack-backup.js";
import { ARCHIVE } from "./stack-backup-job.js";
import { catalog } from "./catalog.js";

const PASSPHRASE = "stack-backup:passphrase", LAST = "stack-restore:last", JOURNAL = "stack-restore:journal";
const KEEP_OUT = new Set(["streamystats", ".stackpilot-owner.json", ".stackpilot-container-backups"]);
const PREVIOUS = /-vorher-\d{8}-\d{4}$/;
const userFacing = (m) => Object.assign(Error(m), { userFacing: true });
const stamp = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;

/** Dienstschlüssel aus den entpackten App-Daten lesen – nur Apps, deren Schlüssel StackPilot
 *  selbst vergibt (Seerr erzeugt seinen eigenen; dort entscheidet die Dienstprüfung danach). */
export async function stagedKeys(appdata, names, read = readFile) {
  const keys = {};
  for (const name of names) {
    const slug = catalog.services[name]?.slug;
    if (!slug) continue;
    try {
      if (["Radarr", "Sonarr", "Lidarr", "Prowlarr"].includes(name))
        keys[name] = /<ApiKey>([^<]+)<\/ApiKey>/.exec(await read(path.join(appdata, slug, "config.xml"), "utf8"))?.[1] ?? null;
      else if (name === "Bazarr")
        keys[name] = /^auth:\s*\n(?:[ \t]+.*\n)*?[ \t]+apikey:\s*['"]?([A-Za-z0-9]+)/m.exec(await read(path.join(appdata, slug, "config", "config.yaml"), "utf8"))?.[1] ?? null;
    } catch { /* Datei fehlt → nicht vergleichbar, die Dienstprüfung danach entscheidet */ }
  }
  return keys;
}

/** Gibt es in einem Baum Einträge, die nicht dem StackPilot-Nutzer gehören (oder Links)? */
export async function foreignEntries(dir, uid, limit = 200000) {
  let seen = 0;
  const walk = async (d) => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      if (++seen > limit) return "zu groß";
      const p = path.join(d, e.name), st = await lstat(p);
      if (st.uid !== uid) return path.relative(dir, p) || ".";
      if (e.isDirectory()) { const hit = await walk(p); if (hit) return hit; }
    }
    return null;
  };
  const top = await lstat(dir).catch(() => null);
  if (!top) return null;
  if (top.uid !== uid) return ".";
  return top.isDirectory() ? walk(dir) : null;
}

export class StackRestoreJob {
  constructor(hub, backupJob, options = {}) {
    this.hub = hub;
    this.engine = hub.engine;
    this.backup = backupJob;
    this.now = options.now || (() => new Date());
    this.backupPlan = options.backupPlan || stackBackupPlan;
    this.waitMs = options.waitMs ?? 10000;
    this.verifyAttempts = options.verifyAttempts ?? 12; // Apps brauchen nach dem Start etwas (Seerr meldet anfangs 403)
    this.running = null;
  }
  plan() {
    const current = this.engine.current();
    if (current?.job.status !== "completed") throw userFacing("Kein eingerichteter Stack.");
    return current.plan;
  }
  archivePath(name) {
    const settings = this.backup.settings();
    if (!settings) throw userFacing("Zuerst die Gesamtsicherung einrichten.");
    if (typeof name !== "string" || !ARCHIVE.test(name)) throw userFacing("Unbekannte Sicherung.");
    return path.join(settings.target, name);
  }
  passphrase() {
    const value = this.engine.vault.get(PASSPHRASE)?.value;
    if (!value) throw userFacing("Sicherungspasswort fehlt in StackPilot.");
    return value;
  }
  async previousCopies(plan) {
    const appdata = await realpath(plan.appdata);
    const dir = path.dirname(appdata), base = path.basename(appdata);
    const names = (await readdir(dir).catch(() => [])).filter((n) => n.startsWith(base + "-vorher-") && PREVIOUS.test(n)).sort().reverse();
    return Promise.all(names.map(async (name) => ({ name, createdAt: (await stat(path.join(dir, name))).mtime.toISOString() })));
  }
  async status() {
    const plan = this.plan();
    const journal = this.engine.vault.get(JOURNAL);
    return {
      running: this.running ? { startedAt: this.running.startedAt, step: this.running.step, archive: this.running.archive } : null,
      last: this.engine.vault.get(LAST) || null,
      previous: await this.previousCopies(plan),
      // Absturz mitten im Tausch: zurückrollen per Knopf
      recoveryRequired: !this.running && !!journal && !["done", "rolled-back"].includes(journal.state),
    };
  }
  /** Archiv prüfen (vollständig entschlüsseln, nichts schreiben) und zeigen, was zurückkäme. */
  async check(body) {
    const plan = this.plan();
    const file = this.archivePath(body.name);
    const r = await verifyStackArchive({ archive: file, passphrase: this.passphrase() });
    const rootId = plan.rootId || plan.id;
    const same = r.manifest?.stackpilot?.rootId === rootId;
    return {
      name: body.name, createdAt: r.manifest?.createdAt || null, entries: r.entries, totalBytes: r.totalBytes, sameStack: same,
      apps: r.apps.filter((a) => !KEEP_OUT.has(a)), kept: ["StackPilot-Anmeldungen und -Einstellungen", "Streamystats (Wiedergabe-Statistik)"],
      skippedCount: r.manifest?.skippedCount || 0,
    };
  }
  /** Wiederherstellung starten (läuft im Hintergrund, Stand über status()). */
  async restore(body) {
    if (body.confirmation !== "OK") throw userFacing("Wiederherstellung mit OK bestätigen.");
    if (body.phrase !== "WIEDERHERSTELLEN") throw userFacing("Zur Sicherheit WIEDERHERSTELLEN eintippen.");
    const plan = this.plan();
    const file = this.archivePath(body.name);
    if (this.running || this.backup.running) throw userFacing("Eine Sicherung oder Wiederherstellung läuft bereits.");
    const journal = this.engine.vault.get(JOURNAL);
    if (journal && !["done", "rolled-back"].includes(journal.state)) throw userFacing("Eine frühere Wiederherstellung wurde unterbrochen. Zuerst „Zurückrollen“.");
    const owner = "stack-restore:" + randomUUID();
    if (!this.engine.store.claim(owner)) throw userFacing("Ein anderer Auftrag läuft. Bitte danach erneut versuchen.");
    const started = this.now();
    this.running = { startedAt: started.toISOString(), step: "Vorbereitung", archive: body.name };
    const heartbeat = setInterval(() => this.engine.store.claim(owner), 10000);
    heartbeat.unref?.();
    const done = this.execute(plan, file, body.name, started)
      .finally(() => { clearInterval(heartbeat); this.engine.store.release(owner); this.running = null; });
    done.catch(() => {});
    return { started: true, startedAt: started.toISOString() };
  }
  step(s) { if (this.running) this.running.step = s; }
  journal(state, extra = {}) {
    const before = this.engine.vault.get(JOURNAL) || {};
    this.engine.vault.set(JOURNAL, { ...before, ...extra, state, at: new Date().toISOString() });
  }
  freezeOptions() {
    return {
      docker: (args) => this.engine.docker(args, { timeout: ["stop", "start"].includes(args[0]) ? 180000 : 60000 }),
      manager: { running: async () => false, stop: async () => {}, start: async () => {} },
      journal: async (r) => this.journal(this.engine.vault.get(JOURNAL)?.state || "prepared", { freeze: r.state, containers: r.previous.map((c) => c.id) }),
    };
  }
  /** Ordner gemäß Journal zurücktauschen (bei laufenden Apps nur innerhalb von freeze aufrufen). */
  async swapBack(j) {
    for (const entry of [...(j.moved || [])].reverse()) {
      const current = path.join(j.appdata, entry.name);
      if (entry.restored) await rm(current, { recursive: true, force: true });
      if (entry.hadPrevious) await rename(path.join(j.previousDir, entry.name), current);
    }
    await rm(j.previousDir, { recursive: true, force: true }).catch(() => {});
  }
  async execute(plan, file, name, started) {
    const record = { at: started.toISOString(), archive: name, ok: false };
    const appdata = await realpath(plan.appdata);
    const staging = `${appdata}-wiederherstellung-${randomUUID().slice(0, 8)}`;
    const previousDir = `${appdata}-vorher-${stamp(started)}`;
    let swapped = false;
    try {
      this.step("Sicherung entpacken");
      const r = await restoreStackArchive({ archive: file, destination: staging, passphrase: this.passphrase() });
      if (r.manifest?.stackpilot?.rootId !== (plan.rootId || plan.id)) throw userFacing("Die Sicherung gehört zu einem anderen Stack.");
      const stagedAppdata = path.join(staging, "appdata");
      const entries = (await readdir(stagedAppdata)).filter((n) => !KEEP_OUT.has(n) && !n.startsWith("."));
      if (!entries.length) throw userFacing("Die Sicherung enthält keine App-Daten.");

      this.step("Dienstschlüssel vergleichen");
      const { s } = await this.hub.context(plan.spec.selected);
      const keys = await stagedKeys(stagedAppdata, plan.spec.selected);
      const changed = Object.entries(keys).filter(([n, k]) => {
        try { const now = s.credentials(n)?.apiKey; return k && now && k !== now; } catch { return false; }
      }).map(([n]) => n);
      if (changed.length) throw userFacing(`Seit der Sicherung wurden Dienstschlüssel erneuert (${changed.join(", ")}). Diese Sicherung passt nicht mehr ohne Begleitung – siehe Anleitung „Gesamtsicherung wiederherstellen“.`);

      this.step("Besitzrechte prüfen");
      for (const e of entries) {
        const hit = await foreignEntries(path.join(appdata, e), plan.uid);
        if (hit) throw userFacing(`„${e}“ enthält Dateien eines anderen Container-Nutzers (${hit}). Nur begleitet wiederherstellbar.`);
      }
      // Ausgangslage: Fehler, die schon vorher bestehen, sind kein Grund zur Rückkehr
      this.step("Ausgangslage prüfen");
      const baseline = (await this.verifyServices(plan, 1))[0] || null;
      const info = await this.backupPlan(this.engine);

      this.step("Apps anhalten und Daten tauschen");
      const moved = [];
      this.journal("prepared", { appdata, previousDir, staging, moved, archive: name });
      await freezeStackForBackup(info, {
        ...this.freezeOptions(),
        archive: async () => {
          await mkdir(previousDir, { mode: 0o700 });
          for (const e of entries) {
            const current = path.join(appdata, e);
            const entry = { name: e, hadPrevious: !!(await lstat(current).catch(() => null)), restored: false };
            moved.push(entry);
            this.journal("swapping", { moved });
            if (entry.hadPrevious) await rename(current, path.join(previousDir, e));
            await rename(path.join(stagedAppdata, e), current);
            entry.restored = true;
            this.journal("swapping", { moved });
          }
          swapped = true;
          this.journal("swapped", { moved });
        },
      });

      this.step("Apps prüfen");
      let failed = await this.verifyServices(plan);
      if (failed.length && baseline && failed[0] === baseline) {
        record.warning = `Bestand schon vor der Wiederherstellung und besteht weiter: ${baseline}`;
        failed = [];
      }
      if (failed.length) {
        this.step("Zurückkehren zum vorherigen Stand");
        const j = this.engine.vault.get(JOURNAL);
        await freezeStackForBackup(await this.backupPlan(this.engine), { ...this.freezeOptions(), archive: () => this.swapBack(j) });
        swapped = false;
        StackRestoreJob.forgetSessions((await this.hub.context(plan.spec.selected).catch(() => ({}))).s);
        this.journal("rolled-back");
        Object.assign(record, { rolledBack: true, error: `Nach dem Zurückspielen nicht bereit: ${failed.join("; ").slice(0, 300).replace(/[.\s]+$/, "")}. Der vorherige Stand ist wiederhergestellt.` });
      } else {
        this.journal("done");
        for (const old of (await this.previousCopies(plan)).slice(1))
          await rm(path.join(path.dirname(appdata), old.name), { recursive: true, force: true });
        Object.assign(record, { ok: true, apps: entries, previous: path.basename(previousDir),
          durationSeconds: Math.round((this.now().getTime() - started.getTime()) / 1000) });
      }
    } catch (e) {
      record.error = String(e?.message || e).slice(0, 400);
      const state = this.engine.vault.get(JOURNAL)?.state;
      if (swapped || state === "swapping" || state === "swapped") record.error += " Daten wurden schon getauscht – „Zurückrollen“ stellt den vorherigen Stand her.";
      else if (state === "prepared") this.journal("rolled-back");
    } finally {
      await rm(staging, { recursive: true, force: true }).catch(() => {});
      this.engine.vault.set(LAST, record);
    }
    return record;
  }
  static forgetSessions(s) {
    if (s?.cookies && typeof s.cookies === "object") for (const k of Object.keys(s.cookies)) delete s.cookies[k];
  }
  /** Alle Dienste erreichbar und mit den gespeicherten Zugängen nutzbar? Liefert Fehlermeldungen. */
  async verifyServices(plan, attempts = this.verifyAttempts) {
    let last = null;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const { s } = await this.hub.context(plan.spec.selected);
        // Gemerkte Anmeldungen (z. B. Seerr-Sitzung) gehören zum alten Datenstand – neu anmelden
        StackRestoreJob.forgetSessions(s);
        for (const name of plan.spec.selected.filter((n) => catalog.services[n]?.port && !["Gluetun", "ApiRelay", "VpnProbe"].includes(n)))
          await s.wait(name);
        await s.verify();
        return [];
      } catch (e) {
        last = String(e?.message || e).slice(0, 200);
        if (attempt + 1 < attempts) await new Promise((r) => setTimeout(r, this.waitMs));
      }
    }
    return [last];
  }
  /** Nach einem Absturz mitten im Tausch: alles auf den vorherigen Stand zurück. */
  async recover(body) {
    if (body.confirmation !== "OK") throw userFacing("Zurückrollen mit OK bestätigen.");
    if (this.running) throw userFacing("Die Wiederherstellung läuft noch.");
    const j = this.engine.vault.get(JOURNAL);
    if (!j || ["done", "rolled-back"].includes(j.state)) throw userFacing("Keine unterbrochene Wiederherstellung.");
    const owner = "stack-restore:" + randomUUID();
    if (!this.engine.store.claim(owner)) throw userFacing("Ein anderer Auftrag läuft. Bitte danach erneut versuchen.");
    try {
      await freezeStackForBackup(await this.backupPlan(this.engine), { ...this.freezeOptions(), archive: () => this.swapBack(j) });
      if (j.staging) await rm(j.staging, { recursive: true, force: true }).catch(() => {});
      this.journal("rolled-back");
      return { ok: true, message: "Vorheriger Stand ist wiederhergestellt, die Apps laufen wieder." };
    } finally { this.engine.store.release(owner); }
  }
  /** Aufbewahrten vorherigen Stand löschen (Platz freigeben). */
  async removePrevious(body) {
    if (body.confirmation !== "OK") throw userFacing("Löschen mit OK bestätigen.");
    const plan = this.plan();
    const list = await this.previousCopies(plan);
    const hit = list.find((p) => p.name === body.name);
    if (!hit) throw userFacing("Unbekannter Stand.");
    if (this.running) throw userFacing("Die Wiederherstellung läuft noch.");
    await rm(path.join(path.dirname(await realpath(plan.appdata)), hit.name), { recursive: true, force: true });
    return { ok: true, message: "Vorheriger Stand gelöscht." };
  }
}
