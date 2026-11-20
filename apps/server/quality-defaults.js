// Qualität & Quellen → Standardqualität (Phase 7.3c): Überblick über die Qualitätsprofile von
// Radarr/Sonarr (Qualitäten, Upgrades, Sprache) und den Standard für neue Anfragen in Seerr.
// Den Standard ändern geht über denselben gesicherten Weg wie „auch für künftige Anfragen“ in
// den Anfrage-Details: Seerr-Server setzen, zurücklesen, Vorgabe im Tresor merken (sonst würde
// die Prüfung neuer Anfragen den geänderten Standard ablehnen).
import { allowedQualities, qualityDefaultKey } from "./quality-policy.js";
import { compactProfileName } from "./quality-settings.js";
import { isFilmLimitProfile } from "./radarr-film-limit.js";
import { isSeriesLimitProfile } from "./series-limits.js";

const SERVICES = ["Radarr", "Sonarr"];
const text = (v, n = 120) => (typeof v === "string" ? v.replace(/[\x00-\x1f\x7f]+/g, " ").trim().slice(0, n) : "");
// Interne Profile von StackPilot (Film-/Serienlimits, Größenregel) sind kein wählbarer Standard
export const internal = (p) => isFilmLimitProfile(p) || isSeriesLimitProfile(p) ||
  /^StackPilot 1080p ≤ [0-9.]+ GiB$/.test(p?.name ?? "") || /^StackPilot · /.test(p?.name ?? "");
const managedServer = (servers, service) => (Array.isArray(servers) ? servers : []).find((v) =>
  v.isDefault && !v.is4k && v.hostname === service.toLowerCase() && Number(v.port) === (service === "Radarr" ? 7878 : 8989) &&
  !v.useSsl && [undefined, "", "/"].includes(v.baseUrl)) || null;

export function profileSummary(p) {
  const allowed = allowedQualities(p.items);
  const cutoff = (function find(items) {
    for (const v of Array.isArray(items) ? items : []) {
      if ((v.id ?? v.quality?.id) === p.cutoff) return v.name || v.quality?.name;
      const inner = find(v.items);
      if (inner) return inner;
    }
    return null;
  })(p.items);
  return {
    id: p.id, name: text(p.name), allowed: allowed.slice(0, 20).map((q) => text(q, 40)),
    upgrades: p.upgradeAllowed === true, cutoff: cutoff ? text(cutoff, 40) : null,
    language: p.language?.name ? text(p.language.name, 40) : null,
  };
}

export class QualityDefaults {
  constructor(hub) {
    this.hub = hub;
  }
  plan() {
    const current = this.hub.engine.current();
    if (current?.job.status !== "completed" || !current.plan.spec.selected.includes("Seerr"))
      throw Object.assign(Error("Seerr ist nicht eingerichtet."), { userFacing: true });
    return current.plan;
  }
  sizeStandard(plan) {
    const c = this.hub.sizeLimits?.config?.(plan) || {};
    return !!(c.rate || c.capGiB);
  }
  async read() {
    const plan = this.plan();
    const services = SERVICES.filter((n) => plan.spec.selected.includes(n));
    const { s } = await this.hub.context(["Seerr", ...services]);
    const rows = await Promise.all(services.map(async (service) => {
      try {
        const [profiles, servers] = await Promise.all([
          s.arr(service, "/qualityprofile"), s.additional.seerr(`/settings/${service.toLowerCase()}`),
        ]);
        const server = managedServer(servers, service);
        const visible = (Array.isArray(profiles) ? profiles : []).filter((p) => !internal(p) || p.id === server?.activeProfileId);
        return {
          service, kind: service === "Radarr" ? "movie" : "tv",
          defaultProfileId: server ? Number(server.activeProfileId) : null,
          serverFound: !!server,
          // Für Filme bestimmt eine aktive Größenregel den Standard (Medienprofile → Größe neuer Filmanfragen)
          governedBySize: service === "Radarr" && this.sizeStandard(plan),
          profiles: visible.map(profileSummary),
        };
      } catch {
        return { service, kind: service === "Radarr" ? "movie" : "tv", error: `${service} oder Seerr nicht erreichbar.` };
      }
    }));
    return { services: rows };
  }
  async setDefault(body) {
    if (body.confirmation !== "OK") throw Error("Standardqualität mit OK bestätigen.");
    const plan = this.plan();
    const service = body.service;
    if (!SERVICES.includes(service) || !plan.spec.selected.includes(service)) throw Error("Radarr oder Sonarr wählen.");
    if (service === "Radarr" && this.sizeStandard(plan))
      throw Object.assign(Error("Für neue Filme gilt die Größenregel. Sie dort ändern oder ausschalten (Medienprofile → Größe neuer Filmanfragen)."), { userFacing: true });
    const profileId = Number(body.profileId);
    if (!Number.isSafeInteger(profileId) || profileId < 1) throw Error("Ungültiges Profil.");
    return this.hub.mutate(["Seerr", service], async ({ s }) => {
      const profiles = await s.arr(service, "/qualityprofile");
      const profile = (Array.isArray(profiles) ? profiles : []).find((p) => p.id === profileId && !internal(p));
      if (!profile) throw Error("Das Profil gibt es in " + service + " nicht (mehr).");
      const route = `/settings/${service.toLowerCase()}`;
      const server = managedServer(await s.additional.seerr(route), service);
      if (!server) throw Error(`Seerr hat keinen verwalteten Standardserver für ${service}.`);
      await s.additional.seerr(`${route}/${server.id}`, {
        method: "PUT", body: { ...server, id: undefined, activeProfileId: profile.id, activeProfileName: profile.name },
      });
      const saved = managedServer(await s.additional.seerr(route), service);
      if (Number(saved?.activeProfileId) !== profile.id) throw Error("Seerr hat den neuen Standard nicht bestätigt.");
      this.hub.engine.vault.set(qualityDefaultKey(plan, service), {
        profileId: profile.id, profileName: text(profile.name), serverId: server.id,
        compact: profile.name === compactProfileName, updatedAt: new Date().toISOString(),
      });
      return { ok: true, service, profileId: profile.id, profileName: text(profile.name) };
    });
  }
}
