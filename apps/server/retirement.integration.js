// Explicit opt-in. Touches only uniquely named test containers and volumes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import { localDocker, RetirementEngine } from "./retirement.js";
import { StateStore } from "./state.js";
test("Echte Ablösung stoppt/entfernt Testcontainer und erhält Daten im Volume", async () => {
  const suffix = randomUUID();
  const name = `stackpilot-sonarr-${suffix}`;
  const project = `sp-test-${suffix}`;
  const volume = `sp-volume-${suffix}`;
  const image =
    "busybox@sha256:a7dbc319b1438115a207e11930dc4bb3e643dcb3ec0bdd694bb36cd8fad289ec";
  const directory = await mkdtemp(os.tmpdir() + "/sp-real-retire-");
  const store = new StateStore(directory);
  let created = false;
  let volumeCreated = false;
  try {
    await localDocker(["volume", "create", volume]);
    volumeCreated = true;
    await localDocker([
      "run",
      "-d",
      "--name",
      name,
      "--restart=unless-stopped",
      "--label",
      `com.docker.compose.project=${project}`,
      "--label",
      "com.docker.compose.service=sonarr",
      "--mount",
      `type=volume,source=${volume},target=/config`,
      image,
      "sh",
      "-c",
      'trap "exit 0" TERM; echo retained > /config/sentinel; while :; do sleep 1 & wait $!; done',
    ]);
    created = true;
    await new Promise((r) => setTimeout(r, 200));
    const engine = new RetirementEngine(store);
    const plan = await engine.createPlan(project);
    assert.equal(plan.containers.length, 1);
    const op = await engine.confirm(plan.id, plan.confirmation, true);
    for (
      let i = 0;
      i < 400 && store.operation(op.id).status !== "completed";
      i++
    ) {
      if (store.operation(op.id).status === "failed")
        assert.fail(store.operation(op.id).error);
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(store.operation(op.id).status, "completed");
    assert.equal(
      (await localDocker(["ps", "-aq", "--filter", `name=^/${name}$`])).trim(),
      "",
    );
    const contents = await localDocker([
      "run",
      "--rm",
      "--mount",
      `type=volume,source=${volume},target=/data,readonly`,
      image,
      "cat",
      "/data/sentinel",
    ]);
    assert.equal(contents.trim(), "retained");
  } finally {
    if (created) {
      const ids = (
        await localDocker(["ps", "-aq", "--filter", `name=^/${name}$`])
      ).trim();
      if (ids) {
        await localDocker(["stop", "--time", "1", name]);
        await localDocker(["rm", name]);
      }
    }
    if (volumeCreated) await localDocker(["volume", "rm", volume]);
    store.close();
    await rm(directory, { recursive: true });
  }
});
