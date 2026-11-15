import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, stat } from "node:fs/promises";
import { StateStore } from "./state.js";
import { Vault } from "./vault.js";
import {
  identityCompose,
  publicLoginGateway,
  validateIdentityInput,
  releases,
} from "./identity/config.js";
import { identityBlueprint } from "./identity/blueprint.js";
import { IdentityPreparation } from "./identity/preparation.js";
const input = { hostname: "media.example.ts.net", uid: 1000, gid: 1000 };
test("Identitätsdienste laufen nicht als Root, ohne Socket oder öffentliche Ports und mit festgelegten Images", () => {
  const c = identityCompose(input);
  assert.equal(c.networks.identity.internal, true);
  for (const [name, s] of Object.entries(c.services)) {
    assert.match(s.image, /@sha256:[a-f0-9]{64}$/);
    assert.equal(s.user, "1000:1000");
    assert.equal(s.read_only, true);
    assert.deepEqual(s.cap_drop, ["ALL"]);
    assert.ok(s.security_opt.includes("no-new-privileges:true"));
    assert.equal(JSON.stringify(s).includes("docker.sock"), false);
    for (const p of s.ports || []) assert.match(p, /^127\.0\.0\.1:/);
    if (name !== "gateway") assert.equal(s.ports, undefined);
  }
  assert.deepEqual(c.services.gateway.ports, [
    "127.0.0.1:19080:8080",
    "127.0.0.1:19000:8090",
  ]);
  assert.equal(
    c.services.server.environment.AUTHENTIK_POSTGRESQL__PASSWORD,
    "file:///run/secrets/database_password",
  );
});
test("Öffentliche Vorlage ist eine Allowlist ohne Administrations-, Benutzer- und Tokenverwaltung", () => {
  const c = publicLoginGateway(input);
  assert.match(c, /location \/ \{ return 404;/);
  assert.equal(c.includes("location /api/"), false);
  assert.equal(c.includes("/api/v3/core/users/"), false);
  assert.equal(c.includes("/if/admin/"), false);
  assert.match(c, /server_name media.example.ts.net/);
  assert.match(c, /listen 8090/);
  assert.equal(c.includes("proxy_params_unused"), false);
  assert.match(c, /limit_req_status 429/);
});
test("MFA ist verpflichtend, Tokens kurzlebig und alternative OAuth-Anmeldewege fehlen", () => {
  const b = identityBlueprint(input);
  assert.match(b, /not_configured_action: deny/);
  assert.match(b, /last_auth_threshold: seconds=0/);
  assert.match(b, /grant_types: \[authorization_code\]/);
  assert.match(b, /matching_mode: strict/);
  assert.match(b, /access_token_validity: minutes=5/);
  assert.match(b, /not request.user.is_superuser/);
  assert.match(b, /spv_/);
  assert.equal(
    releases.ssoPlugin.testedJellyfinVersions.includes("12.4.0"),
    true,
  );
});
test("Ungültige Hostnamen, Root und Portkollisionen sind ausgeschlossen", () => {
  for (const hostname of [
    "evil.test",
    "ok.ts.net\nattack",
    "https://ok.ts.net",
    "localhost",
  ])
    assert.throws(() => validateIdentityInput({ ...input, hostname }));
  assert.throws(() => validateIdentityInput({ ...input, uid: 0 }));
  assert.throws(() => validateIdentityInput({ ...input, adminPort: 19080 }));
});
test("Vorbereitung ist privat, wiederholbar und überschreibt geänderte Dateien nicht", async () => {
  const dir = await mkdtemp("/tmp/sp-id-test-"),
    store = new StateStore(dir),
    vault = new Vault(store),
    plan = { id: "p", rootId: "r" };
  try {
    const hub = {
      engine: {
        store,
        vault,
        current: () => ({ plan, job: { status: "completed" } }),
      },
      mutate: async (n, fn) => fn({ plan }),
    };
    const remote = {
      inspect: async () => ({
        tailscaleRunning: true,
        hostname: input.hostname,
        target: "http://127.0.0.1:8096",
        jellyfin: { version: "12.4.0" },
        serveKnown: true,
        serve: { exclusive: true, public: false },
      }),
    };
    const setup = new IdentityPreparation(hub, remote);
    const result = await setup.prepare(),
      record = setup.current();
    assert.equal(result.publicReady, false);
    assert.equal(result.pluginCompatible, true);
    assert.equal(result.publicReady,false);
    assert.equal((await setup.prepare()).id, result.id);
    const secrets = vault.get("identity-secrets:" + record.id);
    for (const value of Object.values(secrets))
      assert.equal(JSON.stringify(result).includes(value), false);
    assert.equal(
      (await stat(record.directory + "/secrets/admin_password")).mode & 0o077,
      0,
    );
    await setup.verify();
    await writeFile(record.directory + "/config/start.py", "changed");
    await assert.rejects(() => setup.verify(), /geändert/);
    assert.equal((await setup.prepare()).id, result.id);
    assert.equal(
      await readFile(record.directory + "/config/start.py", "utf8"),
      "changed",
    );
    await assert.rejects(
      () => setup.start({ id: record.id, confirmation: "NO" }),
      /OK/,
    );
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Lokale Gateway-Prüfung bewahrt den Host-Header und folgt keinen Weiterleitungen", async () => {
  const { createServer } = await import("node:http");
  const { localIdentityRequest } = await import("./identity/local-request.js");
  const server = createServer((req, res) => {
    res.writeHead(302, {
      Location: "https://external.invalid/",
      "Set-Cookie": ["a=1; HttpOnly", "b=2; Secure"],
    });
    res.end(req.headers.host);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await localIdentityRequest(
      `http://127.0.0.1:${server.address().port}/`,
      { headers: { Host: "identity.example.ts.net" } },
    );
    assert.equal(response.status, 302);
    assert.equal(await response.text(), "identity.example.ts.net");
    assert.equal(response.headers.getSetCookie().length, 2);
    assert.throws(
      () => localIdentityRequest("http://external.invalid/"),
      /lokales/,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Sicherheitsstatus gibt nur geprüfte Zähler zurück und verwechselt Recovery nicht mit primärer MFA", async () => {
  const { parseIdentityStatus, identitySecurityChecks } = await import(
    "./identity/security-status.js"
  );
  const fixture = {
    admins: { total: 1, withMfa: 1, withRecovery: 0 },
    viewers: { total: 2, withMfa: 0, withRecovery: 2 },
    mfaRequired: true,
    logoutConfigured: false,
    secret: "must-not-leak",
  };
  const output =
    "startup log\nSTACKPILOT_IDENTITY_STATUS=" + JSON.stringify(fixture);
  const parsed = parseIdentityStatus(output);
  assert.equal(JSON.stringify(parsed).includes("must-not-leak"), false);
  const checks = identitySecurityChecks(parsed);
  assert.equal(checks.find((c) => c.name === "Administratoren").state, "ok");
  assert.equal(
    checks.find((c) => c.name === "Administrator-Wiederherstellung").state,
    "todo",
  );
  assert.equal(checks.find((c) => c.name === "Zuschauer").state, "todo");
  assert.equal(
    checks.find((c) => c.name === "Authentik-Abmeldung").state,
    "blocked",
  );
  assert.throws(() => parseIdentityStatus(output + "\n" + output), /eindeutig/);
  assert.throws(
    () =>
      parseIdentityStatus(
        "STACKPILOT_IDENTITY_STATUS=" +
          JSON.stringify({
            ...fixture,
            admins: { total: 1, withMfa: 2, withRecovery: 0 },
          }),
      ),
    /ungültig/,
  );
  const empty = { total: 0, withMfa: 0, withRecovery: 0 };
  assert.equal(
    identitySecurityChecks({ ...parsed, admins: empty })[1].state,
    "todo",
  );
});

test("Tatsächliche Portfreigaben dürfen keine zusätzliche öffentliche Adresse enthalten", async () => {
  const dir = await mkdtemp("/tmp/sp-id-port-test-");
  try {
    const expected = {
      image: "fixture-image",
      user: "1000:1000",
      volumes: [],
      ports: ["127.0.0.1:19080:8080"],
      networks: ["identity", "ingress"],
    };
    await writeFile(
      dir + "/compose.json",
      JSON.stringify({ services: { gateway: expected } }),
    );
    const rows = [
      {
        Config: {
          Image: expected.image,
          User: expected.user,
          Labels: {
            "com.docker.compose.service": "gateway",
            "io.stackpilot.identity": "fixture",
          },
        },
        HostConfig: {
          ReadonlyRootfs: true,
          CapDrop: ["ALL"],
          SecurityOpt: ["no-new-privileges:true"],
          PortBindings: {
            "8080/tcp": [{ HostIp: "127.0.0.1", HostPort: "19080" }],
          },
        },
        Mounts: [],
        NetworkSettings: {
          Ports: { "8080/tcp": [{ HostIp: "127.0.0.1", HostPort: "19080" }] },
          Networks: { fixture_identity: {}, fixture_ingress: {} },
        },
      },
    ];
    const setup = new IdentityPreparation({}, {}, async (args) =>
      args[0] === "ps" ? "abcdef123456" : JSON.stringify(rows),
    );
    const record = { id: "fixture", project: "fixture", directory: dir };
    assert.equal((await setup.containers(record)).length, 1);
    rows[0].NetworkSettings.Ports["8080/tcp"].push({
      HostIp: "0.0.0.0",
      HostPort: "19080",
    });
    await assert.rejects(() => setup.containers(record), /effektiv/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
