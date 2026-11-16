import { createHash, randomUUID } from "node:crypto";

const prefix = "StackPilot Serienlimit ";
export const seriesLimitsKey = (plan, mediaId) => `series-size:${plan.rootId || plan.id}:${mediaId}`;
export const isSeriesLimitProfile = (profile) => /^StackPilot Serienlimit [a-f0-9-]{36}$/.test(profile?.name ?? "");

function qualityItems(items) {
  return items.map(({ id, allowed, quality, items: children }) => [id, allowed, quality?.id, qualityItems(children || [])]);
}

function profileSignature(profile) {
  const { upgradeAllowed, cutoff, minFormatScore, cutoffFormatScore, minUpgradeFormatScore, items, formatItems } = profile;
  return createHash("sha256").update(JSON.stringify([
    upgradeAllowed, cutoff, minFormatScore, cutoffFormatScore, minUpgradeFormatScore, qualityItems(items),
    formatItems.filter(({ score }) => score !== 0).map(({ format, score }) => [format, score]).sort(([a], [b]) => a - b),
  ])).digest("hex");
}

function ruleMatches(actual, rule) {
  if (actual?.name !== rule.name || actual.includeCustomFormatWhenRenaming !== false || actual.specifications?.length !== 2)
    return false;
  return actual.specifications.every((spec, index) => {
    const expected = rule.specifications[index];
    return spec.implementation === expected.implementation && spec.required === true && spec.negate === expected.negate &&
      spec.fields?.length === expected.fields.length && expected.fields.every(({ name, value }) =>
        spec.fields.some((field) => field.name === name && field.value != null && Number(field.value) === value));
  });
}

export async function verifySeriesLimitProfile(s, managed) {
  const arr = (route) => s.arr("Sonarr", route);
  const [profile, ...formats] = await Promise.all([
    arr(`/qualityprofile/${managed.profileId}`), ...managed.rules.map(({ id }) => arr(`/customformat/${id}`)),
  ]);
  if (profile?.name !== managed.name || profileSignature(profile) !== managed.signature ||
      !formats.every((format, index) => ruleMatches(format, managed.rules[index])))
    throw Error("Das StackPilot-Größenprofil wurde in Sonarr geändert. Größenlimits erneut speichern oder zum bisherigen Profil zurückkehren.");
}

async function createSeriesLimitProfile(arr, base, series, limits, draft) {
  const schema = await arr("/customformat/schema");
  const releaseType = schema.find(({ implementation }) => implementation === "ReleaseTypeSpecification");
  const size = schema.find(({ implementation }) => implementation === "SizeSpecification");
  const seasonPack = releaseType?.fields?.find(({ name }) => name === "value")?.selectOptions?.find(({ name }) => name === "Season Pack")?.value;
  if (!Number.isInteger(seasonPack) || !["min", "max"].every((name) => size?.fields?.some((field) => field.name === name)))
    throw Error("Sonarr unterstützt die benötigten Größen- und Staffelpaketregeln nicht.");
  if (!Number.isInteger(base.minFormatScore) || !base.formatItems.every(({ score }) => Number.isInteger(score)))
    throw Error("Die Bewertungen im bisherigen Sonarr-Profil konnten nicht übernommen werden.");
  // Existing positive scores must never compensate for an oversized release.
  const positive = base.formatItems.reduce((total, { score }) => total + Math.max(0, score), 0);
  const negative = base.formatItems.reduce((total, { score }) => total + Math.min(0, score), 0);
  const penalty = Math.min(-1, base.minFormatScore - positive - 1);
  if (positive > 2147483647 || negative + penalty < -2147483648)
    throw Error("Die Formatbewertungen im bisherigen Profil sind für ein zusätzliches Größenlimit zu groß.");
  const spec = (schema, values, negate, name) => ({
    ...schema, name, required: true, negate,
    fields: schema.fields.map((field) => ({ ...field, value: values[field.name] })),
  });
  for (const [pack, max] of [[false, limits.episodeGiB], [true, limits.packageGiB]]) {
    if (!max) continue;
    const suffix = pack ? "Staffelpaket" : "Folgenrelease";
    const rule = {
      name: `${draft.name} ${suffix}`,
      includeCustomFormatWhenRenaming: false,
      specifications: [spec(releaseType, { value: seasonPack }, !pack, suffix), spec(size, { min: 0, max }, true, "Außerhalb des Größenlimits")],
    };
    const actual = await arr("/customformat", { method: "POST", body: rule });
    if (!Number.isSafeInteger(actual?.id) || actual.id < 1)
      throw Error("Sonarr hat die neue Größenregel nicht bestätigt.");
    draft.rules.push({ ...rule, id: actual.id });
    if (!ruleMatches(actual, rule)) throw Error("Sonarr hat die Größenregel verändert.");
  }
  const { id: baseProfileId, ...template } = base;
  const body = { ...template, name: draft.name, formatItems: [
    ...base.formatItems,
    ...draft.rules.map(({ id: format, name }) => ({ format, name, score: penalty })),
  ] };
  const created = await arr("/qualityprofile", { method: "POST", body });
  if (!Number.isSafeInteger(created?.id) || created.id < 1)
    throw Error("Sonarr hat das neue Größenprofil nicht bestätigt.");
  draft.profileId = created.id;
  return { ...draft, baseProfileId, baseProfileName: base.name, seriesId: series.id, signature: profileSignature(body) };
}

