// Externer Zugriff in einem Auftrag: führt die vier bisher einzeln zu bestätigenden
// Schritte (Authentik, Jellyfin-Schutz, SSO-Verbindung, privates HTTPS) nacheinander aus.
// Jeder Schritt bleibt der geprüfte Einzelablauf mit seiner eigenen Sperre und Prüfung;
// hier entfällt nur das viermalige Vorschau-ansehen-und-OK-tippen. Wiederholbar: fertige
// Schritte werden erkannt und übersprungen. Öffentlich (Funnel) wird dadurch nichts.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const remoteSetupSteps = [
  ["identity", "Authentik installieren und MFA-Regeln anwenden"],
  ["protection", "Anmelde-Plugin und Schutz-Gateway vor Jellyfin einrichten"],
  ["sso", "Jellyfin mit Authentik verbinden"],
  ["serve", "Private HTTPS-Adressen im Tailnet einrichten"],
  ["harden", "Jellyfin für Zugriff von außen vorbereiten (Fernzugriff an, Administratoren nur lokal)"],
];

export class RemoteSetup {
  constructor(hub, parts, options = {}) {
    Object.assign(this, { hub, ...parts });
    this.pollMs = options.pollMs ?? 2000;
    this.timeoutMs = options.timeoutMs ?? 20 * 60000;
    this.serveAttempts = options.serveAttempts ?? 8;
    this.retryMs = options.retryMs ?? 15000;
    this.pending = null;
    this.memory = null;
  }
  key() {
    const plan = this.hub.engine.current()?.plan;
    return plan ? "remote-setup:" + (plan.rootId || plan.id) : null;
  }
  load() {
    const key = this.key();
    return (key && this.hub.engine.vault.get(key)) || null;
  }
  save(record) {
    const key = this.key();
    if (key) this.hub.engine.vault.set(key, record);
    this.memory = record;
  }
  summary() {
    const record = this.load();
    const steps = [
      ...remoteSetupSteps.filter(([id]) => id !== "harden" || this.security),
      ...(record?.viewer ? [["viewer", `Zuschauer „${record.viewer}“ einladen`]] : []),
    ].map(([id, label]) => ({
      id,
      label,
      status: record?.steps?.[id] || "pending",
    }));
    let status = record?.status || "idle";
    // Nach einem Neustart von StackPilot läuft nichts mehr weiter; ehrlich anzeigen.
    if (status === "running" && !this.pending) status = "interrupted";
    return {
      status,
      running: !!this.pending,
      steps,
      error: record?.error || null,
      result: record?.result || null,
    };
  }
  /** Startpasswort der ersten Einladung nach dem Anzeigen aus dem Tresor entfernen. */
  acknowledge() {
    const record = this.load();
    if (record?.result?.invitation) {
      delete record.result.invitation.password;
      this.save(record);
    }
    return this.summary();
  }
  async start({ viewer = "" } = {}) {
    if (this.pending) return this.summary();
    const current = this.hub.engine.current();
    if (!current || current.job.status !== "completed")
      throw Object.assign(Error("Zuerst die Einrichtung des Stacks abschließen."), {
        userFacing: true,
      });
    // Ein noch nicht angezeigtes Startpasswort übersteht einen erneuten Start.
    const previous = this.load();
    const record = {
      status: "running",
      steps: {},
      error: null,
      result: previous?.result?.invitation ? { invitation: previous.result.invitation } : null,
      viewer: typeof viewer === "string" && viewer ? viewer : previous?.viewer || "",
      startedAt: new Date().toISOString(),
    };
    this.save(record);
    this.pending = this.run(record)
      .catch((e) => {
        record.status = "failed";
        for (const id of Object.keys(record.steps))
          if (record.steps[id] === "running") record.steps[id] = "failed";
        record.error = String(e?.message || "Schritt konnte nicht bestätigt werden.").slice(0, 600);
        this.save(record);
      })
      .finally(() => {
        this.pending = null;
      });
    return this.summary();
  }
  async wait(running, label, part) {
    // Der Teilauftrag kennt sein eigenes Ende am genauesten. Sein Laufstatus allein reicht
    // nicht: In den ersten Sekunden (bevor er seinen Zustand gespeichert hat) meldet er
    // noch "läuft nicht", obwohl er gerade begonnen hat.
    if (part?.pending) await Promise.resolve(part.pending).catch(() => {});
    const end = Date.now() + this.timeoutMs;
    await sleep(this.pollMs);
    while (running()) {
      if (Date.now() > end) throw Error(label + " dauert zu lange.");
      await sleep(this.pollMs);
    }
  }
  async run(record) {
    const phase = async (id, fn) => {
      record.steps[id] = "running";
      this.save(record);
      await fn();
      record.steps[id] = "completed";
      this.save(record);
    };
    await phase("identity", async () => {
      let s = this.identity.summary();
      if (!s.prepared) s = await this.identity.prepare();
      if (s.status === "local-ready") return;
      await this.identity.start({ id: s.id, confirmation: "OK" });
      await this.wait(() => this.identity.summary().running, "Authentik-Einrichtung", this.identity);
      s = this.identity.summary();
      if (s.status !== "local-ready")
        throw Error(s.error || "Authentik wurde nicht bereit.");
    });
    await phase("protection", async () => {
      if (this.protection.summary().status === "ready") return;
      const preview = await this.protection.preview();
      await this.protection.start({ confirmation: "OK", review: preview.review });
      await this.wait(() => this.protection.summary().running, "Jellyfin-Schutz", this.protection);
      const s = this.protection.summary();
      if (s.status !== "ready") throw Error(s.error || "Jellyfin-Schutz wurde nicht bereit.");
    });
    await phase("sso", async () => {
      const plan = await this.sso.plan();
      if (plan.configured) return;
      if (!plan.canApply)
        throw Error(plan.blockers.join(" ") || "SSO-Verbindung ist nicht einrichtbar.");
      // Zuschauer sehen zunächst alle Bibliotheken; je Person einschränken kommt mit den Profilen.
      const libraryIds = plan.resuming
        ? plan.selectedLibraryIds
        : plan.libraries.map((library) => library.id);
      await this.sso.apply({ confirmation: "OK", review: plan.review, libraryIds });
    });
    await phase("serve", async () => {
      // Direkt nach dem Anlegen stellt Tailscale das Zertifikat erst aus; der Weg aus dem
      // Jellyfin-Container zu Authentik wird im selben Schritt geprüft und bei Bedarf
      // eingerichtet. Deshalb mit Pausen wiederholen, bis die ganze Kette bestätigt ist.
      let preview = await this.serve.preview();
      for (let attempt = 0; attempt < this.serveAttempts && !preview.ready; attempt++) {
        if (attempt) await sleep(this.retryMs);
        await this.serve.apply({ confirmation: "OK", review: preview.review });
        preview = await this.serve.preview();
      }
      if (!preview.routesReady) throw Error("Private HTTPS-Adressen wurden nicht bestätigt.");
      if (!preview.ready) {
        const open = (preview.connection?.checks || []).find((check) => check.state !== "ok");
        throw Error(
          "Die Adressen sind eingerichtet, aber die Anmeldung ist noch nicht durchgängig bestätigt" +
            (open ? `: ${open.name} – ${open.message}` : ".") +
            " Den Auftrag in ein paar Minuten erneut starten.",
        );
      }
      record.result = {
        ...(record.result?.invitation ? { invitation: record.result.invitation } : {}),
        ready: preview.ready === true,
        routes: preview.routes.map(({ url, loginUrl }) => ({ url, loginUrl })),
      };
    });
    if (this.security)
      await phase("harden", async () => {
        // Jellyfin selbst lässt Zuschauer nur zu, wenn Fernverbindungen erlaubt sind; das
        // Schutz-Gateway davor bleibt die eigentliche Grenze nach außen.
        const { s, plan } = await this.hub.context(["Jellyfin"]);
        const network = await this.hub.library.request(s, plan, "/System/Configuration/network");
        if (network?.EnableRemoteAccess !== true)
          await this.hub.library.request(s, plan, "/System/Configuration/network", {
            method: "POST",
            body: { ...network, EnableRemoteAccess: true },
          });
        // Verwaltungskonten nur im eigenen Netz; über die HTTPS-Adresse sperrt sie zusätzlich das Gateway.
        const admins = await this.security.admins();
        if (admins.accounts.length)
          await this.security.protectAdmins({ confirmation: "OK", review: admins.review });
      });
    if (record.viewer && this.viewers)
      await phase("viewer", async () => {
        const list = await this.viewers.list();
        if (list.viewers.some((v) => v.username === record.viewer)) return;
        const created = await this.viewers.invite(record.viewer);
        // Liegt verschlüsselt im Tresor, bis es einmal angezeigt und bestätigt wurde.
        record.result.invitation = created.invitation;
      });
    record.status = "completed";
    record.error = null;
    record.finishedAt = new Date().toISOString();
    this.save(record);
  }
}
