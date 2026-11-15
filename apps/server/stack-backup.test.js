import { test } from "node:test";
import assert from "node:assert/strict";
import { freezeStackForBackup } from "./stack-backup.js";
function fixture(failArchive = false) {
  const services = ["gluetun", "database", "jellyfin", "radarr"];
  const containers = services.map((service, i) => ({ id: String(i + 1).repeat(64), service, project: "stackpilot", root: "root", image: "fixture:" + service, running: service !== "radarr" }));
  const running = new Map(containers.map((container) => [container.id, container.running])), calls = [], events = [];
  let managerRunning = true;
  const docker = async (args) => {
    calls.push(args);
    const container = containers.find((item) => item.id === args.at(-1));
    if (!container) throw Error("foreign container");
    if (args[0] === "inspect") return JSON.stringify([{ Id: container.id, Config: { Image: container.image, Labels: { "io.stackpilot.plan": container.root, "com.docker.compose.project": container.project } }, State: { Running: running.get(container.id), Restarting: false, ExitCode: 0 } }]);
    if (args[0] === "stop") running.set(container.id, false);
    if (args[0] === "start") running.set(container.id, true);
    return "";
  };
  return {
    containers, calls, events, running,
    options: {
      docker, journal: async (event) => events.push(event.state),
      manager: { running: async () => managerRunning, stop: async () => { managerRunning = false; }, start: async () => { managerRunning = true; } },
      archive: async () => {
        assert.equal(managerRunning, false);
        assert.equal([...running.values()].some(Boolean), false);
        if (failArchive) throw Error("fixture storage unavailable");
        return { created: true };
      },
    },
    managerRunning: () => managerRunning,
  };
}
for (const failArchive of [false, true]) test("Stack-Sicherung erhält vorherige Betriebszustände, auch bei Archivfehler: " + failArchive, async () => {
  const f = fixture(failArchive);
  if (failArchive) await assert.rejects(() => freezeStackForBackup({ containers: f.containers }, f.options), /storage unavailable/);
  else assert.equal((await freezeStackForBackup({ containers: f.containers }, f.options)).created, true);
  assert.equal(f.managerRunning(), true);
  for (const container of f.containers) assert.equal(f.running.get(container.id), container.running);
  assert.equal(f.calls.filter((call) => call[0] === "start")[0].at(-1), f.containers[0].id);
  assert.ok(!f.calls.some((call) => ["start", "stop"].includes(call[0]) && call.at(-1) === f.containers[3].id));
});
