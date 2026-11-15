import { test } from "node:test";
import assert from "node:assert/strict";
import { storageCandidates, dataPathForMount } from "./storage.js";
test("Speicherauswahl enthält persistente Mounts, aber keine System- oder Docker-Mounts", () => {
  const mounts = [
    { target: "/", type: "ext4", options: "rw" },
    { target: "/boot", type: "ext4", options: "rw" },
    { target: "/run", type: "tmpfs", options: "rw" },
    { target: "/var/lib/docker/rootfs/fixture", type: "ext4", options: "rw" },
    { target: "/media/readonly", type: "ext4", options: "ro" },
    { target: "/mnt/media", type: "zfs", options: "rw" },
  ];
  assert.deepEqual(
    storageCandidates(mounts).map((m) => m.target),
    ["/", "/mnt/media"],
  );
  assert.equal(dataPathForMount("/"), "/srv/stackpilot/data");
  assert.equal(dataPathForMount("/mnt/media"), "/mnt/media/stackpilot/data");
});
