import { ownFunnel } from "./own-funnel.js";
import { setupError } from "./setup-error.js";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  lstat,
  realpath,
  readFile,
  writeFile,
  readdir,
} from "node:fs/promises";
import { createServer } from "node:net";
import { catalog } from "../catalog.js";
import { localDocker } from "../retirement.js";
import { localIdentityRequest } from "./local-request.js";
import { releases } from "./config.js";
import { mediaGateway } from "./media-gateway.js";
import { ssoPluginState, ssoCompatibility } from "./sso-release.js";
import { downloadSsoArchive, unpackSsoArchive } from "./plugin-archive.js";
const hash = (v) =>
  createHash("sha256")
    .update(typeof v === "string" || Buffer.isBuffer(v) ? v : JSON.stringify(v))
    .digest("hex");
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
export const protectedMediaPort = 19096;
export async function safeDirectory(dir, uid) {
  if (!path.isAbsolute(dir) || (await realpath(dir)) !== dir)
    throw setupError(
      "Verzeichnis muss ohne symbolische Links erreichbar sein.",
    );
  const st = await lstat(dir);
  if (!st.isDirectory() || st.uid !== uid || st.mode & 0o022)
    throw setupError(
      "Verzeichnis benötigt den verwalteten Besitzer und geschützte Schreibrechte.",
    );
}
export function mediaGatewayConfig(input) {
  return `pid /tmp/nginx.pid;\nerror_log /dev/null crit;\nworker_processes auto;\nevents { worker_connections 512; }\nhttp {\n server_tokens off;\n client_body_timeout 10s;\n client_header_timeout 10s;\n client_body_temp_path /tmp/client;\n proxy_temp_path /tmp/proxy;\n fastcgi_temp_path /tmp/fastcgi;\n uwsgi_temp_path /tmp/uwsgi;\n scgi_temp_path /tmp/scgi;\n${mediaGateway(input, true)}\n}\n`;
}
export function protectionCompose(record) {
  const compose = {
    name: record.project,
    services: {
      gateway: {
        image: releases.gateway.image,
        user: `${record.uid}:${record.gid}`,
        restart: "unless-stopped",
        read_only: true,
        cap_drop: ["ALL"],
        security_opt: ["no-new-privileges:true"],
        pids_limit: 128,
        mem_limit: "128m",
        labels: {
          "io.stackpilot.protection": record.id,
          "io.stackpilot.plan": record.rootId,
        },
        entrypoint: ["nginx", "-g", "daemon off;"],
        ports: [`127.0.0.1:${protectedMediaPort}:8081`],
        volumes: [`${record.directory}/nginx.conf:/etc/nginx/nginx.conf:ro`],
        tmpfs: ["/tmp:rw,noexec,nosuid,size=32m"],
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
        logging: {
          driver: "json-file",
          options: { "max-size": "5m", "max-file": "2" },
        },
        networks: ["media"],
      },
    },
    networks: { media: { external: true, name: record.network } },
  };
  compose.services.gateway.labels["io.stackpilot.role"] = "gateway";
  compose.services.gateway.depends_on = ["authguard"];
  compose.services.authguard = {
    ...compose.services.gateway,
    image: catalog.services.ApiRelay.image,
    labels: {
      ...compose.services.gateway.labels,
      "io.stackpilot.role": "authguard",
    },
    entrypoint: ["node", "/app/media-auth.mjs"],
    ports: [],
    volumes: [`${record.directory}/media-auth.mjs:/app/media-auth.mjs:ro`],
  };
  delete compose.services.authguard.depends_on;
  return compose;
}
function preparedPlugin(bytes) {
  const files = unpackSsoArchive(bytes);
  const meta = {
    ...JSON.parse(files["meta.json"].toString("utf8")),
    autoUpdate: false,
    status: "Active",
    assemblies: Object.keys(files).filter((name) => name.endsWith(".dll")),
  };
  files["meta.json"] = Buffer.from(JSON.stringify(meta));
  return { files, meta };
}
export function validMetadata(bytes, expected) {
  try {
    const value = JSON.parse(bytes.toString("utf8"));
    return (
      value.autoUpdate === false &&
      [0, "Active"].includes(value.status) &&
      Object.entries(expected).every(
        ([key, v]) =>
          key === "status" ||
          (key === "name" && value[key] === "SSO-Auth") ||
          (key === "description" && value[key] === "") ||
          (key === "timestamp"
            ? new Date(value[key]).getTime() === new Date(v).getTime()
            : (key === "imageUrl" && value[key] === undefined) ||
              JSON.stringify(value[key]) === JSON.stringify(v)),
      ) &&
      Object.entries(value).every(
        ([key, v]) =>
          Object.hasOwn(expected, key) || (key === "imagePath" && v === null),
      )
    );
  } catch {
    return false;
  }
}
export class JellyfinProtection {
  constructor(
    hub,
    identity,
    docker = localDocker,
    download = downloadSsoArchive,
  ) {
    Object.assign(this, { hub, identity, docker, download });
    this.pending = null;
  }
  key(plan) {
    return "jellyfin-protection:" + (plan.rootId || plan.id);
  }
  current() {
    const c = this.hub.engine.current();
    return c ? this.hub.engine.vault.get(this.key(c.plan)) : null;
  }
  save(plan, record) {
    if (record.owner && !this.hub.engine.store.owns(record.owner))
      throw setupError("Auftragssperre wurde verloren. Zustand neu prüfen.");
    this.hub.engine.vault.set(this.key(plan), record);
  }
  summary(r = this.current()) {
    const running =
      !!this.pending || !!(r?.owner && this.hub.engine.store.owns(r.owner));
    return r
      ? {
          prepared: true,
          status: r.status === "running" && !running ? "interrupted" : r.status,
          running,
          stage: r.stage,
          error: this.lastError || r.error || null,
          pluginVersion: releases.ssoPlugin.version,
          target: `http://127.0.0.1:${protectedMediaPort}`,
          publicReady: false,
        }
      : {
          prepared: false,
          running: false,
          publicReady: false,
          error: this.lastError || null,
        };
  }
  async context() {
    const { plan, s } = await this.hub.context(["Jellyfin"]),
      identity = await this.identity.verify();
    if (
      identity.status !== "local-ready" ||
      identity.rootId !== (plan.rootId || plan.id) ||
      plan.uid !== identity.input.uid ||
      plan.gid !== identity.input.gid
    )
      throw setupError(
        "Authentik und Jellyfin müssen zum selben privaten Stack gehören.",
      );
    const live = await this.identity.remote.inspect();
    if (
      !live.tailscaleRunning ||
      live.hostname !== identity.input.hostname ||
      !live.serveKnown ||
      !live.serve.exclusive ||
      (live.serve.public && !ownFunnel(this.hub, plan))
    )
      throw setupError(
        "Bekannte private Tailscale-Ausgangslage zuerst prüfen. Bestehende öffentliche oder fremde Freigaben bleiben unverändert.",
      );
    const [info, plugins] = await Promise.all([
      this.hub.library.request(s, plan, "/System/Info"),
      this.hub.library.request(s, plan, "/Plugins"),
    ]);
    if (
      !ssoCompatibility(info.Version).loginVerified ||
      live.jellyfin?.version !== info.Version
    )
      throw setupError(
        "Jellyfin-Version wurde nicht für das sichere SSO-Profil geprüft.",
      );
    if (
      !Array.isArray(plugins) ||
      plugins.some(
        (p) =>
          /sso/i.test(p.Name || "") &&
          String(p.Id).replaceAll("-", "").toLowerCase() !==
            releases.ssoPlugin.id.replaceAll("-", ""),
      )
    )
      throw setupError("Unbekannte SSO-Erweiterung zuerst gesondert prüfen.");
    const plugin = ssoPluginState(plugins);
    const ids = (
      await this.docker([
        "ps",
        "-q",
        "--no-trunc",
        "--filter",
        "label=com.docker.compose.project=" + plan.project,
        "--filter",
        "label=com.docker.compose.service=jellyfin",
        "--filter",
        "label=io.stackpilot.plan=" + (plan.rootId || plan.id),
      ])
    )
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (ids.length !== 1)
      throw setupError(
        "Verwalteten Jellyfin-Container nicht eindeutig gefunden.",
      );
    const [container] = JSON.parse(await this.docker(["inspect", ids[0]]));
    const source = path.join(plan.appdata, "jellyfin"),
      bindings = container.HostConfig.PortBindings?.["8096/tcp"];
    if (
      !container.State.Running ||
      container.Config.User !== `${plan.uid}:${plan.gid}` ||
      container.HostConfig.Privileged ||
      !container.Mounts.some(
        (m) =>
          m.Destination === "/config" &&
          m.Type === "bind" &&
          m.Source === source &&
          m.RW,
      ) ||
      bindings?.length !== 1 ||
      bindings[0].HostIp !== (plan.bind || "127.0.0.1") ||
      bindings[0].HostPort !== String(plan.ports.Jellyfin)
    )
      throw setupError(
        "Containerrechte, Konfigurationspfad oder lokale Ports weichen vom verwalteten Plan ab.",
      );
    await safeDirectory(source, plan.uid);
    const networks = Object.entries(
      container.NetworkSettings.Networks || {},
    ).filter(
      ([name, n]) =>
        name === plan.project + "_default" && n.Aliases?.includes("jellyfin"),
    );
    if (networks.length !== 1)
      throw setupError("Verwaltetes Jellyfin-Netz nicht eindeutig bestätigt.");
    const [net] = JSON.parse(
      await this.docker(["network", "inspect", networks[0][0]]),
    );
    if (net.Labels?.["com.docker.compose.project"] !== plan.project)
      throw setupError("Fremdes Docker-Netz wird nicht eingebunden.");
    const old = this.current();
    if (
      plugin.present &&
      !plugin.releaseMatches &&
      !(old?.pluginFiles && plugin.version === releases.ssoPlugin.version)
    )
      throw setupError(
        "Vorhandenes SSO-Plugin ist abweichend oder inaktiv. Keine automatische Ersetzung.",
      );
    return {
      plan,
      s,
      identity,
      info,
      plugin,
      source,
      container,
      network: networks[0][0],
      review: hash([
        plan.id,
        identity.id,
        info.Version,
        plugin,
        container.Id,
        identity.input.hostname,
        networks[0][0],
      ]),
    };
  }
  async preview() {
    const c = await this.context();
    return {
      ...this.summary(),
      review: c.review,
      hostname: c.identity.input.hostname,
      canStart: !this.pending,
      pluginInstalled: c.plugin.releaseMatches,
      steps: [
        "Offizielles SSO-Archiv mit festem SHA-256 prüfen",
        "Plugin nur bei fehlender Installation bereitstellen und Jellyfin gezielt neu starten",
        "Schutz-Gateway auf Loopback-Port 19096 bereitstellen",
        "Passwort-, Reset- und fremde SSO-Zugänge sowie Containerrechte prüfen",
      ],
      message:
        "Jellyfin kann kurz nicht erreichbar sein. Medien, bestehende Konten und andere Anwendungen bleiben erhalten. Keine Tailscale- oder Funnel-Änderung.",
    };
  }
  async start(body) {
    if (body.confirmation !== "OK")
      throw setupError("Jellyfin-Schutz mit OK bestätigen.");
    if (this.pending) throw setupError("Einrichtungsauftrag läuft bereits.");
    const c = await this.context();
    if (c.review !== body.review)
      throw setupError("Zustand wurde geändert. Vorschau neu prüfen.");
    this.lastError = null;
    this.pending = this.run(body.review)
      .catch((e) => {
        this.lastError = e.message;
      })
      .finally(() => {
        this.pending = null;
      });
    return { started: true, publicReady: false };
  }
  async run(review) {
    await this.hub.mutate(["Jellyfin"], async ({ leaseOwner } = {}) => {
      const requireLease = () => {
        if (leaseOwner && !this.hub.engine.store.owns(leaseOwner))
          throw setupError(
            "Auftragssperre wurde verloren. Keine weiteren Änderungen; Zustand neu prüfen.",
          );
      };
      let c, r;
      try {
        c = await this.context();
        requireLease();
        if (review !== c.review)
          throw setupError("Zustand wurde vor dem Start geändert.");
        r = this.current();
        if (!r) {
          const id = randomUUID();
          r = {
            id,
            rootId: c.plan.rootId || c.plan.id,
            project: "sp-media-" + id.slice(0, 8),
            directory: path.join(
              this.hub.engine.store.directory,
              "media-protection",
              id,
            ),
            uid: c.plan.uid,
            gid: c.plan.gid,
            network: c.network,
            hostname: c.identity.input.hostname,
            status: "running",
            stage: "Vorbereitung",
          };
          this.save(c.plan, r);
        }
        if (
          r.network !== c.network ||
          r.hostname !== c.identity.input.hostname ||
          r.uid !== c.plan.uid ||
          r.gid !== c.plan.gid
        )
          throw setupError(
            "Gespeicherter Schutzauftrag gehört zu einer anderen Ausgangslage.",
          );
        r.status = "running";
        r.owner = leaseOwner || null;
        r.error = null;
        this.save(c.plan, r);
        if (c.plugin.releaseMatches && !r.pluginFiles)
          throw setupError(
            "Vorhandenes manuell installiertes SSO-Plugin benötigt eine gesonderte Übernahme mit Datei- und Updateprüfung.",
          );
        if (!c.plugin.releaseMatches || r.pluginFiles) {
          const pluginRoot = path.join(c.source, "plugins"),
            target = path.join(
              pluginRoot,
              "SSO-Auth_" + releases.ssoPlugin.version,
            );
          await mkdir(pluginRoot, { recursive: true, mode: 0o700 });
          await safeDirectory(pluginRoot, c.plan.uid);
          const names = await readdir(pluginRoot);
          if (
            names.some(
              (name) =>
                /sso/i.test(name) &&
                (name !== path.basename(target) || !r.pluginFiles),
            )
          )
            throw setupError(
              "Vorhandene SSO-Dateien werden nicht überschrieben.",
            );
          let files;
          if (!r.pluginFiles) {
            r.stage = "Offizielles Plugin laden und prüfen";
            this.save(c.plan, r);
            const prepared = preparedPlugin(await this.download());
            requireLease();
            files = prepared.files;
            r.pluginMeta = prepared.meta;
            r.pluginFiles = Object.fromEntries(
              Object.entries(files).map(([name, bytes]) => [name, hash(bytes)]),
            );
            this.save(c.plan, r);
          }
          await mkdir(target, { recursive: true, mode: 0o700 });
          await safeDirectory(target, c.plan.uid);
          if (
            (await readdir(target)).some(
              (name) => !Object.hasOwn(r.pluginFiles, name),
            )
          )
            throw setupError("Unerwartete Dateien im SSO-Verzeichnis.");
          for (const [name, expected] of Object.entries(r.pluginFiles)) {
            requireLease();
            const file = path.join(target, name);
            try {
              const st = await lstat(file);
              if (
                !st.isFile() ||
                st.isSymbolicLink() ||
                st.uid !== c.plan.uid ||
                (name === "meta.json"
                  ? !validMetadata(await readFile(file), r.pluginMeta)
                  : hash(await readFile(file)) !== expected)
              )
                throw setupError(
                  "Manuell veränderte SSO-Datei wird nicht ersetzt.",
                );
            } catch (e) {
              if (e.code !== "ENOENT") throw e;
              if (!files) files = preparedPlugin(await this.download()).files;
              await writeFile(file, files[name], { flag: "wx", mode: 0o600 });
            }
          }
          if (!c.plugin.releaseMatches) {
            r.stage = "Nur Jellyfin neu starten";
            this.save(c.plan, r);
            // Recheck the exact managed container immediately before a targeted restart.
            const fresh = await this.context();
            if (fresh.container.Id !== c.container.Id)
              throw setupError(
                "Jellyfin-Container wurde ausgetauscht. Neu prüfen.",
              );
            requireLease();
            await this.docker(["restart", c.container.Id], { timeout: 60000 });
            const deadline = Date.now() + 120000;
            while (true) {
              try {
                const plugins = await this.hub.library.request(
                  c.s,
                  c.plan,
                  "/Plugins",
                );
                if (ssoPluginState(plugins).releaseMatches) break;
              } catch {}
              if (Date.now() > deadline)
                throw setupError(
                  "SSO-Plugin nach Neustart nicht aktiv. Auftrag gezielt fortsetzen.",
                );
              await pause(2000);
            }
          }
        }
        requireLease();
        r.stage = "Lokales Schutz-Gateway bereitstellen";
        this.save(c.plan, r);
        await mkdir(r.directory, { recursive: true, mode: 0o700 });
        await safeDirectory(r.directory, r.uid);
        const files = {
          "nginx.conf": mediaGatewayConfig(c.identity.input),
          "media-auth.mjs": await readFile(
            new URL("./media-auth.js", import.meta.url),
            "utf8",
          ),
          "compose.json": JSON.stringify(protectionCompose(r), null, 2),
        };
        for (const [name, value] of Object.entries(files)) {
          const file = path.join(r.directory, name);
          try {
            const st = await lstat(file);
            if (
              !st.isFile() ||
              st.isSymbolicLink() ||
              hash(await readFile(file)) !== hash(value)
            )
              throw setupError(
                "Gateway-Dateien wurden verändert. Keine Überschreibung.",
              );
          } catch (e) {
            if (e.code !== "ENOENT") throw e;
            await writeFile(file, value, { flag: "wx", mode: 0o600 });
          }
        }
        r.files = Object.fromEntries(
          Object.entries(files).map(([k, v]) => [k, hash(v)]),
        );
        this.save(c.plan, r);
        const existing = (
          await this.docker([
            "ps",
            "-a",
            "-q",
            "--filter",
            "label=com.docker.compose.project=" + r.project,
          ])
        ).trim();
        if (!existing)
          await new Promise((resolve, reject) => {
            const server = createServer();
            server.once("error", () =>
              reject(Error("Lokaler Gateway-Port 19096 ist belegt.")),
            );
            server.listen(protectedMediaPort, "127.0.0.1", () =>
              server.close(resolve),
            );
          });
        else await this.verifyContainer(r, false);
        requireLease();
        await this.docker(
          [
            "compose",
            "-f",
            path.join(r.directory, "compose.json"),
            "up",
            "-d",
            "--pull",
            "missing",
          ],
          { timeout: 180000 },
        );
        await this.verifyContainer(r);
        r.stage = "Passwort- und Routing-Sperren prüfen";
        this.save(c.plan, r);
        await this.probe(r);
        r.status = "ready";
        r.stage = "Schutz-Gateway lokal geprüft";
        r.checkedAt = new Date().toISOString();
        this.save(c.plan, r);
      } catch (e) {
        if (r && c && (!leaseOwner || this.hub.engine.store.owns(leaseOwner))) {
          r.status = "failed";
          r.error = "Einrichtung nicht vollständig bestätigt. " + e.message;
          this.save(c.plan, r);
        }
        throw e;
      }
    });
  }
  async verifyContainer(r, running = true) {
    for (const [name, expected] of Object.entries(r.files || {})) {
      const file = path.join(r.directory, name),
        st = await lstat(file);
      if (
        !st.isFile() ||
        st.isSymbolicLink() ||
        st.uid !== r.uid ||
        hash(await readFile(file)) !== expected
      )
        throw setupError(
          "Gateway-Dateien weichen vom gespeicherten Auftrag ab.",
        );
    }
    const ids = (
      await this.docker([
        "ps",
        "-a",
        "-q",
        "--no-trunc",
        "--filter",
        "label=com.docker.compose.project=" + r.project,
      ])
    )
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (ids.length !== 2)
      throw setupError(
        "Schutz-Gateway und Sitzungsprüfung nicht eindeutig bestätigt.",
      );
    let gateway;
    const rows = JSON.parse(await this.docker(["inspect", ...ids]));
    for (const role of ["gateway", "authguard"]) {
      const matches = rows.filter(
        (v) => v.Config.Labels?.["io.stackpilot.role"] === role,
      );
      if (matches.length !== 1)
        throw setupError("Schutzdienst nicht eindeutig zugeordnet.");
      const v = matches[0],
        h = v.HostConfig,
        isGateway = role === "gateway",
        expectedImage = isGateway
          ? releases.gateway.image
          : catalog.services.ApiRelay.image;
      const source = path.join(
          r.directory,
          isGateway ? "nginx.conf" : "media-auth.mjs",
        ),
        destination = isGateway
          ? "/etc/nginx/nginx.conf"
          : "/app/media-auth.mjs";
      const ports = h.PortBindings?.["8081/tcp"];
      if (
        (running && !v.State.Running) ||
        v.Config.Labels["io.stackpilot.protection"] !== r.id ||
        v.Config.Labels["io.stackpilot.plan"] !== r.rootId ||
        v.Config.Image !== expectedImage ||
        v.Config.User !== `${r.uid}:${r.gid}` ||
        h.Privileged ||
        !h.ReadonlyRootfs ||
        h.CapAdd?.length ||
        h.CapDrop?.length !== 1 ||
        !["ALL", "CAP_ALL"].includes(h.CapDrop[0]) ||
        !h.SecurityOpt?.includes("no-new-privileges:true") ||
        (isGateway
          ? Object.keys(h.PortBindings || {}).length !== 1 ||
            ports?.length !== 1 ||
            ports[0].HostIp !== "127.0.0.1" ||
            ports[0].HostPort !== String(protectedMediaPort)
          : Object.keys(h.PortBindings || {}).length !== 0) ||
        Object.keys(v.NetworkSettings.Networks || {}).length !== 1 ||
        !v.NetworkSettings.Networks[r.network] ||
        v.Mounts.length !== 1 ||
        !v.Mounts.some(
          (m) =>
            m.Type === "bind" &&
            m.Source === source &&
            m.Destination === destination &&
            !m.RW,
        ) ||
        Object.keys(h.Tmpfs || {}).length !== 1 ||
        h.Tmpfs["/tmp"] !== "rw,noexec,nosuid,size=32m" ||
        h.PidsLimit !== 128 ||
        h.Memory !== 128 * 1024 * 1024 ||
        JSON.stringify(v.Config.Entrypoint) !==
          JSON.stringify(
            isGateway
              ? ["nginx", "-g", "daemon off;"]
              : ["node", "/app/media-auth.mjs"],
          )
      )
        throw setupError(
          "Schutzdienst-Rechte, Image, Mounts, Netz oder Ports wurden verändert.",
        );
      if (isGateway) gateway = v;
    }
    return gateway;
  }

