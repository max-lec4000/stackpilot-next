// Real pinned Radarr, isolated files, no media requests or downloads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { StateStore } from "./state.js";
import { Vault } from "./vault.js";
import { DeploymentEngine } from "./installer.js";
import { Services } from "./service-api.js";
import { localDocker } from "./retirement.js";
import { SizeLimits } from "./size-limits.js";
test(
  "Radarr erzwingt eigenes Größen-/1080p-Profil und erkennt manuell veränderte Grenzen",
  { timeout: 300000 },
  async () => {
    const root = await mkdtemp("/tmp/sp-size-contract-"),
      store = new StateStore(root + "/state"),
      vault = new Vault(store),
      engine = new DeploymentEngine(store, vault, {
        project: "sp-size-" + randomUUID().slice(0, 8),
        portOffset: 30000,
        allowUnqualifiedLinux: true,
      });
    let plan;
    try {
      plan = await engine.createPlan({
        selected: ["Radarr"],
        path: root + "/data",
        username: "fixture-admin",
        language: "Deutsch",
        vpn: false,
      });
      assert.equal(plan.executable, true, plan.blockers.join(" "));
      const job = await engine.confirm(plan.id, plan.confirmation, true),
        deadline = Date.now() + 180000;
      while (Date.now() < deadline) {
        const j = store.operation(job.id);
        if (j.status === "failed") assert.fail(j.error);
        if (j.status === "completed") break;
        await new Promise((r) => setTimeout(r, 500));
      }
      assert.equal(store.operation(job.id).status, "completed");
      const s = new Services(plan, vault, await engine.relay(plan)),
        before = await s.arr("Radarr", "/qualityprofile"),
        limits = new SizeLimits({ engine: { vault } });
      const bound = await limits.ensure(s, plan, 120, 3);
      assert.equal(bound.capGiB, 6);
      await limits.verify(s, bound);
      const repeated = await limits.ensure(s, plan, 120, 3);
      assert.equal(repeated.profileId, bound.profileId);
      const after = await s.arr("Radarr", "/qualityprofile");
      for (const original of before) {
        const current = after.find((p) => p.id === original.id);
        assert.equal(
          current.formatItems.find((f) => f.format === bound.formatId)?.score,
          0,
        );
        assert.deepEqual(
          {
            ...current,
            formatItems: current.formatItems.filter(
              (f) => f.format !== bound.formatId,
            ),
          },
          original,
        );
      }
      const format = await s.arr("Radarr", `/customformat/${bound.formatId}`);
      format.specifications[0].fields.find((f) => f.name === "max").value = 12;
      await s.arr("Radarr", `/customformat/${bound.formatId}`, {
        method: "PUT",
        body: format,
      });
      await assert.rejects(limits.verify(s, bound), /verändert/);
      await assert.rejects(limits.ensure(s, plan, 120, 3), /verändert/);
      assert.equal(
        (
          await s.arr("Radarr", `/customformat/${bound.formatId}`)
        ).specifications[0].fields.find((f) => f.name === "max").value,
        12,
      );
      console.log(
        "Native Größenregel, Wiederholung, Erhalt vorhandener Profile und Drift-Sperre bestanden.",
      );
    } finally {
      if (plan)
        await localDocker(
          [
            "compose",
            "-f",
            store.directory + "/deployments/" + plan.id + "/compose.json",
            "down",
          ],
          { timeout: 120000 },
        );
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
