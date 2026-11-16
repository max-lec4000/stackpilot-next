import { backup, DatabaseSync } from "node:sqlite";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Vault } from "./vault.js";
import { backupLimit, encryptBackup, decryptBackup, requirePassphrase } from "./identity/backup-format.js";

const magic = Buffer.from("STACKPILOT_VAULT_BACKUP_V1\n");
const dbLimit = 64 * 1024 * 1024;
const files = ["state.sqlite", "master.key"];

function verifyDatabase(file, key) {
  const db = new DatabaseSync(file, { readOnly: true, allowExtension: false });
  try {
    if (Object.values(db.prepare("PRAGMA integrity_check").get())[0] !== "ok")
      throw Error("SQLite-Integritätsprüfung fehlgeschlagen.");
    const vault = Object.assign(Object.create(Vault.prototype), { store: { db }, key });
    const entries = db.prepare("SELECT name FROM vault").all();
    for (const { name } of entries) vault.get(name);
    return entries.length;
  } finally {
    db.close();
  }
}

export async function createVaultBackup(store, vault, passphrase) {
  requirePassphrase(passphrase);
  const dbFile = path.join(store.directory, files[0]);
  if ((await lstat(dbFile)).size > dbLimit)
    throw Error("Die Tresor-Datenbank ist größer als 64 MiB.");
  const dir = await mkdtemp(path.join(store.directory, ".vault-backup-"));
  const target = path.join(dir, files[0]);
  let database;
  try {
    await backup(store.db, target);
    if ((await lstat(target)).size > dbLimit)
      throw Error("Die Tresor-Datenbank ist größer als 64 MiB.");
    verifyDatabase(target, vault.key);
    database = await readFile(target);
    return await encryptBackup({
      format: 1,
      database: database.toString("base64"),
      key: vault.key.toString("base64"),
    }, passphrase, magic);
  } finally {
    database?.fill(0);
    await rm(dir, { recursive: true, force: true });
  }
}

export async function verifyVaultBackup(archive, passphrase, destination) {
  const value = await decryptBackup(archive, passphrase, magic);
  if (value?.format !== 1 || typeof value.key !== "string" || typeof value.database !== "string" ||
      value.database.length > Math.ceil(dbLimit / 3) * 4)
    throw Error("Ungültiges StackPilot-Tresorarchiv.");
  const database = Buffer.from(value.database, "base64");
  const key = Buffer.from(value.key, "base64");
  if (key.length !== 32 || database.length > dbLimit) throw Error("Ungültige Tresordaten.");
  try {
    await mkdir(destination, { mode: 0o700 });
    try {
      const file = path.join(destination, files[0]);
      await writeFile(file, database, { flag: "wx", mode: 0o600 });
      const count = verifyDatabase(file, key);
      await writeFile(path.join(destination, files[1]), key, { flag: "wx", mode: 0o600 });
      return count;
    } catch (error) {
      await rm(destination, { recursive: true, force: true });
      throw error;
    }
  } finally {
    database.fill(0);
    key.fill(0);
  }
}


export const vaultRestoreBodyLimit = Math.ceil(backupLimit / 3) * 4 + 8192;

export async function stageVaultRestore(store, archive, passphrase) {
  if (typeof archive !== "string" || !archive.length ||
      archive.length > Math.ceil(backupLimit / 3) * 4 || archive.length % 4 ||
      /[^A-Za-z0-9+/=]/.test(archive))
    throw Error("Ungültige oder zu große Sicherungsdatei.");
  const bytes = Buffer.from(archive, "base64");
  if (bytes.length > backupLimit || bytes.toString("base64") !== archive)
    throw Error("Ungültige Kodierung der Sicherungsdatei.");
  const root = await mkdtemp(path.join(store.directory, "tresor-wiederherstellung-"));
  const directory = path.join(root, "wiederhergestellt");
  try {
    const entries = await verifyVaultBackup(bytes, passphrase, directory);
    return { directory, entries };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}
