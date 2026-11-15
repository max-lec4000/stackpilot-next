import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, symlink, rm } from "node:fs/promises";
import os from "node:os";
import { makeReport, writeReport } from "./report.js";
import {
  parseSockets,
  serviceCandidates,
  retirementCandidates,
  systemDetails,
} from "./system-details.js";
import { flattenMounts } from "./inventory.js";
test("TCP und UDP werden mit Prozessnamen ohne Befehlszeilen erfasst", () => {
  const r = parseSockets(
    'tcp LISTEN 0 128 0.0.0.0:8989 0.0.0.0:* users:(("Sonarr",pid=123,fd=5))\nudp UNCONN 0 0 [::]:5353 [::]:*',
  );
  assert.equal(r[0].address, "0.0.0.0:8989");
  assert.deepEqual(r[0].processes, [{ name: "Sonarr", pid: 123 }]);
  assert.equal(r[1].protocol, "udp");
});
test("Nur Medien-Dienste werden als Ablösekandidaten erfasst, keine automatische Aktion", () => {
  const s = serviceCandidates(
    "sonarr.service loaded active running Sonarr\nssh.service loaded active running SSH\nqbittorrent-nox.service loaded inactive dead qBittorrent",
  );
  assert.equal(s.length, 2);
  const r = retirementCandidates({
    containers: [{ ID: "1", Names: "sonarr", component: "sonarr" }],
    details: { services: s },
  });
  assert.ok(r.containers[0].preserveData);
  assert.equal(r.services.length, 2);
  assert.ok(r.services.every((s) => s.preserveData));
});
test("Mountoptionen und Datenträger-Identifikatoren gelangen nicht in den Bericht", async () => {
  const mounts = flattenMounts([
    {
      target: "/data",
      source: "//alice:SECRET@nas/share",
      fstype: "cifs",
      options: "rw,password=SECRET,credentials=/private,key=secret,noexec",
    },
  ]);
  assert.ok(!JSON.stringify(mounts).includes("SECRET"));
  assert.equal(mounts[0].options, "rw,noexec");
  const details = await systemDetails(async (bin) =>
    bin === "lsblk"
      ? {
          ok: true,
          output: JSON.stringify({
            blockdevices: [
              {
                name: "sda",
                type: "disk",
                size: 123,
                serial: "PRIVATE-SERIAL",
                uuid: "PRIVATE-UUID",
              },
            ],
          }),
        }
      : { ok: false, reason: "Test" },
  );
  const report = makeReport({ mounts, details });
  assert.ok(!JSON.stringify(report).includes("PRIVATE-"));
  assert.equal(report.schemaVersion, 1);
});
test("CLI-Datei ist privat, überschreibt keine Datei und folgt keinem Dateisymlink", async () => {
  const dir = await mkdtemp(os.tmpdir() + "/stackpilot-report-");
  try {
    const filename = dir + "/report.json";
    await writeReport(filename, makeReport({ host: "fixture" }));
    assert.equal((await stat(filename)).mode & 0o777, 0o600);
    assert.equal(
      JSON.parse(await readFile(filename, "utf8")).inventory.host,
      "fixture",
    );
    await assert.rejects(writeReport(filename, {}), { code: "EEXIST" });
    await symlink(filename, dir + "/link.json");
    await assert.rejects(writeReport(dir + "/link.json", {}), {
      code: "EEXIST",
    });
  } finally {
    await rm(dir, { recursive: true });
  }
});
