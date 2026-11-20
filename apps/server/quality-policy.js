import { filmLimitKey, verifyFilmLimitProfile } from "./radarr-film-limit.js";
import { seriesLimitsKey, verifySeriesLimitProfile } from "./series-limits.js";

const seerrAdmin = 2;
export function seerrServiceAdmin(actor) {
  const permissions = actor?.permissions;
  return Number.isSafeInteger(permissions) && permissions >= 0 && (permissions & seerrAdmin) === seerrAdmin;
}

export const qualityPolicyKey = (plan, kind, id) =>
  `quality-policy:${plan.rootId || plan.id}:${kind}:${id}`;
export const qualityDefaultKey = (plan, service) =>
  `quality-default:${plan.rootId || plan.id}:${String(service).toLowerCase()}`;
export function allowedQualities(items, enabled = true) {
  return (Array.isArray(items) ? items : []).flatMap((v) =>
    Array.isArray(v.items) && v.items.length
      ? allowedQualities(v.items, enabled && v.allowed !== false)
      : v.quality && enabled && v.allowed
        ? [v.quality.name]
        : [],
  );
}
export function compactValid(profile) {
  const names = allowedQualities(profile?.items);
  return (
    names.length > 0 &&
    names.every((n) => /1080p/i.test(n) && !/remux/i.test(n)) &&
    profile.upgradeAllowed === false
  );
}
export async function requestQualityOptions(hub, s, plan, kind, id) {
  const service = kind === "movie" ? "Radarr" : "Sonarr";
  const series = kind === "tv" ? hub.engine.vault.get(seriesLimitsKey(plan, id)) : null;
  if (series?.pending) throw Error("Schließe zuerst den Profilwechsel unter Größenlimits ab.");
  const specific = hub.engine.vault.get(qualityPolicyKey(plan, kind, id)),
    global = hub.engine.vault.get(qualityDefaultKey(plan, service)),
    policy = specific || (kind === "movie" && (hub.sizeLimits?.config(plan)?.rate || hub.sizeLimits?.config(plan)?.capGiB) ? null : global);
  if (!policy) return {};
  const actor = await s.additional.seerr("/auth/me");
  if (!seerrServiceAdmin(actor))
    throw Error(
      "Seerr bestätigt keine Administratorrechte für verbindliche Profilvorgaben. Dienstkonto prüfen; es wird kein Auftrag mit einem Ersatzprofil gestartet.",
    );
  const servers = await s.additional.seerr(
    `/settings/${service.toLowerCase()}`,
  );
  const server = Array.isArray(servers)
    ? servers.find((v) =>
        specific ? v.id === policy.serverId : v.isDefault && !v.is4k,
      )
    : null;
  if (
    !server ||
    server.is4k ||
    server.hostname !== service.toLowerCase() ||
    Number(server.port) !== (kind === "movie" ? 7878 : 8989) ||
    server.useSsl ||
    ![undefined, "", "/"].includes(server.baseUrl)
  )
    throw Error(
      "Gespeichertes Qualitätsprofil gehört nicht mehr zum verwalteten Server. Qualitätseinstellungen prüfen.",
    );
  if (!specific && Number(server.activeProfileId) !== policy.profileId)
    throw Error(
      "Der Seerr-Standard wurde seit der Profiländerung verändert. Vor der neuen Anfrage die Qualität erneut bestätigen.",
    );
  const profiles = await s.arr(service, "/qualityprofile"),
    profile = Array.isArray(profiles)
      ? profiles.find((p) => p.id === policy.profileId)
      : null;
  if (!profile || (policy.compact && !compactValid(profile)))
    throw Error(
      "Das gespeicherte Qualitätsprofil fehlt oder erlaubt inzwischen andere Qualitäten. Vor der Anfrage erneut prüfen.",
    );
  if (policy.size && hub.sizeLimits)
    await hub.sizeLimits.verify(s, policy.size);
  return { serverId: server.id, profileId: profile.id };
}
export async function verifyCurrentQuality(hub, s, plan, target) {
  const policy = hub.engine.vault.get(
    qualityPolicyKey(plan, target.kind, target.mediaId),
  );
  const series = target.kind === "tv" ? hub.engine.vault.get(seriesLimitsKey(plan, target.mediaId)) : null;
  if (series?.pending) throw Error("Schließe zuerst den Profilwechsel unter Größenlimits ab.");
  const managed = series?.automatic;
  if (managed) {
    if (target.item?.id !== managed.seriesId || target.item.tvdbId !== managed.tvdbId ||
        target.item.qualityProfileId !== managed.profileId ||
        (policy && managed.baseProfileId !== policy.profileId))
      throw Error("Das Sonarr-Profil dieser Serie hat sich geändert. Größenlimits prüfen.");
    await verifySeriesLimitProfile(s, managed);
  }
  const film = target.kind === "movie" ? hub.engine.vault.get(filmLimitKey(plan, target.mediaId)) : null;
  if (film?.pending) throw Error("Schließe zuerst den Profilwechsel unter der Filmobergrenze ab.");
  if (film?.rule) {
    if (target.item?.id !== film.movieId || target.item.tmdbId !== film.tmdbId ||
        target.item.qualityProfileId !== film.rule.id || (policy && film.base !== policy.profileId))
      throw Error("Das Radarr-Profil dieses Films hat sich geändert. Filmobergrenze prüfen.");
    await verifyFilmLimitProfile(s, film.rule);
  }
  if (!policy) return;
  const profileId = film?.rule?.id ?? managed?.profileId ?? policy.profileId;
  if (target.item?.qualityProfileId !== profileId)
    throw Error(
      "Das Dienstprofil weicht von deiner bestätigten Auswahl ab. Vor der Suche unter Qualität ändern erneut speichern.",
    );
  if (policy.size && hub.sizeLimits)
    await hub.sizeLimits.verify(s, policy.size);
  if (policy.compact) {
    const actual = await s.arr(
      target.service,
      `/qualityprofile/${profileId}`,
    );
    if (!compactValid(actual))
      throw Error(
        "Das bestätigte Profil erlaubt inzwischen andere Qualitäten. Vor der Suche die Profilregeln prüfen.",
      );
  }
}
