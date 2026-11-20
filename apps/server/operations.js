import { stat, statfs } from "node:fs/promises";
import { inspectPath } from "./inventory.js";
import { managedServices } from "./managed.js";
import { LiveCache } from "./request-index.js";
import { storageHealth } from "../../packages/domain/storage-health.js";
async function rootStorage() {
  const [fs, root] = await Promise.all([statfs("/"), stat("/")]);
  return {
    device: root.dev, totalBytes: fs.blocks * fs.bsize,
    freeBytes: fs.bavail * fs.bsize, usedBytes: (fs.blocks - fs.bfree) * fs.bsize,
  };
}
const usage = (measurement) => ({
  ...storageHealth(measurement),
  usedBytes: measurement?.usedBytes ?? null,
});
export class Operations {
  constructor(hub, activity, options = {}) {
    Object.assign(this, { hub, activity });
    this.storage = options.storage || inspectPath;
    this.systemStorage = options.systemStorage || rootStorage;
    this.managed = options.managed || managedServices;
    this.cache = new LiveCache(15000);
  }
  inspect(force = false) {
    if (force) this.cache.clear();
    return this.cache.read("overview", () => this.collect());
  }
  async storageSummary(plan) {
    const [media, system] = await Promise.all([
      this.storage(plan.spec.path).catch(() => null),
      this.systemStorage().catch(() => null),
    ]);
    const shared = media?.device != null && media.device === system?.device;
    return {
      media: usage(media?.exists === false ? null : media),
      system: shared ? null : usage(system),
      shared,
    };
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
    const disks = await this.storageSummary(current.plan);
    base.storage = disks.media;
    base.systemStorage = disks.system;
    base.sharedStorage = disks.shared;
    if (["warning", "critical"].includes(disks.system?.state))
      tasks.push({
        id: "system-storage", state: "attention", title: "Systemspeicher wird knapp",
        reason: "Freien Platz für System und Container prüfen.",
        action: "Verwaltung öffnen", target: "manage",
      });
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
        // qBittorrent nicht erreichbar, VPN aber geprüft: meist von der Ausfallsperre angehalten
        if (unavailable.includes("qBittorrent") && activity.vpn?.state === "connected") {
          unavailable.splice(unavailable.indexOf("qBittorrent"), 1);
          tasks.push({
            id: "downloads-stopped",
            state: "attention",
            title: "qBittorrent ist angehalten",
            reason: "Meist nach einem kurzen VPN-Ausfall von der Ausfallsperre angehalten. Das VPN ist wieder geprüft – unter Downloads geschützt fortsetzen.",
            action: "Downloads öffnen",
            target: "manage",
            href: "#/downloads",
          });
        }
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
    if (current?.job.status === "completed") await this.attention(current.plan, tasks);
    // Jede Aufgabe führt direkt auf die passende Seite (Phase 7.2c)
    for (const task of tasks)
      if (!task.href && task.target === "manage" && LINKS[task.id]) [task.href, task.action] = LINKS[task.id];
    return base;
  }
  /** Phase 7.2c: was im Betrieb gerade Aufmerksamkeit braucht (Fehler einzelner Prüfungen werden übersprungen). */
  async attention(plan, tasks) {
    const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
    await Promise.all([
      (async () => {
        if (!plan.spec.selected.includes("Seerr") || !this.hub.pendingCount) return;
        try {
          const count = await this.hub.pendingCount();
          if (count > 0)
            tasks.push({
              id: "approvals", state: "todo", title: n(count, "Anfrage wartet", "Anfragen warten") + " auf deine Freigabe",
              reason: "Freigeben oder ablehnen – einzeln oder gesammelt.", action: "Anfragen öffnen", target: "manage", href: "#/anfragen",
            });
        } catch {}
      })(),
      (async () => {
        if (!this.downloadIssues) return;
        try {
          const { total, issues } = await this.downloadIssues.list();
          if (total > 0)
            tasks.push({
              id: "download-issues", state: "attention", title: n(total, "Download braucht", "Downloads brauchen") + " Aufmerksamkeit",
              reason: [...new Set(issues.map((i) => i.cause))].slice(0, 3).join(", ") + ".", action: "Downloads öffnen",
              target: "manage", href: "#/downloads",
            });
        } catch {}
      })(),
      (async () => {
        if (!this.dockerGuard) return;
        try {
          const g = await this.dockerGuard.status();
          if (g.mode === "unreachable")
            tasks.push({
              id: "docker-guard", state: "attention", title: "Docker-Wächter antwortet nicht",
              reason: "Ohne ihn schlagen Docker-Aufgaben fehl. Am Server: sudo /opt/stackpilot/app/deploy/docker-guard.sh status",
              action: "Docker-Wächter öffnen", target: "manage", href: "#/system/updates",
            });
          else if ((g.mode === "observe" || g.mode === "enforce") && g.denied > 0)
            tasks.push({
              id: "docker-guard", state: "attention",
              title: g.mode === "observe" ? `Docker-Wächter hätte ${n(g.denied, "Aufruf", "Aufrufe")} gesperrt` : `Docker-Wächter hat ${n(g.denied, "Aufruf", "Aufrufe")} gesperrt`,
              reason: "Details und letzte Verstöße unter System → Updates & Sicherungen → Docker-Wächter.",
              action: "Docker-Wächter öffnen", target: "manage", href: "#/system/updates",
            });
        } catch {}
      })(),
    ]);
  }
}

const LINKS = {
  apps: ["#/system", "Apps & Container öffnen"],
  "system-storage": ["#/speicher", "Speicher öffnen"],
  storage: ["#/speicher", "Speicher öffnen"],
  connections: ["#/system/verbindungen", "Verbindungen öffnen"],
  vpn: ["#/system/vpn", "VPN & Ausfallsperre öffnen"],
  activity: ["#/system/diagnose", "Diagnose öffnen"],
  sources: ["#/qualitaet/quellen", "Quellen öffnen"],
};
