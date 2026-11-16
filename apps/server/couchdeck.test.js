import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, stat, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Couchdeck } from "./couchdeck.js";

async function fixture({ installed = true, units = {} } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "sp-couchdeck-"));
  const linkDir = path.join(root, "link"),
    appDir = path.join(root, "app");
  if (installed) {
    await mkdir(path.join(linkDir, "control"), { recursive: true });
    await mkdir(appDir);
    await writeFile(path.join(appDir, "package.json"), JSON.stringify({ version: "0.1.0" }));
  }
  const calls = [];
  const systemctl = async (args) => {
    calls.push(args);
    if (args[0] === "show") {
      const job = args[1].match(/@(.+)\.service$/)[1];
      const state = units[job] || "inactive";
      return { ok: true, output: `LoadState=loaded\nActiveState=${state}\nResult=success\n` };
    }
    return { ok: units.denied !== true, output: "" };
  };
  return {
    root,
    linkDir,
    calls,
    couchdeck: new Couchdeck(null, { linkDir, appDir, systemctl, bundledDir: path.join(root, "bundled") }),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

test("Nicht installiert: Zustand fehlt, Starten und Schließen werden verständlich abgelehnt", async () => {
  const f = await fixture({ installed: false });
  try {
    const status = await f.couchdeck.status();
    assert.equal(status.installed, false);
    assert.equal(status.state, "missing");
    await assert.rejects(f.couchdeck.stop(), (e) => e.userFacing === true);
    await assert.rejects(f.couchdeck.start(), (e) => e.userFacing === true);
  } finally {
    await f.cleanup();
  }
});

test("Schließen legt den Merker an, Starten entfernt ihn; der Zustand folgt sofort", async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.linkDir, "control/state"), "running 2026-11-13T14:00:00+01:00\n");
    assert.equal((await f.couchdeck.status()).state, "running");
    const stopped = await f.couchdeck.stop();
    assert.equal(stopped.state, "off");
    assert.ok((await stat(path.join(f.linkDir, "control/off"))).isFile());
    const started = await f.couchdeck.start();
    assert.equal(started.state, "running");
    await assert.rejects(stat(path.join(f.linkDir, "control/off")), { code: "ENOENT" });
    // Zweimal starten ist kein Fehler.
    await f.couchdeck.start();
  } finally {
    await f.cleanup();
  }
});

test("Zustand zeigt die Übergabe ohne Geheimnisse", async () => {
  const f = await fixture();
  try {
    await writeFile(
      path.join(f.linkDir, "integration.json"),
      JSON.stringify({
        writtenAt: "2026-11-13T14:00:00.000Z",
        auth: { userId: "u1", userName: "wohnzimmer", token: "geheim-token" },
        seerr: { url: "http://127.0.0.1:5055", apiKey: "geheim-key" },
      }),
    );
    const status = await f.couchdeck.status();
    assert.deepEqual(status.linked, {
      at: "2026-11-13T14:00:00.000Z",
      user: "wohnzimmer",
      seerr: true,
    });
    assert.ok(!JSON.stringify(status).includes("geheim"));
  } finally {
    await f.cleanup();
  }
});

test("Root-Hilfe: nur feste Aufträge, kein zweiter Auftrag parallel, Ablehnung wird gemeldet", async () => {
  const f = await fixture();
  try {
    await f.couchdeck.install(true);
    assert.deepEqual(
      f.calls.filter((args) => args[0] === "start"),
      [["start", "--no-block", "stackpilot-root@couchdeck-install-youtube.service"]],
    );
    await assert.rejects(f.couchdeck.runHelper("rm -rf /"), (e) => e.userFacing === true);
  } finally {
    await f.cleanup();
  }
  const busy = await fixture({ units: { "couchdeck-install": "activating" } });
  try {
    assert.equal((await busy.couchdeck.status()).helper.running, "install");
    await assert.rejects(busy.couchdeck.remove(), /läuft bereits/);
  } finally {
    await busy.cleanup();
  }
  const denied = await fixture({ units: { denied: true } });
  try {
    await assert.rejects(denied.couchdeck.install(), /nicht angenommen/);
  } finally {
    await denied.cleanup();
  }
});

