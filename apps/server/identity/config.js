import { readFileSync } from "node:fs";
export const releases = JSON.parse(
  readFileSync(
    new URL("../../../packages/security/releases.json", import.meta.url),
    "utf8",
  ),
);
export function validateIdentityInput({
  hostname,
  uid,
  gid,
  adminPort = 19000,
  gatewayPort = 19080,
}) {
  if (
    typeof hostname !== "string" ||
    hostname.length > 253 ||
    !/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+ts\.net$/.test(hostname)
  )
    throw Error("Nur die geprüfte Tailscale-Geräteadresse ist zulässig.");
  if (!Number.isInteger(uid) || uid < 1 || !Number.isInteger(gid) || gid < 1)
    throw Error(
      "Identitätsdienste benötigen einen normalen lokalen Nutzer ohne Root-Rechte.",
    );
  if (
    ![adminPort, gatewayPort].every(
      (p) => Number.isInteger(p) && p >= 1024 && p <= 65535,
    ) ||
    adminPort === gatewayPort
  )
    throw Error("Ungültige lokale Identitätsports.");
  return { hostname, uid, gid, adminPort, gatewayPort };
}
export function identityCompose(input) {
  const { uid, gid, adminPort, gatewayPort } = validateIdentityInput(input);
  const noProxy = {
    HTTP_PROXY: "",
    HTTPS_PROXY: "",
    ALL_PROXY: "",
    http_proxy: "",
    https_proxy: "",
    all_proxy: "",
  };
  const hardening = {
    user: `${uid}:${gid}`,
    restart: "unless-stopped",
    read_only: true,
    cap_drop: ["ALL"],
    security_opt: ["no-new-privileges:true"],
    pids_limit: 256,
    logging: {
      driver: "json-file",
      options: { "max-size": "10m", "max-file": "3" },
    },
  };
  const environment = {
    AUTHENTIK_POSTGRESQL__HOST: "database",
    AUTHENTIK_POSTGRESQL__NAME: "authentik",
    AUTHENTIK_POSTGRESQL__USER: "authentik",
    AUTHENTIK_POSTGRESQL__PASSWORD: "file:///run/secrets/database_password",
    AUTHENTIK_SECRET_KEY: "file:///run/secrets/secret_key",
    AUTHENTIK_ERROR_REPORTING__ENABLED: "false",
    AUTHENTIK_DISABLE_UPDATE_CHECK: "true",
    AUTHENTIK_DISABLE_STARTUP_ANALYTICS: "true",
    AUTHENTIK_COOKIE_DOMAIN: "",
    AUTHENTIK_LISTEN__TRUSTED_PROXY_CIDRS: "172.30.248.10/32",
    AUTHENTIK_LOG_LEVEL: "warning",
    HTTP_PROXY: "",
    HTTPS_PROXY: "",
    ALL_PROXY: "",
    http_proxy: "",
    https_proxy: "",
    all_proxy: "",
  };
  const app = {
    ...hardening,
    image: releases.authentik.image,
    entrypoint: ["dumb-init", "--", "python", "/stackpilot/start.py"],
    environment,
    depends_on: { database: { condition: "service_healthy" } },
    networks: ["identity"],
    volumes: [
      "./config/start.py:/stackpilot/start.py:ro",
      "./config/audit.py:/stackpilot/audit.py:ro",
      "./blueprints:/blueprints/.stackpilot:ro",
      "./secrets:/run/secrets:ro",
      "./data:/data",
      "./media:/media",
    ],
    tmpfs: ["/tmp:rw,noexec,nosuid,size=64m"],
    shm_size: "512mb",
    mem_limit: "2g",
  };
  return {
    services: {
      database: {
        ...hardening,
        image: releases.postgres.image,
        environment: {
          ...noProxy,
          POSTGRES_DB: "authentik",
          POSTGRES_USER: "postgres",
          POSTGRES_PASSWORD_FILE: "/run/secrets/database_admin_password",
          PGDATA: "/var/lib/postgresql/data/pgdata",
          HTTP_PROXY: "",
          HTTPS_PROXY: "",
        },
        networks: ["identity"],
        volumes: [
          "./database:/var/lib/postgresql/data",
          "./secrets/database_admin_password:/run/secrets/database_admin_password:ro",
          "./secrets/initialize.sql:/docker-entrypoint-initdb.d/001-stackpilot.sql:ro",
        ],
        tmpfs: [
          `/var/run/postgresql:rw,nosuid,uid=${uid},gid=${gid},mode=0700,size=16m`,
          "/tmp:rw,noexec,nosuid,size=32m",
        ],
        mem_limit: "768m",
        healthcheck: {
          test: ["CMD-SHELL", "pg_isready -U postgres -d authentik"],
          interval: "5s",
          timeout: "5s",
          retries: 20,
          start_period: "20s",
        },
      },
      server: {
        ...app,
        command: ["server"],
      },
      worker: { ...app, command: ["worker"] },
      gateway: {
        ...hardening,
        image: releases.gateway.image,
        environment: noProxy,
        entrypoint: ["nginx", "-g", "daemon off;"],
        depends_on: ["server"],
        networks: { identity: { ipv4_address: "172.30.248.10" }, ingress: {} },
        ports: [`127.0.0.1:${gatewayPort}:8080`, `127.0.0.1:${adminPort}:8090`],
        volumes: ["./config/public-login.conf:/etc/nginx/nginx.conf:ro"],
        tmpfs: ["/tmp:rw,noexec,nosuid,size=32m"],
        mem_limit: "128m",
      },
    },
    networks: {
      ingress: {},
      identity: {
        internal: true,
        ipam: { config: [{ subnet: "172.30.248.0/28" }] },
      },
    },
  };
}
export const identityStartScript = `import os, sys
from pathlib import Path
for key, name in [("AUTHENTIK_BOOTSTRAP_PASSWORD", "admin_password"), ("STACKPILOT_OIDC_SECRET", "oidc_secret")]:
    value = Path("/run/secrets/" + name).read_text().strip()
    if len(value) < 32:
        raise SystemExit("Missing or invalid private bootstrap secret")
    os.environ[key] = value
os.environ["AUTHENTIK_BOOTSTRAP_EMAIL"] = "admin@localhost.invalid"
commands = {
    "server": ["ak", "server"], "worker": ["ak", "worker"],
    "prerequisites": ["ak", "shell", "-c", "from authentik.crypto.models import CertificateKeyPair; from authentik.core.models import User; from authentik.stages.authenticator_totp.models import AuthenticatorTOTPStage; from authentik.providers.oauth2.models import ScopeMapping; assert CertificateKeyPair.objects.filter(name='authentik Self-signed Certificate').exists(); assert User.objects.filter(username='akadmin').exists(); assert AuthenticatorTOTPStage.objects.filter(name='default-authenticator-totp-setup').exists(); assert ScopeMapping.objects.filter(managed='goauthentik.io/providers/oauth2/scope-openid').exists()"],
    "blueprint-check": ["ak", "apply_blueprint", "--dry-run", "/blueprints/.stackpilot/stackpilot.yaml"],
    "blueprint-apply": ["ak", "apply_blueprint", "/blueprints/.stackpilot/stackpilot.yaml"],
}
if len(sys.argv) != 2 or sys.argv[1] not in commands:
    raise SystemExit("Invalid identity service role")
os.execv("/lifecycle/ak", commands[sys.argv[1]])
`;
export function publicLoginGateway(input) {
  const { hostname } = validateIdentityInput(input);
  return `pid /tmp/nginx.pid;
error_log stderr warn;
worker_processes auto;
events { worker_connections 512; }
http {
  access_log off;
  server_tokens off;
  client_max_body_size 128k;
  client_body_timeout 10s;
  client_header_timeout 10s;
  keepalive_timeout 15s;
  client_body_temp_path /tmp/client;
  proxy_temp_path /tmp/proxy;
  fastcgi_temp_path /tmp/fastcgi;
  uwsgi_temp_path /tmp/uwsgi;
  scgi_temp_path /tmp/scgi;
  limit_req_status 429;
  map $request_method $login_limit_key { default ""; POST $binary_remote_addr; }
  limit_req_zone $login_limit_key zone=login:10m rate=10r/m;
  upstream identity { server server:9000; }
  map $host $private_host_allowed { default 0; localhost 1; 127.0.0.1 1; ${hostname} 1; }
  server {
    listen 8090;
    server_name localhost 127.0.0.1 ${hostname};
    if ($private_host_allowed = 0) { return 421; }
    location / {
      proxy_set_header Host $http_host;
      proxy_set_header X-Forwarded-Host $http_host;
      proxy_set_header X-Forwarded-Proto $scheme;
      proxy_set_header X-Forwarded-For $remote_addr;
      proxy_pass http://identity;
    }
  }
  server {
    listen 8080;
    server_name ${hostname};
    if ($host != "${hostname}") { return 421; }
    merge_slashes on;
    if ($request_method !~ ^(GET|HEAD|POST|OPTIONS)$) { return 405; }
    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy no-referrer always;
    location = /healthz { return 200 'ok'; }
    location ~ ^/if/flow/stackpilot-(authentication|authorization|invalidation)/?$ { include /etc/nginx/proxy_params_unused; }
    location ~ ^/api/v3/flows/executor/stackpilot-(authentication|authorization|invalidation)/$ { include /etc/nginx/proxy_params_unused; }
    location = /api/v3/core/brands/current/ { include /etc/nginx/proxy_params_unused; }
    location = /api/v3/root/config/ { include /etc/nginx/proxy_params_unused; }
    location = /application/o/authorize/ { include /etc/nginx/proxy_params_unused; }
    location = /application/o/token/ { include /etc/nginx/proxy_params_unused; }
    location = /application/o/userinfo/ { include /etc/nginx/proxy_params_unused; }
    location = /application/o/stackpilot-jellyfin/.well-known/openid-configuration { include /etc/nginx/proxy_params_unused; }
    location = /application/o/stackpilot-jellyfin/jwks/ { include /etc/nginx/proxy_params_unused; }
    location = /application/o/stackpilot-jellyfin/end-session/ { include /etc/nginx/proxy_params_unused; }
    location ~ ^/static/[-a-zA-Z0-9_./]+\.(js|css|svg|png|jpe?g|webp|ico|woff2?|json)$ { include /etc/nginx/proxy_params_unused; }
    location / { return 404; }
  }
}
`.replaceAll(
    "include /etc/nginx/proxy_params_unused;",
    proxySettings(hostname),
  );
}
function proxySettings(hostname) {
  return `limit_req zone=login burst=15 nodelay;
      proxy_set_header Host "${hostname}:8443";
      proxy_set_header X-Forwarded-Host "${hostname}:8443";
      proxy_set_header X-Forwarded-Proto https;
      proxy_set_header X-Forwarded-For $remote_addr;
      proxy_set_header X-Forwarded-Port 8443;
      proxy_pass http://identity;`;
}
