import { ownFunnel } from "./own-funnel.js";
import { setupError } from "./setup-error.js";
import { createHash } from "node:crypto";
import { secureSsoProfile } from "./sso-profile.js";
import { ssoPluginState, ssoCompatibility } from "./sso-release.js";
const staticConfig = (value) =>
  Object.fromEntries(
    Object.entries(value || {}).filter(([key]) => key !== "CanonicalLinks"),
  );
const hash = (v) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
function pendingMatches(current, expected) {
  if (!expected) return false;
  return (
    Object.entries(expected).every(
      ([k, v]) => JSON.stringify(current[k]) === JSON.stringify(v),
    ) &&
    Object.entries(current).every(
      ([k, v]) =>
        k === "CanonicalLinks" ||
        k in expected ||
        v === null ||
        v === false ||
        v === "" ||
        (Array.isArray(v) && v.length === 0),
    )
  );
}
export class SsoConnection {
  constructor(hub, identity) {
    this.hub = hub;
    this.identity = identity;
  }
  key(r) {
    return "identity-sso:" + r.id;
  }
  async context() {
    const { s, plan } = await this.hub.context(["Jellyfin"]);
    const record = await this.identity.verify();
    if (
      record.status !== "local-ready" ||
      record.rootId !== (plan.rootId || plan.id)
    )
      throw setupError("Authentik zuerst lokal einrichten.");
    const request = (route, options) =>
      this.hub.library.request(s, plan, route, options);
    const [info, plugins, libraries, users] = await Promise.all([
      request("/System/Info"),
      request("/Plugins"),
      request("/Library/VirtualFolders"),
      request("/Users"),
    ]);
    if (!Array.isArray(libraries) || !Array.isArray(users))
      throw setupError("Jellyfin-Zustand unvollständig.");
    const plugin = ssoPluginState(plugins);
    let existing = null,
      otherProviders = false;
    if (plugin.releaseMatches) {
      const [oid, saml] = await Promise.all([
        request("/sso/OID/Get"),
        request("/sso/SAML/Get"),
      ]);
      if (
        !oid ||
        !saml ||
        typeof oid !== "object" ||
        typeof saml !== "object" ||
        Array.isArray(oid) ||
        Array.isArray(saml)
      )
        throw setupError("SSO-Konfiguration unvollständig.");
      existing = oid.stackpilot || null;
      otherProviders =
        Object.keys(oid).some((k) => k !== "stackpilot") ||
        Object.keys(saml).length > 0;
    }
    const live = await this.identity.remote.inspect();
    const privateReady =
      live.tailscaleRunning === true &&
      live.hostname === record.input.hostname &&
      live.jellyfin?.version === info.Version &&
      live.serveKnown === true &&
      live.serve?.exclusive === true &&
      (live.serve.public === false || ownFunnel(this.hub, plan));
    const stored = this.hub.engine.vault.get(this.key(record));
    const snapshot = hash([
      plan.id,
      record.id,
      info.Version,
      plugin,
      libraries,
      existing,
      otherProviders,
      users.map((u) => [u.Id, u.Name, u.Policy?.IsAdministrator]),
    ]);
    return {
      record,
      plan,
      request,
      version: info.Version,
      plugin,
      libraries,
      existing,
      otherProviders,
      stored,
      snapshot,
      users,
      privateReady,
    };
  }
  project(c) {
    const blockers = [];
    const pending =
      c.stored?.status === "applying" &&
      c.existing &&
      pendingMatches(c.existing, c.stored.expected);
    if (!c.privateReady)
      blockers.push(
        "Private Tailscale-Ausgangslage, Serveradresse und Jellyfin-Version zuerst aktuell prüfen. Vorhandene öffentliche oder abweichende Freigaben nicht ungeprüft umstellen.",
      );
    if (!ssoCompatibility(c.version).loginVerified)
      blockers.push(
        "Vollständiger SSO-Profiltest für diese Jellyfin-Version fehlt.",
      );
    if (!c.plugin.releaseMatches)
      blockers.push(
        "SSO-Auth " +
          "4.0.0.4" +
          " muss zuerst in Jellyfin installiert und aktiv sein. Dieser Schritt installiert kein Plugin.",
      );
    if (c.otherProviders)
      blockers.push(
        "Weitere SSO-Anbieter müssen zuerst gesondert geprüft werden; sie werden nicht überschrieben.",
      );
    if (
      c.existing &&
      !pending &&
      (!c.stored ||
        c.stored.status !== "configured" ||
        hash(staticConfig(c.existing)) !== c.stored.configurationHash)
    )
      blockers.push(
        "Vorhandene oder manuell geänderte StackPilot-SSO-Konfiguration benötigt eine eigene Übernahme. Keine automatische Überschreibung.",
      );
    if (
      c.existing &&
      Object.entries(c.existing.CanonicalLinks || {}).some(([name, id]) => {
        const user = c.users.find(
          (u) =>
            String(u.Id).replaceAll("-", "").toLowerCase() ===
            String(id).replaceAll("-", "").toLowerCase(),
        );
        return (
          !user ||
          !name.startsWith("spv_") ||
          user.Name !== name ||
          user.Policy?.IsAdministrator !== false ||
          user.Policy?.AuthenticationProviderId !==
            "Jellyfin.Server.Implementations.Users.InvalidAuthProvider"
        );
      })
    )
      blockers.push(
        "SSO-Kontoverknüpfungen oder Passwortanbieter sind nicht sicher bestätigt. Keine automatische Übernahme.",
      );
    if (
      !c.existing &&
      c.users.some((u) => String(u.Name || "").startsWith("spv_"))
    )
      blockers.push(
        "Vorhandene Konten mit dem reservierten Präfix spv_ zuerst prüfen; keine automatische Verknüpfung.",
      );
    return {
      checkedAt: new Date().toISOString(),
      review: c.snapshot,
      canApply: blockers.length === 0 && (!c.existing || pending),
      resuming: !!pending,
      selectedLibraryIds: pending ? c.stored.expected.EnabledFolders : [],
      configured: !!c.existing && blockers.length === 0 && !pending,
      plugin: c.plugin,
      version: c.version,
      libraries: c.libraries.map((l) => ({
        id: l.ItemId,
        name: String(l.Name || "Bibliothek").slice(0, 160),
      })),
      blockers,
      hostname: c.record.input.hostname,
      clientId: "stackpilot-jellyfin",
      viewerGroup: "stackpilot-viewers",
      passwordLogin: "gesperrter Jellyfin-Anbieter",
      publicReady: false,
      message:
        "Private Konfiguration. Keine Serve-/Funnel-Änderung und keine öffentliche Freigabe. Zuschauer benötigen eine eigene Authentik-Anmeldung mit MFA; der Administrator bleibt getrennt.",
    };
  }
  async plan() {
    return this.project(await this.context());
  }
  async apply(body) {
    if (body.confirmation !== "OK")
      throw setupError("Private SSO-Verbindung mit OK bestätigen.");
    return this.hub.mutate(["Jellyfin"], async () => {
      const c = await this.context(),
        p = this.project(c);
      if (body.review !== c.snapshot)
        throw setupError("Konfiguration wurde geändert. Vorschau neu prüfen.");
      if (!p.canApply)
        throw setupError(
          p.blockers.join(" ") || "SSO-Verbindung ist bereits eingerichtet.",
        );
      const selected = body.libraryIds;
      if (
        !Array.isArray(selected) ||
        selected.length === 0 ||
        selected.some((id) => !c.libraries.some((l) => l.ItemId === id))
      )
        throw setupError(
          "Mindestens eine vorhandene Bibliothek gezielt auswählen.",
        );
      const secret = this.hub.engine.vault.get(
        "identity-secrets:" + c.record.id,
      )?.oidc_secret;
      const profile = secureSsoProfile(c.record.input, secret, selected);
      if (c.existing) {
        if (!pendingMatches(c.existing, profile))
          throw setupError(
            "Auswahl weicht vom unterbrochenen Vorgang ab. Erneut prüfen.",
          );
      } else {
        this.hub.engine.vault.set(this.key(c.record), {
          status: "applying",
          at: new Date().toISOString(),
          previous: null,
          planId: c.plan.id,
          expected: profile,
        });
        await c.request("/sso/OID/Add/stackpilot", {
          method: "POST",
          body: profile,
        });
      }
      const after = await c.request("/sso/OID/Get");
      if (
        !after?.stackpilot ||
        Object.entries(profile).some(
          ([k, v]) => JSON.stringify(after.stackpilot[k]) !== JSON.stringify(v),
        )
      )
        throw setupError(
          "SSO-Konfiguration wurde nicht vollständig bestätigt. Keine öffentliche Freigabe.",
        );
      this.hub.engine.vault.set(this.key(c.record), {
        status: "configured",
        at: new Date().toISOString(),
        configurationHash: hash(staticConfig(after.stackpilot)),
        planId: c.plan.id,
      });
      return {
        ok: true,
        publicReady: false,
        message:
          "Jellyfin und Authentik sind privat konfiguriert. HTTPS-Verbindungen, getrennte Zuschauerkonten und das Schutz-Gateway müssen vor externer Freigabe geprüft werden.",
      };
    });
  }
}
