import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createStackArchive } from "./stack-archive.js";
import { StackRestoreJob, stagedKeys, foreignEntries } from "./stack-restore-job.js";

const PASS = "geheim-und-lang-genug-1234";
const ID = "c".repeat(64);
async function setup({ verifyFails = false, alwaysFails = false, rootId = "root1", backupKey = "AAA" } = {}) {
  const base = await mkdtemp(path.join(tmpdir(), "restore-"));
  const appdata = path.join(base, "appdata"), backups = path.join(base, "sicherungen"), state = path.join(base, "state");
  for (const d of [appdata, backups, state, path.join(appdata, "radarr"), path.join(appdata, "streamystats")]) await mkdir(d, { recursive: true });
  // Stand zum Zeitpunkt der Sicherung
  await writeFile(path.join(appdata, "radarr", "config.xml"), `<Config><ApiKey>${backupKey}</ApiKey></Config>`);
  await writeFile(path.join(appdata, "radarr", "radarr.db"), "alt");
  await writeFile(path.join(appdata, "streamystats", "x"), "statistik-alt");
  const name = "stackpilot-sicherung-20261120-1400.spstack";
  await createStackArchive({ roots: [{ label: "state", directory: state }, { label: "appdata", directory: appdata }], output: path.join(backups, name),
    passphrase: PASS, manifest: { stackpilot: { rootId } } });
  // danach geändert
  await writeFile(path.join(appdata, "radarr", "radarr.db"), "neu");
  await writeFile(path.join(appdata, "streamystats", "x"), "statistik-neu");
  await mkdir(path.join(appdata, "neuapp"));
  const plan = { id: "p", rootId: "root1", uid: process.getuid(), appdata, spec: { selected: ["Radarr"] } };
  const vault = new Map([["stack-backup:passphrase", { value: PASS }]]);
  let running = true;
  const dockerCalls = [];
  const engine = {
    current: () => ({ job: { status: "completed" }, plan }),
    vault: { get: (k) => vault.get(k), set: (k, v) => vault.set(k, v) },
    store: { claim: () => true, release: () => {} },
    docker: async (args) => {
      dockerCalls.push(args[0]);
      if (args[0] === "inspect") return JSON.stringify([{ Id: ID, Config: { Labels: { "io.stackpilot.plan": "root1", "com.docker.compose.project": "sp" }, Image: "img" }, State: { Running: running, ExitCode: 0 } }]);
      if (args[0] === "stop") running = false;
      if (args[0] === "start") running = true;
      return "";
    },
  };
  let verifies = 0;
  const s = { cookies: { seerr: "alt" }, credentials: () => ({ apiKey: "AAA" }), wait: async () => {}, verify: async () => {
    verifies++;
    if (s.cookies.seerr) throw Error("alte Sitzung");
    if (alwaysFails) throw Error("Seerr: Dienstanfrage /api/v1/settings/sonarr/test fehlgeschlagen (HTTP 500).");
    // nur nach dem Zurückspielen kaputt
    if (verifyFails && (await readFile(path.join(appdata, "radarr", "radarr.db"), "utf8")) === "alt") throw Error("Radarr: Authentifizierung ist nicht fertig eingerichtet.");
  } };
  const hub = { engine, context: async () => ({ s, plan }) };
  const backupJob = { settings: () => ({ target: backups }), running: null };
  const job = new StackRestoreJob(hub, backupJob, { waitMs: 1, verifyAttempts: 3,
    backupPlan: async () => ({ containers: [{ id: ID, service: "radarr", root: "root1", project: "sp", image: "img", running: true }] }),
  });
  const finish = async () => { for (let i = 0; i < 200 && job.running; i++) await new Promise((r) => setTimeout(r, 20)); return vault.get("stack-restore:last"); };
  return { job, name, appdata, base, vault, finish, dockerCalls, verifies: () => verifies };
}

test("Prüfen zeigt Apps; Streamystats bleibt außen vor", async () => {
  const { job, name } = await setup();
  const r = await job.check({ name });
  assert.equal(r.sameStack, true);
  assert.deepEqual(r.apps, ["radarr"]);
  await assert.rejects(job.check({ name: "../x.spstack" }), /Unbekannte Sicherung/);
});

