import { createHash } from "node:crypto";
import { releases } from "./identity/config.js";
const digest = (v) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const clean = (v) =>
  String(v || "")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .slice(0, 160);
export class RemoteSecurity {
  constructor(hub, remote, identity, backups, protection) {
    Object.assign(this, { hub, remote, identity, backups, protection });
  }
  async snapshot() {
    const { s, plan } = await this.hub.context(["Jellyfin"]);
    const users = await this.hub.library.request(s, plan, "/Users");
    if (!Array.isArray(users) || users.length > 1000)
      throw Error("Jellyfin-Konten nicht eindeutig bestätigt.");
    return { s, plan, users };
  }
  async admins() {
    const { plan, users } = await this.snapshot();
    const targets = users.filter(
      (u) =>
        u.Policy?.IsAdministrator &&
        !u.Policy?.IsDisabled &&
        u.Policy?.EnableRemoteAccess !== false,
    );
    return {
      planId: plan.id,
      review: digest([plan.id, targets.map((u) => [u.Id, u.Policy])]),
      accounts: targets.map((u) => ({ id: u.Id, name: clean(u.Name) })),
      message:
        "Nur Fernzugriff aktiver Jellyfin-Administratoren deaktivieren. Andere Rechte und bestehende Passwörter bleiben erhalten. Das ersetzt noch keinen externen Proxy-Test.",
    };
  }
  async protectAdmins(body) {
    if (body.confirmation !== "OK")
      throw Error("Administrator-Schutz mit OK bestätigen.");
    return this.hub.mutate(["Jellyfin"], async () => {
      const { s, plan, users } = await this.snapshot();
      const targets = users.filter(
        (u) =>
          u.Policy?.IsAdministrator &&
          !u.Policy?.IsDisabled &&
          u.Policy?.EnableRemoteAccess !== false,
      );
      if (
        body.review !== digest([plan.id, targets.map((u) => [u.Id, u.Policy])])
      )
        throw Error(
          "Konten oder Rechte wurden geändert. Vorschau erneut prüfen.",
        );
      const previous = targets.map((u) => ({ id: u.Id, policy: u.Policy }));
      this.hub.engine.vault.set(
        "remote-admin-policy:" + (plan.rootId || plan.id),
        { at: new Date().toISOString(), planId: plan.id, previous },
      );
      for (const u of targets) {
        if (!/^[a-f0-9-]{32,36}$/i.test(u.Id))
          throw Error("Ungültige Jellyfin-Konto-ID.");
        await this.hub.library.request(s, plan, "/Users/" + u.Id + "/Policy", {
          method: "POST",
          body: { ...u.Policy, EnableRemoteAccess: false },
        });
      }
      const after = await this.snapshot();
      if (
        after.users.some(
          (u) =>
            u.Policy?.IsAdministrator &&
            !u.Policy?.IsDisabled &&
            u.Policy?.EnableRemoteAccess !== false,
        )
      )
        throw Error(
          "Administrator-Schutz nicht vollständig bestätigt. Bereits bestätigte Konten bleiben lokal beschränkt.",
        );
      return {
        ok: true,
        changed: targets.length,
        message:
          "Aktive Administratorkonten sind in Jellyfin lokal beschränkt. Proxy-Vertrauen und externer Anmeldeversuch bleiben gesondert zu prüfen.",
      };
    });
  }
  async devicesInternal() {
    const { s, plan, users } = await this.snapshot();
    const devices = new Map();
    const owners = new Map(
      users.map((u) => [u.Id.replaceAll("-", "").toLowerCase(), u]),
    );
    // /Devices?userId lists accessible devices, not device ownership in Jellyfin.
    // Read the administrator's complete list and use LastUserId for each token record.
    const response = await this.hub.library.request(s, plan, "/Devices");
    if (
      !Array.isArray(response?.Items) ||
      response.Items.length > 2000 ||
      (Number.isInteger(response.TotalRecordCount) &&
        response.TotalRecordCount !== response.Items.length)
    )
      throw Error("Geräte konnten nicht vollständig geprüft werden.");
    for (const d of response.Items) {
      if (typeof d.Id !== "string" || !d.Id || d.Id.length > 512)
        throw Error("Gerät nicht eindeutig.");
      const user = owners.get(
        String(d.LastUserId || "")
          .replaceAll("-", "")
          .toLowerCase(),
      );
      let item = devices.get(d.Id);
      if (!item) {
        item = {
          raw: d.Id,
          id: digest([plan.id, d.Id]),
          name: clean(d.Name) || "Jellyfin-Gerät",
          app: clean(d.AppName),
          version: clean(d.AppVersion),
          lastSeen:
            typeof d.DateLastActivity === "string" ? d.DateLastActivity : null,
          users: [],
          protected: false,
        };
        devices.set(d.Id, item);
      }
      if (user && !item.users.includes(clean(user.Name)))
        item.users.push(clean(user.Name));
      item.protected ||= !user || user.Policy?.IsAdministrator !== false;
    }
    return { s, plan, devices: [...devices.values()] };
  }
  async devices() {
    const { devices } = await this.devicesInternal();
    return {
      checkedAt: new Date().toISOString(),
      devices: devices.map(({ raw, ...item }) => item),
      message:
        "Gerätewiderruf meldet alle Konten auf diesem Jellyfin-Gerät ab. Administrations- und technische Zugänge werden hier nicht widerrufen. Authentik-Sitzungen sind getrennt.",
    };
  }
  async revoke(body) {
    if (body.confirmation !== "OK")
      throw Error("Gerätewiderruf mit OK bestätigen.");
    if (!/^[a-f0-9]{64}$/.test(body.id || ""))
      throw Error("Ungültige Geräteauswahl.");
    return this.hub.mutate(["Jellyfin"], async () => {
      const { s, plan, devices } = await this.devicesInternal(),
        device = devices.find((d) => d.id === body.id);
      if (!device) throw Error("Gerät ist nicht mehr vorhanden.");
      if (device.protected)
        throw Error(
          "Gerät verwendet ein Administratorkonto und bleibt geschützt.",
        );
      await this.hub.library.request(
        s,
        plan,
        "/Devices?id=" + encodeURIComponent(device.raw),
        { method: "DELETE" },
      );
      const after = await this.devicesInternal();
      if (after.devices.some((d) => d.id === body.id))
        throw Error(
          "Widerruf wurde noch nicht bestätigt. Geräteliste erneut prüfen.",
        );
      return {
        ok: true,
        message:
          "Jellyfin-Gerät abgemeldet. Bei Verlust auch Authentik-Sitzungen widerrufen und gegebenenfalls den zweiten Faktor ersetzen.",
      };
    });
  }
  async funnelPlan() {
    const report = await this.remote.inspect();
    const identity = this.identity.current();
    const blockers = [];
    if (
      !report.target ||
      !report.hostname ||
      !report.tailscaleRunning ||
      !report.serveKnown ||
      !report.serve.exclusive ||
      report.serve.public
    )
      blockers.push(
        "Tailscale-Ausgangslage und ausschließlich lokale Jellyfin-Verbindung prüfen.",
      );
    if (identity && identity.input.hostname !== report.hostname)
      blockers.push(
        "Tailscale-Geräteadresse und vorbereiteter Identitätsdienst stimmen nicht überein.",
      );
    if (report.jellyfin?.remoteAccess !== true)
      blockers.push(
        "Jellyfin-Fernzugriff ist noch deaktiviert; erst nach erfolgreicher SSO- und Proxy-Abnahme gezielt aktivieren.",
      );
    if (report.jellyfin?.quickConnect !== true)
      blockers.push("Quick Connect ist noch nicht als aktiviert bestätigt.");
    if (report.jellyfin?.ssoReleaseMatches !== true)
      blockers.push(
        "Installiertes SSO-Plugin stimmt nicht mit dem geprüften Release überein oder ist nicht aktiv.",
      );
    if (report.jellyfin?.ssoDetected !== true)
      blockers.push(
        "SSO-Plugin ist noch nicht im verwalteten Jellyfin bestätigt.",
      );
    if (!identity || identity.status !== "local-ready")
      blockers.push("Authentik zuerst lokal fertig einrichten.");
    if (
      !releases.ssoPlugin.testedJellyfinVersions.includes(
        report.jellyfin?.version,
      )
    )
      blockers.push(
        "SSO-Plugin für die eingesetzte Jellyfin-Version nicht durch vollständige Anmeldung bestätigt.",
      );
    if (report.jellyfin?.remoteAdmins !== 0)
      blockers.push("Jellyfin-Administratoren lokal beschränken.");
    if (!report.jellyfin?.viewers) blockers.push("Separate Zuschauer fehlen.");
    let checks = [];
    if (identity?.status === "local-ready") {
      try {
        checks = (await this.identity.inspectSecurity()).checks;
        for (const c of checks.filter((c) => c.state !== "ok"))
          blockers.push(c.name + ": " + c.message);
      } catch {
        blockers.push(
          "Aktueller Authentik-Sicherheitsstand konnte nicht bestätigt werden.",
        );
      }
      if (!this.backups.list().some((b) => b.restore?.status === "passed"))
        blockers.push(
          "Verschlüsselte Sicherung mit bestandenem isoliertem Wiederherstellungstest fehlt.",
        );
    }
    const protection = await this.protection?.status();
    if (!protection?.verified)
      blockers.push(
        "Für öffentlichen Zugriff fehlt noch ein bereitgestelltes und geprüftes Jellyfin-Gateway, das Passwort-Anmeldung unabhängig von Kontoanlage und Kontoeinstellungen sperrt.",
      );
    blockers.push(
      "Browser-SSO, Passwort-Bypass, Proxy-Vertrauen sowie Quick Connect und Gerätewiderruf auf Samsung Tizen, Android, iPadOS und Ubuntu extern abnehmen.",
    );
    return {
      checkedAt: new Date().toISOString(),
      publicReady: false,
      applyAvailable: false,
      routes:
        report.target && report.hostname
          ? [
              {
                name: "Jellyfin",
                publicUrl: `https://${report.hostname}`,
                target: protection?.verified ? protection.target : null,
                backendTarget: report.target,
              },
              {
                name: "Authentik-Anmeldung",
                publicUrl: `https://${report.hostname}:8443`,
                target: identity
                  ? `http://127.0.0.1:${identity.input.gatewayPort}`
                  : null,
              },
            ]
          : [],
      privateServices: [
        "StackPilot",
        "Authentik-Verwaltung",
        "ARR-Suite",
        "qBittorrent",
        "PostgreSQL",
      ],
      blockers,
      checks,
      message:
        "Nur Vorschau. Keine Serve-/Funnel-Konfiguration wird verändert. Port 8443 darf ausschließlich auf das eingeschränkte Login-Gateway zeigen, niemals auf die private Authentik-Verwaltung.",
    };
  }
}
