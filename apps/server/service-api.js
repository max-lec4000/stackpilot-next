import { AdditionalServices, additionalNames } from "./additional-services.js";
import { relayRequest } from "./docker-io.js";
import { catalog } from "./catalog.js";
import { apps } from "../../packages/domain/apps.js";
import { serviceCredentials } from "./provision-files.js";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export class Services {
  constructor(plan, vault, relay = null) {
    this.plan = plan;
    this.vault = vault;
    this.cookies = {};
    this.relay = relay;
    this.additional = new AdditionalServices(this);
  }
  credentials(name) {
    return serviceCredentials(
      this.vault,
      this.plan,
      ["Seerr", "Streamystats"].includes(name) ? "Jellyfin" : name,
    );
  }
  /**
   * Adresse und API-Schlüssel aller Apps, mit denen diese App laut Katalog verbunden wird
   * (packages/domain/apps.js, "linksTo"). Neue Adapter holen ihre Partner hierüber, statt
   * Schlüssel selbst zusammenzusuchen.
   */
  linksFor(name) {
    return Object.fromEntries(
      (apps[name]?.linksTo || [])
        .filter((target) => this.plan.spec.selected.includes(target))
        .map((target) => {
          const entry = catalog.services[target];
          const host = target === "qBittorrent" && this.plan.spec.vpn ? "gluetun" : entry.slug;
          const c = this.credentials(target);
          return [
            target,
            {
              url: `http://${host}:${entry.port}`,
              apiKey: target === "qBittorrent" ? null : c.apiKey,
              username: target === "qBittorrent" ? c.username : null,
              password: target === "qBittorrent" ? c.password : null,
            },
          ];
        }),
    );
  }
  base(name) {
    return `http://127.0.0.1:${this.plan.ports[name]}`;
  }
  async request(
    name,
    route,
    { method = "GET", body, headers = {}, raw = false } = {},
  ) {
    const requestHeaders = {
      ...headers,
      ...(body !== undefined
        ? {
            "Content-Type":
              body instanceof URLSearchParams
                ? "application/x-www-form-urlencoded"
                : "application/json",
          }
        : {}),
    };
    const serialized =
      body === undefined
        ? undefined
        : body instanceof URLSearchParams
          ? body.toString()
          : JSON.stringify(body);
    let status, responseHeaders, text, transportError;
    if (this.relay) {
      const response = await relayRequest(this.relay, {
        url: `http://${name === "qBittorrent" && this.plan.spec.vpn ? "gluetun" : catalog.services[name].slug}:${catalog.services[name].port}${route}`,
        method,
        headers: requestHeaders,
        body: serialized,
        timeout: this.timeout || 45000,
      }).catch(() => {
        throw new Error(
          `${name}: interne API-Brücke bei ${route.split("?")[0]} fehlgeschlagen.`,
        );
      });
      transportError = response.error;
      status = response.status;
      responseHeaders = new Headers(response.headers);
      text = response.body;
    } else {
      const r = await fetch(this.base(name) + route, {
        method,
        headers: requestHeaders,
        body: serialized,
        redirect: "manual",
        signal: AbortSignal.timeout(15000),
      }).catch(() => {
        throw new Error(`${name}: Dienst ist nicht erreichbar.`);
      });
      status = r.status;
      responseHeaders = r.headers;
      text = await r.text();
    }
    if (status < 200 || status >= 300) {
      let detail = "";
      try {
        const errors = JSON.parse(text);
        if (Array.isArray(errors))
          detail = errors
            .slice(0, 3)
            .map((e) => String(e.errorMessage || "").slice(0, 300))
            .join("; ");
      } catch {}
      for (const service of this.plan.spec.selected || [name]) {
        const c = this.credentials(service);
        for (const value of [c.password, c.apiKey, c.pendingApiKey])
          if (value) detail = detail.replaceAll(value, "[redacted]");
      }
      const error = new Error(
        `${name}: Dienstanfrage ${route.split("?")[0]} fehlgeschlagen (HTTP ${status}${transportError ? " · " + transportError : ""}). ${detail}`,
      );
      error.status = status;
      throw error;
    }
    if (raw)
      return { status, headers: responseHeaders, text: async () => text };
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  arr(name, route, options = {}) {
    const version = name === "Prowlarr" || name === "Lidarr" ? "v1" : "v3";
    return this.request(name, `/api/${version}${route}`, {
      ...options,
      headers: {
        "X-Api-Key": this.credentials(name).apiKey,
        ...options.headers,
      },
    });
  }
  async qbit(route, body, retry = true) {
    if (!this.cookies.qbit) {
      const c = this.credentials("qBittorrent");
      const response = await this.request("qBittorrent", "/api/v2/auth/login", {
        method: "POST",
        body: new URLSearchParams({
          username: c.username,
          password: c.password,
        }),
        raw: true,
      });
      if (!["Ok.", ""].includes((await response.text()).trim()))
        throw new Error("qBittorrent: Anmeldung fehlgeschlagen.");
      const cookie = response.headers
        .get("set-cookie")
        ?.match(/\b(SID|QBT_SID_\d+)=([^;,\s]+)/);
      if (!cookie) throw new Error("qBittorrent: Sitzung fehlt.");
      this.cookies.qbit = cookie[1] + "=" + cookie[2];
    }
    try {
      return await this.request("qBittorrent", "/api/v2" + route, {
        method: body ? "POST" : "GET",
        body: body ? new URLSearchParams(body) : undefined,
        headers: { Cookie: this.cookies.qbit },
      });
    } catch (error) {
      if (retry && /HTTP (401|403)/.test(error.message)) {
        this.cookies.qbit = null;
        return this.qbit(route, body, false);
      }
      throw error;
    }
  }

  async wait(name) {
    const end = Date.now() + 180000;
    let last;
    while (Date.now() < end) {
      try {
        if (name === "Jellyfin") {
          await this.request(name, "/health");
          const info = await this.request(name, "/System/Info/Public");
          if (
            !info ||
            typeof info !== "object" ||
            typeof info.Version !== "string" ||
            typeof info.StartupWizardCompleted !== "boolean"
          )
            throw new Error(
              "Jellyfin: Startseite ist noch keine betriebsbereite API.",
            );
          if (!info.StartupWizardCompleted) {
            const config = await this.request(name, "/Startup/Configuration");
            if (
              !config ||
              typeof config !== "object" ||
              !("PreferredMetadataLanguage" in config)
            )
              throw new Error(
                "Jellyfin: Einrichtungs-API ist noch nicht bereit.",
              );
          }
        } else if (name === "Bazarr")
          await this.additional.bazarr("/system/status");
        else if (name === "Seerr") await this.request(name, "/api/v1/status");
        else if (name === "Streamystats")
          await this.request(name, "/api/health");
        else if (name === "qBittorrent") await this.qbit("/app/version");
        else await this.arr(name, "/system/status");
        return;
      } catch (e) {
        last = e;
        await sleep(1000);
      }
    }
    throw new Error(
      `${name}: innerhalb von 180 Sekunden nicht bereit. ${last?.message || ""}`,
    );
  }
  async configure(name) {
    if (additionalNames.includes(name)) return this.additional.configure(name);
    if (name === "Jellyfin") return this.jellyfin();
    if (name === "qBittorrent") {
      await this.qbit("/app/setPreferences", {
        json: JSON.stringify({
          save_path: "/data/downloads/complete",
          temp_path: "/data/downloads/incomplete",
          temp_path_enabled: true,
          ...(this.plan.spec.vpn ? { current_network_interface: "tun0" } : {}),
          locale: this.plan.spec.language === "Englisch" ? "en" : "de",
        }),
      });
      for (const [category, folder] of [
        ["stackpilot-tv", "tv"],
        ["stackpilot-movies", "movies"],
        ["stackpilot-music", "music"],
      ]) {
        const categories = await this.qbit("/torrents/categories");
        if (!categories[category])
          await this.qbit("/torrents/createCategory", {
            category,
            savePath: "/data/downloads/complete/" + folder,
          });
      }
      return;
    }
    const host = await this.arr(name, "/config/host");
    const credentials = this.credentials(name);
    await this.arr(name, "/config/host", {
      method: "PUT",
      body: {
        ...host,
        authenticationMethod: "forms",
        authenticationRequired: "enabled",
        username: credentials.username,
        password: credentials.password,
        passwordConfirmation: credentials.password,
        analyticsEnabled: false,
        updateAutomatically: false,
      },
    });
    const folder = {
      Sonarr: "/data/media/tv",
      Radarr: "/data/media/movies",
      Lidarr: "/data/media/music",
    }[name];
    if (folder) {
      const roots = await this.arr(name, "/rootfolder");
      if (!roots.some((r) => r.path === folder))
        await this.arr(name, "/rootfolder", {
          method: "POST",
          body:
            name === "Lidarr"
              ? {
                  name: "Musik",
                  path: folder,
                  defaultMetadataProfileId: (
                    await this.arr(name, "/metadataprofile")
                  )[0]?.id,
                  defaultQualityProfileId: (
                    await this.arr(name, "/qualityprofile")
                  )[0]?.id,
                  defaultMonitorOption: "all",
                  defaultNewItemMonitorOption: "all",
                  defaultTags: [],
                }
              : { path: folder },
        });
    }
  }
  async jellyfin() {
    const credentials = this.credentials("Jellyfin");
    let login;
    const authHeader =
      'MediaBrowser Client="StackPilot", Device="Server", DeviceId="stackpilot", Version="0.1.0"';
    const info = await this.request("Jellyfin", "/System/Info/Public");
    if (!info.StartupWizardCompleted) {
      await this.request("Jellyfin", "/Startup/User");
      try {
        await this.request("Jellyfin", "/Startup/User", {
          method: "POST",
          body: { Name: credentials.username, Password: credentials.password },
        });
      } catch (error) {
        // On resume, the user may already have been created before the checkpoint.
        try {
          login = await this.request("Jellyfin", "/Users/AuthenticateByName", {
            method: "POST",
            headers: { Authorization: authHeader },
            body: { Username: credentials.username, Pw: credentials.password },
          });
        } catch {
          throw error;
        }
      }
      await this.request("Jellyfin", "/Startup/Configuration", {
        method: "POST",
        body: {
          UICulture: this.plan.spec.language === "Englisch" ? "en-US" : "de-DE",
          MetadataCountryCode: "AT",
          PreferredMetadataLanguage:
            this.plan.spec.language === "Englisch" ? "en" : "de",
        },
      });
      await this.request("Jellyfin", "/Startup/RemoteAccess", {
        method: "POST",
        body: { EnableRemoteAccess: false, EnableAutomaticPortMapping: false },
      });
      await this.request("Jellyfin", "/Startup/Complete", { method: "POST" });
    }
    login = await this.request("Jellyfin", "/Users/AuthenticateByName", {
      method: "POST",
      headers: { Authorization: authHeader },
      body: { Username: credentials.username, Pw: credentials.password },
    });
    const headers = {
      Authorization: authHeader + `, Token="${login.AccessToken}"`,
    };
    this.cookies.jellyfin = headers;
    const libraries = await this.request(
      "Jellyfin",
      "/Library/VirtualFolders",
      { headers },
    );
    for (const [name, type, folder] of [
      ["Filme", "movies", "movies"],
      ["Serien", "tvshows", "tv"],
      ["Musik", "music", "music"],
    ])
      if (
        !libraries.some((l) => l.Locations?.includes("/data/media/" + folder))
      )
        await this.request(
          "Jellyfin",
          "/Library/VirtualFolders?" +
            new URLSearchParams({
              name,
              collectionType: type,
              refreshLibrary: "false",
            }),
          {
            method: "POST",
            headers,
            body: {
              LibraryOptions: {
                EnableRealtimeMonitor: true,
                PathInfos: [{ Path: "/data/media/" + folder }],
                PreferredMetadataLanguage:
                  this.plan.spec.language === "Englisch" ? "en" : "de",
                MetadataCountryCode: "AT",
              },
            },
          },
        );
    // Übernommene Medien liegen schon vor dem Anlegen der Bibliotheken im Ordner; die
    // Ordnerüberwachung meldet nur spätere Änderungen. Deshalb einmal vollständig einlesen.
    if (this.plan.adoptedData)
      await this.request("Jellyfin", "/Library/Refresh", { method: "POST", headers });
  }
  async connect() {
    if (this.plan.spec.selected.includes("qBittorrent"))
      for (const name of ["Sonarr", "Radarr", "Lidarr"].filter((n) =>
        this.plan.spec.selected.includes(n),
      )) {
        const nameLabel = "StackPilot qBittorrent";
        const existing = await this.arr(name, "/downloadclient");
        this.vault.ensure(
          `snapshot:${this.plan.id}:${name.toLowerCase()}:downloadclients`,
          () => existing,
        );
        const client = existing.find((c) => c.name === nameLabel);
        if (client && this.plan.vpnTransition) {
          const field = client.fields.find((f) => f.name === "host");
          if (!["qbittorrent", "gluetun"].includes(field?.value))
            throw new Error(
              `${name}: manueller Downloadclient-Host wird nicht überschrieben.`,
            );
          const updated = {
            ...client,
            fields: client.fields.map((f) =>
              f.name === "host" ? { ...f, value: "gluetun" } : f,
            ),
          };
          await this.arr(name, "/downloadclient/test", {
            method: "POST",
            body: updated,
          });
          await this.arr(name, "/downloadclient/" + client.id, {
            method: "PUT",
            body: updated,
          });
        }
        if (!client) {
          const schema = (await this.arr(name, "/downloadclient/schema")).find(
            (s) => s.implementation === "QBittorrent",
          );
          if (!schema)
            throw new Error(`${name}: qBittorrent-Adapter nicht angeboten.`);
          const c = this.credentials("qBittorrent");
          const fields = {
            host: this.plan.spec.vpn ? "gluetun" : "qbittorrent",
            port: 8080,
            useSsl: false,
            urlBase: "",
            username: c.username,
            password: c.password,
            tvCategory: "stackpilot-tv",
            movieCategory: "stackpilot-movies",
            musicCategory: "stackpilot-music",
            recentTvPriority: 0,
            olderTvPriority: 0,
            initialState: 0,
          };
          const body = {
            ...schema,
            id: undefined,
            name: nameLabel,
            enable: true,
            priority: 1,
            removeCompletedDownloads: false,
            removeFailedDownloads: false,
            fields: schema.fields.map((f) => ({
              ...f,
              value: fields[f.name] ?? f.value,
            })),
          };
          await this.arr(name, "/downloadclient/test", {
            method: "POST",
            body,
          });
          await this.arr(name, "/downloadclient", { method: "POST", body });
        }
      }
    if (this.plan.spec.selected.includes("Prowlarr"))
      for (const name of ["Sonarr", "Radarr", "Lidarr"].filter((n) =>
        this.plan.spec.selected.includes(n),
      )) {
        const label = "StackPilot " + name;
        const existing = await this.arr("Prowlarr", "/applications");
        this.vault.ensure(
          `snapshot:${this.plan.id}:prowlarr:applications`,
          () => existing,
        );
        if (!existing.some((a) => a.name === label)) {
          const schema = (
            await this.arr("Prowlarr", "/applications/schema")
          ).find((s) => s.implementation === name);
          if (!schema) throw new Error(`Prowlarr: ${name}-Adapter fehlt.`);
          const values = {
            prowlarrUrl: "http://prowlarr:9696",
            baseUrl: `http://${name === "qBittorrent" && this.plan.spec.vpn ? "gluetun" : catalog.services[name].slug}:${catalog.services[name].port}`,
            apiKey: this.credentials(name).apiKey,
            syncLevel: "fullSync",
          };
          const body = {
            ...schema,
            id: undefined,
            name: label,
            syncLevel: "fullSync",
            fields: schema.fields.map((f) => ({
              ...f,
              value: values[f.name] ?? f.value,
            })),
          };
          await this.arr("Prowlarr", "/applications/test", {
            method: "POST",
            body,
          });
          await this.arr("Prowlarr", "/applications", { method: "POST", body });
        }
      }
    await this.additional.connect();
  }
  async verify() {
    const checks = [];
    for (const name of this.plan.spec.selected) {
      if (additionalNames.includes(name)) await this.additional.verify(name);
      else if (name === "Jellyfin") {
        const credentials = this.credentials("Jellyfin");
        const authHeader =
          'MediaBrowser Client="StackPilot", Device="Server", DeviceId="stackpilot", Version="0.1.0"';
        const login = await this.request(
          "Jellyfin",
          "/Users/AuthenticateByName",
          {
            method: "POST",
            headers: { Authorization: authHeader },
            body: { Username: credentials.username, Pw: credentials.password },
          },
        );
        this.cookies.jellyfin = {
          Authorization: authHeader + `, Token="${login.AccessToken}"`,
        };
        const folders = await this.request(name, "/Library/VirtualFolders", {
          headers: this.cookies.jellyfin,
        });
        if (
          !["movies", "tv", "music"].every((folder) =>
            folders.some((f) => f.Locations?.includes("/data/media/" + folder)),
          )
        )
          throw new Error("Jellyfin: Bibliotheken fehlen.");
      } else if (name === "qBittorrent") {
        const p = await this.qbit("/app/preferences");
        if (p.web_ui_username !== this.plan.spec.username)
          throw new Error("qBittorrent: Benutzername stimmt nicht.");
        if (this.plan.spec.vpn && p.current_network_interface !== "tun0")
          throw new Error(
            "qBittorrent ist nicht an das VPN-Interface gebunden.",
          );
        const categories = await this.qbit("/torrents/categories");
        for (const [category, folder] of [
          ["stackpilot-tv", "tv"],
          ["stackpilot-movies", "movies"],
          ["stackpilot-music", "music"],
        ])
          if (
            categories[category]?.savePath !==
            "/data/downloads/complete/" + folder
          )
            throw new Error(
              "qBittorrent: Downloadkategorie fehlt oder hat einen anderen Pfad.",
            );
      } else {
        const h = await this.arr(name, "/config/host");
        if (
          h.authenticationMethod !== "forms" ||
          h.username !== this.plan.spec.username
        )
          throw new Error(
            `${name}: Authentifizierung ist nicht fertig eingerichtet.`,
          );
        const root = {
          Sonarr: "/data/media/tv",
          Radarr: "/data/media/movies",
          Lidarr: "/data/media/music",
        }[name];
        if (root) {
          const folders = await this.arr(name, "/rootfolder");
          if (!folders.some((f) => f.path === root && f.accessible !== false))
            throw new Error(
              `${name}: Medienordner fehlt oder ist nicht zugänglich.`,
            );
        }
        if (name === "Prowlarr") {
          const apps = await this.arr(name, "/applications");
          for (const target of ["Sonarr", "Radarr", "Lidarr"].filter((n) =>
            this.plan.spec.selected.includes(n),
          )) {
            const app = apps.find((a) => a.name === "StackPilot " + target);
            if (!app)
              throw new Error(`Prowlarr: Verbindung zu ${target} fehlt.`);
            await this.arr(name, "/applications/test", {
              method: "POST",
              body: app,
            });
          }
        }
        if (
          this.plan.spec.selected.includes("qBittorrent") &&
          name !== "Prowlarr"
        ) {
          const clients = await this.arr(name, "/downloadclient");
          const client = clients.find(
            (c) => c.name === "StackPilot qBittorrent",
          );
          if (!client) throw new Error(`${name}: Downloadclient fehlt.`);
          await this.arr(name, "/downloadclient/test", {
            method: "POST",
            body: client,
          });
        }
      }
      checks.push({
        service: name,
        status: "passed",
        scope:
          "API, Konten und konfigurierte Verbindungen; kein Medien-Download",
      });
    }
    return checks;
  }
}
