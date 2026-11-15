import { inspectPath } from "./inventory.js";
import { managedServices } from "./managed.js";
import { LiveCache } from "./request-index.js";
import { storageHealth } from "../../packages/domain/storage-health.js";
export class Operations {
  constructor(hub, activity, options = {}) {
    Object.assign(this, { hub, activity });
    this.storage = options.storage || inspectPath;
    this.managed = options.managed || managedServices;
    this.cache = new LiveCache(15000);
  }
  inspect(force = false) {
    if (force) this.cache.clear();
    return this.cache.read("overview", () => this.collect());
  }
  async collect() {
    const current = this.hub.engine.current(),
      tasks = [];
    const base = {
      observedAt: new Date().toISOString(),
      phase:
        !current || current.job.status !== "completed" ? "setup" : "operation",
      uptimeSeconds: Math.floor(process.uptime()),
      tasks,
      storage: storageHealth(null),
      applications: [],
    };
    if (!current) {
      tasks.push({
        id: "setup",
        state: "todo",
        title: "Deinen Stack zusammenstellen",
        reason: "Komponenten gemeinsam auswählen und einrichten.",
        action: "Einrichtung öffnen",
        target: "setup",
      });
      return base;
    }
    if (current.job.status !== "completed")
      tasks.push({
        id: "setup",
        state: "attention",
        title: "Einrichtung abschließen",
        reason:
          "Der gespeicherte Auftrag ist noch nicht abgeschlossen. Zustand im Auftragsverlauf prüfen.",
        action: "Verwaltung öffnen",
        target: "manage",
      });
    try {
      const result = await this.managed(this.hub.engine);
      base.applications = result.services.map((s) => ({
        name: s.name,
        state: s.state,
      }));
      const missing = result.services.filter((s) => s.state !== "running");
      if (missing.length)
        tasks.push({
          id: "apps",
          state: "attention",
          title: "Anwendungen prüfen",
          reason:
            missing.map((s) => s.name).join(", ") +
            " laufen nicht oder fehlen.",
          action: "Verwaltung öffnen",
          target: "manage",
        });
    } catch {
      tasks.push({
        id: "apps",
        state: "unknown",
        title: "Anwendungszustand nicht bestätigt",
        reason: "Docker-Zugriff und Zuordnung unter Diagnose prüfen.",
        action: "Verwaltung öffnen",
        target: "manage",
      });
    }
    try {
      const measured = await this.storage(current.plan.spec.path);
      base.storage = { ...storageHealth(measured), usedBytes: measured.usedBytes ?? null };
    } catch {}
    if (base.storage.state === "unknown")
      tasks.push({
        id: "storage",
        state: "unknown",
        title: "Speicherstand nicht bestätigt",
        reason: base.storage.reason,
        action: "Verwaltung öffnen",
        target: "manage",
      });
    if (["warning", "critical"].includes(base.storage.state))
      tasks.push({
        id: "storage",
        state: "attention",
        title: "Speicher prüfen",
        reason: base.storage.reason,
        action: "Verwaltung öffnen",
        target: "manage",
      });
    if (current.job.status === "completed") {
      try {
        const activity = await this.activity.get();
        const unavailable = [];
        if (
          current.plan.spec.selected.includes("Jellyfin") &&
          activity.jellyfin?.state !== "ready"
        )
          unavailable.push("Jellyfin");
        if (
          current.plan.spec.selected.includes("qBittorrent") &&
          activity.downloads?.state !== "ready"
        )
          unavailable.push("qBittorrent");
        for (const name of ["Radarr", "Sonarr", "Lidarr"].filter((n) =>
          current.plan.spec.selected.includes(n),
        ))
          if (
            !activity.arr?.some(
              (a) => a.service === name && a.state === "ready",
            )
          )
            unavailable.push(name);
        if (unavailable.length)
          tasks.push({
            id: "connections",
            state: "unknown",
            title: "Dienstverbindungen prüfen",
            reason:
              unavailable.join(", ") +
              " konnten nicht über ihre APIs bestätigt werden.",
            action: "Verwaltung öffnen",
            target: "manage",
          });
        if (
          current.plan.spec.selected.includes("qBittorrent") &&
          activity.vpn.state !== "connected"
        )
          tasks.push({
            id: "vpn",
            state: activity.vpn.state === "checking" ? "checking" : "attention",
            title: "Downloadschutz prüfen",
            reason: activity.vpn.reason,
            action: "Verwaltung öffnen",
            target: "manage",
          });
      } catch {
        tasks.push({
          id: "activity",
          state: "unknown",
          title: "Aktivitäten nicht bestätigt",
          reason:
            "Der aktuelle Betriebszustand konnte nicht vollständig gelesen werden.",
          action: "Verwaltung öffnen",
          target: "manage",
        });
      }
      if (current.plan.spec.selected.includes("Prowlarr"))
        try {
          const { s } = await this.hub.context(["Prowlarr"]),
            sources = await s.arr("Prowlarr", "/indexer");
          if (!Array.isArray(sources)) throw Error();
          if (!sources.some((s) => s.enable === true))
            tasks.push({
              id: "sources",
              state: "todo",
              title: "Quellen einrichten",
              reason:
                "Prowlarr meldet noch keine aktive Quelle. Die Synchronisierung und Suchregeln werden in den ARR-Apps separat geprüft.",
              action: "Verwaltung öffnen",
              target: "manage",
            });
        } catch {
          tasks.push({
            id: "sources",
            state: "unknown",
            title: "Quellenstatus nicht bestätigt",
            reason: "Unter Verwaltung → Quellen die Verbindung prüfen.",
            action: "Verwaltung öffnen",
            target: "manage",
          });
        }
    }
    return base;
  }
}
