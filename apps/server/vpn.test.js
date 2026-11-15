import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { parseWireGuard, importVpn, probeVpn } from "./vpn.js";
import { StateStore } from "./state.js";
import { Vault } from "./vault.js";
import { composeFor, prepareFiles } from "./provision-files.js";
import { catalog } from "./catalog.js";
const key = () => randomBytes(32).toString("base64");
const config = () =>
  `[Interface]\nPrivateKey = ${key()}\nAddress = 10.64.12.34/32, fc00:bbbb::1/128\nDNS = 10.64.0.1\n[Peer]\nPublicKey = ${key()}\nEndpoint = 185.213.154.68:51820\nAllowedIPs = 0.0.0.0/0, ::/0\n`;
test("WireGuard-Import akzeptiert Daten und weist Skripte, zusätzliche Peers und lokale Endpunkte ab", () => {
  const input = config();
  const result = parseWireGuard(input);
  assert.equal(result.address, "10.64.12.34/32");
  assert.ok(!result.config.includes("fc00"));
  assert.ok(!result.config.includes("::/0"));
  for (const bad of [
    input + "PostUp = touch /tmp/unsafe\n",
    input + "[Peer]\n",
    input.replace("185.213.154.68", "127.0.0.1"),
    input.replace("0.0.0.0/0", "10.0.0.0/8"),
    input.replace("51820", "99999"),
  ])
    assert.throws(() => parseWireGuard(bad));
});
test("VPN-Geheimnisse bleiben verschlüsselt; qBittorrent und Prüfcontainer teilen ausschließlich das VPN-Netzwerk", async () => {
  const dir = await mkdtemp("/tmp/sp-vpn-test-");
  const store = new StateStore(dir + "/state"),
    vault = new Vault(store);
  try {
    const text = config(),
      profile = importVpn(vault, text);
    assert.ok(!JSON.stringify(profile).includes("PrivateKey"));
    assert.ok(
      !(await readFile(dir + "/state/state.sqlite")).includes(
        Buffer.from(text.match(/PrivateKey = (.+)/)[1]),
      ),
    );
    const plan = {
      id: "fixture",
      project: "fixture",
      appdata: dir + "/appdata",
      uid: process.getuid(),
      gid: process.getgid(),
      vpnProfileId: profile.id,
      spec: {
        path: dir + "/data",
        username: "admin",
        selected: ["qBittorrent"],
        vpn: true,
      },
      ports: { qBittorrent: 8080 },
      images: Object.fromEntries(
        Object.entries(catalog.services).map(([n, s]) => [n, s.image]),
      ),
    };
    await prepareFiles(plan, vault, dir + "/manifest");
    const before = composeFor(plan, false),
      after = composeFor(plan, true);
    assert.equal(before.services.qbittorrent.network_mode, "service:gluetun");
    assert.equal(before.services.qbittorrent.ports, undefined);
    assert.deepEqual(before.services.gluetun.ports, []);
    assert.equal(after.services.gluetun.ports[0], "127.0.0.1:8080:8080");
    assert.deepEqual(after.services.gluetun.cap_add, ["NET_ADMIN"]);
    assert.equal(after.services.gluetun.environment.VPN_INTERFACE, "tun0");
    assert.equal(
      after.services.gluetun.sysctls["net.ipv6.conf.all.disable_ipv6"],
      "1",
    );
    assert.equal(after.services["vpn-probe"].network_mode, "service:gluetun");
    assert.ok(
      after.services.qbittorrent.volumes.some((v) =>
        v.endsWith(":/etc/resolv.conf:ro"),
      ),
    );
    assert.ok(!JSON.stringify(after).includes("PrivateKey"));
    assert.equal(
      (await stat(dir + "/appdata/gluetun/resolv.conf")).mode & 0o777,
      0o644,
    );
    assert.equal(
      (await stat(dir + "/appdata/gluetun/wg0.conf")).mode & 0o777,
      0o600,
    );
  } finally {
    store.close();
    await rm(dir, { recursive: true });
  }
});
test("VPN-Prüfung behandelt fehlende und negative Nachweise als Fehler; Kontrollschlüssel kommt nur über stdin", async () => {
  const secret = "fixture-private-control-key";
  const passed = await probeVpn(
    "a".repeat(64),
    secret,
    "isolation",
    async (args, stdin) => {
      assert.ok(!args.includes(secret));
      assert.equal(JSON.parse(stdin).key, secret);
      assert.ok(args.at(-1).includes("finally"));
      return JSON.stringify({ passed: true });
    },
  );
  assert.equal(passed.status, "passed");
  for (const result of ['{"passed":false}', "{}", "not json"])
    await assert.rejects(
      probeVpn("a".repeat(64), secret, "isolation", async () => result),
      /Ausfallsperre/,
    );
});

