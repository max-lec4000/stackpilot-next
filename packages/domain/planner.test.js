import { test } from "node:test";
import assert from "node:assert/strict";
import { plan, components } from "./planner.js";
const base = {
  selected: components,
  vpn: true,
  path: "/srv/stackpilot/data",
  username: "admin",
};
test("Gesamtauswahl erzeugt einen Plan mit allen Verbindungen", () => {
  const p = plan(base);
  assert.equal(p.errors.length, 0);
  assert.equal(p.selected.length, 9);
  assert.equal(p.connections.length, 12);
  assert.equal(p.steps.filter((s) => s.includes("Mullvad")).length, 1);
});
test("VPN ohne Downloadclient blockiert", () =>
  assert.ok(
    plan({ ...base, selected: ["Jellyfin"] }).errors.some((e) =>
      e.includes("qBittorrent"),
    ),
  ));
test("Unsichere Pfade und leere Auswahl blockieren", () => {
  for (const path of ["/", "/srv/../etc", "relative"])
    assert.ok(plan({ ...base, path }).errors.length);
  assert.ok(plan({ ...base, selected: [] }).errors.length);
});
test("Fehlende Partner sichtbar und Auswahl deterministisch", () => {
  assert.ok(
    plan({ ...base, selected: ["Streamystats"], vpn: false }).warnings.length,
  );
  assert.deepEqual(
    plan({ ...base, selected: [...components].reverse() }),
    plan(base),
  );
});
test("Webport-Konflikte erkennen IPv4 und IPv6 ohne fremde Apps zu melden", async () => {
  const { portConflicts } = await import("./planner.js");
  assert.deepEqual(
    portConflicts(
      ["Sonarr", "Radarr"],
      ["0.0.0.0:8989", "[::]:7878", "127.0.0.1:8096"],
    ),
    [
      { component: "Sonarr", port: 8989 },
      { component: "Radarr", port: 7878 },
    ],
  );
});
