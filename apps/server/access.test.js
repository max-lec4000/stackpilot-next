import test from "node:test";
import assert from "node:assert/strict";
import { bindAddress, hostAllowed, serviceUrl } from "./access.js";
import { composeFor } from "./provision-files.js";

const interfaces = {
  lo: [{ family: "IPv4", address: "127.0.0.1" }],
  enp1s0: [{ family: "IPv4", address: "192.168.1.10" }],
  tailscale0: [{ family: "IPv4", address: "100.64.0.10" }],
};
const lan = { bind: "0.0.0.0", hostname: "server", interfaces, extra: "" };

test("Nur am Server: ausschließlich Loopback-Namen werden angenommen", () => {
  const local = { ...lan, bind: "127.0.0.1" };
  assert.equal(hostAllowed("stackpilot.localhost:5173", local), true);
  assert.equal(hostAllowed("127.0.0.1:5173", local), true);
  assert.equal(hostAllowed("192.168.1.10:5173", local), false);
  assert.equal(hostAllowed("server:5173", local), false);
});

test("Heimnetz: eigene Adressen und der Gerätename gelten, fremde Namen nicht", () => {
  for (const host of [
    "192.168.1.10:5173",
    "100.64.0.10:5173",
    "server:5173",
    "SERVER.local:5173",
    "server.example.ts.net:5173",
    "stackpilot.localhost:5173",
  ])
    assert.equal(hostAllowed(host, lan), true, host);
  for (const host of [
    "192.168.1.99:5173", // andere Adresse im selben Netz
    "evil.example:5173", // DNS-Rebinding
    "server.evil.example:5173",
    "other.example.ts.net:5173",
    "192.168.1.10", // ohne Port
    "192.168.1.10:5173/x",
    "",
    undefined,
  ])
    assert.equal(hostAllowed(host, lan), false, String(host));
});

test("Zusätzliche Namen des Betreibers und der feste Port werden beachtet", () => {
  assert.equal(
    hostAllowed("medien.example.org:5173", { ...lan, extra: " medien.example.org " }),
    true,
  );
  assert.equal(hostAllowed("192.168.1.10:8989", { ...lan, requiredPort: 5173 }), false);
  assert.equal(hostAllowed("192.168.1.10:5173", { ...lan, requiredPort: 5173 }), true);
  // Über einen eigenen Tunnel darf der Port bei Loopback-Namen abweichen.
  assert.equal(hostAllowed("stackpilot.localhost:5174", { ...lan, requiredPort: 5173 }), true);
});

test("Bindeadresse akzeptiert nur die beiden vorgesehenen Werte", () => {
  assert.equal(bindAddress({}), "127.0.0.1");
  assert.equal(bindAddress({ STACKPILOT_BIND: "0.0.0.0" }), "0.0.0.0");
  assert.throws(() => bindAddress({ STACKPILOT_BIND: "192.168.1.10" }));
});

test("Dienstadressen folgen dem Namen, über den der Browser StackPilot erreicht", () => {
  assert.equal(
    serviceUrl("sonarr", 8989, "0.0.0.0", "192.168.1.10:5173"),
    "http://192.168.1.10:8989",
  );
  assert.equal(
    serviceUrl("sonarr", 8989, "0.0.0.0", "stackpilot.localhost:5173"),
    "http://sonarr.localhost:8989",
  );
  assert.equal(
    serviceUrl("sonarr", 8989, undefined, "192.168.1.10:5173"),
    "http://sonarr.localhost:8989",
  );
});

test("Compose bindet Dienstports an die Adresse aus dem Plan", () => {
  const plan = {
    id: "p1",
    project: "stackpilot",
    appdata: "/srv/x-appdata",
    uid: 1000,
    gid: 1000,
    vpnProfileId: "v",
    spec: { selected: ["Jellyfin", "qBittorrent"], path: "/srv/x", vpn: true },
    ports: { Jellyfin: 8096, qBittorrent: 8080 },
  };
  const local = composeFor(plan, true).services;
  assert.deepEqual(local.jellyfin.ports, ["127.0.0.1:8096:8096"]);
  assert.deepEqual(local.gluetun.ports, ["127.0.0.1:8080:8080"]);
  const open = composeFor({ ...plan, bind: "0.0.0.0" }, true).services;
  assert.deepEqual(open.jellyfin.ports, ["0.0.0.0:8096:8096"]);
  assert.deepEqual(open.gluetun.ports, ["0.0.0.0:8080:8080"]);
  // Vor der Konten- und Verbindungsprüfung bleibt alles unveröffentlicht.
  assert.deepEqual(composeFor({ ...plan, bind: "0.0.0.0" }, false).services.jellyfin.ports, []);
});

test("Getrennte Netze: Jellyfin ohne Weg zu ARR und Downloadclient, Seerr in beiden", async () => {
  const { networkLayout } = await import("./provision-files.js");
  const plan = {
    id: "p1",
    project: "stackpilot",
    appdata: "/srv/x-appdata",
    uid: 1000,
    gid: 1000,
    vpnProfileId: "v",
    networkLayout,
    spec: { selected: ["Jellyfin", "Seerr", "Sonarr", "Prowlarr", "qBittorrent", "Streamystats"], path: "/srv/x", vpn: true },
    ports: { Jellyfin: 8096, Seerr: 5055, Sonarr: 8989, Prowlarr: 9696, qBittorrent: 8080, Streamystats: 3000 },
  };
  const c = composeFor(plan, true);
  assert.deepEqual(c.services.jellyfin.networks, ["default"]);
  assert.deepEqual(c.services.streamystats.networks, ["default"]);
  assert.deepEqual(c.services.seerr.networks, ["default", "arr"]);
  assert.deepEqual(c.services.sonarr.networks, ["arr"]);
  assert.deepEqual(c.services["api-relay"].networks, ["default", "arr"]);
  assert.deepEqual(c.services.gluetun.networks, { arr: { aliases: ["qbittorrent"] } });
  assert.equal(c.services.qbittorrent.networks, undefined);
  assert.equal(c.services.qbittorrent.network_mode, "service:gluetun");
  assert.ok(c.networks.arr);
  // Alte Pläne ohne Layout bleiben unverändert in einem Netz.
  const old = composeFor({ ...plan, networkLayout: undefined }, true);
  assert.equal(old.services.jellyfin.networks, undefined);
  assert.equal(old.networks.arr, undefined);
  // Eingefrorene Definitionen eines älteren Plans werden bei der Umstellung neu verteilt.
  const upgraded = composeFor(
    { ...plan, spec: { ...plan.spec, selected: [] }, preservedServices: { sonarr: { image: "x" }, gluetun: { image: "g", networks: { default: { aliases: ["qbittorrent"] } } } } },
    true,
  );
  assert.deepEqual(upgraded.services.sonarr.networks, ["arr"]);
  assert.deepEqual(upgraded.services.gluetun.networks, { arr: { aliases: ["qbittorrent"] } });
});
