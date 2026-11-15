// Explicit opt-in: creates one temporary container on the local Docker daemon.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { command, inventory } from "./inventory.js";
const run = (bin, args) =>
  command(
    bin,
    bin === "docker" ? ["--host=unix:///var/run/docker.sock", ...args] : args,
  );
test("Echte Docker-Erkennung samt Compose-Zuordnung und Volume, ohne Geheimnisexport", async () => {
  const name = `stackpilot-sonarr-test-${randomUUID()}`;
  const image =
    "busybox@sha256:a7dbc319b1438115a207e11930dc4bb3e643dcb3ec0bdd694bb36cd8fad289ec";
  let created = false;
  try {
    const create = await run("docker", [
      "create",
      "--name",
      name,
      "--label",
      "com.docker.compose.project=stackpilot-inventory-test",
      "--env",
      "FIXTURE_SECRET=do-not-export-this",
      "--mount",
      "type=bind,source=/tmp,target=/fixture,readonly",
      image,
      "true",
    ]);
    assert.ok(create.ok, create.reason);
    created = true;
    const result = await inventory(run);
    assert.ok(result.containerScanComplete);
    const found = result.containers.find((c) => c.Names === name);
    assert.ok(found);
    assert.equal(found.mode, "observed");
    assert.equal(found.component, "sonarr");
    assert.equal(found.project, "stackpilot-inventory-test");
    assert.ok(
      found.mounts.some((m) => m.destination === "/fixture" && !m.writable),
    );
    assert.ok(!JSON.stringify(result).includes("do-not-export-this"));
  } finally {
    if (created) {
      const cleanup = await run("docker", ["rm", name]);
      assert.ok(cleanup.ok, "Testcontainer konnte nicht entfernt werden.");
    }
  }
});
