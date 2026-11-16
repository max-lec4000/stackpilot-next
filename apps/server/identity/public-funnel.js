import { createHash, randomUUID } from "node:crypto";
import { checkServeConfig } from "../remote-access.js";
import { tailscaleCommand } from "./tailscale-command.js";
import { validateIdentityInput } from "./config.js";
import { setupError } from "./setup-error.js";

const digest = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
export const acceptanceKeys = ["browserMfa", "quickConnect", "playback", "revocation", "recovery"];
export class PublicFunnel {
  constructor(hub, identity, protection, sso, connection, settings, security, backups, run = tailscaleCommand) {
    Object.assign(this, { hub, identity, protection, sso, connection, settings, security, backups, run });
    this.withdrawAfter = 2;
    this.unsafeStreak = 0;
  }
  async config() {
    const r = await this.run("tailscale", ["serve", "status", "--json"]);
    if (!r.ok) throw setupError("Tailscale-Freigaben sind nicht lesbar. Lokale Berechtigung prüfen.");
    try {
      const c = JSON.parse(r.output);
      if (!c || typeof c !== "object" || Array.isArray(c)) throw Error();
      return c;
    } catch { throw setupError("Tailscale-Freigaben sind nicht eindeutig lesbar."); }
  }
  key(plan) { return "public-funnel:" + (plan.rootId || plan.id); }
  validate(config, desired) {
    if (!checkServeConfig(config, desired).exclusive ||
        Object.keys(config.Foreground || {}).length || Object.keys(config.Services || {}).length ||
        Object.keys(config.AllowFunnel || {}).some((host) => !Object.hasOwn(desired, host)))
      throw setupError("Fremde oder zusätzliche Tailscale-Routen gefunden. Sie werden nicht verändert.");
    for (const [host, target] of Object.entries(desired))
      if (config.Web?.[host]?.Handlers?.["/"]?.Proxy !== target ||
          config.TCP?.[host.split(":").at(-1)]?.HTTPS !== true)
        throw setupError("Die beiden geschützten privaten HTTPS-Routen zuerst vollständig einrichten.");
  }
  async routeContext() {
    const plan = this.hub.engine.current()?.plan;
    if (!plan?.id) throw setupError("Keine gespeicherte Installation vorhanden.");
    const saved = this.hub.engine.vault.get(this.key(plan));
    // Withdrawal must work even when Authentik, the plugin or the gateway is down.
    if (!saved?.desired || saved.rootId !== (plan.rootId || plan.id))
      return { plan, saved: null, current: await this.config() };
    const current = await this.config();
    return { plan, saved, current };
  }
  async context(alreadyLocked = false) {
    const { plan } = await this.hub.context(["Jellyfin"]);
    const record = await this.identity.verify();
    validateIdentityInput(record.input);
    const gateway = await this.protection.verify();
    if (gateway.streamyfin)
      throw setupError("Das Streamyfin-Gateway ist nur für die private Abnahme freigegeben. Vor Funnel die bisherige Konfiguration wiederherstellen.");
    const sso = await this.sso.plan();
    if (!sso.configured || sso.hostname !== record.input.hostname || gateway.hostname !== record.input.hostname)
      throw setupError("SSO und Jellyfin-Schutz müssen für dieselbe Serveradresse bestätigt sein.");
    const desired = {
      [record.input.hostname + ":443"]: gateway.target,
      [record.input.hostname + ":8443"]: "http://127.0.0.1:" + record.input.gatewayPort,
    };
    const current = await this.config();
    this.validate(current, desired);
    const saved = this.hub.engine.vault.get(this.key(plan));
    if (checkServeConfig(current, desired).public && (!saved ||
        saved.rootId !== (plan.rootId || plan.id) || digest(saved.desired) !== digest(desired)))
      throw setupError("Die bestehende öffentliche Freigabe wurde nicht von diesem Ablauf eingerichtet.");
    const [identityStatus, connection, settings, report] = await Promise.all([
      this.identity.inspectSecurity({ alreadyLocked }),
      this.connection.inspect(), this.settings.inspect(), this.security.remote.inspect(),
    ]);
    const blockers = [];
    for (const c of identityStatus.checks)
      if (!["ok", "info"].includes(c.state) && c.name !== "Offline-Wiederherstellung")
        blockers.push(c.name + ": " + c.message);
    if (!connection.ready) blockers.push("Der vollständige SSO-Verbindungsweg ist nicht bestätigt.");
    if (!["expected", "unsupported"].includes(settings.baseUrl)) blockers.push("Authentik-Basisadresse prüfen.");
    if (report.hostname !== record.input.hostname || !report.tailscaleRunning ||
        report.jellyfin?.remoteAccess !== true || report.jellyfin?.quickConnect !== true ||
        report.jellyfin?.remoteAdmins !== 0 || !report.jellyfin?.viewers ||
        report.jellyfin?.ssoReleaseMatches !== true)
      blockers.push("Serveradresse, Fernzugriff, Quick Connect, Plugin und getrennte lokale Administratoren prüfen.");
    if (!this.backups.list().some((b) => b.restore?.status === "passed"))
      blockers.push("Authentik-Sicherung mit bestandenem isoliertem Wiederherstellungstest fehlt.");
    const proof = [plan.id, record.id, desired, current, sso.review,
      identityStatus.checks.map((c) => [c.name, c.state, c.message]), settings.baseUrl, blockers];
    return { plan, record, desired, current, blockers, saved, review: digest(proof) };
  }
  async preview() {
    let c;
    try { c = await this.context(); }
    catch (e) {
      const r = await this.routeContext();
      return { ready: false, review: null, blockers: [e.userFacing ? e.message : "Sicherheitsprüfung nicht abgeschlossen. Vorherige Schritte erneut prüfen."],
        canDisable: !!r.saved, active: Object.values(r.current.AllowFunnel || {}).some(Boolean),
        routes: [], externallyVerified: false };
    }
    const enabled = Object.entries(c.desired).filter(([host]) => c.current.AllowFunnel?.[host] === true).length;
    return { checkedAt: new Date().toISOString(), ready: c.blockers.length === 0, review: c.review,
      blockers: c.blockers, active: enabled > 0, complete: enabled === 2, canDisable: !!c.saved,
      externallyVerified: false,
      routes: Object.keys(c.desired).map((host) => ({ url: "https://" + host.replace(/:443$/, ""),
        name: host.endsWith(":443") ? "Jellyfin" : "Authentik-Anmeldung" })) };
  }
  async command(args) {
    const r = await this.run("tailscale", args);
    if (!r.ok) throw setupError(r.failureCode === "permission"
      ? "Tailscale verweigert die Änderung. Einmalige lokale Berechtigung erforderlich; StackPilot führt kein sudo aus."
      : "Tailscale konnte die Freigabe nicht bestätigen. Funnel-Berechtigung, HTTPS und Erreichbarkeit prüfen.");
  }
  async apply(body) {
    if (body.confirmation !== "OK" || !acceptanceKeys.every((key) => body.acceptance?.[key] === true))
      throw setupError("Persönliche MFA-, Geräte-, Wiedergabe-, Widerrufs- und Wiederherstellungsprüfung bestätigen.");
    return this.hub.mutate(["Jellyfin"], async () => {
      const c = await this.context(true);
      if (c.blockers.length || body.review !== c.review)
        throw setupError("Voraussetzungen oder Konfiguration geändert. Freigabe erneut prüfen.");
      const key = this.key(c.plan);
      this.hub.engine.vault.set(key, { planId: c.plan.id, rootId: c.plan.rootId || c.plan.id, desired: c.desired, status: "applying",
        at: new Date().toISOString(), acceptance: Object.fromEntries(acceptanceKeys.map((key) => [key, true])) });
      let last = c.current;
      try {
        // Login first: never deliberately publish Jellyfin without its identity endpoint.
        for (const port of [8443, 443]) {
          const now = await this.config();
          if (digest(now) !== digest(last)) throw setupError("Tailscale wurde parallel geändert. Keine weiteren Freigaben.");
          const host = c.record.input.hostname + ":" + port;
          if (now.AllowFunnel?.[host] !== true)
            await this.command(["funnel", "--bg", "--yes", "--https=" + port, c.desired[host]]);
          last = await this.config();
          this.validate(last, c.desired);
          if (last.AllowFunnel?.[host] !== true) throw setupError("Öffentliche Route nicht bestätigt.");
        }
        this.hub.engine.vault.set(key, { planId: c.plan.id, rootId: c.plan.rootId || c.plan.id, desired: c.desired, status: "active",
          at: new Date().toISOString(), acceptance: Object.fromEntries(acceptanceKeys.map((key) => [key, true])) });
        return { ok: true, externallyVerified: false,
          message: "Beide Funnel-Freigaben sind lokal bestätigt. Jetzt ohne Tailscale über Mobilfunk anmelden und Wiedergabe prüfen." };
      } catch {
        // Fail closed for these two owned routes, without resetting other Serve settings.
        const recovery = await this.withdraw(c.plan, c.desired);
        throw setupError(recovery.ok
          ? "Aktivierung nicht abgeschlossen. Beide verwalteten Routen wurden auf privaten Zugriff zurückgestellt."
          : "Aktivierung fehlgeschlagen; Abschaltung nicht vollständig bestätigt. Öffentlichen Status sofort lokal prüfen.");
      }
    });
  }
  async withdraw(plan, desired) {
    let ok = true;
    for (const [host, target] of Object.entries(desired)) {
      try {
        const now = await this.config(), port = host.split(":").at(-1);
        // Never rewrite a route another application has replaced.
        if (now.Web?.[host] && (now.Web[host]?.Handlers?.["/"]?.Proxy !== target ||
            Object.keys(now.Web[host].Handlers || {}).length !== 1)) { ok = false; continue; }
        if (now.AllowFunnel?.[host] === true) await this.command(["funnel", "--https=" + port, "off"]);
        const after = await this.config();
        if (!after.Web?.[host]) await this.command(["serve", "--bg", "--yes", "--https=" + port, target]);
        const final = await this.config();
        if (final.AllowFunnel?.[host] === true || final.Web?.[host]?.Handlers?.["/"]?.Proxy !== target) ok = false;
      } catch { ok = false; }
    }
    this.hub.engine.vault.set(this.key(plan), { planId: plan.id, rootId: plan.rootId || plan.id, desired, status: ok ? "private" : "withdrawal-required",
      at: new Date().toISOString() });
    return { ok, message: ok
      ? "Öffentlicher Zugriff abgeschaltet. Private HTTPS-Routen und lokale Dienste bleiben erhalten."
      : "Abschaltung nicht vollständig bestätigt. Tailscale-Status lokal prüfen; fremde Routen wurden nicht überschrieben." };
  }
  async disable(body) {
    if (body.confirmation !== "OK") throw setupError("Abschaltung mit OK bestätigen.");
    return this.withLease(async () => {
      const c = await this.routeContext();
      if (!c.saved) throw setupError("Keine eigene gespeicherte Funnel-Freigabe vorhanden.");
      return this.withdraw(c.plan, c.saved.desired);
    });
  }
  async withLease(fn) {
    const owner = "funnel-withdraw:" + randomUUID(), store = this.hub.engine.store;
    if (!store.claim(owner)) throw setupError("Ein anderer Auftrag läuft. Danach erneut abschalten.");
    const timer = setInterval(() => store.claim(owner), 10000);
    timer.unref?.();
    try {
      return await fn();
    } finally { clearInterval(timer); store.release(owner); }
  }
  async monitor() {
    const initial = await this.routeContext();
    if (!initial.saved || !Object.keys(initial.saved.desired).some((host) => initial.current.AllowFunnel?.[host]))
      return;
    return this.withLease(async () => {
      const current = await this.routeContext();
      let safe = false;
      try {
        const c = await this.context(true);
        safe = c.blockers.length === 0 && Object.keys(c.desired).every((host) => c.current.AllowFunnel?.[host] === true);
      } catch {}
      // Nach einem Neustart oder während Container neu erstellt werden, sind Authentik und
      // Jellyfin kurz nicht prüfbar. Erst zwei Fehlschläge hintereinander nehmen die
      // Freigabe zurück (sonst ging Funnel nach jedem Server-Neustart aus).
      this.unsafeStreak = safe ? 0 : (this.unsafeStreak || 0) + 1;
      if (!safe && this.unsafeStreak >= this.withdrawAfter) {
        this.unsafeStreak = 0;
        return this.withdraw(current.plan, current.saved.desired);
      }
    });
  }
  start() {
    if (this.timer) return;
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try { await this.monitor(); } catch {} finally { running = false; }
    };
    this.timer = setInterval(tick, 300000);
    this.timer.unref?.();
    // Erste Prüfung erst, wenn Authentik und Jellyfin nach einem Neustart sicher laufen.
    this.startupTimer = setTimeout(tick, 180000);
    this.startupTimer.unref?.();
  }
  close() { clearInterval(this.timer); clearTimeout(this.startupTimer); this.timer = null; }
}
