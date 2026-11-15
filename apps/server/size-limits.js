import { compactProfile, compactProfileName } from "./quality-settings.js";
import { compactValid } from "./quality-policy.js";
import { positiveId } from "./media-hub.js";
const rates = [1, 2, 3, 4, 6, 8];
export function sizeCap(runtime, rate) {
  if (
    !Number.isFinite(runtime) ||
    runtime < 1 ||
    runtime > 1000 ||
    !rates.includes(rate)
  )
    throw Error("Gültige Filmlaufzeit und Größenregel erforderlich.");
  return Math.ceil(((runtime * rate) / 60) * 2) / 2;
}
export function validSizeFormat(format, cap) {
  const specs = format?.specifications;
  if (!Array.isArray(specs) || specs.length !== 1) return false;
  const s = specs[0],
    fields = new Map((s.fields || []).map((v) => [v.name, v.value]));
  return (
    s.implementation === "SizeSpecification" &&
    s.negate === false &&
    s.required === true &&
    Number(fields.get("min")) === 0 &&
    Number(fields.get("max")) === cap &&
    format.includeCustomFormatWhenRenaming === false
  );
}
export function validSizeProfile(profile, formatId) {
  return (
    compactValid(profile) &&
    profile.minFormatScore === 1 &&
    profile.formatItems?.filter((v) => v.format === formatId && v.score === 1)
      .length === 1 &&
    profile.formatItems.every((v) =>
      v.format === formatId ? v.score === 1 : v.score === 0,
    )
  );
}
export class SizeLimits {
  constructor(hub) {
    this.hub = hub;
  }
  key(plan) {
    return `size-default:${plan.rootId || plan.id}`;
  }
  config(plan) {
    return this.hub.engine.vault.get(this.key(plan)) || { rate: 0 };
  }
  async settings() {
    const { plan } = await this.hub.context(["Seerr", "Radarr"]);
    return {
      ...this.config(plan),
      rates,
      scope:
        "Neue Filmanfragen aus StackPilot; Serien und andere Radarr-Profile bleiben unverändert.",
    };
  }
  async save(body) {
    const rate = Number(body.rate);
    if (![0, ...rates].includes(rate) || body.confirmation !== "OK")
      throw Error("Größenregel mit OK bestätigen.");
    return this.hub.mutate(["Seerr", "Radarr"], async ({ plan }) => {
      this.hub.engine.vault.set(this.key(plan), {
        rate,
        updatedAt: new Date().toISOString(),
      });
      return {
        ok: true,
        message: rate
          ? `Neue StackPilot-Filmanfragen verwenden 1080p ohne Remux mit höchstens ${rate} GiB pro Stunde Laufzeit.`
          : "Kein Größenstandard für neue Anfragen aktiv. Bereits angelegte Filmprofile bleiben unverändert.",
      };
    });
  }
  async ensure(s, plan, runtime, rate) {
    const cap = sizeCap(runtime, rate),
      key = `size-profile:${plan.rootId || plan.id}:${cap}`,
      vault = this.hub.engine.vault;
    let own = vault.get(key);
    const formatName = `StackPilot Größe ≤ ${cap} GiB`,
      profileName = `StackPilot 1080p ≤ ${cap} GiB`;
    const formats = await s.arr("Radarr", "/customformat"),
      profiles = await s.arr("Radarr", "/qualityprofile");
    if (!Array.isArray(formats) || !Array.isArray(profiles))
      throw Error("Native Größenprofile sind nicht erreichbar.");
    if (
      own?.status === "ready" &&
      (!formats.some((v) => v.id === own.formatId && v.name === formatName) ||
        !profiles.some((v) => v.id === own.profileId && v.name === profileName))
    )
      throw Error(
        "Ein bestehendes Größenprofil wurde entfernt oder umbenannt. Keine automatische Ersetzung.",
      );
    if (
      !own &&
      (formats.some((v) => v.name === formatName) ||
        profiles.some((v) => v.name === profileName))
    )
      throw Error(
        "Vorhandenes Größenprofil wird nicht still übernommen. Eigenes Profil zuerst prüfen.",
      );
    own ||= { status: "preparing", cap, formatName, profileName };
    vault.set(key, own);
    let format = formats.find((v) => v.name === formatName);
    if (!format) {
      const schema = await s.arr("Radarr", "/customformat/schema"),
        size = schema.find((v) => v.implementation === "SizeSpecification");
      if (
        !size ||
        !["min", "max"].every((n) => size.fields?.some((f) => f.name === n))
      )
        throw Error(
          "Radarr unterstützt die erwartete native Größenregel nicht.",
        );
      format = await s.arr("Radarr", "/customformat", {
        method: "POST",
        body: {
          name: formatName,
          includeCustomFormatWhenRenaming: false,
          specifications: [
            {
              ...size,
              name: "Größenobergrenze",
              required: true,
              negate: false,
              fields: size.fields.map((f) => ({
                ...f,
                value: f.name === "max" ? cap : 0,
              })),
            },
          ],
        },
      });
    }
    positiveId(format.id);
    if (
      (own.formatId && own.formatId !== format.id) ||
      !validSizeFormat(format, cap)
    )
      throw Error("Native Größenregel wurde verändert. Keine Überschreibung.");
    own.formatId = format.id;
    vault.set(key, own);
    let profile = profiles.find((v) => v.name === profileName);
    if (!profile) {
      const schema = await s.arr("Radarr", "/qualityprofile/schema"),
        template = compactProfile(schema);
      const formatItems = (template.formatItems || [])
        .filter((v) => v.format !== format.id)
        .map((v) => ({ ...v, score: 0 }));
      formatItems.push({ format: format.id, name: formatName, score: 1 });
      profile = await s.arr("Radarr", "/qualityprofile", {
        method: "POST",
        body: {
          ...template,
          name: profileName,
          minFormatScore: 1,
          cutoffFormatScore: 1,
          formatItems,
        },
      });
    }
    positiveId(profile.id);
    const actual = await s.arr("Radarr", `/qualityprofile/${profile.id}`),
      actualFormat = await s.arr("Radarr", `/customformat/${format.id}`);
    if (
      (own.profileId && own.profileId !== profile.id) ||
      !validSizeProfile(actual, format.id) ||
      !validSizeFormat(actualFormat, cap)
    )
      throw Error("Radarr hat Größe und Qualitätsprofil nicht bestätigt.");
    own.profileId = profile.id;
    own.status = "ready";
    vault.set(key, own);
    return { profileId: profile.id, formatId: format.id, capGiB: cap, rate };
  }
  owned(plan, profile) {
    const match = /^StackPilot 1080p ≤ ([0-9.]+) GiB$/.exec(profile.name || "");
    if (!match) return null;
    const record = this.hub.engine.vault.get(
      `size-profile:${plan.rootId || plan.id}:${Number(match[1])}`,
    );
    return record?.status === "ready" && record.profileId === profile.id
      ? { profileId: profile.id, formatId: record.formatId, capGiB: record.cap }
      : null;
  }
  async forRequest(s, plan, detail, rate) {
    const actor = await s.additional.seerr("/auth/me");
    if (
      !Number.isSafeInteger(actor?.permissions) ||
      (actor.permissions & 1) !== 1
    )
      throw Error(
        "Seerr erlaubt keine verbindliche Profilvorgabe. Dienstberechtigungen zuerst prüfen.",
      );
    const bound = await this.ensure(
      s,
      plan,
      Number(detail.runtime),
      Number(rate),
    );
    const list = await s.additional.seerr("/settings/radarr"),
      server = list.find((v) => v.isDefault && !v.is4k);
    if (
      !server ||
      server.hostname !== "radarr" ||
      Number(server.port) !== 7878 ||
      server.useSsl ||
      ![undefined, "", "/"].includes(server.baseUrl)
    )
      throw Error("Größenprofil gehört nicht zum verwalteten Radarr-Standard.");
    return { ...bound, serverId: server.id };
  }
  async verify(s, size) {
    if (
      !validSizeFormat(
        await s.arr("Radarr", `/customformat/${positiveId(size.formatId)}`),
        size.capGiB,
      ) ||
      !validSizeProfile(
        await s.arr("Radarr", `/qualityprofile/${positiveId(size.profileId)}`),
        size.formatId,
      )
    )
      throw Error(
        "Das gespeicherte Größenprofil wurde verändert. Vor einer Suche erneut bestätigen.",
      );
  }
}
