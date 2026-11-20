import { open, opendir, realpath, mkdir, rm, statfs } from "node:fs/promises";
import { constants } from "node:fs";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip, createGunzip } from "node:zlib";
import { randomBytes, scrypt, createCipheriv, createDecipheriv } from "node:crypto";
import { promisify } from "node:util";
import path from "node:path";
const derive = promisify(scrypt);
const magic = Buffer.from("SPSTACK1\n"), directoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const labels = new Set(["state", "appdata", "data"]);
const params = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
async function* readRange(file, start, end) {
  let position = start;
  while (position <= end) {
    const buffer = Buffer.alloc(Math.min(65536, end - position + 1));
    const read = await file.read(buffer, 0, buffer.length, position);
    if (!read.bytesRead) throw Error("Datei ist unvollständig.");
    position += read.bytesRead;
    yield buffer.subarray(0, read.bytesRead);
  }
}
const fdPath = (handle, name = "") => "/proc/self/fd/" + handle.fd + (name ? "/" + name : "");
function password(value) {
  if (typeof value !== "string" || value.length < 16 || value.length > 256) throw Error("Separate Sicherungspassphrase mit 16–256 Zeichen angeben.");
}
export function snapshotPath(value) {
  if (typeof value !== "string" || Buffer.byteLength(value) > 4000 || /[\\\x00-\x1f\x7f]/.test(value) || value.split("/").some((part) => !part || part === "." || part === "..") || !labels.has(value.split("/")[0]))
    throw Error("Ungültiger Pfad im Sicherungsarchiv.");
  return value;
}
function frame(value) {
  const json = Buffer.from(JSON.stringify(value));
  if (json.length > 8192) throw Error("Sicherungsmetadaten zu groß.");
  const length = Buffer.alloc(4); length.writeUInt32BE(json.length);
  return Buffer.concat([length, json]);
}
// options.exclude(label, relative) → true: Eintrag (und bei Ordnern alles darunter) auslassen.
// options.skipped: Liste – Links und besondere Dateien (Sockets, Pipes) werden dann übersprungen
// und dort vermerkt, statt die Sicherung abzubrechen.
async function catalogRoot(label, root, limit, options = {}) {
  const entries = [], handle = await open(root, directoryFlags);
  async function walk(parent, relative) {
    const stream = await opendir(fdPath(parent));
    for await (const entry of stream) {
      if (entries.length >= limit) throw Error("Sicherung enthält zu viele Einträge; kein Teilarchiv erstellt.");
      const name = relative ? relative + "/" + entry.name : entry.name;
      snapshotPath(label + "/" + name);
      if (options.exclude?.(label, name)) continue;
      if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) {
        if (options.skipped) { options.skipped.push(label + "/" + name); continue; }
        throw Error("Sicherung enthält einen Link oder eine besondere Datei: " + label + "/" + name);
      }
      let child;
      try {
        child = await open(fdPath(parent, entry.name), entry.isDirectory() ? directoryFlags : constants.O_RDONLY | constants.O_NOFOLLOW);
        const st = await child.stat();
        if (!st.isFile() && !st.isDirectory()) throw Error("Dateityp während der Sicherung geändert.");
        entries.push({ label, relative: name, type: st.isDirectory() ? "directory" : "file", size: st.isFile() ? st.size : 0, modified: st.mtimeMs, mode: st.mode & 0o700, inode: st.ino, device: st.dev });
        if (st.isDirectory()) await walk(child, name);
      } finally { if (child) await child.close(); }
    }
  }
  try { await walk(handle, ""); } finally { await handle.close(); }
  return entries.sort((a, b) => a.relative.localeCompare(b.relative));
}
async function withFile(root, relative, inspect) {
  const handles = [await open(root, directoryFlags)];
  try {
    const parts = relative.split("/");
    for (const part of parts.slice(0, -1)) handles.push(await open(fdPath(handles.at(-1), part), directoryFlags));
    const file = await open(fdPath(handles.at(-1), parts.at(-1)), constants.O_RDONLY | constants.O_NOFOLLOW);
    handles.push(file);
    return await inspect(file);
  } finally { for (const handle of handles.reverse()) await handle.close(); }
}
export async function createStackArchive({ roots, output, passphrase, manifest = {}, maxEntries = 200000, exclude = null, skipSpecial = false }) {
  password(passphrase);
  if (!Array.isArray(roots) || !roots.length || roots.length > 3 || new Set(roots.map((root) => root.label)).size !== roots.length || roots.some((root) => !labels.has(root.label)))
    throw Error("Ungültige Sicherungsauswahl.");
  const canonical = [];
  for (const root of roots) canonical.push({ label: root.label, directory: await realpath(root.directory) });
  const outputParent = await realpath(path.dirname(output)), target = path.join(outputParent, path.basename(output));
  if (canonical.some((root) => target === root.directory || target.startsWith(root.directory + path.sep))) throw Error("Sicherung außerhalb aller gesicherten Verzeichnisse ablegen.");
  const snapshots = [], skipped = [], catalogOptions = { exclude, ...(skipSpecial ? { skipped } : {}) };
  for (const root of canonical) snapshots.push(...await catalogRoot(root.label, root.directory, maxEntries - snapshots.length, catalogOptions));
  const totalBytes = snapshots.reduce((sum, entry) => sum + entry.size, 0);
  if (!Number.isSafeInteger(totalBytes)) throw Error("Sicherungsumfang nicht sicher darstellbar.");
  const capacity = await statfs(outputParent);
  if (capacity.bavail * capacity.bsize < totalBytes + snapshots.length * 1024 + 16 * 1024 * 1024) throw Error("Nicht genügend freier Platz für die vollständige Sicherung.");
  const salt = randomBytes(32), iv = randomBytes(12);
  const header = Buffer.from(JSON.stringify({ version: 1, salt: salt.toString("hex"), iv: iv.toString("hex") }));
  const length = Buffer.alloc(4); length.writeUInt32BE(header.length);
  const preamble = Buffer.concat([magic, length, header]);
  const key = await derive(passphrase, salt, 32, params), cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(preamble);
  let out, complete = false;
  const details = { ...manifest, formatVersion: 1, createdAt: new Date().toISOString(), roots: canonical, entries: snapshots.length, totalBytes, skipped: skipped.slice(0, 20).map((v) => v.slice(0, 160)), skippedCount: skipped.length };
  async function* payload() {
    yield frame({ type: "manifest", value: details });
    for (const root of canonical) yield frame({ type: "directory", path: root.label });
    for (const entry of snapshots) {
      yield frame({ type: entry.type, path: entry.label + "/" + entry.relative, size: entry.size, mode: entry.mode, modified: entry.modified });
      if (entry.type === "file") {
        const root = canonical.find((item) => item.label === entry.label);
        // Yield directly from an anchored descriptor; no plaintext archive on disk.
        const handles = [await open(root.directory, directoryFlags)];
        let file;
        try {
          const parts = entry.relative.split("/");
          for (const part of parts.slice(0, -1)) handles.push(await open(fdPath(handles.at(-1), part), directoryFlags));
          file = await open(fdPath(handles.at(-1), parts.at(-1)), constants.O_RDONLY | constants.O_NOFOLLOW);
          const before = await file.stat();
          if (before.size !== entry.size || before.ino !== entry.inode || before.dev !== entry.device || before.mtimeMs !== entry.modified) throw Error("Quelldatei wurde während der Sicherung geändert.");
          let count = 0;
          if (entry.size) {
            for await (const chunk of readRange(file, 0, entry.size - 1)) { count += chunk.length; yield chunk; }
          }
          const after = await file.stat();
          if (count !== entry.size || after.size !== entry.size || after.mtimeMs !== entry.modified) throw Error("Quelldatei wurde während der Sicherung geändert.");
        } finally {
          if (file) await file.close();
          for (const handle of handles.reverse()) await handle.close();
        }
      }
    }
    // Validate the entire source set again, including newly added or removed files.
    for (const root of canonical) {
      const after = await catalogRoot(root.label, root.directory, maxEntries, { exclude, ...(skipSpecial ? { skipped: [] } : {}) });
      if (JSON.stringify(after) !== JSON.stringify(snapshots.filter((entry) => entry.label === root.label))) throw Error("Quellbestand wurde während der Sicherung geändert.");
    }
    yield frame({ type: "end", entries: snapshots.length, totalBytes });
  }
  try {
    out = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await out.writeFile(preamble);
    const sink = new Writable({ write(chunk, encoding, callback) { out.writeFile(chunk).then(() => callback(), callback); } });
    await pipeline(Readable.from(payload()), createGzip({ level: 1 }), cipher, sink);
    const end = (await out.stat()).size;
    const tag = cipher.getAuthTag(); await out.write(tag, 0, tag.length, end); await out.sync();
    complete = true;
    return { path: target, manifest: details };
  } finally {
    key.fill(0);
    if (out) await out.close();
    if (out && !complete) await rm(target, { force: true });
  }
}
/** Archiv vollständig entschlüsseln und prüfen, ohne etwas zu schreiben. */
export function verifyStackArchive({ archive, passphrase, maxBytes = 1024 ** 4, maxEntries = 200000 }) {
  return restoreStackArchive({ archive, destination: null, passphrase, maxBytes, maxEntries, dryRun: true });
}
export async function restoreStackArchive({ archive, destination, passphrase, maxBytes = 64 * 1024 ** 3, maxEntries = 200000, dryRun = false }) {
  password(passphrase);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw Error("Ungültiges Wiederherstellungslimit.");
  const source = await open(archive, constants.O_RDONLY | constants.O_NOFOLLOW);
  let created = false, key, manifest, count = 0, totalBytes = 0;
  const apps = new Set(); // oberste Ordner unter appdata/ (für die Vorschau der Wiederherstellung)
  const expectedDirectories = new Set(), completed = new Set();
  try {
    const st = await source.stat();
    if (!st.isFile() || st.size < 64) throw Error("Ungültiges Sicherungsarchiv.");
    const first = Buffer.alloc(magic.length + 4);
    if ((await source.read(first, 0, first.length, 0)).bytesRead !== first.length || !first.subarray(0, magic.length).equals(magic)) throw Error("Unbekanntes Sicherungsformat.");
    const size = first.readUInt32BE(magic.length);
    if (size < 1 || size > 1024 || first.length + size + 16 >= st.size) throw Error("Ungültiger Sicherungskopf.");
    const header = Buffer.alloc(size); await source.read(header, 0, size, first.length);
    const parsed = JSON.parse(header.toString("utf8"));
    if (parsed.version !== 1 || !/^[a-f0-9]{64}$/.test(parsed.salt) || !/^[a-f0-9]{24}$/.test(parsed.iv)) throw Error("Ungültige Sicherungsparameter.");
    key = await derive(passphrase, Buffer.from(parsed.salt, "hex"), 32, params);
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parsed.iv, "hex"));
    decipher.setAAD(Buffer.concat([first, header]));
    const tag = Buffer.alloc(16); await source.read(tag, 0, 16, st.size - 16); decipher.setAuthTag(tag);
    // This directory must be new. Existing installations are never overwritten.
    let budget = maxBytes;
    if (!dryRun) {
      await mkdir(destination, { mode: 0o700 }); created = true;
      const disk = await statfs(destination);
      budget = Math.min(maxBytes, Math.floor(disk.bavail * disk.bsize * 0.9));
    }
    await pipeline(
      Readable.from(readRange(source, first.length + size, st.size - 17)),
      decipher, createGunzip(),
      async (input) => {
        const iterator = input[Symbol.asyncIterator]();
        let buffer = Buffer.alloc(0);
        async function exact(length, allowEnd = false) {
          while (buffer.length < length) {
            const item = await iterator.next();
            if (item.done) { if (allowEnd && !buffer.length) return null; throw Error("Sicherung ist unvollständig."); }
            buffer = Buffer.concat([buffer, item.value]);
          }
          const value = buffer.subarray(0, length); buffer = buffer.subarray(length); return value;
        }
        while (true) {
          const length = (await exact(4)).readUInt32BE(0);
          if (!length || length > 8192) throw Error("Ungültiger Archivdatensatz.");
          const entry = JSON.parse((await exact(length)).toString("utf8"));
          if (!manifest) {
            if (entry.type !== "manifest" || entry.value?.formatVersion !== 1 || !Number.isSafeInteger(entry.value.totalBytes) || entry.value.totalBytes < 0 || entry.value.totalBytes > budget) throw Error("Sicherungsumfang überschreitet den erlaubten Platz oder ist unbekannt.");
            manifest = entry.value; continue;
          }
          if (entry.type === "end") {
            if (entry.entries !== count || entry.totalBytes !== totalBytes || manifest.entries !== count || manifest.totalBytes !== totalBytes) throw Error("Sicherungsumfang stimmt nicht mit dem Manifest überein.");
            if (await exact(1, true) !== null) throw Error("Unerwartete Daten nach Archivende.");
            return;
          }
          const relative = snapshotPath(entry.path), target = dryRun ? null : path.join(destination, relative);
          if (completed.has(relative)) throw Error("Doppelter Archivpfad.");
          const parent = path.posix.dirname(relative);
          if (parent !== "." && !expectedDirectories.has(parent)) throw Error("Archivverzeichnis fehlt.");
          completed.add(relative);
          if (labels.has(relative)) {
            if (entry.type !== "directory") throw Error("Ungültige Archivwurzel.");
          } else if (++count > maxEntries) throw Error("Zu viele Archiveinträge.");
          if (entry.type === "directory") {
            if (/^appdata\/[^/]+$/.test(relative)) apps.add(relative.slice("appdata/".length));
            if (!dryRun) await mkdir(target, { mode: 0o700 });
            expectedDirectories.add(relative);
          } else if (entry.type === "file") {
            if (!Number.isSafeInteger(entry.size) || entry.size < 0 || totalBytes + entry.size > budget) throw Error("Ungültige Dateigröße.");
            if (!Number.isSafeInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o700 || !Number.isFinite(entry.modified) || Math.abs(entry.modified) > 8640000000000000) throw Error("Ungültige Dateimetadaten.");
            if (dryRun) {
              let remaining = entry.size;
              while (remaining) remaining -= (await exact(Math.min(65536, remaining))).length;
            } else {
              const file = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, entry.mode & 0o100 ? 0o700 : 0o600);
              try {
                let remaining = entry.size;
                while (remaining) { const chunk = await exact(Math.min(65536, remaining)); await file.writeFile(chunk); remaining -= chunk.length; }
                await file.utimes(new Date(entry.modified), new Date(entry.modified));
              } finally { await file.close(); }
            }
            totalBytes += entry.size;
          } else throw Error("Links und besondere Dateien sind im Wiederherstellungsarchiv nicht erlaubt.");
        }
      },
    );
    return { state: "verified", destination: dryRun ? null : destination, manifest, entries: count, totalBytes, apps: [...apps].sort(), productionImport: false };
  } catch {
    if (created) await rm(destination, { recursive: true, force: true });
    throw Error("Wiederherstellung nicht bestätigt: Passphrase, Integrität, Format oder Platz prüfen. Keine bestehende Installation wurde überschrieben.");
  } finally { if (key) key.fill(0); await source.close(); }
}
