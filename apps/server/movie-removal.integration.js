// Explicit opt-in: isolated Docker fixture, no user media and no downloads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { StateStore } from "./state.js";
import { Vault } from "./vault.js";
import { DeploymentEngine } from "./installer.js";
import { Services } from "./service-api.js";
import { localDocker } from "./retirement.js";
test(
  "Native Radarr-Löschanfrage verändert bei fehlender Film-ID keine Bibliotheksdaten",
  { timeout: 240000 },
  async () => {
    const root = await mkdtemp("/tmp/stackpilot-removal-contract-"),
      store = new StateStore(root + "/state"),
      vault = new Vault(store);
    const engine = new DeploymentEngine(store, vault, {
      project: "sp-delete-" + randomUUID().slice(0, 8),
      portOffset: 30000,
      allowUnqualifiedLinux: true,
    });
    let plan;
    try {
      plan = await engine.createPlan({
        selected: ["Radarr"],
        path: root + "/data",
        username: "stackadmin",
        language: "Deutsch",
        vpn: false,
      });
      assert.equal(plan.executable, true, plan.blockers.join("\n"));
      const job = await engine.confirm(plan.id, plan.confirmation, true),
        deadline = Date.now() + 180000;
      while (Date.now() < deadline) {
        const op = store.operation(job.id);
        if (op.status === "failed") assert.fail(op.error);
        if (op.status === "completed") break;
        await new Promise((r) => setTimeout(r, 500));
      }
      assert.equal(store.operation(job.id).status, "completed");
      const native = new Services(plan, vault, await engine.relay(plan));
      await assert.rejects(
        native.arr(
          "Radarr",
          "/movie/2147483647?deleteFiles=true&addImportExclusion=false",
          { method: "DELETE" },
        ),
        /HTTP 404/,
      );
      assert.deepEqual(await native.arr("Radarr", "/movie"), []);
    } finally {
      if (plan)
        await localDocker(
          [
            "compose",
            "-f",
            path.join(store.directory, "deployments", plan.id, "compose.json"),
            "down",
          ],
          { timeout: 120000 },
        );
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
