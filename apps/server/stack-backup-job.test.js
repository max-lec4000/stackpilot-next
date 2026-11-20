import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { StateStore } from "./state.js";
import { Vault } from "./vault.js";
import { StackBackupJob, due, nextRun, ARCHIVE } from "./stack-backup-job.js";
import { restoreStackArchive } from "./stack-archive.js";
import { readFile } from "node:fs/promises";

test("Zeitplan: Sonntag ab 03:30, einmal je Sonntag", () => {
  const sun = new Date(2026, 10, 22, 3, 31), sat = new Date(2026, 10, 21, 23, 0);
  assert.equal(due(sun, null), true);
  assert.equal(due(sun, "2026-11-22"), false);
  assert.equal(due(new Date(2026, 10, 22, 3, 10), null), false);
  assert.equal(due(sat, null), false);
  const n = nextRun(sat);
  assert.deepEqual([n.getDay(), n.getHours(), n.getMinutes()], [0, 3, 30]);
  assert.ok(nextRun(sun) > sun);
});

function fixture() {
  const base = mkdtempSync(path.join(tmpdir(), "sp-sb-"));
  const state = path.join(base, "state"), appdata = path.join(base, "data-appdata"), data = path.join(base, "data"), target = path.join(base, "sicherungen");
  for (const d of [state, appdata, data]) mkdirSync(d, { recursive: true });
  const store = new StateStore(state), vault = new Vault(store);
  writeFileSync(path.join(appdata, "radarr.db"), "radarr");
  mkdirSync(path.join(appdata, "streamystats/database"), { recursive: true });
  writeFileSync(path.join(appdata, "streamystats/database/PG_VERSION"), "17");
  mkdirSync(path.join(appdata, ".stackpilot-container-backups/x"), { recursive: true });
  writeFileSync(path.join(appdata, ".stackpilot-container-backups/x/copy"), "rollback");
  symlinkSync("radarr.db", path.join(appdata, "verweis"));
  const containers = [{ id: "a".repeat(64), service: "radarr", project: "stackpilot", root: "p", image: "radarr@sha", running: true },
    { id: "b".repeat(64), service: "streamystats", project: "stackpilot", root: "p", image: "ss@sha", running: true },
    { id: "c".repeat(64), service: "vpn-probe", project: "stackpilot", root: "p", image: "probe@sha", running: true }];
  const exitCodes = { ["c".repeat(64)]: 137 };
  const running = new Set(containers.map((c) => c.id)), calls = [];
  const docker = async (args) => {
    calls.push(args.join(" "));
    const id = args.at(-1);
    if (args[0] === "inspect") { const c = containers.find((x) => x.id === id); return JSON.stringify([{ Id: id, Config: { Labels: { "io.stackpilot.plan": "p", "com.docker.compose.project": "stackpilot" }, Image: c.image }, State: { Running: running.has(id), ExitCode: running.has(id) ? 0 : exitCodes[id] ?? 0 } }]); }
    if (args[0] === "stop") { running.delete(id); return ""; }
    if (args[0] === "start") { running.add(id); return ""; }
  };
  const plan = { id: "p", appdata, spec: { path: data, selected: ["Radarr", "Streamystats"] } };
  const engine = { store, vault, docker, current: () => ({ job: { status: "completed" }, plan }) };
  const job = new StackBackupJob({ engine }, {
    backupPlan: async () => ({ rootId: "p", mode: "configuration-and-databases", containers: containers.map((c) => ({ ...c, running: running.has(c.id) })) }),
    dump: async (args) => { calls.push(args.join(" ")); return "-- PostgreSQL database dump\nCREATE TABLE t();\n"; },
  });
  return { base, target, store, vault, job, calls, running, containers, appdata, exitCodes };
}
const settle = async (job) => { while (job.running) await new Promise((r) => setTimeout(r, 20)); };

