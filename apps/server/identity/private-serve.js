import { setupError } from "./setup-error.js";
import { createHash } from "node:crypto";
import { tailscaleCommand } from "./tailscale-command.js";
import { checkServeConfig } from "../remote-access.js";
import { localIdentityRequest } from "./local-request.js";
const digest = (v) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
export class PrivateServe {
  constructor(
    hub,
    identity,
    protection,
    sso,
    run = tailscaleCommand,
    request = localIdentityRequest,
    diagnostics = null,
    settings = null,
    backchannel = null,
  ) {
    Object.assign(this, {
      hub,
      identity,
      protection,
      sso,
      run,
      request,
      diagnostics,
      settings,
      backchannel,
    });
  }
  async config() {
    const r = await this.run("tailscale", ["serve", "status", "--json"]);
    if (!r.ok) throw setupError("Tailscale-Serve-Zustand ist nicht lesbar.");
    try {
      const value = JSON.parse(r.output);
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw setupError();
      return value;
    } catch {
      throw setupError("Tailscale-Serve-Zustand ist ungültig.");
    }
  }
  async context() {
    const gateway = await this.protection.verify(),
      record = await this.identity.verify(),
      sso = await this.sso.plan();
    if (!sso.configured || sso.hostname !== record.input.hostname)
      throw setupError(
        "Private SSO-Verbindung zuerst vollständig einrichten und prüfen.",
      );
    const current = await this.config(),
      hostname = record.input.hostname;
    const { plan } = await this.hub.context(["Jellyfin"]);
    const desired = {
      [`${hostname}:443`]: gateway.target,
      [`${hostname}:8443`]: `http://127.0.0.1:${record.input.gatewayPort}`,
    };
    const allowed = {
      ...desired,
      [`${hostname}:443`]: [
        gateway.target,
        `http://127.0.0.1:${plan.ports.Jellyfin}`,
      ],
    };
    const check = checkServeConfig(current, allowed);
    if (
      !check.exclusive ||
      check.public ||
      Object.keys(current?.Foreground || {}).length ||
      Object.keys(current?.Services || {}).length
    )
      throw setupError(
        "Fremde, temporäre oder öffentliche Tailscale-Freigaben werden nicht verändert.",
      );
    const login = await this.request(
      `http://127.0.0.1:${record.input.gatewayPort}/healthz`,
      { headers: { Host: hostname } },
    );
    await login.arrayBuffer();
    if (login.status !== 200)
      throw setupError("Privates Authentik-Login-Gateway ist nicht bereit.");
    return {
      record,
      plan,
      current,
      desired,
      gateway,
      review: digest([plan.id, record.id, current, desired, sso.review]),
    };
  }
  async preview() {
    const c = await this.context();
    const routesReady = this.matches(c.current, c.desired);
    let connection = null,
      systemSettings = null;
    if (routesReady && this.diagnostics) {
      try {
        connection = await this.diagnostics.inspect();
      } catch {
        connection = {
          ready: false,
          checks: [
            {
              name: "SSO-Verbindung",
              state: "unknown",
              message: "Aktueller Verbindungsnachweis fehlt.",
            },
          ],
        };
      }
    }
    if (this.settings) {
      try {
        systemSettings = await this.settings.inspect();
      } catch {
        systemSettings = { baseUrl: "unknown" };
      }
    }
    const backchannel = this.backchannel
      ? await (
          this.backchannel.diagnostics
            ? this.backchannel.diagnostics()
            : this.backchannel.inspect()
        ).catch(() => ({ installed: true, verified: false }))
      : null;
    return {
      review: c.review,
      routesReady,
      backchannel,
      connection,
      systemSettings,
      publicReady: false,
      privateOnly: true,
      routes: Object.entries(c.desired).map(([host, target]) => ({
        url: "https://" + host.replace(/:443$/, ""),
        loginUrl: host.endsWith(":443")
          ? "https://" + host.replace(/:443$/, "") + "/sso/OID/start/stackpilot"
          : null,
        target,
      })),
      ready:
        routesReady &&
        (!backchannel?.installed || backchannel.verified === true) &&
        (!this.diagnostics || connection?.ready === true) &&
        (!this.settings ||
          ["expected", "unsupported"].includes(systemSettings?.baseUrl)),
      message:
        "Nur im Tailscale-Netz erreichbar. Ersetzt gegebenenfalls die bisherige direkte Jellyfin-Route durch das Schutz-Gateway. Keine öffentliche Funnel-Freigabe; Authentik-Verwaltung und StackPilot bleiben unveröffentlicht.",
    };
  }
  matches(config, desired) {
    return (
      Object.entries(desired).every(
        ([host, target]) =>
          config?.Web?.[host]?.Handlers?.["/"]?.Proxy === target,
      ) &&
      checkServeConfig(config, desired).exclusive &&
      !checkServeConfig(config, desired).public
    );
  }
  async apply(body) {
    if (body.confirmation !== "OK")
      throw setupError("Private HTTPS-Einrichtung mit OK bestätigen.");
    return this.hub.mutate(["Jellyfin"], async () => {
      const c = await this.context();
      if (body.review !== c.review)
        throw setupError(
          "Freigaben oder Konfiguration wurden geändert. Vorschau neu prüfen.",
        );
      const key = "private-serve:" + (c.plan.rootId || c.plan.id),
        previous = this.hub.engine.vault.get(key);
      this.hub.engine.vault.set(key, {
        status: "applying",
        at: new Date().toISOString(),
        original: previous?.original || c.current,
        desired: c.desired,
      });
      let last = c.current;
      try {
        for (const [host, target] of Object.entries(c.desired)) {
          const now = await this.config();
          if (digest(now) !== digest(last))
            throw setupError(
              "Tailscale wurde parallel geändert. Keine weiteren Änderungen ausgeführt.",
            );
          if (now.Web?.[host]?.Handlers?.["/"]?.Proxy === target) continue;
          const port = host.endsWith(":8443") ? 8443 : 443;
          const result = await this.run("tailscale", [
            "serve",
            "--bg",
            "--yes",
            `--https=${port}`,
            target,
          ]);
          if (!result.ok)
            throw setupError(
              result.failureCode === "permission"
                ? "Tailscale verweigert Änderungen durch den StackPilot-Benutzer. Einmalige lokale Administratorfreigabe nötig; StackPilot startet kein sudo. Danach neue Vorschau prüfen."
                : "Private HTTPS-Route konnte nicht gesetzt werden. Berechtigung oder Zertifikatsbereitstellung ist nicht bestätigt; vorhandene Routen bleiben erhalten.",
            );
          last = await this.config();
          if (
            !checkServeConfig(last, {
              ...c.desired,
              [`${c.record.input.hostname}:443`]: [
                c.gateway.target,
                `http://127.0.0.1:${c.plan.ports.Jellyfin}`,
              ],
            }).exclusive ||
            checkServeConfig(last, c.desired).public ||
            last.Web?.[host]?.Handlers?.["/"]?.Proxy !== target
          )
            throw setupError(
              "Neue private Route nicht eindeutig bestätigt. Keine weiteren Änderungen.",
            );
        }
        const after = await this.config();
        if (!this.matches(after, c.desired))
          throw setupError(
            "Private HTTPS-Routen sind nicht vollständig bestätigt.",
          );
        const settings = this.settings
          ? await this.settings.inspect(true)
          : null;
        let connection = this.diagnostics
          ? await this.diagnostics.inspect()
          : null;
        let backchannel = null;
        if (
          this.backchannel &&
          connection &&
          !connection.ready &&
          connection.checks.some(
            (c) => c.name === "Authentik HTTPS vom Server" && c.state === "ok",
          ) &&
          (this.backchannel.current?.() ||
            connection.checks.some(
              (c) => c.name === "SSO aus Jellyfin" && c.code === "refused",
            ))
        ) {
          try {
            backchannel = await this.backchannel.ensure({ explicit: true });
            if (this.backchannel.diagnostics)
              backchannel = {
                ...backchannel,
                ...(await this.backchannel.diagnostics()),
              };
            connection = await this.diagnostics.inspect();
          } catch (e) {
            backchannel = {
              ...(this.backchannel.diagnostics
                ? await this.backchannel.diagnostics()
                : {}),
              verified: false,
              message: e.userFacing
                ? e.message
                : "Interner HTTPS-Weg konnte nicht bestätigt werden. Keine Sicherheitslockerung.",
            };
          }
        }
        if (this.backchannel && !backchannel)
          backchannel = await (
            this.backchannel.diagnostics
              ? this.backchannel.diagnostics()
              : this.backchannel.inspect()
          ).catch(() => ({ installed: true, verified: false }));
        const setupReady =
          (!backchannel?.installed || backchannel.verified === true) &&
          (!connection || connection.ready) &&
          (!settings || ["expected", "unsupported"].includes(settings.baseUrl));
        this.hub.engine.vault.set(key, {
          status: setupReady ? "ready" : "connection-blocked",
          at: new Date().toISOString(),
          original: previous?.original || c.current,
          desired: c.desired,
        });
        return {
          ok: setupReady,
          connection,
          backchannel,
          systemSettings: settings,
          publicReady: false,
          message: setupReady
            ? "Private HTTPS-Routen und SSO-Verbindungsweg bestätigt. Persönliche MFA und Gerätefreigabe jetzt im eigenen Tailscale-Netz testen. Funnel bleibt deaktiviert."
            : "Routen sind gesetzt, aber die Einrichtung ist noch nicht bestätigt. Verbindungsprüfung und Authentik-Basisadresse beachten; keine Sicherheitsregeln wurden gelockert.",
        };
      } catch (e) {
        this.hub.engine.vault.set(key, {
          status: "failed",
          at: new Date().toISOString(),
          original: previous?.original || c.current,
          desired: c.desired,
          error: e.message,
        });
        throw e;
      }
    });
  }
}