test("Fehlgeschlagener Ausfallsperrentest verhindert Bootstrap und Portfreigabe des Downloadclients", async () => {
  const { DeploymentEngine } = await import("./installer.js");
  const os = await import("node:os");
  const { inspectPath } = await import("./inventory.js");
  const dir = await mkdtemp("/tmp/sp-vpn-gate-");
  const store = new StateStore(dir + "/state"),
    vault = new Vault(store);
  const commands = [];
  const docker = async (args) => {
    commands.push(args);
    return args[0] === "network" ? "" : args[0] === "ps" ? "" : "fixture";
  };
  const engine = new DeploymentEngine(store, vault, {
    docker,
    inspectStorage: async (target) => ({
      ...(await inspectPath(target)),
      freeBytes: 20 * 1024 ** 3,
    }),
    allowUnqualifiedLinux: true,
  });
  engine.tunAvailable = async () => true;
  const release = (await readFile("/etc/os-release", "utf8")).match(
    /^PRETTY_NAME="?([^"\n]+)/m,
  )[1];
  engine.host = async () => ({
    host: os.hostname(),
    release,
    platform: "linux",
    details: { architecture: "x64" },
    docker: { available: true },
    compose: { available: true },
    containerScanComplete: true,
    containers: [],
    listening: [],
  });
  engine.vpnCheck = async (_plan, action) => {
    if (action === "isolation")
      throw new Error("Fixture-Ausfallsperre fehlgeschlagen");
    return { service: "Mullvad", status: "passed" };
  };
  try {
    const imported = importVpn(vault, config());
    const plan = await engine.createPlan({
      selected: ["qBittorrent"],
      path: dir + "/data",
      username: "admin",
      vpn: true,
      vpnProfileId: imported.id,
    });
    assert.equal(plan.executable, true, plan.blockers.join("\n"));
    assert.equal(plan.confirmation, "OK");
    await assert.rejects(engine.confirm(plan.id, "", false), /nicht bestätigt/);
    const op = await engine.confirm(plan.id, plan.confirmation, false);
    const deadline = Date.now() + 5000;
    while (store.operation(op.id).status !== "failed" && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 10));
    const failed = store.operation(op.id);
    assert.equal(failed.status, "failed");
    assert.match(failed.error, /Ausfallsperre/);
    assert.equal(
      failed.steps.find((s) => s.id === "bootstrap").status,
      "pending",
    );
    assert.equal(
      failed.steps.find((s) => s.id === "publish").status,
      "pending",
    );
    const starts = commands.filter(
      (args) => args[0] === "compose" && args.includes("up"),
    );
    assert.equal(starts.length, 1);
    assert.deepEqual(starts[0].slice(-2), ["gluetun", "vpn-probe"]);
    assert.ok(!JSON.stringify(plan).includes("PrivateKey"));
  } finally {
    while (engine.running) await new Promise((r) => setTimeout(r, 10));
    store.close();
    await rm(dir, { recursive: true });
  }
});

test("Installationsprüfung akzeptiert beide NET_ADMIN-Schreibweisen und weist unsichere VPN-Rechte weiterhin ab", async () => {
  const { DeploymentEngine } = await import("./installer.js");
  const os = await import("node:os");
  const dir = await mkdtemp("/tmp/sp-vpn-capabilities-");
  const store = new StateStore(dir + "/state");
  try {
    const plan = {
      id: "fixture", kind: "deployment", catalogVersion: catalog.version,
      host: os.hostname(), uid: process.getuid(), gid: process.getgid(),
      release: (await readFile("/etc/os-release", "utf8")).match(/^PRETTY_NAME="?([^"\n]+)/m)[1],
      project: "sp-capabilities", appdata: dir + "/appdata",
      spec: { selected: ["qBittorrent"], path: dir + "/data", username: "admin", vpn: true },
      ports: { qBittorrent: 8080 },
      images: Object.fromEntries(Object.entries(catalog.services).map(([name, service]) => [name, service.image])),
    };
    const expected = composeFor(plan, false).services.gluetun;
    const container = {
      id: "a".repeat(64), name: "/sp-capabilities-gluetun-1", service: "gluetun",
      project: plan.project, managedPlan: plan.id, image: plan.images.Gluetun,
      privileged: false, capAdd: ["NET_ADMIN"], firewallOn: true,
      devices: [{ CgroupPermissions: "rwm", PathOnHost: "/dev/net/tun", PathInContainer: "/dev/net/tun" }],
      sysctls: { "net.ipv6.conf.all.disable_ipv6": "1" },
      bindings: {}, network: plan.project + "_default", networkNames: [plan.project + "_default"],
      mounts: expected.volumes.map((volume) => {
        const [Source, Destination, mode] = volume.split(":");
        return { Type: "bind", Source, Destination, RW: mode !== "ro" };
      }),
    };
    const engine = new DeploymentEngine(store, new Vault(store), {
      docker: async (args) => args[0] === "ps" ? container.id : JSON.stringify(container),
    });
    engine.network = async () => ({ id: "b".repeat(64), project: plan.project, plan: plan.id });
    for (const capability of ["NET_ADMIN", "CAP_NET_ADMIN"]) {
      container.capAdd = [capability];
      assert.equal((await engine.validate(plan, true)).length, 1);
    }
    for (const capabilities of [[], ["SYS_ADMIN"], ["CAP_SYS_ADMIN"], ["CAP_NET_ADMIN", "CAP_SYS_ADMIN"]]) {
      container.capAdd = capabilities;
      await assert.rejects(engine.validate(plan, true), /VPN-Rechte/);
    }
    container.capAdd = ["CAP_NET_ADMIN"];
    container.sysctls["net.ipv6.conf.all.disable_ipv6"] = "0";
    await assert.rejects(engine.validate(plan, true), /VPN-Rechte/);
    container.sysctls["net.ipv6.conf.all.disable_ipv6"] = "1";
    container.firewallOn = false;
    await assert.rejects(engine.validate(plan, true), /VPN-Rechte/);
    container.firewallOn = true;
    container.devices[0].PathOnHost = "/dev/other";
    await assert.rejects(engine.validate(plan, true), /VPN-Rechte/);
  } finally {
    store.close();
    await rm(dir, { recursive: true });
  }
});
