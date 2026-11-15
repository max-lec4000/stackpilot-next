import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, stat, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { createStackArchive, restoreStackArchive, snapshotPath } from "./stack-archive.js";
const passphrase = "Fixture-only-backup-phrase-2026!";
test("Vollständiges verschlüsseltes Archiv wird isoliert wiederhergestellt, einschließlich leerer Dateien", { timeout: 20000 }, async () => {
  const temporary = await mkdtemp("/tmp/sp-stack-archive-"), root = path.join(temporary, "source"), output = path.join(temporary, "stack.spstack"), destination = path.join(temporary, "restore");
  try {
    await mkdir(path.join(root, "nested"), { recursive: true });
    await writeFile(path.join(root, "master.key"), "private-fixture-secret");
    await writeFile(path.join(root, "nested/empty"), "");
    const large = Buffer.alloc(512 * 1024, 71); await writeFile(path.join(root, "nested/database"), large);
    const created = await createStackArchive({ roots: [{ label: "state", directory: root }], output, passphrase });
    assert.equal(created.manifest.entries, 4);
    assert.ok(!(await readFile(output)).includes(Buffer.from("private-fixture-secret")));
    assert.equal((await stat(output)).mode & 0o777, 0o600);
    const restored = await restoreStackArchive({ archive: output, destination, passphrase });
    assert.equal(restored.state, "verified");
    assert.equal(await readFile(path.join(destination, "state/master.key"), "utf8"), "private-fixture-secret");
    assert.deepEqual(await readFile(path.join(destination, "state/nested/database")), large);
    assert.equal((await stat(path.join(destination, "state/nested/empty"))).size, 0);
    assert.equal(restored.productionImport, false);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
test("Manipulation und falsche Passphrase hinterlassen keine teilweisen Wiederherstellungen", { timeout: 20000 }, async () => {
  const temporary = await mkdtemp("/tmp/sp-stack-archive-"), root = path.join(temporary, "source"), output = path.join(temporary, "stack.spstack");
  try {
    await mkdir(root); await writeFile(path.join(root, "data"), "fixture");
    await createStackArchive({ roots: [{ label: "state", directory: root }], output, passphrase });
    const destination = path.join(temporary, "wrong");
    await assert.rejects(() => restoreStackArchive({ archive: output, destination, passphrase: "Another-fixture-only-passphrase" }), /nicht bestätigt/);
    await assert.rejects(() => stat(destination), { code: "ENOENT" });
    const data = await readFile(output); data[data.length - 1] ^= 1; await writeFile(output, data);
    const tampered = path.join(temporary, "tampered");
    await assert.rejects(() => restoreStackArchive({ archive: output, destination: tampered, passphrase }), /nicht bestätigt/);
    await assert.rejects(() => stat(tampered), { code: "ENOENT" });
    const existing = path.join(temporary, "existing"); await mkdir(existing); await writeFile(path.join(existing, "keep"), "kept");
    await assert.rejects(() => restoreStackArchive({ archive: output, destination: existing, passphrase }), /nicht bestätigt/);
    assert.equal(await readFile(path.join(existing, "keep"), "utf8"), "kept");
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
test("Sicherung verweigert Quelllinks, Ziel im Quellbestand und Pfadtraversal", async () => {
  const temporary = await mkdtemp("/tmp/sp-stack-archive-"), root = path.join(temporary, "source");
  try {
    await mkdir(root); await symlink("/etc/passwd", path.join(root, "link"));
    await assert.rejects(() => createStackArchive({ roots: [{ label: "state", directory: root }], output: path.join(temporary, "backup"), passphrase }), /Link/);
    await assert.rejects(() => createStackArchive({ roots: [{ label: "state", directory: root }], output: path.join(root, "backup"), passphrase }), /außerhalb/);
    for (const name of ["../outside", "state/../../outside", "/state/file", "state\\file", "unknown/file", "state//file"])
      assert.throws(() => snapshotPath(name), /Ungültiger/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
