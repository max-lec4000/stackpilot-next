// Isolated Docker host only. Does not start Gluetun or contact a VPN endpoint.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { StateStore } from "./state.js";
import { Vault } from "./vault.js";
import { importVpn } from "./vpn.js";
import { catalog } from "./catalog.js";
import { prepareFiles } from "./provision-files.js";
import { localDocker } from "./retirement.js";
test(
  "Docker akzeptiert den VPN-Compose-Plan; der unprivilegierte Prüfcontainer kann seine feste Resolverdatei lesen",
  { timeout: 60000 },
  async () => {
    const root = await mkdtemp("/tmp/sp-vpn-compose-");
    const store = new StateStore(root + "/state"),
      vault = new Vault(store);
    try {
      const profile = importVpn(
        vault,
        `[Interface]\nPrivateKey = ${randomBytes(32).toString("base64")}\nAddress = 10.64.12.34/32\n[Peer]\nPublicKey = ${randomBytes(32).toString("base64")}\nEndpoint = 185.213.154.68:51820\nAllowedIPs = 0.0.0.0/0\n`,
      );
      const plan = {
        id: "fixture",
        project: "sp-vpn-compose",
        appdata: root + "/appdata",
        uid: process.getuid(),
        gid: process.getgid(),
        vpnProfileId: profile.id,
        spec: {
          selected: ["qBittorrent", "Sonarr"],
          path: root + "/data",
          username: "admin",
          vpn: true,
        },
        ports: { qBittorrent: 48080, Sonarr: 48989 },
        images: Object.fromEntries(
          Object.entries(catalog.services).map(([n, s]) => [n, s.image]),
        ),
      };
      await prepareFiles(plan, vault, root + "/manifest");
      for (const file of ["bootstrap", "compose"])
        await localDocker([
          "compose",
          "-f",
          `${root}/manifest/${file}.json`,
          "config",
          "--quiet",
        ]);
      const content = await localDocker([
        "run",
        "--rm",
        "--network",
        "none",
        "--user",
        "65534:65534",
        "--volume",
        `${root}/appdata/gluetun/resolv.conf:/etc/resolv.conf:ro`,
        catalog.services.ApiRelay.image,
        "node",
        "-e",
        "process.stdout.write(require('node:fs').readFileSync('/etc/resolv.conf','utf8'))",
      ]);
      assert.match(content, /^nameserver 127\.0\.0\.1\n/);
    } finally {
      store.close();
      await rm(root, { recursive: true });
    }
  },
);
