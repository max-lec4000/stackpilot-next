import test from "node:test";
import assert from "node:assert/strict";
import { ContainerMaintenance } from "./container-maintenance.js";
import { catalog } from "./catalog.js";

test("Sammelupdates nehmen nur aktuell geprüfte, stabile Ziele an und melden den Ausgang je App", async () => {
  const plan = {
    id: "fixture", spec: { selected: ["Seerr", "Lidarr", "Bazarr"] },
    images: Object.fromEntries(["Seerr", "Lidarr", "Bazarr"]
      .map((name) => [name, "example.invalid/" + name.toLowerCase() + "@sha256:" + "1".repeat(64)])),
  };
  const engine = {
    current: () => ({ job: { status: "completed" }, plan }),
    store: { activeLease: () => false }, vault: { get: () => null },
  };
  const maintenance = new ContainerMaintenance({ engine }, {
    catalog: { ...catalog.services, Bazarr: { ...catalog.services.Bazarr, channel: "preview" } },
  });
  const calls = [];
  const couchdeck = {
    status: async () => ({ updateVersion: "0.2.6", helper: { available: true, running: null } }),
    update: async (version) => {
      calls.push(version);
      return { phase: "started" };
    },
  };
  maintenance.apply = async ({ name }) => {
    calls.push(name);
    return { phase: name === "Seerr" ? "rolled-back" : "updated" };
  };
  const { services } = await maintenance.list();
  const targets = services.map(({ name, review }) => ({ name, review }));
  assert.equal(services.find(({ name }) => name === "Bazarr").update, false);
  await assert.rejects(maintenance.applyBatch({ targets, confirmation: "OK" }, couchdeck), /nicht mehr aktuell/);
  assert.deepEqual(calls, []);
  const approved = targets.filter(({ name }) => name !== "Bazarr");
  const result = await maintenance.applyBatch({
    targets: [...approved, { name: "Couchdeck", review: "0.2.6" }], confirmation: "OK",
  }, couchdeck);
  assert.deepEqual(calls, ["Lidarr", "Seerr", "0.2.6"]);
  assert.deepEqual(result.results, [
    { name: "Lidarr", phase: "updated" }, { name: "Seerr", phase: "rolled-back" },
    { name: "Couchdeck", phase: "started" },
  ]);
});

test("Seerr-Prüfung nach dem Wechsel wartet, bis Seerr den Schlüssel wieder annimmt", async () => {
  const engine = { store: { activeLease: () => false }, vault: { get: () => null } };
  const m = new ContainerMaintenance({ engine }, { retryDelay: 0 });
  let calls = 0;
  const s = (answers) => ({
    wait: async () => {},
    additional: { seerr: async () => { const a = answers[Math.min(calls++, answers.length - 1)]; if (a instanceof Error) throw a; return a; } },
  });
  const http = (code) => Error(`Seerr: Dienstanfrage /api/v1/auth/me fehlgeschlagen (HTTP ${code}).`);
  await m.verify(s([http(403), http(403), http(503), { id: 1 }]), "Seerr");
  assert.equal(calls, 4);
  calls = 0;
  await assert.rejects(m.verify(s([http(403)]), "Seerr"), /HTTP 403/);
  assert.equal(calls, 20);
  calls = 0;
  await assert.rejects(m.verify(s([Error("Zeitüberschreitung")]), "Seerr"), /Zeitüberschreitung/);
  assert.equal(calls, 1);
});
