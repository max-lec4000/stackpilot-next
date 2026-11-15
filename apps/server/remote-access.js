import { tailnetAddresses } from "../../packages/domain/tailnet-access.js";
import { ssoPluginState } from "./identity/sso-release.js";
import { command } from "./inventory.js";
function configChecks(config, target, depth = 0) {
  const protectedRoutes = typeof target === "object" && target !== null;
  if (config == null) return { exclusive: true, routes: 0, public: false };
  if (typeof config !== "object" || Array.isArray(config) || depth > 3)
    return { exclusive: false, routes: 0, public: false };
  let exclusive = true,
    routes = 0,
    publicAccess = false;
  const known = ["TCP", "Web", "AllowFunnel", "Foreground", "Services", "ETag"];
  for (const key of ["TCP", "Web", "AllowFunnel", "Foreground", "Services"])
    if (
      config[key] != null &&
      (typeof config[key] !== "object" || Array.isArray(config[key]))
    )
      exclusive = false;
  if (Object.keys(config).some((k) => !known.includes(k))) exclusive = false;
  if (Object.keys(config.Services || {}).length) exclusive = false;
  for (const [port, value] of Object.entries(config.TCP || {}))
    if (
      !["443", ...(protectedRoutes ? ["8443"] : [])].includes(port) ||
      value?.HTTPS !== true ||
      value?.HTTP === true ||
      (value && Object.keys(value).some((key) => key !== "HTTPS")) ||
      value.TCPForward ||
      value.TerminateTLS
    )
      exclusive = false;
  for (const [host, value] of Object.entries(config.Web || {})) {
    const expected = protectedRoutes ? target[host] : target;
    if (
      protectedRoutes
        ? !Object.hasOwn(target, host)
        : !/^[a-z0-9.-]+\.ts\.net:443$/i.test(host)
    )
      exclusive = false;
    const handlers = value?.Handlers;
    if (
      !handlers ||
      typeof handlers !== "object" ||
      Array.isArray(handlers) ||
      Object.keys(value).some((key) => key !== "Handlers")
    ) {
      exclusive = false;
      continue;
    }
    for (const [path, handler] of Object.entries(handlers)) {
      routes++;
      if (
        path !== "/" ||
        !(Array.isArray(expected)
          ? expected.includes(handler?.Proxy)
          : handler?.Proxy === expected) ||
        handler?.Path ||
        handler?.Text ||
        !handler ||
        typeof handler !== "object" ||
        Array.isArray(handler) ||
        Object.keys(handler).some((key) => key !== "Proxy")
      )
        exclusive = false;
    }
  }
  for (const [host, enabled] of Object.entries(config.AllowFunnel || {}))
    if (enabled) {
      publicAccess = true;
      if (!config.Web?.[host]) exclusive = false;
    }
  for (const value of Object.values(config.Foreground || {})) {
    const nested = configChecks(value, target, depth + 1);
    exclusive &&= nested.exclusive;
    routes += nested.routes;
    publicAccess ||= nested.public;
  }
  return { exclusive, routes, public: publicAccess };
}
export { configChecks as checkServeConfig };
export class RemoteAccess {
  constructor(hub, run = command) {
    this.hub = hub;
    this.run = run;
  }
  async inspect() {
    const currentPlan = this.hub.engine?.current()?.plan;
    const protection =
      currentPlan &&
      this.hub.engine.vault.get(
        "jellyfin-protection:" + (currentPlan.rootId || currentPlan.id),
      );
    const identity =
      currentPlan &&
      this.hub.engine.vault.get(
        "identity-preparation:" + (currentPlan.rootId || currentPlan.id),
      );
    const checks = [],
      add = (name, state, message) => checks.push({ name, state, message });
    let target = null,
      jellyfin = null;
    try {
      const { s, plan } = await this.hub.context(["Jellyfin"]);
      const port = plan.ports.Jellyfin;
      if (!Number.isInteger(port) || port < 1 || port > 65535)
        throw Error("port");
      target = `http://127.0.0.1:${port}`;
      const [info, network, quick, users, plugins] = await Promise.all([
        this.hub.library.request(s, plan, "/System/Info"),
        this.hub.library.request(s, plan, "/System/Configuration/network"),
        this.hub.library.request(s, plan, "/QuickConnect/Enabled"),
        this.hub.library.request(s, plan, "/Users"),
        this.hub.library.request(s, plan, "/Plugins"),
      ]);
      if (!Array.isArray(users) || !Array.isArray(plugins))
        throw Error("shape");
      const administrators = users.filter(
          (u) => u.Policy?.IsAdministrator && !u.Policy?.IsDisabled,
        ),
        remoteAdmins = administrators.filter(
          (u) => u.Policy?.EnableRemoteAccess !== false,
        ).length;
      jellyfin = {
        version: typeof info?.Version === "string" ? info.Version : null,
        quickConnect: quick === true,
        ssoDetected: ssoPluginState(plugins).active,
        ssoVersion: ssoPluginState(plugins).version,
        ssoReleaseMatches: ssoPluginState(plugins).releaseMatches,
        remoteAccess: network?.EnableRemoteAccess === true,
        remoteAdmins,
        viewers: users.filter(
          (u) => u.Policy?.IsAdministrator === false && !u.Policy?.IsDisabled,
        ).length,
      };
      add(
        "Jellyfin-Ziel",
        "ok",
        "Verwaltetes Jellyfin über den geprüften lokalen Webport erreichbar.",
      );
      add(
        "Jellyfin-Fernzugriff",
        jellyfin.remoteAccess ? "ok" : "todo",
        jellyfin.remoteAccess
          ? "Fernzugriff ist in Jellyfin aktiviert."
          : "Jellyfin-Fernzugriff ist noch deaktiviert. Vor der Freigabe gezielt konfigurieren.",
      );
      add(
        "Administratorzugriff",
        remoteAdmins ? "blocked" : "ok",
        remoteAdmins
          ? "Mindestens ein aktives Administratorkonto erlaubt Fernzugriff oder konnte nicht als lokal beschränkt bestätigt werden. Administratorkonten vor Funnel lokal beschränken."
          : "Aktive Administratorkonten sind in ihrer Jellyfin-Richtlinie auf lokalen Zugriff beschränkt.",
      );
      add(
        "Zuschauerkonten",
        jellyfin.viewers ? "ok" : "todo",
        jellyfin.viewers
          ? "Separate Zuschauer ohne Administratorrechte vorhanden."
          : "Separate Zuschauerkonten ohne Administratorrechte fehlen noch.",
      );
      add(
        "Quick Connect",
        jellyfin.quickConnect ? "ok" : "todo",
        jellyfin.quickConnect
          ? "Geräteanmeldung ist aktiviert. Der Code wird in einer bereits authentifizierten Sitzung bestätigt; das ist allein keine MFA."
          : "Quick Connect ist noch nicht aktiviert oder nicht bestätigt. Gerätecodes ersetzen allein keine MFA.",
      );
      add(
        "SSO/MFA",
        "todo",
        jellyfin.ssoDetected
          ? "SSO-Plugin erkannt. MFA, Passwort-Umgehung und Client-Unterstützung müssen weiterhin tatsächlich geprüft werden."
          : "Noch keine bestätigte SSO/MFA-Integration. Vorgesehen: MFA im Identitätsanbieter, Browser-SSO und Gerätefreigabe über Quick Connect, soweit vom Client unterstützt.",
      );
    } catch {
      target = null;
      add(
        "Jellyfin-Ziel",
        "unknown",
        "Jellyfin-Konfiguration oder Containerzuordnung konnte nicht vollständig geprüft werden. Keine Freigabevorlage erzeugt.",
      );
    }
    const [statusResult, serveResult, prefsResult] = await Promise.all([
      this.run("tailscale", ["status", "--json"]),
      this.run("tailscale", ["serve", "status", "--json"]),
      this.run("tailscale", ["debug", "prefs"]),
    ]);
    let tailscaleRunning = false,
      serveKnown = false,
      serve = { exclusive: false, routes: 0, public: false },
      hostname = null,
      serverAddresses = [],
      incomingAllowed = null;
    try {
      if (!statusResult.ok) throw Error();
      const status = JSON.parse(statusResult.output);
      tailscaleRunning =
        status.BackendState === "Running" && status.Self?.Online === true;
      serverAddresses = tailnetAddresses(status.Self?.TailscaleIPs || []);
      const dns = status.Self?.DNSName?.replace(/\.$/, "");
      if (typeof dns === "string" && /^[a-z0-9.-]+\.ts\.net$/i.test(dns))
        hostname = dns;
    } catch {}
    add(
      "Tailscale",
      tailscaleRunning ? "ok" : "unknown",
      tailscaleRunning
        ? "Tailscale meldet diesen Server als online."
        : "Tailscale ist nicht installiert, nicht verbunden oder für den StackPilot-Prozess nicht lesbar.",
    );
    try {
      if (prefsResult.ok) {
        const prefs = JSON.parse(prefsResult.output);
        if (typeof prefs.ShieldsUp === "boolean")
          incomingAllowed = !prefs.ShieldsUp;
      }
    } catch {}
    add(
      "Tailscale-Verbindungsannahme",
      incomingAllowed === true
        ? "ok"
        : incomingAllowed === false
          ? "blocked"
          : "unknown",
      incomingAllowed === false
        ? "Der Server blockiert eingehende Tailscale-Verbindungen. Die lokale HTTPS-Prüfung bestätigt keinen Zugriff deiner Geräte."
        : incomingAllowed === true
          ? "Eingehende Verbindungen werden am Gerät nicht pauschal blockiert. Die Tailnet-Zugriffsregeln müssen die gewählten Quellen und TCP 443/8443 zusätzlich erlauben."
          : "Die Einstellung für eingehende Verbindungen ist nicht lesbar. Gerätezugriff gesondert prüfen; keine automatische Rechteausweitung.",
    );
    try {
      if (!serveResult.ok || !target) throw Error();
      const routeTargets =
        protection?.id &&
        identity?.input?.hostname === hostname &&
        protection.hostname === hostname
          ? {
              [`${hostname}:443`]: [target, "http://127.0.0.1:19096"],
              [`${hostname}:8443`]: `http://127.0.0.1:${identity.input.gatewayPort}`,
            }
          : target;
      serve = configChecks(JSON.parse(serveResult.output), routeTargets);
      serveKnown = true;
    } catch {}
    add(
      "Nur Jellyfin",
      serveKnown && serve.exclusive ? "ok" : serveKnown ? "blocked" : "unknown",
      serveKnown && serve.exclusive
        ? serve.routes
          ? "Serve-Webrouten entsprechen den vorgesehenen privaten Zielen für Jellyfin und gegebenenfalls Authentik."
          : "Es sind noch keine Serve-Webrouten eingerichtet."
        : "Vorhandene Serve-Routen sind nicht ausschließlich Jellyfin zugeordnet oder konnten nicht vollständig geprüft werden. Bestehende Freigaben gezielt prüfen; kein pauschales Zurücksetzen.",
    );
    add(
      "Öffentlicher Zugriff",
      serve.public ? "blocked" : "todo",
      serve.public
        ? "Funnel ist bereits aktiviert. Eine MFA-Absicherung wurde durch diese Prüfung nicht nachgewiesen."
        : "Funnel ist noch nicht als aktive öffentliche Freigabe bestätigt. Die Vorbereitung aktiviert ihn nicht.",
    );
    add(
      "MFA-Abnahme",
      "todo",
      "Vor öffentlichem Zugriff: Browser mit MFA, native Clients mit Gerätefreigabe, Ablehnung direkter Passwort-Anmeldung, lokale Administratoren und Widerruf verlorener Gerätesitzungen prüfen. Nicht alle Jellyfin-Clients unterstützen Quick Connect.",
    );
    return {
      checkedAt: new Date().toISOString(),
      target,
      hostname,
      serverAddresses,
      incomingAllowed,
      jellyfin,
      tailscaleRunning,
      serveKnown,
      serve,
      publicReady: false,
      checks,
      privateCommand: null,
    };
  }
}
