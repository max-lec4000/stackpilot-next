import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, rm, readFile } from "node:fs/promises";
import path from "node:path";
import { musicInventory, withMusicTrack } from "./music-library.js";
import { inspectMusicTags } from "./music-tags.js";
function id3(title) {
  const payload = Buffer.concat([Buffer.from([3]), Buffer.from(title)]);
  const frame = Buffer.alloc(10); frame.write("TIT2"); frame.writeUInt32BE(payload.length, 4);
  const header = Buffer.from([73, 68, 51, 3, 0, 0, 0, 0, 0, frame.length + payload.length]);
  return Buffer.concat([header, frame, payload]);
}
test("Musikbestand bleibt getrennt, unverändert und folgt keinen Links außerhalb des Medienpfads", async () => {
  const root = await mkdtemp("/tmp/sp-music-"), music = path.join(root, "media/music");
  try {
    await mkdir(path.join(music, "Artist/Album"), { recursive: true });
    const file = path.join(music, "Artist/Album/song.mp3"), data = id3("Ein Titel");
    await writeFile(file, data);
    await writeFile(path.join(music, "Artist/Album/cover.jpg"), "fixture");
    await writeFile(path.join(root, "private.mp3"), id3("private-secret"));
    await symlink(path.join(root, "private.mp3"), path.join(music, "linked.mp3"));
    const result = await musicInventory(root);
    assert.equal(result.count, 1); assert.equal(result.files[0].path, "Artist/Album/song.mp3");
    assert.equal(result.files[0].folderCover, true); assert.equal(result.skippedLinks, 1);
    assert.ok(!JSON.stringify(result).includes("private-secret"));
    const tags = await withMusicTrack(root, "Artist/Album/song.mp3", inspectMusicTags);
    assert.equal(tags.state, "inspected"); assert.equal(tags.fields.title, "Ein Titel");
    assert.deepEqual(await readFile(file), data);
    await assert.rejects(() => withMusicTrack(root, "../private.mp3", inspectMusicTags), /Ungültiger/);
    await assert.rejects(() => withMusicTrack(root, "linked.mp3", inspectMusicTags));
    assert.equal((await musicInventory(root, { limit: 1 })).limited, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("Ungültige Tags werden unbestätigt und unbekannte Formate nicht als taglos ausgegeben", async () => {
  const root = await mkdtemp("/tmp/sp-music-"), music = path.join(root, "media/music");
  try {
    await mkdir(music, { recursive: true });
    const corrupted = id3("Titel"); corrupted.writeUInt32BE(999999, 14);
    await writeFile(path.join(music, "bad.mp3"), corrupted);
    await writeFile(path.join(music, "other.m4a"), Buffer.alloc(20));
    assert.equal((await withMusicTrack(root, "bad.mp3", inspectMusicTags)).state, "unconfirmed");
    assert.equal((await withMusicTrack(root, "other.m4a", inspectMusicTags)).state, "unsupported");
  } finally { await rm(root, { recursive: true, force: true }); }
});