test("Couchdeck bietet nur neuere stabile Versionen aus dem Lieferumfang an", async () => {
  const f = await fixture();
  try {
    await mkdir(f.couchdeck.bundledDir);
    const file = path.join(f.couchdeck.bundledDir, "package.json");
    for (const version of ["0.0.9", "0.1.0", "0.2.0-beta.1"]) {
      await writeFile(file, JSON.stringify({ version }));
      assert.equal((await f.couchdeck.status()).updateVersion, null);
      await assert.rejects(f.couchdeck.update(version), /stabile Couchdeck-Version/);
    }
    await writeFile(file, JSON.stringify({ version: "0.2.0" }));
    assert.equal((await f.couchdeck.status()).updateVersion, "0.2.0");
    assert.deepEqual(await f.couchdeck.update("0.2.0"), { phase: "started" });
    assert.deepEqual(f.calls.filter((args) => args[0] === "start"),
      [["start", "--no-block", "stackpilot-root@couchdeck-install.service"]]);
  } finally {
    await f.cleanup();
  }
});

test("Entfernen löscht die Übergabedatei mit dem Zugang", async () => {
  const f = await fixture();
  try {
    const file = path.join(f.linkDir, "integration.json");
    await writeFile(file, "{}");
    await f.couchdeck.remove();
    await assert.rejects(readFile(file), { code: "ENOENT" });
  } finally {
    await f.cleanup();
  }
});

test("Installationsschritt wartet auf die Root-Hilfe und meldet einen Fehlschlag", async () => {
  // Erfolgreich: Die Hilfe läuft kurz und hinterlässt die installierte App.
  const ok = await fixture({ installed: false });
  try {
    let polls = 0,
      begun = false;
    const appDir = path.join(ok.root, "app");
    ok.couchdeck.systemctl = async (args) => {
      if (args[0] === "start") begun = true;
      if (args[0] !== "show") return { ok: true, output: "" };
      const install = begun && args[1].includes("couchdeck-install.service");
      const running = install && polls++ < 6;
      if (install && !running) {
        await mkdir(appDir, { recursive: true });
        await writeFile(path.join(appDir, "package.json"), JSON.stringify({ version: "0.1.0" }));
      }
      return {
        ok: true,
        output: `LoadState=loaded\nActiveState=${running ? "activating" : "inactive"}\nResult=success\n`,
      };
    };
    await ok.couchdeck.ensureInstalled(false, { pollMs: 5 });
    assert.equal((await ok.couchdeck.status()).installed, true);
    // Schon installiert: kein weiterer Auftrag.
    await ok.couchdeck.ensureInstalled(false, { pollMs: 5 });
  } finally {
    await ok.cleanup();
  }
  const bad = await fixture({ installed: false });
  try {
    let started = false;
    bad.couchdeck.systemctl = async (args) => {
      if (args[0] === "start") started = true;
      if (args[0] !== "show") return { ok: true, output: "" };
      const failed = started && args[1].includes("couchdeck-install.service");
      return {
        ok: true,
        output: `LoadState=loaded\nActiveState=${failed ? "failed" : "inactive"}\nResult=${failed ? "exit-code" : "success"}\n`,
      };
    };
    await assert.rejects(bad.couchdeck.ensureInstalled(false, { pollMs: 5 }), /nicht installiert/);
  } finally {
    await bad.cleanup();
  }
});

test("Ein älteres installiertes Couchdeck gilt als veraltet und wird vom Installationsschritt ersetzt", async () => {
  const f = await fixture();
  try {
    await mkdir(path.join(f.root, "bundled"));
    await writeFile(path.join(f.root, "bundled/package.json"), JSON.stringify({ version: "0.2.0" }));
    assert.equal((await f.couchdeck.status()).outdated, true);
    let begun = false;
    f.couchdeck.systemctl = async (args) => {
      if (args[0] === "start") {
        begun = true;
        await writeFile(path.join(f.root, "app/package.json"), JSON.stringify({ version: "0.2.0" }));
      }
      return { ok: true, output: "LoadState=loaded\nActiveState=inactive\nResult=success\n" };
    };
    await f.couchdeck.ensureInstalled(false, { pollMs: 5 });
    assert.equal(begun, true);
    assert.equal((await f.couchdeck.status()).outdated, false);
  } finally {
    await f.cleanup();
  }
});
