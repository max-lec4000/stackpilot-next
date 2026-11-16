import test from "node:test";
import assert from "node:assert/strict";
import { JellyfinProtection } from "./identity/jellyfin-protection.js";
import { inspectStreamyfinSeerr, streamyfinSeerrVersion } from "./identity/streamyfin-version.js";

test("Streamyfin verlangt eine stabile Seerr-Version ab 3.5.3", () => {
  for (const value of ["3.5.2", "3.5.3-rc.1", "develop", "3.5", "3.05.3", null])
    assert.equal(streamyfinSeerrVersion(value).supported, false);
  for (const value of ["3.5.3", "v3.5.3", "3.10.0", "4.0.0"])
    assert.equal(streamyfinSeerrVersion(value).supported, true);
});

function fixture(version) {
  const id = "a".repeat(64);
  const image = "ghcr.io/seerr-team/seerr@sha256:" + "b".repeat(64);
  const plan = { id: "later-plan", rootId: "root", project: "fixture", images: { Seerr: image } };
  const s = { request: async (service, route) => {
    assert.deepEqual([service, route], ["Seerr", "/api/v1/status"]);
    return { version };
  }};
  const container = { Id: id, State: { Running: true }, Image: image, Config: {
    Image: image, Labels: { "com.docker.compose.project": plan.project,
      "com.docker.compose.service": "seerr", "io.stackpilot.plan": plan.rootId, "io.stackpilot.managed": "true" },
  }};
  const docker = async ([operation]) => {
    if (operation === "ps") return id;
    if (operation === "inspect") return JSON.stringify([container]);
    throw Error("Ein blockiertes Image darf nicht zur Aktivierung geprüft werden.");
  };
  return { context: { plan, s }, docker, container };
}

test("Die laufende Version muss passen und das konkrete Image muss abgenommen sein", async () => {
  const old = fixture("3.5.2");
  const blocked = await inspectStreamyfinSeerr(old.context, old.docker);
  assert.equal(blocked.version, "3.5.2");
  assert.equal(blocked.ready, false);
  assert.match(blocked.reason, /mindestens Seerr 3\.5\.3/);

  const unapproved = fixture("3.5.3");
  assert.match((await inspectStreamyfinSeerr(unapproved.context, unapproved.docker)).reason, /noch nicht.*abgenommen/);

  old.container.Config.Labels["io.stackpilot.plan"] = "foreign";
  const foreign = await inspectStreamyfinSeerr(old.context, old.docker);
  assert.equal(foreign.ready, false);
  assert.equal(foreign.version, null);
});

test("Der Vorbereitungsschritt prüft Seerr unter Sperre vor dem Zugriff auf das Gateway", async () => {
  const { context, docker } = fixture("3.5.2");
  const protection = new JellyfinProtection({
    mutate: async (names, prepare) => {
      assert.deepEqual(names, ["Jellyfin", "Seerr"]);
      return prepare(context);
    },
  }, {}, docker);
  protection.verify = () => assert.fail("Ein blockierter Seerr-Stand darf das Gateway nicht vorbereiten.");
  await assert.rejects(protection.prepareStreamyfin(), /Seerr 3\.5\.2 läuft/);
});
