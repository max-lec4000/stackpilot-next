import path from "node:path";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  rm,
  lstat,
  realpath,
} from "node:fs/promises";
import {
  randomUUID,
  createHash,
  X509Certificate,
  createPrivateKey,
} from "node:crypto";
import { releases, validateIdentityInput } from "./config.js";
import { localDocker } from "../retirement.js";
import { setupError } from "./setup-error.js";
import { issueCertificate } from "./certificate-issuer.js";
import {
  safeRepairFailure,
  repairStages,
  certificatePermissionPlan,
} from "./backchannel-diagnostics.js";
const hash = (v) => createHash("sha256").update(v).digest("hex");
export function certificateInfo(cert, key, hostname, allowExpired = false) {
  const x = new X509Certificate(cert);
  if (
    x.checkHost(hostname) !== hostname ||
    !x.checkPrivateKey(createPrivateKey(key)) ||
    Date.parse(x.validFrom) > Date.now() ||
    (!allowExpired && Date.parse(x.validTo) < Date.now() + 86400000)
  )
    throw setupError(
      "HTTPS-Zertifikat, Hostname, Schlüsselpaar oder Gültigkeit nicht bestätigt.",
    );
  return {
    expiresAt: new Date(x.validTo).toISOString(),
    certificateHash: hash(cert),
    keyHash: hash(key),
  };
}
export function backchannelConfig(hostname, upstream) {
  validateIdentityInput({ hostname, uid: 1000, gid: 1000 });
  if (!/^[a-z0-9_.-]+$/.test(upstream))
    throw setupError("Authentik-Gatewayname ungültig.");
  return `pid /tmp/nginx.pid;error_log /dev/null crit;worker_processes auto;
events {worker_connections 128;}
http {access_log off;server_tokens off;client_max_body_size 128k;
client_body_timeout 10s;client_header_timeout 10s;keepalive_timeout 15s;
client_body_temp_path /tmp/client;proxy_temp_path /tmp/proxy;fastcgi_temp_path /tmp/fastcgi;uwsgi_temp_path /tmp/uwsgi;scgi_temp_path /tmp/scgi;
server {listen 8443 ssl;server_name ${hostname};ssl_certificate /tls/cert.pem;ssl_certificate_key /tls/key.pem;
ssl_protocols TLSv1.2 TLSv1.3;ssl_session_tickets off;
if ($host != "${hostname}") {return 421;}
if ($request_method !~ ^(GET|POST|HEAD)$) {return 405;}
location ~ ^/application/o/(token/|userinfo/|stackpilot-jellyfin/(\\.well-known/openid-configuration|jwks/))$ {
proxy_connect_timeout 5s;proxy_read_timeout 15s;proxy_send_timeout 15s;
proxy_set_header Host "${hostname}:8443";proxy_set_header X-Forwarded-Host "${hostname}:8443";
proxy_set_header X-Forwarded-Proto https;proxy_set_header X-Forwarded-Port 8443;proxy_set_header X-Forwarded-For $remote_addr;
proxy_pass http://${upstream}:8080;
}
location / {return 404;}
}}
`;
}
export function backchannelCompose(r) {
  return {
    name: r.project,
    services: {
      backchannel: {
        image: releases.gateway.image,
        user: `${r.uid}:${r.gid}`,
        restart: "unless-stopped",
        read_only: true,
        cap_drop: ["ALL"],
        security_opt: ["no-new-privileges:true"],
        pids_limit: 64,
        mem_limit: "64m",
        entrypoint: ["nginx", "-g", "daemon off;"],
        labels: {
          "io.stackpilot.backchannel": r.id,
          "io.stackpilot.plan": r.rootId,
        },
        environment: Object.fromEntries(
          [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "http_proxy",
            "https_proxy",
            "all_proxy",
          ].map((k) => [k, ""]),
        ),
        tmpfs: ["/tmp:rw,noexec,nosuid,size=16m"],
        volumes: [
          `${r.directory}/nginx.conf:/etc/nginx/nginx.conf:ro`,
          `${r.directory}/tls:/tls:ro`,
        ],
        networks: { media: { aliases: [r.hostname] }, ingress: {} },
        logging: {
          driver: "json-file",
          options: { "max-size": "2m", "max-file": "2" },
        },
      },
    },
    networks: {
      media: { external: true, name: r.media },
      ingress: { external: true, name: r.ingress },
    },
  };
}
export class OidcBackchannel {
  constructor(
    hub,
    identity,
    protection,
    { docker = localDocker, certificates = issueCertificate } = {},
  ) {
    Object.assign(this, { hub, identity, protection, docker, certificates });
  }
  current() {
    const c = this.hub.engine.current();
    return c
      ? this.hub.engine.vault.get(
          "oidc-backchannel:" + (c.plan.rootId || c.plan.id),
        )
      : null;
  }
  save(r) {
    this.hub.engine.vault.set("oidc-backchannel:" + r.rootId, r);
  }
  async context() {
    const c = await this.protection.context(),
      id = await this.identity.verify();
    const { hostname } = validateIdentityInput(id.input);
    if (
      c.identity.id !== id.id ||
      c.identity.rootId !== (c.plan.rootId || c.plan.id)
    )
      throw setupError("Identitätsdienst und Stack gehören nicht zusammen.");
    const rows = await this.identity.containers(id, true),
      gateways = rows.filter(
        (v) =>
          v.Config.Labels["com.docker.compose.service"] === "gateway" &&
          v.State.Running,
      );
    if (gateways.length !== 1)
      throw setupError("Authentik-Login-Gateway nicht eindeutig bereit.");
    const upstream = gateways[0].Name.replace(/^\//, "");
    if (
      (c.container.HostConfig.ExtraHosts || []).some((v) =>
        v.startsWith(hostname + ":"),
      )
    )
      throw setupError(
        "Manueller Hosteintrag im Jellyfin-Container verhindert eine sichere interne DNS-Zuordnung.",
      );
    return { c, id, hostname, upstream };
  }
  async files(r) {
    if ((await realpath(r.directory)) !== r.directory)
      throw setupError(
        "Backchannel-Verzeichnis darf keine symbolischen Links enthalten.",
      );
    const st = await lstat(r.directory);
    if (!st.isDirectory() || st.uid !== r.uid || st.mode & 0o022)
      throw setupError("Backchannel-Verzeichnisrechte wurden verändert.");
    for (const [filename, expected] of Object.entries(r.hashes || {})) {
      const f = path.join(r.directory, filename),
        st = await lstat(f);
      if (
        !st.isFile() ||
        st.isSymbolicLink() ||
        st.uid !== r.uid ||
        st.mode & 0o077 ||
        (await realpath(path.dirname(f))) !== path.dirname(f) ||
        hash(await readFile(f)) !== expected
      )
        throw setupError(
          "Manuell geänderte Backchannel-Dateien werden nicht überschrieben.",
        );
    }
  }
  async aliases(media, hostname, ownId) {
    const [net] = JSON.parse(await this.docker(["network", "inspect", media]));
    const ids = Object.keys(net.Containers || {});
    if (ids.length > 100)
      throw setupError(
        "Zu viele Netzteilnehmer für automatische OIDC-Reparatur.",
      );
    if (!ids.length) return;
    const rows = JSON.parse(await this.docker(["inspect", ...ids]));
    for (const v of rows)
      if (
        v.NetworkSettings.Networks[media]?.Aliases?.includes(hostname) &&
        v.Config.Labels["io.stackpilot.backchannel"] !== ownId
      )
        throw setupError(
          "Die interne Anbieteradresse ist bereits manuell vergeben; keine DNS-Übernahme.",
        );
  }
  async recoverFiles(r) {
    for (const [name, pending] of Object.entries(r.pendingFiles || {})) {
      if (!["nginx.conf", "compose.json"].includes(name))
        throw setupError("Unbekannter Dateischritt.");
      let actual = null;
      try {
        const f = path.join(r.directory, name),
          st = await lstat(f);
        if (!st.isFile() || st.isSymbolicLink())
          throw setupError("Datei wurde ersetzt.");
        actual = hash(await readFile(f));
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      if (actual === pending.next) r.hashes[name] = actual;
      else if (actual !== pending.previous)
        throw setupError("Unterbrochene Konfigurationsdatei wurde verändert.");
      r.activationPending = true;
      delete r.pendingFiles[name];
      this.save(r);
    }
  }
  async finishRotation(r) {
    const t = r.rotation;
    if (!t) return;
    if (
      path.dirname(t.source) !== r.directory ||
      !/^issue-[a-f0-9-]{36}$/.test(path.basename(t.source)) ||
      (await realpath(t.source)) !== t.source
    )
      throw setupError("Zertifikatswechsel nicht eindeutig zugeordnet.");
    const cert = await readFile(t.source + "/cert.pem"),
      key = await readFile(t.source + "/key.pem");
    const info = certificateInfo(cert, key, r.hostname);
    if (
      info.certificateHash !== t.certificateHash ||
      info.keyHash !== t.keyHash
    )
      throw setupError("Unterbrochener Zertifikatswechsel wurde verändert.");
    for (const [name, expected] of [
      ["cert.pem", t.certificateHash],
      ["key.pem", t.keyHash],
    ]) {
      const f = r.directory + "/tls/" + name;
      let actual = null;
      try {
        const st = await lstat(f);
        if (!st.isFile() || st.isSymbolicLink())
          throw setupError("Zertifikatsdatei wurde ersetzt.");
        actual = hash(await readFile(f));
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      if (
        actual !== null &&
        actual !== expected &&
        actual !== t.previous["tls/" + name]
      )
        throw setupError("Zertifikatsdatei wurde manuell geändert.");
    }
    await writeFile(r.directory + "/tls/cert.pem.next", cert, { mode: 0o600 });
    await writeFile(r.directory + "/tls/key.pem.next", key, { mode: 0o600 });
    await rename(
      r.directory + "/tls/cert.pem.next",
      r.directory + "/tls/cert.pem",
    );
    await rename(
      r.directory + "/tls/key.pem.next",
      r.directory + "/tls/key.pem",
    );
    r.expiresAt = info.expiresAt;
    r.hashes["tls/cert.pem"] = info.certificateHash;
    r.hashes["tls/key.pem"] = info.keyHash;
    r.rotation = null;
    r.reloadPending = true;
    this.save(r);
    await rm(t.source, { recursive: true, force: true });
  }
  // Called under the existing HTTPS setup lease; public routes and Jellyfin configuration stay untouched.
  progress(r, stage) {
    r.stage = stage;
    this.save(r);
  }
  async ensure(options = { explicit: true }) {
    const previous = this.current();
    if (previous) this.progress(previous, "context");
    try {
      const result = await this.perform(options);
      const r = this.current();
      if (r) {
        r.lastFailure = null;
        r.stage = "ready";
        this.save(r);
      }
      return { ...result, stage: "ready", lastFailure: null };
    } catch (e) {
      const r = this.current(),
        stage = repairStages.includes(r?.stage) ? r.stage : "context";
      const failure = safeRepairFailure({
        code: e.certificateFailureCode || e.repairFailureCode || stage,
        stage,
        at: new Date().toISOString(),
      });
      if (r) {
        r.lastFailure = failure;
        this.save(r);
      }
      throw Object.assign(setupError(failure.message), {
        repairFailure: failure,
      });
    }
  }
  async diagnostics() {
    const r = this.current();
    if (!r)
      return {
        configured: false,
        installed: false,
        verified: false,
        status: "not-configured",
        stage: "idle",
        lastFailure: null,
      };
    let result;
    try {
      result = await this.inspect();
    } catch {
      result = { installed: r.status === "installed", verified: false };
    }
    const failure = safeRepairFailure(r.lastFailure);
    return {
      ...result,
      configured: true,
      status: r.status === "installed" ? "installed" : "pending",
      stage: repairStages.includes(r.stage) ? r.stage : "context",
      lastFailure: failure,
      legacyCertificateClient: !!r.legacyCertificateClient,
      localPermission:
        failure?.code === "permission"
          ? certificatePermissionPlan(r.uid)
          : null,
      publicReady: false,
    };
  }
  async perform({ explicit = true } = {}) {
    const { c, id, hostname, upstream } = await this.context();
    let r = this.current();
    if (r) {
      if (
        r.hostname !== hostname ||
        r.media !== c.network ||
        r.ingress !== id.project + "_ingress" ||
        r.identityId !== id.id ||
        r.uid !== c.plan.uid ||
        r.gid !== c.plan.gid
      )
        throw setupError(
          "Gespeicherter OIDC-Weg gehört zu einer anderen Ausgangslage.",
        );
      this.progress(r, "files");
      if (r.rotation) await this.finishRotation(r);
      await this.recoverFiles(r);
      await this.files(r);
    } else {
      const uuid = randomUUID();
      r = {
        id: uuid,
        rootId: c.plan.rootId || c.plan.id,
        identityId: id.id,
        hostname,
        uid: c.plan.uid,
        gid: c.plan.gid,
        project: "sp-oidc-" + uuid.slice(0, 8),
        directory: path.join(
          this.hub.engine.store.directory,
          "identity-secrets",
          "oidc-" + uuid,
        ),
        media: c.network,
        ingress: id.project + "_ingress",
        hashes: {},
        status: "preparing",
      };
      await mkdir(r.directory, { mode: 0o700 });
      await mkdir(path.join(r.directory, "tls"), { mode: 0o700 });
      this.save(r);
    }
    this.progress(r, "alias");
    await this.aliases(r.media, hostname, r.id);
    const hadContainer = r.status === "installed";
    let missing = false,
      stopped = false;
    if (hadContainer) {
      this.progress(r, "verification");
      const state = await this.inspect({
        allowStopped: true,
        allowMissing: true,
      });
      missing = !!state.missing;
      stopped = state.running === false;
      if ((missing || stopped) && !explicit)
        throw Object.assign(setupError("Dienst wurde gestoppt."), {
          repairFailureCode: "service-stopped",
        });
    }
    const needsCertificate =
      !r.expiresAt || Date.parse(r.expiresAt) < Date.now() + 14 * 86400000;
    if (needsCertificate) {
      this.progress(r, "certificate");
      const temp = path.join(r.directory, "issue-" + randomUUID());
      await mkdir(temp, { mode: 0o700 });
      try {
        const issued = await this.certificates(hostname, temp);
        r.legacyCertificateClient = !!issued?.legacyClient;
        this.progress(r, "certificate-validation");
        const cert = await readFile(temp + "/cert.pem"),
          key = await readFile(temp + "/key.pem"),
          info = certificateInfo(cert, key, hostname);
        if (Date.parse(info.expiresAt) < Date.now() + 14 * 86400000)
          throw setupError(
            "Zertifikatsrestgültigkeit unter 14 Tagen; Tailscale aktualisieren oder Zertifikat erneuern.",
          );
        // Journal expected new hashes before the two atomic renames; recover our own partial rotation.
        r.rotation = { ...info, source: temp, previous: { ...r.hashes } };
        this.save(r);
        await this.finishRotation(r);
      } finally {
        if (!r.rotation) await rm(temp, { recursive: true, force: true });
      }
    }
    const files = {
      "nginx.conf": backchannelConfig(hostname, upstream),
      "compose.json": JSON.stringify(backchannelCompose(r), null, 2),
    };
    const changed = Object.entries(files).some(
      ([name, content]) => r.hashes[name] !== hash(content),
    );
    if (
      hadContainer &&
      !needsCertificate &&
      !changed &&
      !r.reloadPending &&
      !r.activationPending &&
      !missing &&
      !stopped
    )
      return this.inspect();
    this.progress(r, "configuration");
    for (const [name, content] of Object.entries(files)) {
      if (r.hashes[name] === hash(content)) continue;
      // Existing content was checked above. The only upstream comes from the verified managed gateway.
      const destination = path.join(r.directory, name);
      if (!r.hashes[name]) {
        try {
          if (hash(await readFile(destination)) !== hash(content))
            throw setupError(
              "Vorhandene Konfigurationsdatei wird nicht übernommen.",
            );
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
        }
      }
      r.activationPending = true;
      r.pendingFiles ||= {};
      r.pendingFiles[name] = {
        previous: r.hashes[name] || null,
        next: hash(content),
      };
      this.save(r);
      const staging = destination + ".next-" + randomUUID();
      await writeFile(staging, content, { mode: 0o600, flag: "wx" });
      await rename(staging, destination);
      r.hashes[name] = hash(content);
      r.activationPending = true;
      delete r.pendingFiles[name];
      this.save(r);
    }
    this.progress(r, "image");
    await this.docker(["pull", releases.gateway.image], { timeout: 180000 });
    this.progress(r, "container");
    await this.docker(
      [
        "compose",
        "-f",
        r.directory + "/compose.json",
        "up",
        "-d",
        ...(r.activationPending ? ["--force-recreate"] : []),
        "--pull",
        "never",
      ],
      { timeout: 120000 },
    );
    await this.docker([
      "compose",
      "-f",
      r.directory + "/compose.json",
      "exec",
      "-T",
      "backchannel",
      "nginx",
      "-t",
    ]);
    if (
      (needsCertificate || r.reloadPending) &&
      hadContainer &&
      !missing &&
      !stopped &&
      !r.activationPending
    )
      await this.docker([
        "compose",
        "-f",
        r.directory + "/compose.json",
        "exec",
        "-T",
        "backchannel",
        "nginx",
        "-s",
        "reload",
      ]);
    r.status = "installed";
    r.reloadPending = false;
    r.activationPending = false;
    r.renewalUnconfirmed = false;
    r.updatedAt = new Date().toISOString();
    this.save(r);
    this.progress(r, "verification");
    return this.inspect();
  }
  async inspect({ allowStopped = false, allowMissing = false } = {}) {
    const r = this.current();
    if (!r) return { installed: false, verified: false };
    await this.files(r);
    const ids = (
      await this.docker([
        "ps",
        "-aq",
        "--no-trunc",
        "--filter",
        "label=com.docker.compose.project=" + r.project,
      ])
    )
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (ids.length === 0 && allowMissing)
      return {
        installed: false,
        verified: false,
        missing: true,
        running: false,
      };
    if (ids.length !== 1)
      throw setupError("Interner OIDC-Dienst nicht eindeutig bereit.");
    const [v] = JSON.parse(await this.docker(["inspect", ids[0]]));
    if (
      (!v.State.Running && !allowStopped) ||
      v.State.Restarting ||
      v.Config.Labels?.["io.stackpilot.backchannel"] !== r.id ||
      v.Config.Labels?.["io.stackpilot.plan"] !== r.rootId ||
      v.Config.Labels?.["com.docker.compose.service"] !== "backchannel" ||
      v.Config.Image !== releases.gateway.image ||
      v.Config.User !== `${r.uid}:${r.gid}` ||
      !v.HostConfig.ReadonlyRootfs ||
      v.HostConfig.Privileged ||
      v.HostConfig.CapAdd?.length ||
      !v.HostConfig.CapDrop?.includes("ALL") ||
      !v.HostConfig.SecurityOpt?.includes("no-new-privileges:true") ||
      Object.values(v.HostConfig.PortBindings || {}).some(Boolean) ||
      Object.keys(v.NetworkSettings.Networks).length !== 2 ||
      !v.NetworkSettings.Networks[r.media]?.Aliases?.includes(r.hostname) ||
      !v.NetworkSettings.Networks[r.ingress]
    )
      throw setupError(
        "Interner OIDC-Dienst weicht von den geprüften Rechten, Netzen oder Ports ab.",
      );
    const expected = new Map([
      ["/etc/nginx/nginx.conf", r.directory + "/nginx.conf"],
      ["/tls", r.directory + "/tls"],
    ]);
    for (const m of v.Mounts) {
      if (m.Type === "tmpfs") continue;
      if (m.Type !== "bind" || m.RW || expected.get(m.Destination) !== m.Source)
        throw setupError("Unerwarteter OIDC-Mount.");
      expected.delete(m.Destination);
    }
    if (expected.size) throw setupError("OIDC-Mount fehlt.");
    const cert = certificateInfo(
      await readFile(r.directory + "/tls/cert.pem"),
      await readFile(r.directory + "/tls/key.pem"),
      r.hostname,
      true,
    );
    return {
      installed: true,
      running: v.State.Running,
      verified: v.State.Running && Date.parse(cert.expiresAt) > Date.now(),
      expiresAt: cert.expiresAt,
      renewalNeeded: Date.parse(cert.expiresAt) < Date.now() + 14 * 86400000,
      renewalUnconfirmed: !!r.renewalUnconfirmed,
      publicReady: false,
      message:
        "Interner HTTPS-Dienst ohne Hostport bestätigt. Der tatsächliche Jellyfin-SSO-Weg muss zusätzlich erfolgreich sein.",
    };
  }
  start() {
    const refresh = () => {
      if (!this.current()) return;
      this.hub
        .mutate(["Jellyfin"], () => this.ensure({ explicit: false }))
        .catch(() => {
          const r = this.current();
          if (r) {
            r.renewalUnconfirmed = true;
            this.save(r);
          }
        });
    };
    this.initial = setTimeout(refresh, 1000);
    this.initial.unref?.();
    this.timer = setInterval(refresh, 3600000);
    this.timer.unref?.();
  }
  close() {
    clearTimeout(this.initial);
    clearInterval(this.timer);
  }
}
