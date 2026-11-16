import test from "node:test";
import assert from "node:assert/strict";
import { JellyfinProtection } from "./identity/jellyfin-protection.js";
import { inspectStreamyfinSeerr, streamyfinSeerrVersion } from "./identity/streamyfin-version.js";

test("Das private Streamyfin-Gateway verlangt eine stabile Seerr-Version ab 3.5.2", () => {
  for (const value of ["3.5.1", "3.5.3-rc.1", "develop", "3.5", "3.05.3", null])
    assert.equal(streamyfinSeerrVersion(value).supported, false);
  for (const value of ["3.5.2", "v3.5.2", "3.5.3", "3.10.0", "4.0.0"])
    assert.equal(streamyfinSeerrVersion(value).supported, true);
});

function fixture(version, image = "ghcr.io/seerr-team/seerr@sha256:" + "b".repeat(64)) {
  const id = "a".repeat(64);
  const imageId = "sha256:" + "c".repeat(64);
  const plan = { id: "later-plan", rootId: "root", project: "fixture", images: { Seerr: image } };
  const s = { request: async (service, route) => {
    assert.deepEqual([service, route], ["Seerr", "/api/v1/status"]);
    return { version };
  }};
  const container = { Id: id, State: { Running: true }, Image: imageId, Config: {
    Image: image, Labels: { "com.docker.compose.project": plan.project,
      "com.docker.compose.service": "seerr", "io.stackpilot.plan": plan.rootId, "io.stackpilot.managed": "true" },
  }};
  const docker = async ([operation, ...args]) => {
    if (operation === "ps") return id;
    if (operation === "inspect") return JSON.stringify([container]);
    assert.deepEqual([operation, ...args], ["image", "inspect", image, "--format", "{{.Id}}"]);
    return imageId;
  };
  return { context: { plan, s }, docker, container };
}

test("Die laufende Version muss passen und das konkrete Image muss abgenommen sein", async () => {
  const old = fixture("3.5.1");
  const blocked = await inspectStreamyfinSeerr(old.context, old.docker);
  assert.equal(blocked.version, "3.5.1");
  assert.equal(blocked.ready, false);
  assert.match(blocked.reason, /mindestens Seerr 3\.5\.2/);

  for (const version of ["3.5.2", "3.5.3"]) {
    const unapproved = fixture(version);
    assert.match((await inspectStreamyfinSeerr(unapproved.context, unapproved.docker)).reason, /noch nicht.*abgenommen/);
  }

  old.container.Config.Labels["io.stackpilot.plan"] = "foreign";
  const foreign = await inspectStreamyfinSeerr(old.context, old.docker);
  assert.equal(foreign.ready, false);
  assert.equal(foreign.version, null);
});

test("Der offizielle Seerr-Digest muss zum laufenden Image passen", async () => {
  const image = "ghcr.io/seerr-team/seerr@sha256:aadee014b40e28cf9aa4928bc9d1183a6eb08f8c44d543cddc9efdcb16549be2";
  const { context, docker, container } = fixture("3.5.2", image);
  assert.equal((await inspectStreamyfinSeerr(context, docker)).ready, true);
  container.Image = "sha256:" + "d".repeat(64);
  assert.match((await inspectStreamyfinSeerr(context, docker)).reason, /während der Prüfung geändert/);
});

test("Der Vorbereitungsschritt prüft Seerr unter Sperre vor dem Zugriff auf das Gateway", async () => {
  const { context, docker } = fixture("3.5.1");
  const protection = new JellyfinProtection({
    mutate: async (names, prepare) => {
      assert.deepEqual(names, ["Jellyfin", "Seerr"]);
      return prepare(context);
    },
  }, {}, docker);
  protection.verify = () => assert.fail("Ein blockierter Seerr-Stand darf das Gateway nicht vorbereiten.");
  await assert.rejects(protection.prepareStreamyfin(), /Seerr 3\.5\.1 läuft/);
});
