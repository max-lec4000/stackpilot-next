import { test } from "node:test";
import assert from "node:assert/strict";
import { routeAllowed, checkCreate, checkExec, checkVolume, checkNetwork, bare, clean } from "./policy.js";

const roots = ["/var/lib/stackpilot", "/home/u/stackpilot-data", "/home/u/stackpilot-data-appdata"];
test("Wächter: nur bekannte Aufrufe", () => {
  assert.equal(bare("/v1.47/containers/json?all=1"), "/containers/json");
  for (const [m, p] of [["GET", "/v1.47/containers/json"], ["POST", "/v1.47/containers/abc/exec"], ["POST", "/exec/abc/start"], ["POST", "/images/create?fromImage=x"], ["DELETE", "/v1.47/containers/abc"]])
    assert.equal(routeAllowed(m, p), true, `${m} ${p}`);
  for (const [m, p] of [["POST", "/build"], ["PUT", "/containers/abc/archive"], ["POST", "/swarm/init"], ["POST", "/plugins/pull"], ["POST", "/containers/abc/commit"], ["GET", "/secrets"]])
    assert.equal(routeAllowed(m, p), false, `${m} ${p}`);
});
test("Wächter: neue Container nur ohne Wege nach außen", () => {
  assert.deepEqual(checkCreate({ HostConfig: { Binds: ["/home/u/stackpilot-data/media:/data/media:ro"], CapDrop: ["ALL"] } }, { roots }), []);
  assert.deepEqual(checkCreate({ HostConfig: { CapAdd: ["NET_ADMIN"], Devices: [{ PathOnHost: "/dev/net/tun" }], Binds: ["/home/u/stackpilot-data-appdata/gluetun/wg0.conf:/gluetun/wireguard/wg0.conf:ro"] } }, { roots }), []);
  const bad = checkCreate({ HostConfig: { Privileged: true, NetworkMode: "host", PidMode: "host", CapAdd: ["SYS_ADMIN"],
    Devices: [{ PathOnHost: "/dev/sda" }], Binds: ["/:/host", "/var/run/docker.sock:/var/run/docker.sock", "/home/u/stackpilot-data-evil:/x"],
    SecurityOpt: ["apparmor=unconfined"] } }, { roots });
  for (const r of ["privileged", "NetworkMode=host", "PidMode=host", "CapAdd SYS_ADMIN", "Device /dev/sda", "Bind /", "Docker-Socket", "Bind /home/u/stackpilot-data-evil", "SecurityOpt apparmor=unconfined"])
    assert.ok(bad.includes(r), r);
  assert.deepEqual(checkCreate({ HostConfig: { Mounts: [{ Type: "bind", Source: "/etc" }] } }, { roots }), ["Bind /etc"]);
  assert.deepEqual(checkExec({ Privileged: true }), ["exec privileged"]);
});

test("Wächter: keine Umwege über Pfade, Verknüpfungen, Volumes und Netzwerke", () => {
  assert.equal(clean("/var/lib/stackpilot/../../../etc//x/."), "/etc/x");
  const c = { roots };
  assert.deepEqual(checkCreate({ HostConfig: { Binds: ["/var/lib/stackpilot/../../../etc:/x"] } }, c), ["Bind /etc"]);
  // Verknüpfung in einem erlaubten Ordner, die nach / zeigt
  const links = { ...c, resolve: (p) => (p.startsWith("/home/u/stackpilot-data/evil") ? "/" + p.slice("/home/u/stackpilot-data/evil".length + 1) : p) };
  assert.deepEqual(checkCreate({ HostConfig: { Binds: ["/home/u/stackpilot-data/evil:/x"] } }, links), ["Bind /home/u/stackpilot-data/evil → /"]);
  assert.deepEqual(checkCreate({ HostConfig: { Mounts: [{ Type: "bind", Source: "/home/u/stackpilot-data/evil/run/docker.sock" }] } }, links), ["Docker-Socket"]);
  // benannte Volumes mit Host-Ordner
  const bindOpts = (device) => ({ type: "none", o: "bind", device });
  assert.deepEqual(checkVolume({ Name: "a", DriverOpts: bindOpts("/") }, c), ["Volume-Bind /"]);
  assert.deepEqual(checkVolume({ Name: "a", DriverOpts: bindOpts("/home/u/stackpilot-data/media") }, c), []);
  assert.deepEqual(checkVolume({ Name: "a" }, c), []);
  assert.deepEqual(checkVolume({ Name: "a", Driver: "rexray" }, c), ["Volume-Treiber rexray"]);
  assert.deepEqual(checkVolume({ Name: "a", DriverOpts: { type: "nfs", o: "addr=1.2.3.4", device: ":/x" } }, c), ["Volume-Optionen nfs"]);
  assert.deepEqual(checkCreate({ HostConfig: { Mounts: [{ Type: "volume", Source: "v", VolumeOptions: { DriverConfig: { Name: "local", Options: bindOpts("/etc") } } }] } }, c), ["Volume-Bind /etc"]);
  assert.deepEqual(checkCreate({ HostConfig: { Mounts: [{ Type: "tmpfs", Target: "/tmp" }, { Type: "volume", Source: "db" }] } }, c), []);
  assert.deepEqual(checkCreate({ HostConfig: { Mounts: [{ Type: "npipe", Source: "x" }] } }, c), ["Mount-Typ npipe"]);
  // weitere Wege zum Host
  const more = checkCreate({ HostConfig: { VolumesFrom: ["x"], Runtime: "kata", CgroupParent: "/", DeviceCgroupRules: ["c 8:* rwm"], SecurityOpt: ["systempaths=unconfined"] } }, c);
  for (const r of ["VolumesFrom", "Runtime kata", "CgroupParent", "DeviceCgroupRules"]) assert.ok(more.includes(r), r);
  assert.ok(more.some((r) => r.startsWith("SecurityOpt")));
  // gluetun-Muster: Netz eines anderen Containers mitnutzen bleibt erlaubt
  assert.deepEqual(checkCreate({ HostConfig: { NetworkMode: "container:abc" } }, c), []);
  assert.deepEqual(checkNetwork({ Name: "n", Driver: "bridge" }), []);
  assert.deepEqual(checkNetwork({ Name: "n" }), []);
  assert.deepEqual(checkNetwork({ Name: "n", Driver: "macvlan" }), ["Netzwerk-Treiber macvlan"]);
});
