import {
  allowedQualities,
  compactValid,
  qualityPolicyKey,
  qualityDefaultKey,
} from "./quality-policy.js";
import { randomUUID } from "node:crypto";
import { positiveId } from "./media-hub.js";
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
      sizePolicy:
        this.hub.engine.vault.get(
          qualityPolicyKey(plan, target.kind, target.mediaId),
        )?.size || null,
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
      profiles: profiles.map((p) => ({
        id: p.id,
        name: p.name,
        allowed: allowedQualities(p.items),
      })),
      canCreateCompact: !profiles.some((p) => p.name === compactProfileName),
    };
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
      if (item.qualityProfileId !== positiveId(body.previousProfileId))
        throw Error("Das Profil wurde inzwischen geändert. Neu laden.");
      if (body.alsoFuture === true && !server.isDefault)
        throw Error(
          "Dieser Server ist nicht der Seerr-Standard. Nur das aktuelle Medium ändern oder die Serverauswahl in Seerr prüfen.",
        );
      const profiles = await s.arr(service, "/qualityprofile");
      if (!Array.isArray(profiles))
        throw Error("Qualitätsprofile nicht erreichbar.");
      let profile,
        sizePolicy = null;
      if (
        body.sizeGiBPerHour !== undefined &&
        Number(body.sizeGiBPerHour) !== 0
      ) {
        if (kind !== "movie" || !this.hub.sizeLimits)
          throw Error(
            "Individuelle Größenregeln sind nur für Filme verfügbar.",
          );
        if (body.alsoFuture === true)
          throw Error(
            "Größenstandard separat unter Medienprofile einstellen; diese Grenze gilt nur für diesen Film.",
          );
        sizePolicy = await this.hub.sizeLimits.ensure(
          s,
          plan,
          Number(item.runtime),
          Number(body.sizeGiBPerHour),
        );
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
        profile = profiles.find((p) => p.id === positiveId(body.profile));
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
      if (sizePolicy) await this.hub.sizeLimits.verify(s, sizePolicy);
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
      if (body.alsoFuture === true) {
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