test("Gesamtsicherung: einrichten, sichern, prüfen, wiederherstellbar", async () => {
  const f = fixture();
  try {
    await assert.rejects(f.job.run({ confirmation: "OK" }), /Sicherungsordner festlegen/);
    await assert.rejects(f.job.setup({ target: f.appdata + "/x", confirmation: "OK" }), /nicht im Zustands-/);
    const s = await f.job.setup({ target: f.target, confirmation: "OK" });
    assert.match(s.passphrase, /^[A-Za-z0-9_-]{32}$/);
    assert.equal((await f.job.setup({ target: f.target, confirmation: "OK" })).passphrase, null, "Passwort nur beim ersten Mal");
    await f.job.run({ confirmation: "OK" });
    await settle(f.job);
    const st = await f.job.status();
    assert.equal(st.last.ok, true, st.last.error);
    assert.equal(st.last.verified, true);
    assert.equal(st.archives.length, 1);
    assert.match(st.archives[0].name, ARCHIVE);
    assert.ok(st.last.skipped.includes("appdata/verweis"), "Link übersprungen und genannt");
    assert.ok(f.calls.some((c) => c.includes("pg_dump -d streamystats")), "Datenbankexport");
    assert.ok(f.calls.some((c) => c.startsWith("stop")) && f.containers.every((c) => f.running.has(c.id)), "angehalten und wieder gestartet");
    assert.ok(!readdirSync(f.target).some((n) => n.startsWith(".vorbereitung")), "Vorbereitung aufgeräumt");
    // Wiederherstellen in einen neuen Ordner: Export und App-Daten da, Rollback-Kopien und Rohdatenbank nicht
    const out = path.join(f.base, "zurueck");
    await restoreStackArchive({ archive: path.join(f.target, st.archives[0].name), destination: out, passphrase: s.passphrase });
    assert.equal(await readFile(path.join(out, "appdata/radarr.db"), "utf8"), "radarr");
    assert.match(await readFile(path.join(out, "state/stackpilot-datenbank-exporte/streamystats.sql"), "utf8"), /PostgreSQL database dump/);
    assert.ok(existsSync(path.join(out, "state/state.sqlite")));
    assert.ok(!existsSync(path.join(out, "appdata/.stackpilot-container-backups")));
    assert.ok(!existsSync(path.join(out, "appdata/streamystats/database")));
  } finally { f.store.close(); rmSync(f.base, { recursive: true, force: true }); }
});

test("Gesamtsicherung: Aufbewahrung, Fehler wird gemeldet, Apps laufen wieder", async () => {
  const f = fixture();
  try {
    await f.job.setup({ target: f.target, confirmation: "OK" });
    for (const d of ["20260101-0330", "20260102-0330", "20260103-0330", "20260104-0330", "20260105-0330"]) writeFileSync(path.join(f.target, `stackpilot-sicherung-${d}.spstack`), "alt");
    await f.job.run({ confirmation: "OK" });
    await settle(f.job);
    const names = readdirSync(f.target).filter((n) => ARCHIVE.test(n)).sort();
    assert.equal(names.length, 4);
    assert.ok(!names.includes("stackpilot-sicherung-20260101-0330.spstack"));
    // Export schlägt fehl → nichts angehalten, Fehler im Ergebnis
    f.job.dump = async () => "kaputt";
    const stopsBefore = f.calls.filter((c) => c.startsWith("stop")).length;
    await f.job.run({ confirmation: "OK" });
    await settle(f.job);
    const st = await f.job.status();
    assert.equal(st.last.ok, false);
    assert.match(st.last.error, /Datenbankexport nicht bestätigt/);
    assert.equal(f.calls.filter((c) => c.startsWith("stop")).length, stopsBefore);
  } finally { f.store.close(); rmSync(f.base, { recursive: true, force: true }); }
});

test("Unterbrochene Sicherung: Apps wieder starten", async () => {
  const f = fixture();
  try {
    await f.job.setup({ target: f.target, confirmation: "OK" });
    f.running.clear();
    f.vault.set("stack-backup:journal", { state: "frozen", previous: f.containers.map((c) => ({ id: c.id, project: c.project, root: c.root })) });
    assert.equal((await f.job.status()).resumeRequired, true);
    await assert.rejects(f.job.run({ confirmation: "OK" }), /unterbrochen/);
    const r = await f.job.resume({ confirmation: "OK" });
    assert.equal(r.started, 3);
    assert.equal((await f.job.status()).resumeRequired, false);
  } finally { f.store.close(); rmSync(f.base, { recursive: true, force: true }); }
});

test("Harter Abbruch: bei Helfern ohne Daten erlaubt, bei Apps nicht", async () => {
  const f = fixture();
  try {
    await f.job.setup({ target: f.target, confirmation: "OK" });
    await f.job.run({ confirmation: "OK" });
    await settle(f.job);
    assert.equal((await f.job.status()).last.ok, true, "vpn-probe mit 137 ist in Ordnung");
    assert.ok(f.calls.includes("stop --time 10 " + "c".repeat(64)), "Helfer bekommt 10 s");
    assert.ok(f.calls.includes("stop --time 60 " + "a".repeat(64)), "App bekommt 60 s");
    f.exitCodes["a".repeat(64)] = 137;
    await f.job.run({ confirmation: "OK" });
    await settle(f.job);
    const st = await f.job.status();
    assert.equal(st.last.ok, false);
    assert.match(st.last.error, /Geordnetes Ende/);
    assert.ok(f.containers.every((c) => f.running.has(c.id)), "trotzdem alle wieder gestartet");
  } finally { f.store.close(); rmSync(f.base, { recursive: true, force: true }); }
});
