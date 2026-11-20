import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { StateStore } from "./state.js";
import { guardRoots, writeGuardRoots, DockerGuardStatus, ROOTS_FILE } from "./docker-guard-client.js";

function store() {
  const dir = mkdtempSync(path.join(tmpdir(), "sp-guard-"));
  const s = new StateStore(dir);
  const add = (id, spec, status, extra = {}) => {
    s.savePlan({ id, spec, ...extra });
    s.db.prepare("INSERT INTO operations VALUES(?,?,?)").run(id, id, JSON.stringify({ id, planId: id, kind: "deployment", status, steps: [] }));
  };
  return { s, dir, add };
}

test("Docker-Wächter: Datenordner aller Einrichtungen, abgebrochene nicht", () => {
  const { s, dir, add } = store();
  try {
    add("a", { path: "/srv/media/" }, "completed", { appdata: "/srv/media-appdata" });
    add("b", { path: "/mnt/nas/stack" }, "failed");
    add("c", { path: "/mnt/alt" }, "cancelled");
    add("d", { path: "relativ" }, "completed");
    s.savePlan({ id: "entwurf", spec: { path: "/nie/eingerichtet" } }); // Plan ohne Auftrag
    assert.deepEqual(guardRoots(s), ["/mnt/nas/stack", "/mnt/nas/stack-appdata", "/srv/media", "/srv/media-appdata"]);
    const before = process.env.STACKPILOT_DOCKER_HOST;
    delete process.env.STACKPILOT_DOCKER_HOST;
    assert.equal(writeGuardRoots(s), null); // ohne Wächter keine Datei
    process.env.STACKPILOT_DOCKER_HOST = "unix:///run/x.sock";
    try {
      writeGuardRoots(s);
      assert.deepEqual(JSON.parse(readFileSync(path.join(dir, ROOTS_FILE), "utf8")).roots, guardRoots(s));
    } finally {
      if (before === undefined) delete process.env.STACKPILOT_DOCKER_HOST; else process.env.STACKPILOT_DOCKER_HOST = before;
    }
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Docker-Wächter: Zustand bereinigt, Sperren nur aus dem Beobachtungsmodus", async () => {
  const lease = { active: false };
  const st = { activeLease: () => lease.active };
  assert.deepEqual(await new DockerGuardStatus(st, { socket: null }).status(), { mode: "off" });
  assert.deepEqual(await new DockerGuardStatus(st, { socket: "/x", ask: async () => { throw Error("weg"); } }).status(), { mode: "unreachable" });
  const calls = [];
  let answer = { guard: true, mode: "observe", allowed: 5, denied: 1, since: "t",
    recent: [{ at: "t", method: "POST", path: "/containers/create", reasons: ["Bind /etc"], blocked: false, extra: "weg" }],
    roots: ["/srv/media"], rejectedRoots: [{ path: "/etc", problem: "Systemordner /etc" }] };
  const g = new DockerGuardStatus(st, { socket: "/x", ask: async () => answer, run: async (b, a) => { calls.push([b, ...a]); return ""; } });
  const s = await g.status();
  assert.equal(s.mode, "observe");
  assert.deepEqual(s.recent, [{ at: "t", method: "POST", path: "/containers/create", reasons: ["Bind /etc"], blocked: false }]);
  assert.deepEqual(s.rejectedRoots, [{ path: "/etc", problem: "Systemordner /etc" }]);
  lease.active = true;
  await assert.rejects(g.enforce(), /Serverauftrag/);
  lease.active = false;
  assert.deepEqual(await g.enforce(), { started: true });
  assert.deepEqual(calls.at(-1), ["systemctl", "start", "--no-block", "stackpilot-root@docker-guard-enforce.service"]);
  answer = { ...answer, mode: "enforce" };
  await assert.rejects(g.enforce(), /Beobachtungsmodus/);
});
