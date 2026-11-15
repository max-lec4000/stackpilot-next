import { test } from "node:test";
import assert from "node:assert/strict";
import {
  backchannelCompose,
  backchannelConfig,
} from "./identity/oidc-backchannel.js";
test("Interner OIDC-Dienst veröffentlicht keine Ports, benötigt keine Capabilities und bindet nur zwei bestätigte Netze ein", () => {
  const r = {
    project: "sp-oidc-fixture",
    id: "id",
    rootId: "p",
    uid: 1000,
    gid: 1000,
    directory: "/private/identity-secrets/oidc",
    hostname: "device.example.ts.net",
    media: "stack_default",
    ingress: "identity_ingress",
  };
  const compose = backchannelCompose(r),
    svc = compose.services.backchannel;
  assert.equal(svc.ports, undefined);
  assert.equal(svc.read_only, true);
  assert.deepEqual(svc.cap_drop, ["ALL"]);
  assert.deepEqual(svc.networks.media.aliases, [r.hostname]);
  assert.deepEqual(Object.keys(compose.networks).sort(), ["ingress", "media"]);
  const conf = backchannelConfig(r.hostname, "managed-idp-gateway-1");
  assert.ok(!conf.includes("/if/admin"));
  assert.match(conf, /ssl_protocols TLSv1.2 TLSv1.3/);
  assert.match(conf, /location \/ \{return 404;/);
  assert.throws(() =>
    backchannelConfig(r.hostname, "evil; proxy_pass http://other"),
  );
});
test("Manuell belegter Anbieter-Alias wird nicht durch einen verwalteten Dienst übernommen", async () => {
  const { OidcBackchannel } = await import("./identity/oidc-backchannel.js");
  const helper = new OidcBackchannel({}, null, null, {
    docker: async (args) =>
      args[0] === "network"
        ? JSON.stringify([{ Containers: { foreign: {} } }])
        : JSON.stringify([
            {
              Config: { Labels: {} },
              NetworkSettings: {
                Networks: { media: { Aliases: ["device.example.ts.net"] } },
              },
            },
          ]),
  });
  await assert.rejects(
    helper.aliases("media", "device.example.ts.net", "owned"),
    /manuell vergeben/,
  );
});
