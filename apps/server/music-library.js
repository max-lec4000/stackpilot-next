import { open, opendir, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
const formats = new Set(["mp3", "flac", "m4a", "aac", "ogg", "opus", "wav", "aiff", "aif", "alac", "wma"]);
const directoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
export async function musicInventory(dataRoot, { limit = 10000 } = {}) {
  if (!path.isAbsolute(dataRoot) || !Number.isSafeInteger(limit) || limit < 1 || limit > 20000) throw Error("Ungültiger Musikpfad oder Prüfumfang.");
  const root = await realpath(dataRoot);
  const rootHandle = await open(root, directoryFlags);
  const files = [], directories = [];
  let visited = 0, skipped = 0, unavailable = 0, limited = false, totalBytes = 0;
  let media, music;
  const fdPath = (handle, name = "") => "/proc/self/fd/" + handle.fd + (name ? "/" + name : "");
  async function walk(handle, relative = "", depth = 0) {
    if (depth > 12) { limited = true; return; }
    const entries = [];
    const stream = await opendir(fdPath(handle));
    for await (const entry of stream) {
      if (entries.length >= limit - visited) { limited = true; break; }
      entries.push(entry);
    }
    const covers = entries.filter((entry) => entry.isFile() && /^(cover|folder|front)\.(jpe?g|png|webp)$/i.test(entry.name)).map((entry) => entry.name);
    if (covers.length) directories.push({ folder: relative || ".", covers });
    for (const entry of entries) {
      if (++visited > limit) { limited = true; return; }
      if (entry.isSymbolicLink()) { skipped++; continue; }
      if (entry.name.startsWith(".")) continue;
      const relativeName = relative ? relative + "/" + entry.name : entry.name;
      let child;
      try {
        if (entry.isDirectory()) {
          child = await open(fdPath(handle, entry.name), directoryFlags);
          await walk(child, relativeName, depth + 1);
        } else if (entry.isFile()) {
          const extension = path.extname(entry.name).slice(1).toLowerCase();
          if (!formats.has(extension)) continue;
          child = await open(fdPath(handle, entry.name), constants.O_RDONLY | constants.O_NOFOLLOW);
          const stat = await child.stat();
          if (!stat.isFile()) { skipped++; continue; }
          files.push({ path: relativeName, name: entry.name, format: extension, bytes: stat.size, modifiedAt: stat.mtime.toISOString(), folderCover: covers.length > 0, tags: "not-inspected" });
          totalBytes += stat.size;
        }
      } catch { unavailable++; }
      finally { if (child) await child.close(); }
      if (limited && visited > limit) return;
    }
  }
  try {
    media = await open(fdPath(rootHandle, "media"), directoryFlags);
    music = await open(fdPath(media, "music"), directoryFlags);
    await walk(music);
  } finally {
    if (music) await music.close();
    if (media) await media.close();
    await rootHandle.close();
  }
  const groups = new Map();
  for (const file of files) {
    const key = file.bytes + ":" + file.name.toLocaleLowerCase("de");
    const group = groups.get(key) || [];
    group.push(file.path); groups.set(key, group);
  }
  return {
    schemaVersion: 1, observedAt: new Date().toISOString(), relativeRoot: "media/music",
    files, totalBytes, count: files.length, visited, skippedLinks: skipped, unavailable, limited,
    covers: directories,
    possibleDuplicates: [...groups.values()].filter((group) => group.length > 1),
    duplicateEvidence: "name-and-size-only",
    portable: true,
  };
}
export async function withMusicTrack(dataRoot, relative, inspect) {
  if (typeof relative !== "string" || relative.length > 2000 || /[\\\x00-\x1f\x7f]/.test(relative)) throw Error("Ungültiger Musikpfad.");
  const segments = relative.split("/");
  if (!segments.length || segments.some((part) => !part || part === "." || part === "..") || !formats.has(path.extname(relative).slice(1).toLowerCase())) throw Error("Ungültiger Musikpfad.");
  const handles = [];
  try {
    handles.push(await open(await realpath(dataRoot), directoryFlags));
    for (const segment of ["media", "music", ...segments.slice(0, -1)])
      handles.push(await open("/proc/self/fd/" + handles.at(-1).fd + "/" + segment, directoryFlags));
    const file = await open("/proc/self/fd/" + handles.at(-1).fd + "/" + segments.at(-1), constants.O_RDONLY | constants.O_NOFOLLOW);
    handles.push(file);
    const stat = await file.stat();
    if (!stat.isFile()) throw Error("Keine reguläre Audiodatei.");
    return await inspect(file, stat);
  } finally { for (const handle of handles.reverse()) await handle.close(); }
}
