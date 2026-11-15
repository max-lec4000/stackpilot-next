import { randomBytes, pbkdf2Sync, createHash } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  link,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { catalog } from "./catalog.js";
export function serviceCredentialKey(plan, name) {
  return `deployment:${plan.rootId || plan.id}:${catalog.services[name].slug}`;
}

export function serviceCredentials(vault, plan, name) {
  return vault.ensure(
    serviceCredentialKey(plan, name),
    () => ({
      username: plan.spec.username,
      password: randomBytes(24).toString("base64url"),
      apiKey: randomBytes(16).toString("hex"),
      salt: randomBytes(16).toString("base64"),
    }),
  );
}
// Netzaufteilung (Layout 2): Jellyfin – der einzige von außen erreichbare Dienst – liegt
// im Netz "default" zusammen mit Schutz-Gateway, Sitzungsprüfung und OIDC-Weg. Die
// ARR-Dienste und der Downloadclient liegen im Netz "arr". Nur wer beide braucht, hängt
// in beiden: Seerr (Jellyfin + Sonarr/Radarr) und die interne API-Brücke von StackPilot.
// Ein kompromittiertes Jellyfin erreicht so keinen ARR-Dienst und keinen Downloadclient.
export const networkLayout = 2;
const layout = {
  jellyfin: ["default"],
  streamystats: ["default"],
  seerr: ["default", "arr"],
  "api-relay": ["default", "arr"],
  gluetun: ["arr"],
  qbittorrent: ["arr"],
  sonarr: ["arr"],
  radarr: ["arr"],
  lidarr: ["arr"],
  prowlarr: ["arr"],
  bazarr: ["arr"],
};
/** Netze eines Dienstes (Compose-Schlüssel) im jeweiligen Layout des Plans. */
export function serviceNetworks(plan, slug) {
  return plan.networkLayout === networkLayout ? layout[slug] || ["default"] : ["default"];
}
export function composeFor(plan, publish = true) {
  const internal = [
    "localhost",
    "127.0.0.1",
    ...Object.values(catalog.services).map((s) => s.slug),
  ].join(",");
  const noProxy = [
    process.env.NO_PROXY || "",
    process.env.no_proxy || "",
    internal,
  ]
    .filter(Boolean)
    .join(",");
  const services = {};
  const rootId = plan.rootId || plan.id;
  for (const name of plan.spec.selected) {
    const entry = catalog.services[name];
    const volumes = [`${plan.appdata}/${entry.slug}:/config`];
    if (["Sonarr", "Radarr", "Lidarr", "qBittorrent", "Bazarr"].includes(name))
      volumes.push(`${plan.spec.path}:/data`);
    const options = {
      image: plan.images?.[name] || entry.image,
      restart: "unless-stopped",
      labels: {
        "io.stackpilot.managed": "true",
        "io.stackpilot.plan": plan.rootId || plan.id,
      },
      ports:
        publish || plan.existing?.includes(name)
          ? [`${plan.bind || "127.0.0.1"}:${plan.ports[name]}:${entry.port}`]
          : [],
      volumes,
      environment: {
        PUID: String(plan.uid),
        PGID: String(plan.gid),
        TZ: "Europe/Vienna",
        NO_PROXY: noProxy,
        no_proxy: noProxy,
      },
      security_opt: ["no-new-privileges:true"],
    };
    if (name === "Jellyfin") {
      options.user = `${plan.uid}:${plan.gid}`;
      options.volumes = [
        `${plan.appdata}/jellyfin:/config`,
        `${plan.appdata}/jellyfin-cache:/cache`,
        `${plan.spec.path}/media:/data/media:ro`,
      ];
      options.environment = {
        TZ: "Europe/Vienna",
        NO_PROXY: noProxy,
        no_proxy: noProxy,
      };
    }
    if (name === "Seerr") {
      options.user = `${plan.uid}:${plan.gid}`;
      options.volumes = [`${plan.appdata}/seerr:/app/config`];
      options.environment = {
        TZ: "Europe/Vienna",
        NO_PROXY: noProxy,
        no_proxy: noProxy,
      };
    }
    if (name === "Streamystats") {
      options.volumes = [
        `${plan.appdata}/streamystats/database:/var/lib/postgresql/data`,
        `${plan.appdata}/streamystats/runtime.env:/run/secrets/stackpilot.env:ro`,
      ];
      options.entrypoint = [
        "/bin/sh",
        "-c",
        "set -a; . /run/secrets/stackpilot.env; set +a; exec /app/entrypoint.sh",
      ];
      options.environment = {
        TZ: "Europe/Vienna",
        NO_PROXY: noProxy,
        no_proxy: noProxy,
        POSTGRES_USER: "postgres",
        POSTGRES_DB: "streamystats",
        PGDATA: "/var/lib/postgresql/data",
        POSTGRES_HOST_AUTH_METHOD: "scram-sha-256",
        POSTGRES_INITDB_ARGS: "--auth-host=scram-sha-256",
        SKIP_STARTUP_FULL_SYNC: "true",
        NEXT_TELEMETRY_DISABLED: "1",
      };
      options.stop_grace_period = "60s";
    }
    if (name === "qBittorrent")
      options.environment = {
        ...options.environment,
        WEBUI_PORT: "8080",
        TORRENTING_PORT: "6881",
      };
    if (name === "qBittorrent" && plan.spec.vpn) {
      options.network_mode = "service:gluetun";
      options.depends_on = { gluetun: { condition: "service_started" } };
      delete options.ports;
      options.volumes.push(
        `${plan.appdata}/gluetun/resolv.conf:/etc/resolv.conf:ro`,
      );
      options.environment = {
        ...options.environment,
        HTTP_PROXY: "",
        HTTPS_PROXY: "",
        ALL_PROXY: "",
        http_proxy: "",
        https_proxy: "",
        all_proxy: "",
      };
    }
    services[entry.slug] = options;
  }
  services["api-relay"] = {
    image: plan.images?.ApiRelay || catalog.services.ApiRelay.image,
    command: ["node", "-e", "setInterval(()=>{},1000000)"],
    restart: "unless-stopped",
    user: "65534:65534",
    read_only: true,
    cap_drop: ["ALL"],
    security_opt: ["no-new-privileges:true"],
    labels: {
      "io.stackpilot.managed": "true",
      "io.stackpilot.plan": plan.rootId || plan.id,
    },
  };
  if (plan.spec.vpn) {
    services.gluetun = {
      image: plan.images?.Gluetun || catalog.services.Gluetun.image,
      restart: "unless-stopped",
      cap_add: ["NET_ADMIN"],
      devices: ["/dev/net/tun:/dev/net/tun"],
      security_opt: ["no-new-privileges:true"],
      sysctls: { "net.ipv6.conf.all.disable_ipv6": "1" },
      labels: { "io.stackpilot.managed": "true", "io.stackpilot.plan": rootId },
      networks: { default: { aliases: ["qbittorrent"] } },
      ports: publish
        ? [`${plan.bind || "127.0.0.1"}:${plan.ports.qBittorrent}:8080`]
        : [],
      volumes: [
        `${plan.appdata}/gluetun/wg0.conf:/gluetun/wireguard/wg0.conf:ro`,
        `${plan.appdata}/gluetun/auth.toml:/gluetun/auth/config.toml:ro`,
      ],
      environment: {
        VPN_SERVICE_PROVIDER: "custom",
        VPN_TYPE: "wireguard",
        VPN_INTERFACE: "tun0",
        WIREGUARD_IMPLEMENTATION: "userspace",
        FIREWALL: "on",
        FIREWALL_INPUT_PORTS: "8080",
        HTTP_CONTROL_SERVER_ADDRESS: "127.0.0.1:8000",
        UPDATER_PERIOD: "0",
        TZ: "Europe/Vienna",
        HTTP_PROXY: "",
        HTTPS_PROXY: "",
        ALL_PROXY: "",
        http_proxy: "",
        https_proxy: "",
        all_proxy: "",
      },
    };
    services["vpn-probe"] = {
      ...services["api-relay"],
      volumes: [`${plan.appdata}/gluetun/resolv.conf:/etc/resolv.conf:ro`],
      network_mode: "service:gluetun",
      depends_on: { gluetun: { condition: "service_started" } },
      environment: {
        HTTP_PROXY: "",
        HTTPS_PROXY: "",
        ALL_PROXY: "",
        http_proxy: "",
        https_proxy: "",
        all_proxy: "",
      },
    };
  }
  Object.assign(services, plan.preservedServices || {});
  const labels = {
    "io.stackpilot.managed": "true",
    "io.stackpilot.plan": plan.rootId || plan.id,
  };
  const networks = { default: { labels } };
  if (plan.networkLayout === networkLayout) {
    networks.arr = { labels };
    // Gilt auch für eingefrorene Definitionen älterer Pläne: so stellt eine Erweiterung
    // einen bestehenden Stack auf die getrennten Netze um.
    for (const [slug, definition] of Object.entries(services)) {
      if (definition.network_mode?.startsWith("service:")) continue;
      const names = serviceNetworks(plan, slug);
      definition.networks =
        slug === "gluetun"
          ? Object.fromEntries(names.map((n) => [n, { aliases: ["qbittorrent"] }]))
          : names;
    }
  }
  return { name: plan.project, services, networks };
}
async function createFile(file, text, mode = 0o600) {
  const temp = file + "." + randomBytes(6).toString("hex") + ".tmp";
  const handle = await open(temp, "wx", mode);
  try {
    await handle.writeFile(text);
    await handle.chmod(mode);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(temp, file);
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  } finally {
    await unlink(temp);
  }
}
/** Was in einem übernommenen Medienordner liegen darf – mehr fasst StackPilot nicht an. */
export const adoptableEntries = ["media", "downloads", ".stackpilot-owner.json", "lost+found"];
/**
 * Prüft, ob ein vorhandener Datenordner übernommen werden kann. Liefert die Besitzmarke
 * des früheren Stacks (oder null) und die Liste unerwarteter Einträge.
 */
