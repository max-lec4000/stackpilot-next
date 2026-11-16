import {
  allowedQualities,
  compactValid,
  qualityPolicyKey,
  qualityDefaultKey,
} from "./quality-policy.js";
import { filmLimitKey, isFilmLimitProfile, saveAutomaticFilmLimit } from "./radarr-film-limit.js";
import { randomUUID } from "node:crypto";
import { positiveId } from "./media-hub.js";
import { isSeriesLimitProfile, seriesLimitsKey } from "./series-limits.js";
export const compactProfileName = "StackPilot 1080p (ohne Remux)";
function flat(items) {
  return (Array.isArray(items) ? items : []).flatMap((v) =>
    Array.isArray(v.items) && v.items.length
      ? flat(v.items)
      : v.quality
        ? [v]
        : [],
  );
}
export function compactProfile(schema) {
  const items = flat(schema.items).map((v) => ({
    ...v,
    allowed: /1080p/i.test(v.quality.name) && !/remux/i.test(v.quality.name),
  }));
  const allowed = items.filter((v) => v.allowed);
  if (!allowed.length)
    throw Error(
      "Kein geeignetes 1080p-Profil aus der Dienstvorlage ableitbar.",
    );
  const result = {
    ...schema,
    name: compactProfileName,
    items,
    upgradeAllowed: false,
    cutoff: allowed.at(-1).quality.id,
    minFormatScore: 0,
    cutoffFormatScore: 0,
  };
  delete result.id;
  return result;
}
export class QualitySettings {
  constructor(hub, diagnostics) {
    this.hub = hub;
    this.diagnostics = diagnostics;
  }
  async read(id) {
    const { s, plan } = await this.hub.context(["Seerr"]);
    const target = await this.diagnostics.target(s, id);
    if (!target.item)
      throw Object.assign(
        Error("Das Medium ist noch nicht in der ARR-App angekommen."),
        { userFacing: true },
      );
    const profiles = await s.arr(target.service, "/qualityprofile");
    if (!Array.isArray(profiles))
      throw Error("Qualitätsprofile nicht erreichbar.");
    return {
      service: target.service,
      kind: target.kind,
      currentProfileId: target.item.qualityProfileId,
      hasFile: !!target.item.hasFile,
      runtime: Number(target.item.runtime) || null,
      automaticFilmLimit: target.kind === "movie"
        ? this.hub.engine.vault.get(filmLimitKey(plan, target.mediaId))?.rule?.cap ?? 0 : null,
      sizePolicy:
        this.hub.engine.vault.get(
          qualityPolicyKey(plan, target.kind, target.mediaId),
        )?.size || null,
      sizeDefaultRate: target.kind === "movie" ? this.hub.sizeLimits?.config(plan).rate ?? 0 : 0,
      canSetDefault: !!target.server.isDefault,
      defaultProfileId: target.server.activeProfileId,
      requestProfileId: target.request?.profileId ?? null,
      savedProfileId:
        this.hub.engine.vault.get(
          qualityPolicyKey(plan, target.kind, target.mediaId),
        )?.profileId ?? null,
      fileQuality: target.item.movieFile?.quality?.quality?.name || null,
      fileSize: Number.isFinite(target.item.movieFile?.size)
        ? target.item.movieFile.size
        : null,
      profiles: profiles.filter((p) => (!isSeriesLimitProfile(p) && !isFilmLimitProfile(p)) || p.id === target.item.qualityProfileId).map((p) => ({
        id: p.id,
        name: p.name,
        allowed: allowedQualities(p.items),
      })),
      canCreateCompact: !profiles.some((p) => p.name === compactProfileName),
    };
  }
  async filmLimit(body) {
    if (body.confirmation !== "OK" || typeof body.capGiB !== "number") throw Error("Filmgrößenlimit bestätigen.");
    return this.hub.mutate(["Seerr", "Radarr"], async ({ s, plan }) => {
      const target = await this.diagnostics.target(s, positiveId(body.requestId));
      if (target.kind !== "movie" || target.service !== "Radarr" || !target.item)
        throw Error("Der Film ist noch nicht im verwalteten Radarr eingerichtet.");
      return saveAutomaticFilmLimit(s, this.hub.engine.vault, filmLimitKey(plan, target.mediaId), target.item, body.capGiB);
    });
  }
  async apply(body) {
    if (body.confirmation !== "OK") throw Error("Profiländerung bestätigen.");
    return this.hub.mutate(["Seerr"], async ({ s, plan }) => {
      const target = await this.diagnostics.target(
        s,
        positiveId(body.requestId),
      );
      const { item, service, kind, server } = target;
      if (!item)
        throw Error("Das Medium ist noch nicht in der ARR-App angekommen.");
      const film = kind === "movie" ? this.hub.engine.vault.get(filmLimitKey(plan, target.mediaId)) : null;
      if (film?.rule || film?.pending)
        throw Error("Stelle zuerst das Radarr-Profil über das automatische Filmgrößenlimit wieder her.");
      const series = kind === "tv" ? this.hub.engine.vault.get(seriesLimitsKey(plan, target.mediaId)) : null;
      if (series?.automatic || series?.pending)
        throw Error("Schalte unter Größenlimits zuerst die automatischen Sonarr-Limits aus. Danach kannst du die Qualität ändern.");
      if (item.qualityProfileId !== positiveId(body.previousProfileId))
        throw Error("Das Profil wurde inzwischen geändert. Neu laden.");
      const sizeRate = Number(body.sizeGiBPerHour ?? 0);
      if (body.alsoFuture === true && sizeRate === 0 && !server.isDefault)
        throw Error(
          "Dieser Server ist nicht der Seerr-Standard. Nur das aktuelle Medium ändern oder die Serverauswahl in Seerr prüfen.",
        );
      const profiles = await s.arr(service, "/qualityprofile");
      if (!Array.isArray(profiles))
        throw Error("Qualitätsprofile nicht erreichbar.");
      let profile,
        sizePolicy = null;
      if (sizeRate !== 0) {
        if (kind !== "movie" || !this.hub.sizeLimits)
          throw Error("Individuelle Größenregeln sind nur für Filme verfügbar.");
        sizePolicy = await this.hub.sizeLimits.ensure(s, plan, Number(item.runtime), sizeRate);
        profile = await s.arr(
          service,
          `/qualityprofile/${sizePolicy.profileId}`,
        );
      } else if (body.profile === "1080p-compact") {
        if (profiles.some((p) => p.name === compactProfileName))
          throw Error(
            "Das StackPilot-1080p-Profil existiert bereits. Aus der Profilliste auswählen.",
          );
        const schema = await s.arr(service, "/qualityprofile/schema");
        profile = await s.arr(service, "/qualityprofile", {
          method: "POST",
          body: compactProfile(schema),
        });
      } else {
        profile = profiles.find((p) => p.id === positiveId(body.profile) && !isSeriesLimitProfile(p) && !isFilmLimitProfile(p));
        if (!profile)
          throw Error("Gewähltes Qualitätsprofil existiert nicht mehr.");
      }
      positiveId(profile.id);
      const actualProfile = await s.arr(
        service,
        `/qualityprofile/${profile.id}`,
      );
      if (profile.name === compactProfileName && !compactValid(actualProfile))
        throw Error(
          "Das gewählte 1080p-Profil schließt Remux nicht zuverlässig aus oder erlaubt Upgrades. Native Profilregeln prüfen.",
        );
      sizePolicy ||= this.hub.sizeLimits?.owned(plan, actualProfile);
      if (sizePolicy) {
        if (body.alsoFuture === true && sizeRate === 0)
          throw Error("Wähle eine Größenregel pro Stunde, um sie als Standard zu speichern.");
        await this.hub.sizeLimits.verify(s, sizePolicy);
      }
      const backupId = randomUUID();
      this.hub.engine.vault.set(`quality-change:${backupId}`, {
        planId: plan.id,
        service,
        item,
        server: body.alsoFuture ? server : null,
        createdAt: new Date().toISOString(),
      });
      await s.arr(
        service,
        `/${kind === "movie" ? "movie" : "series"}/${item.id}`,
        { method: "PUT", body: { ...item, qualityProfileId: profile.id } },
      );
      const confirmed = await s.arr(
        service,
        `/${kind === "movie" ? "movie" : "series"}/${item.id}`,
      );
      if (confirmed?.qualityProfileId !== profile.id)
        throw Error(
          "Radarr/Sonarr hat den Profilwechsel nicht bestätigt. Nicht erneut löschen; das aktuelle Profil prüfen.",
        );
      const policy = {
        profileId: profile.id,
        profileName: profile.name,
        serverId: server.id,
        compact: profile.name === compactProfileName || !!sizePolicy,
        ...(sizePolicy ? { size: sizePolicy } : {}),
        updatedAt: new Date().toISOString(),
      };
      this.hub.engine.vault.set(
        qualityPolicyKey(plan, kind, positiveId(target.mediaId)),
        policy,
      );
      let futureUpdated = false,
        warning = null;
      if (body.alsoFuture === true && sizeRate !== 0) {
        this.hub.sizeLimits.setDefault(plan, sizeRate);
        futureUpdated = true;
      } else if (body.alsoFuture === true) {
        try {
          const list = await s.additional.seerr(
            `/settings/${service.toLowerCase()}`,
          );
          const current = list.find((v) => v.id === server.id);
          if (!current || JSON.stringify(current) !== JSON.stringify(server))
            throw Error("changed");
          await s.additional.seerr(
            `/settings/${service.toLowerCase()}/${server.id}`,
            {
              method: "PUT",
              body: {
                ...current,
                id: undefined,
                activeProfileId: profile.id,
                activeProfileName: profile.name,
              },
            },
          );
          const verified = await s.additional.seerr(
            `/settings/${service.toLowerCase()}`,
          );
          const saved = Array.isArray(verified)
            ? verified.find((v) => v.id === server.id)
            : null;
          if (Number(saved?.activeProfileId) !== profile.id)
            throw Error("not saved");
          this.hub.engine.vault.set(qualityDefaultKey(plan, service), policy);
          futureUpdated = true;
        } catch {
          warning =
            "Das Profil des Mediums wurde geändert. Der Standard für zukünftige Anfragen konnte nicht bestätigt werden; Seerr-Einstellungen prüfen.";
        }
      }
      return {
        ok: true,
        profileName: profile.name,
        currentVerified: true,
        futureUpdated,
        warning,
      };
    });
  }
}