  async probe(r) {
    const target = `http://127.0.0.1:${protectedMediaPort}`,
      headers = { Host: r.hostname };
    let ready = false;
    for (let i = 0; i < 20; i++) {
      try {
        const result = await localIdentityRequest(
          target + "/System/Info/Public",
          { headers },
        );
        if (result.status === 200 && (await result.json()).Version) {
          ready = true;
          break;
        }
      } catch {}
      await pause(500);
    }
    if (!ready)
      throw setupError("Jellyfin ist über das Gateway nicht erreichbar.");
    for (const route of [
      "/Users/AuthenticateByName",
      "/users/authenticatebyname",
      "/%55sers/AuthenticateByName",
      "//Users/AuthenticateByName",
      "/emby/Users/AuthenticateByName",
      "/Users/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/Authenticate",
      "/Users/Password",
      "/Users/ForgotPassword/Pin",
      "/%2555sers/AuthenticateByName",
      "/sso/OID/States",
      "/sso/SAML/start/other",
    ]) {
      const result = await localIdentityRequest(target + route, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          Username: "stackpilot-probe-" + randomUUID(),
          Pw: "",
        }),
      });
      await result.arrayBuffer();
      if (![400, 403].includes(result.status))
        throw setupError("Gateway sperrt einen alternativen Anmeldeweg nicht.");
    }
    const wrong = await localIdentityRequest(target + "/System/Info/Public", {
      headers: { Host: "localhost" },
    });
    await wrong.arrayBuffer();
    if (wrong.status !== 421)
      throw setupError("Gateway akzeptiert einen fremden Hostnamen.");
  }
  async verify() {
    const c = await this.context(),
      r = this.current();
    if (
      r?.status !== "ready" ||
      r.hostname !== c.identity.input.hostname ||
      r.network !== c.network ||
      !c.plugin.releaseMatches
    )
      throw setupError("Jellyfin-Schutz zuerst vollständig einrichten.");
    const pluginDir = path.join(
      c.source,
      "plugins",
      "SSO-Auth_" + releases.ssoPlugin.version,
    );
    await safeDirectory(pluginDir, c.plan.uid);
    if (
      !r.pluginFiles ||
      (await readdir(pluginDir)).some(
        (name) => !Object.hasOwn(r.pluginFiles, name),
      )
    )
      throw setupError("SSO-Dateien nicht vollständig bestätigt.");
    for (const [name, expected] of Object.entries(r.pluginFiles)) {
      const file = path.join(pluginDir, name),
        st = await lstat(file),
        bytes = await readFile(file);
      if (
        !st.isFile() ||
        st.isSymbolicLink() ||
        st.uid !== c.plan.uid ||
        (name === "meta.json"
          ? !validMetadata(bytes, r.pluginMeta)
          : hash(bytes) !== expected)
      )
        throw setupError(
          "SSO-Dateien oder automatische Update-Einstellung wurden verändert.",
        );
    }
    await this.verifyContainer(r);
    await this.probe(r);
    return { ...r, target: `http://127.0.0.1:${protectedMediaPort}` };
  }
  async status() {
    try {
      const r = await this.verify();
      return {
        ...this.summary(r),
        verified: true,
        checkedAt: new Date().toISOString(),
      };
    } catch {
      return { ...this.summary(), verified: false };
    }
  }
}
