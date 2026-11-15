import { test } from "node:test";
import assert from "node:assert/strict";
import { deploymentReadiness } from "./deployment.js";
const spec = {
  selected: ["Sonarr", "qBittorrent"],
  path: "/tmp/stackpilot-data",
  username: "admin",
  vpn: true,
};
const host = {
  host: "fixture",
  platform: "linux",
  release: "Ubuntu 24.04 LTS",
  docker: { available: true },
  compose: { available: true },
  containerScanComplete: true,
  containers: [],
  listening: [],
};
const storage = { exists: true, writable: true, freeBytes: 20 * 1024 ** 3 };
test("Echte Vorplanung blockiert Ports, Altinstallationen und fehlende Rechte", () => {
  const p = deploymentReadiness(
    spec,
    {
      ...host,
      listening: ["127.0.0.1:8989"],
      containers: [
        {
          ID: "fixture",
          Names: "old-sonarr",
          component: "sonarr",
          project: "old",
        },
      ],
    },
    { ...storage, writable: false },
  );
  assert.equal(p.executable, false);
  assert.equal(p.existing.length, 1);
  assert.equal(p.portConflicts.length, 1);
  assert.ok(p.blockers.some((s) => s.includes("beschreibbar")));
});
test("VPN-Pilot bleibt ohne echte Ausfallsperre blockiert; fremde Komponenten werden abgewiesen", () => {
  assert.ok(
    deploymentReadiness({ ...spec, vpn: true }, host, storage).blockers.some(
      (s) => s.includes("Ausfallsperre"),
    ),
  );
  assert.throws(() =>
    deploymentReadiness(
      { ...spec, selected: ["shell-command"] },
      host,
      storage,
    ),
  );
});
test("Andere Linux-Systeme bleiben ohne ausdrücklichen Entwicklertestmodus gesperrt", () => {
  const p = deploymentReadiness(
    spec,
    { ...host, release: "Debian GNU/Linux 13 (trixie)" },
    storage,
  );
  assert.equal(p.executable, false);
  assert.ok(p.blockers.some((b) => b.includes("Ubuntu Server 24.04")));
  const testPlan = deploymentReadiness(
    spec,
    { ...host, release: "Debian GNU/Linux 13 (trixie)" },
    storage,
    { allowUnqualifiedLinux: true, vpnProfile: true },
  );
  assert.equal(testPlan.executable, true);
  assert.equal(testPlan.testPlatform, true);
});

test("Add-ons benötigen ihre verwalteten Partner; eine reine VPN-Umstellung braucht keine zweite 10-GiB-Neuinstallation", () => {
  for (const name of ["Seerr", "Streamystats", "Bazarr"]) {
    const result = deploymentReadiness(
      { ...spec, selected: [name] },
      host,
      storage,
    );
    assert.ok(result.blockers.some((b) => b.includes("benötigt")));
  }
  const changed = deploymentReadiness(
    { ...spec, vpn: true },
    host,
    { ...storage, freeBytes: 3 * 1024 ** 3 },
    { existing: spec.selected, vpnProfile: true },
  );
  assert.equal(changed.executable, true);
  const fresh = deploymentReadiness(
    { ...spec, vpn: true },
    host,
    { ...storage, freeBytes: 3 * 1024 ** 3 },
    { vpnProfile: true },
  );
  assert.equal(fresh.executable, false);
});

test("qBittorrent ohne VPN bleibt unabhängig von einer alten Ohne-VPN-Bestätigung gesperrt", () => {
  const result = deploymentReadiness({ ...spec, vpn: false }, host, storage);
  assert.equal(result.executable, false);
  assert.ok(result.blockers.some((b) => b.includes("Downloads benötigen")));
});
test("Couchdeck ist abwählbar, braucht Jellyfin und nimmt YouTube nur zusammen mit sich selbst", () => {
  const base = { ...spec, selected: ["Jellyfin"], vpn: false };
  const off = deploymentReadiness(base, host, storage);
  assert.equal(off.spec.couchdeck, false);
  assert.equal(off.spec.couchdeckYoutube, false);
  const on = deploymentReadiness(
    { ...base, couchdeck: true, couchdeckYoutube: true },
    host,
    storage,
  );
  assert.equal(on.spec.couchdeck, true);
  assert.equal(on.spec.couchdeckYoutube, true);
  assert.equal(on.executable, true);
  // Nur echte Wahrheitswerte zählen; YouTube ohne Couchdeck gibt es nicht.
  const loose = deploymentReadiness(
    { ...base, couchdeck: "yes", couchdeckYoutube: true },
    host,
    storage,
  );
  assert.equal(loose.spec.couchdeck, false);
  assert.equal(loose.spec.couchdeckYoutube, false);
  const withoutJellyfin = deploymentReadiness(
    { ...spec, vpn: false, selected: ["Sonarr"], couchdeck: true },
    host,
    storage,
  );
  assert.ok(withoutJellyfin.blockers.some((b) => b.includes("Couchdeck benötigt Jellyfin")));
});
