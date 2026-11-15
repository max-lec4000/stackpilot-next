import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inspectAdoption, prepareFiles } from "./provision-files.js";

async function oldStack() {
  const root = await mkdtemp(path.join(os.tmpdir(), "sp-adopt-"));
  const data = path.join(root, "data");
  await mkdir(path.join(data, "media/movies/Film (2020)"), { recursive: true });
  await mkdir(path.join(data, "downloads/complete"), { recursive: true });
  await writeFile(path.join(data, "media/movies/Film (2020)/film.mkv"), "bild");
  await writeFile(path.join(data, ".stackpilot-owner.json"), JSON.stringify({ planId: "alt-12345678", project: "stackpilot" }));
  return { root, data, cleanup: () => rm(root, { recursive: true, force: true }) };
}
const vault = { ensure: (_name, make) => make(), get: () => null };
const plan = (f, extra = {}) => ({
  id: "neu-1",
  project: "stackpilot",
  appdata: f.data + "-appdata",
  uid: process.getuid(),
  gid: process.getgid(),
  spec: { selected: ["Jellyfin"], path: f.data, username: "admin", vpn: false },
  ports: { Jellyfin: 8096 },
  added: ["Jellyfin"],
  ...extra,
});

test("Übernahme erkennt die frühere Marke und unerwartete Einträge", async () => {
  const f = await oldStack();
  try {
    let state = await inspectAdoption(f.data);
    assert.equal(state.previous, "alt-12345678");
    assert.deepEqual(state.unexpected, []);
    assert.equal(state.hasMedia, true);
    await writeFile(path.join(f.data, "notizen.txt"), "x");
    state = await inspectAdoption(f.data);
    assert.deepEqual(state.unexpected, ["notizen.txt"]);
  } finally {
    await f.cleanup();
  }
});

test("Vorbereiten übernimmt den Ordner: Medien unverändert, neue Marke, alte bleibt als Nachweis", async () => {
  const f = await oldStack();
  try {
    const p = plan(f, { adoptedData: true, adoptedFrom: "alt-12345678" });
    await prepareFiles(p, vault, path.join(f.root, "manifest"));
    assert.equal(await readFile(path.join(f.data, "media/movies/Film (2020)/film.mkv"), "utf8"), "bild");
    assert.equal(JSON.parse(await readFile(path.join(f.data, ".stackpilot-owner.json"), "utf8")).planId, "neu-1");
    assert.ok((await readdir(f.data)).includes(".stackpilot-owner.previous-alt-1234.json"));
    assert.ok((await readdir(f.data + "-appdata")).includes("jellyfin"));
    // Wiederaufnahme nach Abbruch: zweiter Lauf ändert nichts mehr und scheitert nicht.
    await prepareFiles(p, vault, path.join(f.root, "manifest2"));
  } finally {
    await f.cleanup();
  }
});

test("Ohne ausdrückliche Übernahme oder bei geändertem Ordner wird nichts angefasst", async () => {
  const f = await oldStack();
  try {
    await assert.rejects(prepareFiles(plan(f), vault, path.join(f.root, "m")), /gehört nicht zu diesem Installationsplan/);
    await assert.rejects(
      prepareFiles(plan(f, { adoptedData: true, adoptedFrom: "anderer-stack" }), vault, path.join(f.root, "m")),
      /seit der Planung geändert/,
    );
    await writeFile(path.join(f.data, "fremd.bin"), "x");
    await assert.rejects(
      prepareFiles(plan(f, { adoptedData: true, adoptedFrom: "alt-12345678" }), vault, path.join(f.root, "m")),
      /seit der Planung geändert/,
    );
    assert.equal(JSON.parse(await readFile(path.join(f.data, ".stackpilot-owner.json"), "utf8")).planId, "alt-12345678");
  } finally {
    await f.cleanup();
  }
});
