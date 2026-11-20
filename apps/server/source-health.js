// Qualität & Quellen → Zustand der Quellen (Phase 7.3b): Ausfälle und Sperren aus Prowlarr,
// Nutzung je Quelle, Ankunft in den ARR-Apps und Prowlarr-Warnungen – mit „Alle testen“ und
// „An die Apps übertragen“. Nur lesend außer diesen beiden Prowlarr-Aktionen.
import { importMessage } from "./import-status.js";

const ARR = ["Radarr", "Sonarr", "Lidarr"];
const text = (v, n = 200) => (typeof v === "string" ? v.replace(/[\x00-\x1f\x7f]+/g, " ").trim().slice(0, n) : "");
const time = (v) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
const list = (v) => (Array.isArray(v) ? v : []);

/** Zustand einer Quelle aus Prowlarr-Indexer, -Status und -Statistik. */
export function sourceState(indexer, status, stats, now = Date.now()) {
  const disabledTill = time(status?.disabledTill);
  const blocked = !!disabledTill && Date.parse(disabledTill) > now;
  const failed = !!time(status?.mostRecentFailure);
  return {
    id: indexer.id,
    name: text(indexer.name, 120),
    enabled: indexer.enable === true,
    state: indexer.enable !== true ? "off" : blocked ? "blocked" : failed ? "failing" : "ok",
    disabledTill: blocked ? disabledTill : null,
    lastFailure: time(status?.mostRecentFailure),
    queries: Number.isSafeInteger(stats?.numberOfQueries) ? stats.numberOfQueries : null,
    grabs: Number.isSafeInteger(stats?.numberOfGrabs) ? stats.numberOfGrabs : null,
    failedQueries: Number.isSafeInteger(stats?.numberOfFailedQueries) ? stats.numberOfFailedQueries : null,
    averageMs: Number.isFinite(stats?.averageResponseTime) ? Math.round(stats.averageResponseTime) : null,
  };
}

export class SourceHealth {
  constructor(hub) {
    this.hub = hub;
  }
  plan() {
    const current = this.hub.engine.current();
    if (current?.job.status !== "completed" || !current.plan.spec.selected.includes("Prowlarr"))
      throw Object.assign(Error("Prowlarr ist nicht eingerichtet."), { userFacing: true });
    return current.plan;
  }
  secrets(s, plan) {
    const out = [];
    for (const name of plan.spec.selected) {
      try { const c = s.credentials(name); out.push(c.password, c.apiKey); } catch {}
    }
    return out;
  }
  async read() {
    const plan = this.plan();
    const { s } = await this.hub.context(["Prowlarr"]);
    const p = (route) => s.arr("Prowlarr", route);
    const [indexers, statuses, stats, health, apps] = await Promise.all([
      p("/indexer"), p("/indexerstatus").catch(() => []), p("/indexerstats").catch(() => null),
      p("/health").catch(() => []), p("/applications").catch(() => []),
    ]);
    if (!Array.isArray(indexers)) throw Error("Prowlarr-Quellen nicht lesbar.");
    const secrets = this.secrets(s, plan);
    const byStatus = new Map(list(statuses).map((v) => [v.indexerId, v]));
    const byStats = new Map(list(stats?.indexers).map((v) => [v.indexerId, v]));
    const sources = indexers.map((i) => sourceState(i, byStatus.get(i.id), byStats.get(i.id)));
    const services = ARR.filter((n) => plan.spec.selected.includes(n));
    const connected = list(apps).map((a) => text(a.implementation || a.implementationName || a.name, 40));
    const arr = await Promise.all(services.map(async (name) => {
      const out = { name, connected: connected.includes(name), indexers: null, problems: [] };
      try {
        const [rows, checks] = await Promise.all([s.arr(name, "/indexer"), s.arr(name, "/health").catch(() => [])]);
        out.indexers = list(rows).filter((r) => r.enableRss || r.enableAutomaticSearch || r.enableInteractiveSearch).length;
        out.problems = list(checks).filter((c) => /indexer/i.test(String(c.source))).map((c) => text(importMessage(c.message, secrets), 240)).slice(0, 5);
      } catch {
        out.problems = [`${name} nicht erreichbar.`];
      }
      return out;
    }));
    // Update-Hinweise von Prowlarr gehören nicht zum Zustand der Quellen
    const warnings = list(health).filter((h) => ["warning", "error"].includes(h.type) && !/update/i.test(String(h.source)))
      .map((h) => text(importMessage(h.message, secrets), 240)).slice(0, 8);
    const count = (st) => sources.filter((x) => x.state === st).length;
    return { checkedAt: new Date().toISOString(), sources, arr, warnings,
      summary: { ok: count("ok"), failing: count("failing"), blocked: count("blocked"), off: count("off") } };
  }
  /** Alle aktiven Quellen testen (Prowlarr testall). Ergebnis je Quelle. */
  async testAll() {
    this.plan();
    return this.hub.mutate(["Prowlarr"], async ({ s, plan }) => {
      const [indexers, results] = await Promise.all([
        s.arr("Prowlarr", "/indexer"),
        s.arr("Prowlarr", "/indexer/testall", { method: "POST" }).catch((e) => {
          // Prowlarr antwortet bei fehlgeschlagenen Tests mit 400 und der Ergebnisliste
          if (Array.isArray(e.body)) return e.body;
          throw e;
        }),
      ]);
      const names = new Map(list(indexers).map((i) => [i.id, text(i.name, 120)]));
      const secrets = this.secrets(s, plan);
      return {
        results: list(results).map((r) => ({
          id: r.id, name: names.get(r.id) || `Quelle ${r.id}`, ok: r.isValid === true,
          message: list(r.validationFailures).map((f) => text(importMessage(f.errorMessage, secrets), 240)).join(" · ") || null,
        })),
      };
    });
  }
  /** Quellen erneut an Radarr/Sonarr/Lidarr übertragen (Prowlarr-Abgleich). */
  async sync() {
    this.plan();
    const { s } = await this.hub.context(["Prowlarr"]);
    await s.arr("Prowlarr", "/command", { method: "POST", body: { name: "ApplicationIndexerSync" } });
    return { ok: true, message: "Prowlarr überträgt die Quellen an die Apps. Das dauert meist wenige Sekunden." };
  }
}
