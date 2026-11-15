export const additionalNames = ["Bazarr", "Seerr", "Streamystats"];
const jfHeader = (device) =>
  `MediaBrowser Client="StackPilot", Device="${device}", DeviceId="stackpilot-${device}", Version="0.1.0"`;
export class AdditionalServices {
  constructor(services) {
    this.s = services;
  }
  async jellyfinLogin(device) {
    const c = this.s.credentials("Jellyfin");
    return this.s.request("Jellyfin", "/Users/AuthenticateByName", {
      method: "POST",
      headers: { Authorization: jfHeader(device) },
      body: { Username: c.username, Pw: c.password },
    });
  }
  bazarr(route, options = {}) {
    return this.s.request("Bazarr", "/api" + route, {
      ...options,
      headers: {
        "X-API-KEY": this.s.credentials("Bazarr").apiKey,
        ...options.headers,
      },
    });
  }
  async seerrLogin() {
    if (this.s.cookies.seerr) return;
    const settings = await this.s.request("Seerr", "/api/v1/settings/public");
    const c = this.s.credentials("Jellyfin");
    const response = await this.s.request("Seerr", "/api/v1/auth/jellyfin", {
      method: "POST",
      raw: true,
      body: {
        username: c.username,
        password: c.password,
        ...(!settings.mediaServerType || settings.mediaServerType === 4
          ? {
              hostname: "jellyfin",
              port: 8096,
              useSsl: false,
              urlBase: "",
              serverType: 2,
            }
          : {}),
      },
    });
    const cookie = response.headers
      .get("set-cookie")
      ?.match(/(?:^|,\s*)(connect\.sid|seerr\.sid|jellyseerr\.sid)=([^;]+)/);
    if (!cookie) throw new Error("Seerr: Anmeldung liefert keine Sitzung.");
    this.s.cookies.seerr = cookie[1] + "=" + cookie[2];
  }
  async seerr(route, options = {}) {
    await this.seerrLogin();
    const send = () =>
      this.s.request("Seerr", "/api/v1" + route, {
        ...options,
        headers: { Cookie: this.s.cookies.seerr, ...options.headers },
      });
    try {
      return await send();
    } catch (error) {
      if (!/HTTP 401/.test(error.message)) throw error;
      delete this.s.cookies.seerr;
      await this.seerrLogin();
      return send();
    }
  }
  async configure(name) {
    if (name === "Bazarr") {
      const c = this.s.credentials(name);
      await this.s.request(name, "/api/system/account", {
        method: "POST",
        body: new URLSearchParams({
          action: "login",
          username: c.username,
          password: c.password,
        }),
      });
    } else if (name === "Seerr") await this.seerrLogin();
    // Streamystats is initialized in connect(), after all partners are ready.
  }
  async connectBazarr() {
    const current = await this.bazarr("/system/settings");
    const values = {};
    for (const name of ["Sonarr", "Radarr"].filter((n) =>
      this.s.plan.spec.selected.includes(n),
    )) {
      const section = name.toLowerCase(),
        before = current[section] || {};
      const enabled = current.general?.["use_" + section];
      if (enabled) {
        if (
          before.ip !== section ||
          before.apikey !== this.s.credentials(name).apiKey
        )
          throw new Error(
            `Bazarr: vorhandene ${name}-Verbindung wird nicht überschrieben.`,
          );
        continue;
      }
      Object.assign(values, {
        [`settings-general-use_${section}`]: "true",
        [`settings-${section}-ip`]: section,
        [`settings-${section}-port`]: String(name === "Sonarr" ? 8989 : 7878),
        [`settings-${section}-base_url`]: "/",
        [`settings-${section}-ssl`]: "false",
        [`settings-${section}-apikey`]: this.s.credentials(name).apiKey,
      });
    }
    if (Object.keys(values).length) {
      this.s.vault.ensure(
        `snapshot:${this.s.plan.id}:bazarr:settings`,
        () => current,
      );
      await this.bazarr("/system/settings", {
        method: "POST",
        body: new URLSearchParams(values),
      });
    }
  }
  async connectSeerr() {
    await this.seerrLogin();
    if (!this.s.plan.existing?.includes("Seerr")) {
      await this.seerr("/settings/jellyfin/library/sync", { method: "POST" });
      const libraries = await this.seerr("/settings/jellyfin/library");
      for (const lib of libraries.filter((l) => !l.enabled))
        await this.seerr("/settings/jellyfin/library/" + lib.id, {
          method: "PUT",
          body: { enabled: true },
        });
    }
    for (const name of ["Sonarr", "Radarr"].filter((n) =>
      this.s.plan.spec.selected.includes(n),
    )) {
      const route = "/settings/" + name.toLowerCase();
      const before = await this.seerr(route);
      this.s.vault.ensure(
        `snapshot:${this.s.plan.id}:seerr:${name.toLowerCase()}`,
        () => before,
      );
      if (before.some((c) => c.name === "StackPilot " + name)) continue;
      const profiles = await this.s.arr(name, "/qualityprofile");
      const profile =
        profiles.find((p) => /1080p/i.test(p.name)) || profiles[0];
      if (!profile) throw new Error(`Seerr: ${name}-Qualitätsprofil fehlt.`);
      const body = {
        name: "StackPilot " + name,
        hostname: name.toLowerCase(),
        port: name === "Sonarr" ? 8989 : 7878,
        apiKey: this.s.credentials(name).apiKey,
        useSsl: false,
        baseUrl: "",
        activeProfileId: profile.id,
        activeProfileName: profile.name,
        activeDirectory: "/data/media/" + (name === "Sonarr" ? "tv" : "movies"),
        tags: [],
        is4k: false,
        isDefault: before.length === 0,
        syncEnabled: false,
        preventSearch: false,
        tagRequests: false,
        minimumAvailability: "released",
        seriesType: "standard",
        animeSeriesType: "standard",
        enableSeasonFolders: true,
        monitorNewItems: "all",
        overrideRule: [],
      };
      await this.seerr(route + "/test", { method: "POST", body });
      await this.seerr(route, { method: "POST", body });
    }
    await this.seerr("/settings/initialize", { method: "POST" });
  }
  async connectStreamystats() {
    const servers = await this.s.request("Streamystats", "/api/servers");
    if (
      servers.some(
        (server) =>
          server.url === "http://jellyfin:8096" ||
          server.internalUrl === "http://jellyfin:8096",
      )
    )
      return;
    if (servers.length)
      throw new Error(
        "Streamystats: vorhandene Serverkonfiguration wird nicht übernommen.",
      );
    const key = `deployment:${this.s.plan.rootId || this.s.plan.id}:streamystats-jellyfin`;
    let token = this.s.vault.get(key);
    if (!token) {
      const login = await this.jellyfinLogin("streamystats-background");
      token = { accessToken: login.AccessToken, userId: login.User.Id };
      this.s.vault.set(key, token);
    }
    const created = await this.s.request("Streamystats", "/api/servers", {
      method: "POST",
      body: {
        name: "StackPilot Jellyfin",
        url: "http://jellyfin:8096",
        apiKey: token.accessToken,
        autoGenerateEmbeddings: false,
      },
    });
    if (!created?.success)
      throw new Error(
        "Streamystats: Jellyfin-Verbindung konnte nicht angelegt werden.",
      );
  }
  async connect() {
    if (this.s.plan.spec.selected.includes("Bazarr"))
      await this.connectBazarr();
    if (this.s.plan.spec.selected.includes("Seerr")) await this.connectSeerr();
    if (this.s.plan.spec.selected.includes("Streamystats"))
      await this.connectStreamystats();
  }
  async verify(name) {
    if (name === "Bazarr") {
      await this.configure(name);
      const config = await this.bazarr("/system/settings");
      for (const target of ["Sonarr", "Radarr"].filter((n) =>
        this.s.plan.spec.selected.includes(n),
      )) {
        const slug = target.toLowerCase();
        if (
          !config.general["use_" + slug] ||
          config[slug].ip !== slug ||
          config[slug].apikey !== this.s.credentials(target).apiKey
        )
          throw new Error(
            `Bazarr: ${target}-Verbindung fehlt oder wurde verändert.`,
          );
      }
      const status = await this.bazarr("/system/status");
      for (const slug of ["sonarr", "radarr"].filter((n) =>
        this.s.plan.spec.selected.some((s) => s.toLowerCase() === n),
      ))
        if (!status.data?.[slug + "_version"])
          throw new Error(`Bazarr: ${slug} meldet keine erreichbare Version.`);
    } else if (name === "Seerr") {
      const user = await this.seerr("/auth/me");
      if (user.jellyfinUsername !== this.s.plan.spec.username)
        throw new Error("Seerr: Jellyfin-Anmeldung stimmt nicht.");
      const settings = await this.s.request(name, "/api/v1/settings/public");
      if (!settings.initialized)
        throw new Error("Seerr: Einrichtung noch nicht abgeschlossen.");
      for (const target of ["Sonarr", "Radarr"].filter((n) =>
        this.s.plan.spec.selected.includes(n),
      )) {
        const route = "/settings/" + target.toLowerCase();
        const clients = await this.seerr(route);
        const client = clients.find((c) => c.name === "StackPilot " + target);
        if (!client) throw new Error(`Seerr: ${target}-Verbindung fehlt.`);
        await this.seerr(route + "/test", { method: "POST", body: client });
      }
    } else {
      await this.s.request(name, "/api/health");
      const servers = await this.s.request(name, "/api/servers");
      const server = servers.find(
        (v) =>
          v.url === "http://jellyfin:8096" ||
          v.internalUrl === "http://jellyfin:8096",
      );
      if (!server) throw new Error("Streamystats: Jellyfin-Verbindung fehlt.");
      const background = this.s.vault.get(
        `deployment:${this.s.plan.rootId || this.s.plan.id}:streamystats-jellyfin`,
      );
      if (!background?.accessToken)
        throw new Error("Streamystats: technischer Jellyfin-Zugang fehlt.");
      const technical = await this.s.request("Jellyfin", "/Users/Me", {
        headers: {
          Authorization:
            jfHeader("streamystats-background") +
            `, Token="${background.accessToken}"`,
        },
      });
      if (
        technical.Id !== background.userId ||
        technical.Policy?.IsAdministrator !== true
      )
        throw new Error(
          "Streamystats: technischer Jellyfin-Zugang ist nicht gültig.",
        );
      const login = await this.jellyfinLogin("streamystats-check");
      const response = await this.s.request(
        name,
        `/api/watchlists?serverId=${server.id}`,
        {
          headers: {
            Authorization:
              jfHeader("streamystats-check") + `, Token="${login.AccessToken}"`,
          },
        },
      );
      if (!response || typeof response !== "object")
        throw new Error("Streamystats: geschützte API-Prüfung fehlgeschlagen.");
    }
  }
}
