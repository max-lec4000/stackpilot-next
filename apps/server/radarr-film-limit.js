import { arrAdapter } from "./adapters/arr.js";
import { randomUUID } from "node:crypto";
import { profileSignature } from "./series-limits.js";

export const filmLimitKey = (plan, mediaId) => `film-size:${plan.rootId || plan.id}:${mediaId}`;
const prefix = "StackPilot Filmlimit ";
export const isFilmLimitProfile = (profile) => /^StackPilot Filmlimit [a-f0-9-]{36}$/.test(profile?.name ?? "");

function formatMatches(actual, rule) {
  const [size] = actual?.specifications ?? [];
  return actual?.name === rule.name && actual.includeCustomFormatWhenRenaming === false &&
    actual.specifications?.length === 1 && size?.implementation === "SizeSpecification" &&
    size.required === true && size.negate === true && size.fields?.length === 2 &&
    size.fields.some((field) => field.name === "min" && field.value != null && Number(field.value) === 0) &&
    size.fields.some((field) => field.name === "max" && Number(field.value) === rule.cap);
}

async function verifyProfile(arr, managed) {
  const [profile, format] = await Promise.all([arr(`/qualityprofile/${managed.id}`), arr(`/customformat/${managed.formatId}`)]);
  if (profile?.name !== managed.name || profileSignature(profile) !== managed.signature ||
      !formatMatches(format, managed))
    throw Error("Das Filmgrößenprofil wurde in Radarr geändert. Stelle das bisherige Profil wieder her.");
}

export function verifyFilmLimitProfile(s, managed) {
  return verifyProfile((route) => s.arr("Radarr", route), managed);
}

async function discard(s, arr, rule) {
  if (!rule?.formatId) return;
  try {
    const [movies, servers, profiles] = await Promise.all([
      arr("/movie"), s.additional.seerr("/settings/radarr"), arr("/qualityprofile"),
    ]);
    if (rule.id) {
      const profile = profiles.find(({ id }) => id === rule.id);
      if (profile) {
        if (profile.name !== rule.name || profileSignature(profile) !== rule.signature ||
            movies.some((item) => item.qualityProfileId === rule.id) ||
            servers.some((server) => Number(server.activeProfileId) === rule.id)) return;
        await arr(`/qualityprofile/${rule.id}`, { method: "DELETE" });
      }
    }
    const remaining = await arr("/qualityprofile");
    const format = await arr(`/customformat/${rule.formatId}`);
    if (formatMatches(format, rule) && !remaining.some((profile) =>
      profile.formatItems.some((entry) => entry.format === rule.formatId && entry.score)))
      await arr(`/customformat/${rule.formatId}`, { method: "DELETE" });
  } catch {
    // An uncertain or externally used object is retained.
  }
}

