// Local bare Git repository only: no network, real index/commit/push commands.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
const exec = promisify(execFile);
test("Entwicklungsupload verändert weder vorgemerkte Dateien noch Arbeitsbaum und pusht nur den Bericht", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "sp-report-git-"));
  const repo = path.join(root, "checkout"),
    bare = path.join(root, "remote.git"),
    bin = path.join(root, "bin");
  const git = async (...args) =>
    (await exec("/usr/bin/git", args, { cwd: repo })).stdout.trim();
  try {
    await mkdir(repo);
    await mkdir(bin);
    await exec("/usr/bin/git", ["init", "--bare", bare]);
    await git("init", "-b", "main");
    await git("config", "user.name", "Fixture");
    await git("config", "user.email", "fixture@localhost");
    await writeFile(path.join(repo, "README.md"), "baseline\n");
    await git("add", "README.md");
    await git("commit", "-m", "baseline");
    await git("push", bare, "main");
    await git(
      "remote",
      "add",
      "origin",
      "https://github.com/max-lec4000/stackpilot.git",
    );
    await writeFile(path.join(repo, "staged.txt"), "SECRET-STAGED\n");
    await git("add", "staged.txt");
    await writeFile(path.join(repo, "README.md"), "UNCOMMITTED\n");
    const before = await git("status", "--porcelain");
    await writeFile(
      path.join(bin, "git"),
      `#!/usr/bin/env node\nconst {spawnSync}=require('node:child_process');const args=process.argv.slice(2);if(['fetch','push'].includes(args[0])){const at=args.indexOf('origin');if(at>=0)args[at]=process.env.STACKPILOT_TEST_REMOTE;}const r=spawnSync('/usr/bin/git',args,{stdio:'inherit'});process.exit(r.status??1);`,
      { mode: 0o755 },
    );
    const module = fileURLToPath(
      new URL("./development-report.js", import.meta.url),
    );
    const code = `import {StateStore} from ${JSON.stringify(fileURLToPath(new URL("./state.js", import.meta.url)))};import {setReportConsent} from ${JSON.stringify(fileURLToPath(new URL("./dev-report-consent.js", import.meta.url)))};const store=new StateStore(process.argv[1]+"/../private-state");setReportConsent(store,true);import {publishDevelopmentReport} from ${JSON.stringify(module)};const r=await publishDevelopmentReport({kind:'stackpilot-development-report',schemaVersion:2,createdAt:'fixture'}, {directory:process.argv[1],policy:async()=>true,store});store.close();console.log(JSON.stringify(r));`;
    const child = await exec(
      process.execPath,
      ["--input-type=module", "-e", code, repo],
      {
        env: {
          ...process.env,
          PATH: bin + ":" + process.env.PATH,
          STACKPILOT_TEST_REMOTE: bare,
        },
      },
    );
    const result = JSON.parse(child.stdout);
    assert.equal(await git("status", "--porcelain"), before);
    const names = (
      await exec("/usr/bin/git", [
        "--git-dir",
        bare,
        "ls-tree",
        "-r",
        "--name-only",
        "main",
      ])
    ).stdout
      .trim()
      .split("\n");
    assert.deepEqual(names.sort(), ["README.md", result.file].sort());
    const readme = (
      await exec("/usr/bin/git", ["--git-dir", bare, "show", "main:README.md"])
    ).stdout;
    assert.equal(readme, "baseline\n");
    console.log(
      "Real Git: Bericht isoliert veröffentlicht; lokale Änderungen und Index erhalten.",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