export async function inspectAdoption(dir) {
  const entries = await readdir(dir);
  const unexpected = entries.filter(
    (name) => !adoptableEntries.includes(name) && !/^\.stackpilot-owner\.previous/.test(name),
  );
  let previous = null;
  try {
    previous = JSON.parse(await readFile(path.join(dir, ".stackpilot-owner.json"), "utf8")).planId || null;
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  return { entries, unexpected, previous, hasMedia: entries.includes("media") };
}
async function adoptDirectory(dir, plan) {
  if ((await realpath(dir)) !== dir)
    throw new Error("Speicherpfad enthält einen unerwarteten Symlink.");
  const marker = path.join(dir, ".stackpilot-owner.json");
  const own = plan.rootId || plan.id;
  const state = await inspectAdoption(dir);
  if (state.previous === own) return;
  if (state.unexpected.length || state.previous !== (plan.adoptedFrom || null))
    throw new Error(
      "Der Medienordner hat sich seit der Planung geändert. Erneut prüfen.",
    );
  // Die alte Marke bleibt als Nachweis liegen; Mediendateien werden nicht angefasst.
  if (state.previous) {
    const keep = path.join(dir, `.stackpilot-owner.previous-${state.previous.slice(0, 8)}.json`);
    await link(marker, keep).catch((e) => {
      if (e.code !== "EEXIST") throw e;
    });
    await unlink(marker);
  }
  await createFile(marker, JSON.stringify({ planId: own, project: plan.project }));
}
async function ownedDirectory(dir, plan) {
  try {
    await mkdir(dir, { mode: 0o700 });
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
  if ((await realpath(dir)) !== dir)
    throw new Error("Speicherpfad enthält einen unerwarteten Symlink.");
  const marker = path.join(dir, ".stackpilot-owner.json");
  try {
    const owner = JSON.parse(await readFile(marker, "utf8"));
    if (owner.planId !== (plan.rootId || plan.id))
      throw new Error(
        "Der Datenordner gehört nicht zu diesem Installationsplan.",
      );
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    if ((await readdir(dir)).length)
      throw new Error(
        "Neuer Datenordner ist nicht leer. Bestehende Inhalte werden nicht überschrieben.",
      );
    await createFile(
      marker,
      JSON.stringify({ planId: plan.rootId || plan.id, project: plan.project }),
    );
  }
}
async function serviceDirectory(dir, plan, name) {
  await mkdir(dir, { mode: 0o700, recursive: true });
  if ((await realpath(dir)) !== dir)
    throw new Error("Dienstordner enthält einen Symlink.");
  const marker = path.join(dir, ".stackpilot-service.json");
  try {
    const owner = JSON.parse(await readFile(marker, "utf8"));
    if (owner.rootId !== (plan.rootId || plan.id) || owner.name !== name)
      throw new Error("Dienstordner gehört nicht zum verwalteten Stack.");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    if ((await readdir(dir)).length)
      throw new Error(
        "Dienstordner enthält fremde Konfiguration. Keine Übernahme.",
      );
    await createFile(
      marker,
      JSON.stringify({ rootId: plan.rootId || plan.id, name }),
    );
  }
}
export async function prepareFiles(plan, vault, manifestDir) {
  if (plan.adoptedData) await adoptDirectory(plan.spec.path, plan);
  else await ownedDirectory(plan.spec.path, plan);
  await ownedDirectory(plan.appdata, plan);
  for (const sub of [
    "downloads",
    "downloads/incomplete",
    "downloads/complete",
    "downloads/complete/tv",
    "downloads/complete/movies",
    "downloads/complete/music",
    "media",
    "media/tv",
    "media/movies",
    "media/music",
  ])
    await mkdir(path.join(plan.spec.path, sub), {
      recursive: true,
      mode: 0o750,
    });
  for (const name of plan.added || plan.spec.selected) {
    const entry = catalog.services[name];
    const config = path.join(plan.appdata, entry.slug);
    await serviceDirectory(config, plan, name);
    const creds = serviceCredentials(
      vault,
      plan,
      ["Seerr", "Streamystats"].includes(name) ? "Jellyfin" : name,
    );
    if (["Sonarr", "Radarr", "Prowlarr", "Lidarr"].includes(name)) {
      await createFile(
        path.join(config, "config.xml"),
        `<Config><BindAddress>*</BindAddress><Port>${entry.port}</Port><EnableSsl>False</EnableSsl><LaunchBrowser>False</LaunchBrowser><ApiKey>${creds.apiKey}</ApiKey><AuthenticationMethod>Forms</AuthenticationMethod><AuthenticationRequired>Enabled</AuthenticationRequired><AnalyticsEnabled>False</AnalyticsEnabled><UpdateAutomatically>False</UpdateAutomatically></Config>`,
      );
    }
    if (name === "Bazarr") {
      await mkdir(path.join(config, "config"), {
        mode: 0o700,
        recursive: true,
      });
      await createFile(
        path.join(config, "config/config.yaml"),
        JSON.stringify(
          {
            auth: {
              type: "form",
              username: creds.username,
              password: createHash("md5").update(creds.password).digest("hex"),
              apikey: creds.apiKey,
            },
            general: {
              auto_update: false,
              use_sonarr: false,
              use_radarr: false,
            },
            analytics: { enabled: false },
          },
          null,
          2,
        ),
      );
    }
    if (name === "Streamystats") {
      await mkdir(path.join(config, "database"), {
        mode: 0o700,
        recursive: true,
      });
      const runtime = vault.ensure(
        `deployment:${plan.rootId || plan.id}:streamystats-runtime`,
        () => ({
          databasePassword: randomBytes(24).toString("base64url"),
          sessionSecret: randomBytes(32).toString("base64url"),
          actionKey: randomBytes(32).toString("base64"),
        }),
      );
      await createFile(
        path.join(config, "runtime.env"),
        `POSTGRES_PASSWORD=${runtime.databasePassword}\nDATABASE_URL=postgresql://postgres:${runtime.databasePassword}@127.0.0.1:5432/streamystats\nSESSION_SECRET=${runtime.sessionSecret}\nNEXT_SERVER_ACTIONS_ENCRYPTION_KEY=${runtime.actionKey}\n`,
      );
    }
    if (name === "qBittorrent") {
      await mkdir(path.join(config, "qBittorrent"), {
        recursive: true,
        mode: 0o700,
      });
      const salt = Buffer.from(creds.salt, "base64");
      const hash = pbkdf2Sync(creds.password, salt, 100000, 64, "sha512");
      await createFile(
        path.join(config, "qBittorrent/qBittorrent.conf"),
        `[LegalNotice]\nAccepted=true\n[Preferences]\nWebUI\\Username=${creds.username}\nWebUI\\Password_PBKDF2="@ByteArray(${salt.toString("base64")}:${hash.toString("base64")})"\nWebUI\\LocalHostAuth=true\nWebUI\\AuthSubnetWhitelistEnabled=false\n[BitTorrent]\nSession\\DefaultSavePath=/data/downloads/complete\nSession\\TempPath=/data/downloads/incomplete\nSession\\TempPathEnabled=true\n`,
      );
    }
  }
  if (plan.spec.selected.includes("Jellyfin"))
    await mkdir(plan.appdata + "/jellyfin-cache", {
      mode: 0o700,
      recursive: true,
    });
  if (plan.spec.vpn) {
    const profile = vault.get(`vpn-profile:${plan.vpnProfileId}`);
    if (!profile) throw new Error("Verschlüsseltes VPN-Profil fehlt.");
    const dir = path.join(plan.appdata, "gluetun");
    await serviceDirectory(dir, plan, "Gluetun");
    await createFile(path.join(dir, "wg0.conf"), profile.config);
    await createFile(
      path.join(dir, "resolv.conf"),
      "nameserver 127.0.0.1\noptions timeout:2 attempts:2\n",
      0o644,
    );
    await createFile(
      path.join(dir, "auth.toml"),
      `[[roles]]\nname = "stackpilot-check"\nroutes = ["GET /v1/vpn/status", "PUT /v1/vpn/status"]\nauth = "apikey"\napikey = "${profile.controlKey}"\n`,
    );
  }
  await mkdir(manifestDir, { mode: 0o700, recursive: true });
  await createFile(
    path.join(manifestDir, "compose.json"),
    JSON.stringify(composeFor(plan, true), null, 2),
  );
  await createFile(
    path.join(manifestDir, "bootstrap.json"),
    JSON.stringify(composeFor(plan, false), null, 2),
  );
}

export async function testHardlinks(plan) {
  const { link, unlink, stat, realpath } = await import("node:fs/promises");
  const folders = [
    ["Radarr", "movies"],
    ["Sonarr", "tv"],
    ["Lidarr", "music"],
  ].filter(([service]) => plan.spec.selected.includes(service));
  const results = [];
  for (const [service, folder] of folders) {
    const name = ".stackpilot-link-test-" + randomBytes(8).toString("hex"),
      sourceDir = path.join(plan.spec.path, "downloads/complete", folder),
      targetDir = path.join(plan.spec.path, "media", folder);
    if (
      (await realpath(sourceDir)) !== sourceDir ||
      (await realpath(targetDir)) !== targetDir
    )
      throw new Error(
        "Speicherprüfung verweigert symbolische Links in " +
          service +
          "-Pfaden.",
      );
    const source = path.join(sourceDir, name),
      target = path.join(targetDir, name);
    let created = false,
      linked = false;
    try {
      const file = await open(source, "wx", 0o600);
      created = true;
      try {
        await file.writeFile("StackPilot storage check\n");
      } finally {
        await file.close();
      }
      await link(source, target);
      linked = true;
      const [first, second] = await Promise.all([stat(source), stat(target)]);
      if (
        first.ino !== second.ino ||
        first.dev !== second.dev ||
        first.nlink < 2
      )
        throw new Error("Hardlink-Nachweis fehlgeschlagen.");
      results.push({ service, folder, verified: true });
    } catch {
      throw new Error(
        "Hardlinks für " +
          service +
          " zwischen abgeschlossenen Downloads und Medien funktionieren nicht. Dateisystemgrenzen und Rechte prüfen.",
      );
    } finally {
      const cleanup = await Promise.allSettled([
        ...(linked ? [unlink(target)] : []),
        ...(created ? [unlink(source)] : []),
      ]);
      if (cleanup.some((r) => r.status === "rejected"))
        throw new Error(
          "Temporäre Speicher-Testdateien für " +
            service +
            " konnten nicht vollständig entfernt werden. Diagnose prüfen.",
        );
    }
  }
  return results;
}