export async function saveAutomaticFilmLimit(s, vault, key, item, cap) {
  if (!Number.isFinite(cap) || cap < 0 || cap > 200 || !Number.isInteger(cap * 2))
    throw Error("Eine Obergrenze von 0,5 bis 200 GiB in halben GiB oder 0 zum Ausschalten angeben.");
  const arr = (route, options) => s.arr("Radarr", route, options);
  const route = `/movie/${item.id}`;
  let movie = await arr(route);
  if (movie.id !== item.id || movie.tmdbId !== item.tmdbId || !Number.isSafeInteger(movie.qualityProfileId))
    throw Error("Der Film konnte in Radarr nicht eindeutig bestätigt werden.");
  let stored = vault.get(key) || {};
  if (stored.movieId && (stored.movieId !== movie.id || stored.tmdbId !== movie.tmdbId))
    throw Error("Die gespeicherte Regel gehört zu einem anderen Radarr-Film.");

  async function finish(pending) {
    if (![pending.from, pending.to].includes(movie.qualityProfileId))
      throw Error("Das Radarr-Profil wurde inzwischen geändert. Zuordnung prüfen.");
    if (pending.next) await verifyProfile(arr, pending.next);
    const latest = await arr(route);
    if (latest.tmdbId !== movie.tmdbId || latest.qualityProfileId !== movie.qualityProfileId)
      throw Error("Die Filmzuordnung wurde während der Prüfung geändert.");
    movie = await arrAdapter(s, "Radarr").assignMovieProfile(latest, pending.to, item.tmdbId,
      "Radarr hat die Profilzuweisung nicht bestätigt. Speichere die Grenze erneut.");
    const previous = stored.rule;
    stored = pending.next ? { movieId: item.id, tmdbId: item.tmdbId, base: stored.base, rule: pending.next } : {};
    vault.set(key, stored);
    await discard(s, arr, previous);
  }

  if (stored.pending) await finish(stored.pending);
  const previous = stored.rule;
  if (previous && movie.qualityProfileId !== previous.id)
    throw Error("Der Film verwendet inzwischen ein anderes Radarr-Profil.");
  if (cap === 0 && !previous) return { capGiB: 0 };
  if (previous?.cap === cap) {
    await verifyProfile(arr, previous);
    return { capGiB: cap };
  }
  const baseId = stored.base ?? movie.qualityProfileId;
  const base = await arr(`/qualityprofile/${baseId}`);
  if (base?.id !== baseId || isFilmLimitProfile(base))
    throw Error("Das bisherige Radarr-Profil konnte nicht bestätigt werden.");
  let next = null;
  if (cap > 0) {
    const schema = (await arr("/customformat/schema")).find((entry) => entry.implementation === "SizeSpecification");
    if (!["min","max"].every((name) => schema?.fields?.some((field) => field.name === name)) ||
        !Number.isInteger(base.minFormatScore) || !base.formatItems.every((entry) => Number.isInteger(entry.score)))
      throw Error("Radarrs Größenregeln oder Formatbewertungen konnten nicht bestätigt werden.");
    const positive = base.formatItems.reduce((sum, {score}) => sum + Math.max(0, score), 0);
    const negative = base.formatItems.reduce((sum, {score}) => sum + Math.min(0, score), 0);
    const penalty = Math.min(-1, base.minFormatScore - positive - 1);
    if (positive > 2147483647 || negative + penalty < -2147483648)
      throw Error("Die bestehenden Formatbewertungen sind für das zusätzliche Limit zu groß.");
    const draft = { name: prefix + randomUUID(), cap };
    try {
      const format = await arr("/customformat", { method: "POST", body: {
        name: draft.name, includeCustomFormatWhenRenaming: false, specifications: [{
          ...schema, name: "Außerhalb der Obergrenze", required: true, negate: true,
          fields: schema.fields.map((field) => ({ ...field, value: field.name === "max" ? cap : 0 })),
        }],
      }});
      if (!Number.isSafeInteger(format?.id) || format.id < 1) throw Error("Radarr hat die Größenregel nicht angelegt.");
      draft.formatId = format.id;
      if (!formatMatches(format, draft)) throw Error("Radarr hat die Größenregel verändert.");
      const { id, ...body } = base;
      body.name = draft.name;
      body.formatItems = [...base.formatItems, { format: format.id, name: format.name, score: penalty }];
      draft.signature = profileSignature(body);
      const profile = await arr("/qualityprofile", { method: "POST", body });
      if (!Number.isSafeInteger(profile?.id) || profile.id < 1) throw Error("Radarr hat das Größenprofil nicht angelegt.");
      draft.id = profile.id;
      await verifyProfile(arr, draft);
      next = draft;
    } catch (error) {
      await discard(s, arr, draft);
      throw error;
    }
  }
  const pending = { from: movie.qualityProfileId, to: next?.id ?? baseId, next };
  stored = { ...stored, movieId: item.id, tmdbId: item.tmdbId, base: baseId, pending };
  vault.set(key, stored);
  await finish(pending);
  return { capGiB: cap };
}
