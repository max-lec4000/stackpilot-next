import { test } from "node:test";
import assert from "node:assert/strict";
import { apps, appNames, linksIn, missingRequirements } from "./apps.js";
import { readFileSync } from "node:fs";

const catalog = JSON.parse(readFileSync(new URL("../catalog/services.json", import.meta.url), "utf8"));

test("Jede App im Beziehungskatalog hat ein Image und verweist nur auf bekannte Apps", () => {
  for (const name of appNames) {
    assert.ok(catalog.services[name]?.image, name + " fehlt in services.json");
    for (const other of [...(apps[name].requires || []), ...(apps[name].requiresAny || []), ...(apps[name].linksTo || [])])
      assert.ok(appNames.includes(other), `${name} verweist auf unbekannte App ${other}`);
  }
});

test("Verbindungen und Pflicht-Partner folgen der Auswahl", () => {
  assert.equal(linksIn(appNames).length, 12);
  assert.deepEqual(linksIn(["Seerr", "Jellyfin"]), [["Seerr", "Jellyfin"]]);
  assert.deepEqual(missingRequirements(["Seerr"]), ["Seerr benötigt Jellyfin."]);
  assert.deepEqual(missingRequirements(["Bazarr"]), ["Bazarr benötigt Sonarr oder Radarr."]);
  assert.deepEqual(missingRequirements(["Bazarr", "Radarr"]), []);
});
