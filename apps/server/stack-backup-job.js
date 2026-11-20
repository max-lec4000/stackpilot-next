// System → Updates & Sicherungen → Gesamtsicherung (Phase 7.5).
// Verschlüsseltes Archiv aller App-Einstellungen und Datenbanken (ohne Filme/Serien) in einen
// gewählten Ordner, wöchentlich (Sonntag 03:30) und per Knopf; die letzten 4 bleiben.
// Ablauf: Vorabprüfung → Datenbank-Export (Streamystats, läuft weiter) → Apps geordnet anhalten
// (freezeStackForBackup, mit Journal) → konsistente Kopie des StackPilot-Zustands (SQLite
// VACUUM INTO) → Archiv (App-Daten ohne Rollback-Kopien und rohe Fremd-Datenbanken; Sockets
// und Links werden übersprungen und genannt) → Apps starten → Aufbewahrung → Archiv prüfen.
import { randomBytes, randomUUID } from "node:crypto";
import { access, constants as fsConstants, cp, mkdir, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { stackBackupPlan, freezeStackForBackup } from "./stack-backup.js";
import { createStackArchive, verifyStackArchive } from "./stack-archive.js";
import { dockerInput } from "./docker-io.js";
import { streamResponse } from "./routes.js";

export const ARCHIVE = /^stackpilot-sicherung-\d{8}-\d{4}\.spstack$/;
const KEEP = 4;
const SETTINGS = "stack-backup:settings", PASSPHRASE = "stack-backup:passphrase", LAST = "stack-backup:last", JOURNAL = "stack-backup:journal";
const ACTIVE_JOURNAL = ["prepared", "stopping", "frozen", "archive-created", "resuming", "resume-required"];
const beneath = (p, root) => p === root || p.startsWith(root + path.sep);
const stamp = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
const userFacing = (m) => Object.assign(Error(m), { userFacing: true });

/** Nächster Sonntag 03:30 (Ortszeit des Servers) ab `from`. */
export function nextRun(from = new Date()) {
  const d = new Date(from);
  d.setHours(3, 30, 0, 0);
  const days = (7 - d.getDay()) % 7;
  d.setDate(d.getDate() + days);
  if (d <= from) d.setDate(d.getDate() + 7);
  return d;
}
/** Soll die wöchentliche Sicherung jetzt laufen? (Sonntag ab 03:30, einmal je Sonntag) */
export const localDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export function due(now, lastScheduledDay) {
  const day = localDay(now);
  return now.getDay() === 0 && (now.getHours() > 3 || (now.getHours() === 3 && now.getMinutes() >= 30)) && lastScheduledDay !== day;
}

export class StackBackupJob {
  constructor(hub, options = {}) {
    this.hub = hub;
    this.engine = hub.engine;
    this.dump = options.dump || ((args) => dockerInput(args, "", { timeout: 600000, maxOutputBytes: 512 * 1024 * 1024 }));
    this.now = options.now || (() => new Date());
    this.backupPlan = options.backupPlan || stackBackupPlan;
    this.running = null;
  }
  settings() { return this.engine.vault.get(SETTINGS); }
  plan() {
    const current = this.engine.current();
    if (current?.job.status !== "completed") throw userFacing("Kein eingerichteter Stack.");
    return current.plan;
  }
  async roots(plan) {
    return [await realpath(this.engine.store.directory), await realpath(plan.appdata), await realpath(plan.spec.path)];
  }
  defaultTarget(plan) { return path.join(path.dirname(plan.spec.path), "stackpilot-sicherungen"); }

  async archives(target) {
    try {
      const names = (await readdir(target)).filter((n) => ARCHIVE.test(n)).sort().reverse();
      return Promise.all(names.map(async (name) => {
        const st = await stat(path.join(target, name));
        return { name, size: st.size, createdAt: st.mtime.toISOString() };
      }));
    } catch { return []; }
  }
  async status() {
    const plan = this.plan();
    const settings = this.settings();
    const journal = this.engine.vault.get(JOURNAL);
    return {
      configured: !!settings,
      target: settings?.target || null,
      suggestedTarget: this.defaultTarget(plan),
      schedule: settings ? "Sonntag 03:30, wöchentlich" : null,
      nextRun: settings ? nextRun(this.now()).toISOString() : null,
      keep: KEEP,
      running: this.running ? { startedAt: this.running.startedAt, step: this.running.step } : null,
      last: this.engine.vault.get(LAST) || null,
      // Nach einem Absturz mitten in der Sicherung: angehaltene Apps wieder starten
      resumeRequired: !this.running && !!journal && ACTIVE_JOURNAL.includes(journal.state),
      archives: settings ? await this.archives(settings.target) : [],
    };
  }

  /** Ordner festlegen und beim ersten Mal das Sicherungspasswort erzeugen (einmal angezeigt). */
  async setup(body) {
    if (body.confirmation !== "OK") throw Error("Sicherungsordner mit OK bestätigen.");
    const plan = this.plan();
    const wanted = typeof body.target === "string" && body.target.trim() ? body.target.trim() : this.defaultTarget(plan);
    if (!path.isAbsolute(wanted) || wanted.length > 300 || /[\x00-\x1f]/.test(wanted)) throw userFacing("Bitte einen vollständigen Ordnerpfad angeben.");
    const clean = path.resolve(wanted);
    await mkdir(clean, { recursive: true, mode: 0o700 }).catch(() => { throw userFacing("Ordner konnte nicht angelegt werden – Rechte prüfen."); });
    const real = await realpath(clean);
    if (!(await stat(real)).isDirectory()) throw userFacing("Das ist kein Ordner.");
    await access(real, fsConstants.W_OK).catch(() => { throw userFacing("StackPilot darf in diesen Ordner nicht schreiben."); });
    for (const root of await this.roots(plan))
      if (beneath(real, root) || beneath(root, real)) throw userFacing("Der Sicherungsordner darf nicht im Zustands-, App-Daten- oder Medienordner liegen (und sie nicht enthalten).");
    let passphrase = null;
    if (!this.engine.vault.get(PASSPHRASE)) {
      passphrase = randomBytes(24).toString("base64url"); // 32 Zeichen
      this.engine.vault.set(PASSPHRASE, { value: passphrase, createdAt: new Date().toISOString() });
    }
    this.engine.vault.set(SETTINGS, { target: real, schedule: "weekly", keep: KEEP, updatedAt: new Date().toISOString() });
    return { ok: true, target: real, passphrase };
  }

  start() {
    this.timer = setInterval(() => {
      const settings = this.settings();
      if (!settings || this.running) return;
      const now = this.now();
      if (!due(now, settings.lastScheduledDay)) return;
      if (this.engine.store.activeLease()) return; // später erneut versuchen
      this.engine.vault.set(SETTINGS, { ...settings, lastScheduledDay: localDay(now) });
      void this.run({ confirmation: "OK", scheduled: true }).catch(() => {});
    }, 60000);
    this.timer.unref?.();
  }
  close() { clearInterval(this.timer); }

  /** Sicherung starten; läuft im Hintergrund, Stand über status(). */
  async run(body) {
    if (body.confirmation !== "OK") throw Error("Gesamtsicherung mit OK bestätigen.");
    const settings = this.settings();
    if (!settings) throw userFacing("Zuerst den Sicherungsordner festlegen.");
    if (this.running) throw userFacing("Eine Sicherung läuft bereits.");
    const journal = this.engine.vault.get(JOURNAL);
    if (journal && ACTIVE_JOURNAL.includes(journal.state)) throw userFacing("Eine frühere Sicherung wurde unterbrochen. Zuerst „Apps wieder starten“.");
    const owner = "stack-backup:" + randomUUID();
    if (!this.engine.store.claim(owner)) throw userFacing("Ein anderer Auftrag läuft. Bitte danach erneut versuchen.");
    const started = this.now();
    this.running = { startedAt: started.toISOString(), step: "Vorbereitung" };
    const heartbeat = setInterval(() => this.engine.store.claim(owner), 10000);
    heartbeat.unref?.();
    const done = this.execute(settings, started, body.scheduled === true)
      .finally(() => { clearInterval(heartbeat); this.engine.store.release(owner); this.running = null; });
    done.catch(() => {});
    return { started: true, startedAt: started.toISOString() };
  }

  async execute(settings, started, scheduled) {
    const step = (s) => { if (this.running) this.running.step = s; };
    const passphrase = this.engine.vault.get(PASSPHRASE)?.value;
    const name = `stackpilot-sicherung-${stamp(started)}.spstack`;
    const output = path.join(settings.target, name);
    const staging = path.join(settings.target, `.vorbereitung-${randomUUID().slice(0, 8)}`);
    const record = { at: started.toISOString(), scheduled, file: name, ok: false };
    try {
      if (!passphrase) throw userFacing("Sicherungspasswort fehlt. Sicherungsordner neu festlegen.");
      const plan = this.plan();
      const info = await this.backupPlan(this.engine);
      step("Datenbanken exportieren");
      await mkdir(path.join(staging, "state", "stackpilot-datenbank-exporte"), { recursive: true, mode: 0o700 });
      const excluded = new Set([".stackpilot-container-backups"]);
      const appdata = await realpath(plan.appdata);
      for (const c of info.containers.filter((x) => x.service === "streamystats" && x.running)) {
        const sql = await this.dump(["exec", "-i", "--user", "postgres", c.id, "pg_dump", "-d", "streamystats", "--no-owner", "--no-privileges"]);
        if (!/PostgreSQL database dump/.test(sql.slice(0, 2000))) throw Error("Streamystats-Datenbankexport nicht bestätigt.");
        await writeFile(path.join(staging, "state", "stackpilot-datenbank-exporte", "streamystats.sql"), sql, { mode: 0o600 });
        excluded.add("streamystats/database");
      }
      if (info.containers.some((x) => x.service === "streamystats") && !excluded.has("streamystats/database"))
        throw Error("Streamystats läuft nicht – Datenbank kann nicht exportiert werden.");
      step("Apps anhalten und sichern");
      let result;
      await freezeStackForBackup(info, {
        // docker stop --time 60 darf selbst bis zu 60 s dauern (z. B. Postgres) – mehr Spielraum geben
        docker: (args) => this.engine.docker(args, { timeout: ["stop", "start"].includes(args[0]) ? 180000 : 60000 }),
        manager: { running: async () => false, stop: async () => {}, start: async () => {} },
        journal: async (r) => this.engine.vault.set(JOURNAL, { state: r.state, previous: r.previous.map((c) => ({ id: c.id, service: c.service, root: c.root, project: c.project, image: c.image })), at: new Date().toISOString() }),
        archive: async () => {
          step("Zustand kopieren");
          const stateDir = await realpath(this.engine.store.directory);
          await cp(stateDir, path.join(staging, "state"), {
            recursive: true, verbatimSymlinks: true, force: false, errorOnExist: false,
            filter: (src) => !/state\.sqlite(-journal|-wal|-shm)?$/.test(src),
          });
          this.engine.store.db.exec(`VACUUM INTO '${path.join(staging, "state", "state.sqlite").replaceAll("'", "''")}'`);
          step("Archiv schreiben");
          result = await createStackArchive({
            roots: [{ label: "state", directory: path.join(staging, "state") }, { label: "appdata", directory: appdata }],
            output, passphrase, skipSpecial: true,
            exclude: (label, relative) => label === "appdata" && excluded.has(relative),
            manifest: { stackpilot: { planId: plan.id, rootId: info.rootId, mode: info.mode, containers: info.containers.length, excluded: [...excluded], databaseExports: excluded.has("streamystats/database") ? ["streamystats"] : [] } },
          });
          return result;
        },
      });
      step("Aufräumen");
      await rm(staging, { recursive: true, force: true });
      const all = await this.archives(settings.target);
      for (const old of all.slice(KEEP)) await rm(path.join(settings.target, old.name), { force: true });
      step("Archiv prüfen");
      const verified = await verifyStackArchive({ archive: output, passphrase });
      Object.assign(record, {
        ok: true, verified: verified.state === "verified", size: (await stat(output)).size, entries: result.manifest.entries,
        totalBytes: result.manifest.totalBytes, skipped: result.manifest.skipped, skippedCount: result.manifest.skippedCount,
        durationSeconds: Math.round((Date.now() - started.getTime()) / 1000),
      });
    } catch (e) {
      record.error = String(e?.message || e).slice(0, 400);
      await rm(staging, { recursive: true, force: true }).catch(() => {});
    } finally {
      this.engine.vault.set(LAST, record);
    }
    return record;
  }

  /** Nach einem Absturz mitten in der Sicherung: die angehaltenen Apps wieder starten. */
  async resume(body) {
    if (body.confirmation !== "OK") throw Error("Wiederanlauf mit OK bestätigen.");
    if (this.running) throw userFacing("Die Sicherung läuft noch.");
    const journal = this.engine.vault.get(JOURNAL);
    if (!journal || !ACTIVE_JOURNAL.includes(journal.state)) throw userFacing("Keine unterbrochene Sicherung.");
    const plan = this.plan(), rootId = plan.rootId || plan.id;
    let started = 0;
    for (const c of journal.previous || []) {
      if (!/^[a-f0-9]{64}$/.test(c.id)) continue;
      const [row] = JSON.parse(await this.engine.docker(["inspect", c.id]));
      const labels = row?.Config?.Labels || {};
      if (row?.Id !== c.id || labels["com.docker.compose.project"] !== c.project || ![rootId, c.root].includes(labels["io.stackpilot.plan"])) continue;
      if (!row.State.Running) { await this.engine.docker(["start", c.id]); started++; }
    }
    this.engine.vault.set(JOURNAL, { ...journal, state: "resumed-manually", at: new Date().toISOString() });
    return { ok: true, started };
  }

  /** Archiv als Datenstrom herunterladen. */
  async download(name) {
    const settings = this.settings();
    if (!settings || typeof name !== "string" || !ARCHIVE.test(name)) throw userFacing("Unbekannte Sicherung.");
    const file = path.join(settings.target, name);
    const st = await stat(file).catch(() => null);
    if (!st?.isFile()) throw userFacing("Sicherung nicht gefunden.");
    return streamResponse(createReadStream(file), name, st.size);
  }
}
