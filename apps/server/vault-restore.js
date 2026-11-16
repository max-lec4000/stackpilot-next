import { constants } from "node:fs";
import { copyFile, link, lstat, mkdtemp, open, readFile, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";
import { Vault } from "./vault.js";
import { verifyDatabase } from "./vault-backup.js";

const databaseName = "state.sqlite";

async function checkPrivate(file, directory = false) {
  const stat = await lstat(file);
  if (!(directory ? stat.isDirectory() : stat.isFile()) ||
      stat.uid !== process.getuid() || stat.mode & 0o077 || await realpath(file) !== file)
    throw Error("Datei oder Ordner gehört nicht zum privaten StackPilot-Bestand.");
  return stat;
}

async function checkClosed(file) {
  await checkPrivate(file);
  for (const suffix of ["-journal", "-wal", "-shm"]) {
    const extra = await lstat(file + suffix).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    if (extra) throw Error("Die Datenbank hat offene SQLite-Dateien. Zuerst den sauberen Stopp prüfen.");
  }
}

function completedDeployment(db) {
  const row = db.prepare(`
    SELECT data FROM operations WHERE json_extract(data,'$.kind')='deployment'
    AND json_extract(data,'$.status')!='cancelled' ORDER BY rowid DESC LIMIT 1
  `).get();
  if (!row) return null;
  const job = JSON.parse(row.data);
  const planRow = db.prepare("SELECT data FROM plans WHERE id=?").get(job.planId);
  if (job.status !== "completed" || !planRow)
    throw Error("Der letzte Installationsplan ist nicht abgeschlossen.");
  return JSON.parse(planRow.data);
}

async function syncFile(file) {
  const descriptor = await open(file, "r");
  try { await descriptor.sync(); }
  finally { await descriptor.close(); }
}

async function readKey(file) {
  if ((await checkPrivate(file)).size !== 32) throw Error("Der Tresorschlüssel ist ungültig.");
  return readFile(file);
}

export async function replaceVaultState(state, source, undo = false) {
  const activeFile = path.join(state, databaseName);
  await checkPrivate(state, true);
  await checkClosed(activeFile);
  await checkPrivate(source, true);
  const sourceFile = path.join(source, databaseName);
  await checkClosed(sourceFile);
  if ((await lstat(sourceFile)).size > 64 * 1024 * 1024 && !undo)
    throw Error("Die wiederhergestellte Datenbank ist zu groß.");
  const currentKey = await readKey(path.join(state, "master.key"));
  const scratch = await mkdtemp(path.join(state, ".tresor-uebernahme-"));
  const candidate = path.join(scratch, databaseName);
  let sourceKey, rollback, switched = false;
  try {
    sourceKey = undo ? currentKey : await readKey(path.join(source, "master.key"));
    await copyFile(sourceFile, candidate, constants.COPYFILE_EXCL);
    await checkPrivate(candidate);
    verifyDatabase(candidate, sourceKey);
    const old = new DatabaseSync(activeFile, { readOnly: true, allowExtension: false });
    try {
      const next = new DatabaseSync(candidate, { allowExtension: false });
      try {
        const oldPlan = undo ? null : completedDeployment(old);
        const nextPlan = undo ? null : completedDeployment(next);
        if (!isDeepStrictEqual(oldPlan, nextPlan))
          throw Error("Sicherung und laufender Stack haben unterschiedliche Installationspläne.");
        next.exec("PRAGMA journal_mode=DELETE; PRAGMA secure_delete=ON; BEGIN IMMEDIATE");
        if (!sourceKey.equals(currentKey)) {
          const reader = Object.assign(Object.create(Vault.prototype), { store: { db: next }, key: sourceKey });
          const writer = Object.assign(Object.create(Vault.prototype), { store: { db: next }, key: currentKey });
          for (const { name } of next.prepare("SELECT name FROM vault").all())
            writer.set(name, reader.get(name));
        }
        if (next.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='sessions'").get())
          next.exec("DELETE FROM sessions");
        next.exec("UPDATE lease SET owner=NULL, expires=0 WHERE id=1; COMMIT");
      } finally { next.close(); }
    } finally { old.close(); }
    verifyDatabase(candidate, currentKey);
    await syncFile(candidate);
    rollback = await mkdtemp(path.join(state, "tresor-vor-uebernahme-"));
    await link(activeFile, path.join(rollback, databaseName));
    await syncFile(rollback);
    await syncFile(state);
    await rename(candidate, activeFile);
    switched = true;
    await syncFile(state);
    return { rollback };
  } catch (error) {
    if (switched) throw Error(`Datenbank wurde bereits getauscht. Rückweg: ${rollback}`);
    if (rollback) await rm(rollback, { recursive: true, force: true });
    throw error;
  } finally {
    currentKey.fill(0);
    sourceKey?.fill(0);
    await rm(scratch, { recursive: true, force: true });
  }
}
