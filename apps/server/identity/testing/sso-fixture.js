import { JellyfinProtection } from "../jellyfin-protection.js";
import { SsoConnection } from "../sso-connection.js";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { StateStore } from "../../state.js";
import { Vault } from "../../vault.js";
import { IdentityPreparation } from "../../identity/preparation.js";
import { prepareFiles } from "../../provision-files.js";
import { Services } from "../../service-api.js";
import { LibrarySync } from "../../library-sync.js";
import { localDocker } from "../../retirement.js";
import { dockerInput } from "../../docker-io.js";
import { releases } from "../../identity/config.js";
export async function createSsoFixture() {
  const run = promisify(execFile);
  const root = await mkdtemp("/tmp/sp-sso-e2e-");
  const store = new StateStore(root + "/state"),
    vault = new Vault(store),
    plan = { id: "fixture", rootId: "fixture" };
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
      hostname: "identity.example.ts.net",
      target: "http://127.0.0.1:8096",
      jellyfin: { version: "12.4.0" },
      serveKnown: true,
      serve: { exclusive: true, public: false },
    }),
  };
  const setup = new IdentityPreparation(hub, remote);
  let identity, jf, protection;
  try {
    console.log("Prepare isolated Authentik");
    await setup.prepare();
    await setup.start({ id: setup.current().id, confirmation: "OK" });
    await setup.pending;
    identity = setup.current();
    if (identity.status !== "local-ready")
      throw Error("Identity fixture failed");
    const rows = await setup.containers(identity, true);
    const worker = rows.find(
      (r) => r.Config.Labels["com.docker.compose.service"] === "worker",
    );
    await dockerInput(
      [
        "exec",
        "-i",
        worker.Id,
        "ak",
        "shell",
        "-c",
        "exec(__import__('sys').stdin.read())",
      ],
      await readFile(new URL("./fixture.py", import.meta.url), "utf8"),
      { timeout: 60000 },
    );
    console.log("Authentik ready");
    for (const name of ["tls", "trust", "ca"])
      await mkdir(root + "/" + name, { mode: 0o700 });
    await run("openssl", [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=StackPilot fixture CA",
      "-addext",
      "basicConstraints=critical,CA:TRUE",
      "-keyout",
      root + "/ca/root.key",
      "-out",
      root + "/ca/root.crt",
    ]);
    await run("openssl", [
      "req",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-subj",
      "/CN=identity.example.ts.net",
      "-keyout",
      root + "/tls/server.key",
      "-out",
      root + "/ca/server.csr",
    ]);
    await writeFile(
      root + "/ca/leaf.ext",
      "subjectAltName=DNS:identity.example.ts.net\nextendedKeyUsage=serverAuth\nkeyUsage=digitalSignature,keyEncipherment\nbasicConstraints=CA:FALSE\n",
    );
    await run("openssl", [
      "x509",
      "-req",
      "-in",
      root + "/ca/server.csr",
      "-CA",
      root + "/ca/root.crt",
      "-CAkey",
      root + "/ca/root.key",
      "-CAcreateserial",
      "-days",
      "1",
      "-extfile",
      root + "/ca/leaf.ext",
      "-out",
      root + "/tls/server.crt",
    ]);
    await writeFile(
      root + "/trust/bundle.pem",
      Buffer.concat([
        await readFile("/etc/ssl/certs/ca-certificates.crt"),
        await readFile(root + "/ca/root.crt"),
      ]),
      { mode: 0o600 },
    );
    jf = {
      id: randomUUID(),
      rootId: "fixture",
      project: "sp-sso-e2e-" + randomUUID().slice(0, 8),
      uid: process.getuid(),
      gid: process.getgid(),
      spec: {
        selected: ["Jellyfin"],
        path: root + "/data",
        username: "fixture-admin",
        language: "Deutsch",
      },
      appdata: root + "/config",
      ports: { Jellyfin: 28096 },
    };
    await prepareFiles(jf, vault, root + "/manifest");
    await writeFile(
      root + "/tls/nginx.conf",
      `pid /tmp/nginx.pid;error_log stderr warn;events {} http {access_log off;client_body_temp_path /tmp/client;proxy_temp_path /tmp/proxy;fastcgi_temp_path /tmp/fastcgi;uwsgi_temp_path /tmp/uwsgi;scgi_temp_path /tmp/scgi;server {listen 8443 ssl;ssl_certificate /tls/server.crt;ssl_certificate_key /tls/server.key;server_name identity.example.ts.net;location / {proxy_set_header Host identity.example.ts.net:8443;proxy_set_header X-Forwarded-Proto https;proxy_pass http://gateway:8080;}}}`,
      { mode: 0o600 },
    );
    const compose = JSON.parse(
      await readFile(root + "/manifest/bootstrap.json", "utf8"),
    );
    const j = compose.services.jellyfin;
    j.ports = ["127.0.0.1:28096:8096"];
    j.volumes.push(root + "/trust:/trust:ro");
    j.environment = {
      ...j.environment,
      SSL_CERT_FILE: "/trust/bundle.pem",
      NO_PROXY: "jellyfin,localhost,127.0.0.1,identity.example.ts.net",
      no_proxy: "jellyfin,localhost,127.0.0.1,identity.example.ts.net",
      HTTP_PROXY: "",
      HTTPS_PROXY: "",
      http_proxy: "",
      https_proxy: "",
      ALL_PROXY: "",
      all_proxy: "",
    };
    compose.networks.idp = {
      external: true,
      name: identity.project + "_ingress",
    };
    compose.services["tls-fixture"] = {
      image: releases.gateway.image,
      user: `${process.getuid()}:${process.getgid()}`,
      read_only: true,
      cap_drop: ["ALL"],
      security_opt: ["no-new-privileges:true"],
      entrypoint: ["nginx", "-g", "daemon off;"],
      tmpfs: ["/tmp:rw,nosuid,size=32m"],
      volumes: [
        root + "/tls/nginx.conf:/etc/nginx/nginx.conf:ro",
        root + "/tls:/tls:ro",
      ],
      networks: { default: { aliases: ["identity.example.ts.net"] }, idp: {} },
    };
    await writeFile(root + "/fixture-compose.json", JSON.stringify(compose), {
      mode: 0o600,
    });
    await writeFile(root + "/fixture.json", JSON.stringify({ jf, identity }), {
      mode: 0o600,
    });
    await localDocker(
      [
        "compose",
        "-f",
        root + "/fixture-compose.json",
        "up",
        "-d",
        "--pull",
        "never",
      ],
      { timeout: 120000 },
    );
    const relay = (
      await localDocker([
        "ps",
        "-q",
        "--no-trunc",
        "--filter",
        "label=com.docker.compose.project=" + jf.project,
        "--filter",
        "label=com.docker.compose.service=api-relay",
      ])
    ).trim();
    const s = new Services(jf, vault, relay);
    await s.wait("Jellyfin");
    await s.configure("Jellyfin");
    const library = new LibrarySync({});
    const requestAsAdmin = (route, options) =>
      library.request(s, jf, route, options);
    const mediaHub = {
      engine: {
        vault,
        store,
        current: () => ({ plan: jf, job: { status: "completed" } }),
      },
      context: async () => ({ s, plan: { ...jf, rootId: "fixture" } }),
      library,
      mutate: async (names, fn) => fn(),
    };
    protection = new JellyfinProtection(mediaHub, setup, localDocker, () =>
      readFile(
        process.env.STACKPILOT_SSO_ARCHIVE || "/tmp/stackpilot-sso-4.0.0.4.zip",
      ),
    );
    const protectionPlan = await protection.preview();
    await protection.start({
      review: protectionPlan.review,
      confirmation: "OK",
    });
    await protection.pending;
    if (!(await protection.status()).verified)
      throw Error("Fixture protection failed: " + protection.current()?.error);
    const connection = new SsoConnection(mediaHub, setup);
    const connectionPlan = await connection.plan();
    if (!connectionPlan.canApply)
      throw Error("Private connection plan blocked");
    const selectedLibraryIds = connectionPlan.libraries
      .filter((l) => l.name === "Filme")
      .map((l) => l.id);
    if (!selectedLibraryIds.length) throw Error("Fixture library missing");
    await connection.apply({
      confirmation: "OK",
      review: connectionPlan.review,
      libraryIds: selectedLibraryIds,
    });
    return {
      root,
      store,
      vault,
      jf,
      identity,
      connection,
      protection,
      selectedLibraryIds,
      requestAsAdmin,
      close: async () => {
        await localDocker(
          [
            "compose",
            "-f",
            protection.current().directory + "/compose.json",
            "down",
          ],
          { timeout: 120000 },
        );
        await localDocker(
          ["compose", "-f", root + "/fixture-compose.json", "down"],
          { timeout: 120000 },
        );
        await localDocker(
          ["compose", "-f", identity.directory + "/compose.json", "down"],
          { timeout: 120000 },
        );
        store.close();
        await rm(root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    console.log("Setup failed:", error.message);
    if (protection?.current()?.directory)
      await localDocker(
        [
          "compose",
          "-f",
          protection.current().directory + "/compose.json",
          "down",
        ],
        { timeout: 120000 },
      ).catch(() => {});
    if (jf)
      await localDocker(
        ["compose", "-f", root + "/fixture-compose.json", "down"],
        { timeout: 120000 },
      ).catch(() => {});
    if (identity)
      await localDocker(
        ["compose", "-f", identity.directory + "/compose.json", "down"],
        { timeout: 120000 },
      ).catch(() => {});
    store.close();
    throw error;
  }
}