test("Wiederherstellen tauscht App-Daten, vorheriger Stand bleibt, Statistik unverändert", async () => {
  const { job, name, appdata, base, finish, dockerCalls, verifies } = await setup();
  await assert.rejects(job.restore({ name, confirmation: "OK" }), /WIEDERHERSTELLEN/);
  await job.restore({ name, confirmation: "OK", phrase: "WIEDERHERSTELLEN" });
  const last = await finish();
  assert.equal(last.ok, true, last.error);
  assert.equal(await readFile(path.join(appdata, "radarr", "radarr.db"), "utf8"), "alt");
  assert.equal(await readFile(path.join(appdata, "streamystats", "x"), "utf8"), "statistik-neu");
  assert.ok((await readdir(appdata)).includes("neuapp"), "später hinzugekommene App bleibt");
  const st = await job.status();
  assert.equal(st.previous.length, 1);
  assert.equal(await readFile(path.join(base, st.previous[0].name, "radarr", "radarr.db"), "utf8"), "neu");
  assert.ok(dockerCalls.includes("stop") && dockerCalls.includes("start"));
  assert.equal(verifies(), 2, "Ausgangslage + danach");
  assert.ok(!(await readdir(base)).some((n) => n.includes("-wiederherstellung-")), "Entpackordner entfernt");
  assert.equal(st.recoveryRequired, false);
  await job.removePrevious({ name: st.previous[0].name, confirmation: "OK" });
  assert.equal((await job.status()).previous.length, 0);
});

test("Dienste danach nicht bereit → automatisch zurück", async () => {
  const { job, name, appdata, finish, verifies } = await setup({ verifyFails: true });
  await job.restore({ name, confirmation: "OK", phrase: "WIEDERHERSTELLEN" });
  const last = await finish();
  assert.equal(last.ok, false);
  assert.equal(last.rolledBack, true);
  assert.match(last.error, /vorherige Stand ist wiederhergestellt/);
  assert.equal(verifies(), 4, "Ausgangslage + drei Versuche, bevor zurückgekehrt wird");
  assert.equal(await readFile(path.join(appdata, "radarr", "radarr.db"), "utf8"), "neu");
  assert.deepEqual((await job.status()).previous, []);
});

test("Fehler, der schon vorher bestand, verhindert die Wiederherstellung nicht", async () => {
  const { job, name, appdata, finish } = await setup({ alwaysFails: true });
  await job.restore({ name, confirmation: "OK", phrase: "WIEDERHERSTELLEN" });
  const last = await finish();
  assert.equal(last.ok, true, last.error);
  assert.match(last.warning, /schon vor der Wiederherstellung.*sonarr\/test/);
  assert.equal(await readFile(path.join(appdata, "radarr", "radarr.db"), "utf8"), "alt");
});

test("Erneuerte Dienstschlüssel oder fremder Stack: nichts wird angefasst", async () => {
  const keyed = await setup({ backupKey: "ALT" });
  await keyed.job.restore({ name: keyed.name, confirmation: "OK", phrase: "WIEDERHERSTELLEN" });
  assert.match((await keyed.finish()).error, /Dienstschlüssel erneuert \(Radarr\)/);
  assert.equal(await readFile(path.join(keyed.appdata, "radarr", "radarr.db"), "utf8"), "neu");
  assert.ok(!keyed.dockerCalls.includes("stop"));
  const other = await setup({ rootId: "fremd" });
  assert.equal((await other.job.check({ name: other.name })).sameStack, false);
  await other.job.restore({ name: other.name, confirmation: "OK", phrase: "WIEDERHERSTELLEN" });
  assert.match((await other.finish()).error, /anderen Stack/);
});

test("Schlüssel lesen und fremde Besitzer erkennen", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "keys-"));
  await mkdir(path.join(dir, "bazarr", "config"), { recursive: true });
  await writeFile(path.join(dir, "bazarr", "config", "config.yaml"), "general:\n  x: 1\nauth:\n  type: null\n  apikey: abc123\n");
  await mkdir(path.join(dir, "seerr"));
  await writeFile(path.join(dir, "seerr", "settings.json"), JSON.stringify({ main: { apiKey: "eigener" } }));
  assert.deepEqual(await stagedKeys(dir, ["Bazarr", "Radarr", "Seerr"]), { Bazarr: "abc123" }, "Seerr vergibt seinen Schlüssel selbst");
  assert.equal(await foreignEntries(dir, process.getuid()), null);
  assert.equal(await foreignEntries(dir, process.getuid() + 1), ".");
});
