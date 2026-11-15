import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTailnetGrant,
  tailnetHost,
  tailnetAddresses,
  tailnetBrowserLinks,
} from "./tailnet-access.js";
test("Gerätevorlage begrenzt Quellen und aktuelles Ziel auf genau die beiden nötigen HTTPS-Ports", () => {
  assert.deepEqual(
    buildTailnetGrant(
      "100.64.0.10, 100.64.0.11/32\n100.64.0.10",
      "100.64.0.20",
    ),
    {
      src: ["100.64.0.10", "100.64.0.11"],
      dst: ["100.64.0.20"],
      ip: ["tcp:443", "tcp:8443"],
    },
  );
  assert.deepEqual(
    buildTailnetGrant("fd7a:115c:a1e0::10/128", "fd7a:115c:a1e0::20").dst,
    ["fd7a:115c:a1e0::20"],
  );
});
test("Vorlagen lehnen pauschale Freigaben, fremde Netze und vermeintliche Selbsttests ab", () => {
  for (const value of [
    "*",
    "autogroup:member",
    "tag:server",
    "192.168.1.2",
    "127.0.0.1",
    "100.64.0.0/10",
    "100.064.0.1",
    "100.128.0.1",
    "100.64.0.256",
    "fd7a:115c:a1e0::/48",
    "fd7a:115c:a1e1::1",
    "::1",
    "https://device.ts.net",
  ])
    assert.throws(() => buildTailnetGrant(value, "100.64.0.20"), value);
  assert.throws(
    () => buildTailnetGrant("100.64.0.20", "100.64.0.20"),
    /sich selbst/,
  );
  assert.throws(() => buildTailnetGrant("100.64.0.10", "192.168.1.1"));
  assert.throws(() =>
    buildTailnetGrant(Array(17).fill("100.64.0.10").join(" "), "100.64.0.20"),
  );
});
test("Erkannte Serveradressen werden gefiltert; fehlende Adressen erzeugen keine geratenen Ziele", () => {
  assert.deepEqual(tailnetAddresses(null), []);
  assert.deepEqual(
    tailnetAddresses([
      "192.168.1.1",
      "fd7a:115c:a1e0::20",
      "100.64.0.20",
      "100.64.0.20",
    ]),
    ["100.64.0.20", "fd7a:115c:a1e0::20"],
  );
  assert.equal(tailnetHost("FD7A:115C:A1E0:0:0:0:0:20"), "fd7a:115c:a1e0::20");
});
test("Browserprüfung benutzt das konkrete HTTPS-Gerät und Discovery statt der gesperrten Authentik-Wurzel", () => {
  const links = tailnetBrowserLinks("device.example.ts.net");
  assert.equal(
    links.discovery,
    "https://device.example.ts.net:8443/application/o/stackpilot-jellyfin/.well-known/openid-configuration",
  );
  assert.equal(
    links.sso,
    "https://device.example.ts.net/sso/OID/start/stackpilot",
  );
  for (const host of [
    null,
    "https://device.example.ts.net",
    "other.invalid",
    "device.ts.net/path",
    "user@device.ts.net",
    "device.ts.net:8443",
  ])
    assert.equal(tailnetBrowserLinks(host), null);
});