async function removeUnused(s, managed) {
  if (!managed) return;
  const arr = (route, options) => s.arr("Sonarr", route, options);
  try {
    if (managed.profileId) {
      const profiles = await arr("/qualityprofile");
      const profile = profiles.find(({ id }) => id === managed.profileId);
      if (profile) {
        const [series, servers] = await Promise.all([arr("/series"), s.additional.seerr("/settings/sonarr")]);
        if (profile.name !== managed.name || series.some((item) => item.qualityProfileId === profile.id) ||
            servers.some((server) => [server.activeProfileId, server.activeAnimeProfileId].some((id) => Number(id) === profile.id))) return;
        await arr(`/qualityprofile/${profile.id}`, { method: "DELETE" });
      }
    }
    const profiles = await arr("/qualityprofile");
    const formats = await arr("/customformat");
    for (const rule of managed.rules) {
      if (ruleMatches(formats.find(({ id }) => id === rule.id), rule) &&
          !profiles.some(({ formatItems }) => formatItems.some(({ format, score }) => format === rule.id && score !== 0)))
        await arr(`/customformat/${rule.id}`, { method: "DELETE" });
    }
  } catch {
    // Sonarr may keep unassigned rules if it is unavailable or they are used elsewhere.
  }
}

export async function saveAutomaticSeriesLimits(s, vault, key, target, limits, automatic) {
  const arr = (route, options) => s.arr("Sonarr", route, options);
  const route = `/series/${target.item.id}`;
  let current = vault.get(key);
  let series = await arr(route);
  if (series?.id !== target.item.id || series.tvdbId !== target.item.tvdbId || !Number.isSafeInteger(series.qualityProfileId))
    throw Error("Die Serie konnte in Sonarr nicht eindeutig bestätigt werden.");

  async function finishChange(pending) {
    if (pending.seriesId !== series.id || ![pending.from, pending.to].includes(series.qualityProfileId))
      throw Error("Das Serienprofil wurde inzwischen in Sonarr geändert. Prüfe die Profilzuordnung in Sonarr.");
    if (pending.next.automatic) await verifySeriesLimitProfile(s, pending.next.automatic);
    const latest = await arr(route);
    if (latest?.tvdbId !== series.tvdbId || latest.qualityProfileId !== series.qualityProfileId)
      throw Error("Die Serie oder ihr Profil wurde während der Prüfung geändert. Erneut prüfen.");
    if (latest.qualityProfileId !== pending.to) {
      await arr(route, { method: "PUT", body: { ...latest, qualityProfileId: pending.to } });
      series = await arr(route);
      if (series?.tvdbId !== latest.tvdbId || series.qualityProfileId !== pending.to)
        throw Error("Sonarr hat den Profilwechsel noch nicht bestätigt. Speichere die Limits erneut, um die Zuordnung zu prüfen.");
    }
    const previous = current?.automatic;
    current = pending.next;
    vault.set(key, current);
    await removeUnused(s, previous);
  }

  if (current?.pending) await finishChange(current.pending);
  const previous = current?.automatic;
  if (previous && (previous.seriesId !== series.id || previous.tvdbId !== series.tvdbId ||
      (previous.profileId !== series.qualityProfileId && (automatic || previous.baseProfileId !== series.qualityProfileId))))
    throw Error("Die Serie verwendet inzwischen ein anderes Sonarr-Profil. Stelle zuerst die gespeicherte Zuordnung in Sonarr wieder her.");
  const baseProfileId = previous?.baseProfileId ?? series.qualityProfileId;
  const base = await arr(`/qualityprofile/${baseProfileId}`);
  if (base?.id !== baseProfileId || isSeriesLimitProfile(base))
    throw Error("Das bisherige Sonarr-Profil konnte nicht eindeutig bestätigt werden.");
  let next = { ...limits };
  if (automatic) {
    if (previous && current.episodeGiB === limits.episodeGiB && current.packageGiB === limits.packageGiB) {
      try {
        await verifySeriesLimitProfile(s, previous);
        return current;
      } catch {
        // Rebuild from the original profile if the active size rules have drifted.
      }
    }
    const draft = { name: `${prefix}${randomUUID()}`, rules: [] };
    try {
      next.automatic = await createSeriesLimitProfile(arr, base, series, limits, draft);
      next.automatic.tvdbId = series.tvdbId;
      await verifySeriesLimitProfile(s, next.automatic);
    } catch (error) {
      await removeUnused(s, draft);
      throw error;
    }
  }
  const pending = { seriesId: series.id, from: series.qualityProfileId, to: next.automatic?.profileId ?? baseProfileId, next };
  vault.set(key, { ...current, pending });
  await finishChange(pending);
  return current;
}
