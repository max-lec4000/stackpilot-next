// Qualität & Quellen → Untertitel (Phase 7.3a): Bazarr einstellen – gewünschte Sprachen als
// eigenes Sprachprofil „StackPilot“, automatisch für neue Filme und Serien, optional für
// vorhandene ohne Profil, und Untertitel-Anbieter. Andere Profile und Anbieter bleiben
// unverändert. Bazarr bleibt die Quelle; nach dem Speichern wird zurückgelesen.

export const PROFILE_NAME = "StackPilot";
export const LANGUAGES = [
  ["de", "Deutsch"], ["en", "Englisch"], ["fr", "Französisch"], ["es", "Spanisch"], ["it", "Italienisch"],
  ["nl", "Niederländisch"], ["pl", "Polnisch"], ["tr", "Türkisch"], ["hr", "Kroatisch"], ["sr", "Serbisch"],
  ["pt", "Portugiesisch"], ["ru", "Russisch"],
];
// Anbieter, die ohne Konto funktionieren; OpenSubtitles.com braucht ein (kostenloses) Konto.
export const PROVIDERS = [
  ["embeddedsubtitles", "Eingebettete Untertitel aus der Videodatei", false],
  ["gestdown", "Gestdown (Serien)", false],
  ["yifysubtitles", "YIFY Subtitles (Filme)", false],
  ["opensubtitlescom", "OpenSubtitles.com (kostenloses Konto)", true],
];
const LANGUAGE_CODES = new Set(LANGUAGES.map(([c]) => c));
const PROVIDER_NAMES = new Set(PROVIDERS.map(([n]) => n));
const list = (v) => (Array.isArray(v) ? v : []);
const bool = (v) => v === true || v === "true" || v === "True";

export function projection(settings, profiles, series, movies) {
  const g = settings?.general || {};
  const own = list(profiles).find((p) => p.name === PROFILE_NAME) || null;
  const count = (rows) => ({ total: rows.length, withProfile: rows.filter((r) => r.profileId !== null && r.profileId !== undefined).length,
    stackpilot: own ? rows.filter((r) => Number(r.profileId) === own.profileId).length : 0 });
  return {
    profile: own ? { id: own.profileId, languages: list(own.items).map((i) => i.language) } : null,
    otherProfiles: list(profiles).filter((p) => p !== own).map((p) => String(p.name || "").slice(0, 80)),
    defaults: {
      series: bool(g.serie_default_enabled) && !!own && String(g.serie_default_profile) === String(own.profileId),
      movies: bool(g.movie_default_enabled) && !!own && String(g.movie_default_profile) === String(own.profileId),
      otherSeries: bool(g.serie_default_enabled) && (!own || String(g.serie_default_profile) !== String(own.profileId)),
      otherMovies: bool(g.movie_default_enabled) && (!own || String(g.movie_default_profile) !== String(own.profileId)),
    },
    providers: list(g.enabled_providers).filter((p) => PROVIDER_NAMES.has(p)),
    otherProviders: list(g.enabled_providers).filter((p) => !PROVIDER_NAMES.has(p)),
    opensubtitles: !!(settings?.opensubtitlescom?.username),
    series: series ? count(series) : null,
    movies: movies ? count(movies) : null,
    options: { languages: LANGUAGES, providers: PROVIDERS },
  };
}

/** Eingaben prüfen. */
export function validate(body) {
  const languages = [...new Set(list(body.languages))];
  if (!languages.length || languages.length > 6 || !languages.every((c) => LANGUAGE_CODES.has(c)))
    throw Error("Eine bis sechs Untertitelsprachen aus der Liste wählen.");
  const providers = [...new Set(list(body.providers))];
  if (!providers.every((p) => PROVIDER_NAMES.has(p))) throw Error("Unbekannter Untertitel-Anbieter.");
  if (!providers.length) throw Error("Mindestens einen Anbieter wählen – sonst lädt Bazarr nichts.");
  let login = null;
  if (body.opensubtitles && (body.opensubtitles.username || body.opensubtitles.password)) {
    const { username, password } = body.opensubtitles;
    if (typeof username !== "string" || !/^[\w.@+-]{2,64}$/.test(username) || typeof password !== "string" || password.length < 4 || password.length > 128)
      throw Error("OpenSubtitles: Benutzername und Passwort prüfen.");
    login = { username, password };
  }
  return { languages, providers, login, defaults: body.defaults !== false, applyExisting: body.applyExisting === true };
}

export class Subtitles {
  constructor(hub) {
    this.hub = hub;
  }
  ready() {
    const current = this.hub.engine.current();
    if (current?.job.status !== "completed" || !current.plan.spec.selected.includes("Bazarr"))
      throw Object.assign(Error("Bazarr ist nicht eingerichtet."), { userFacing: true });
  }
  async state(s) {
    const b = (r) => s.additional.bazarr(r);
    const [settings, profiles, series, movies] = await Promise.all([
      b("/system/settings"), b("/system/languages/profiles"),
      b("/series?start=0&length=-1").then((r) => list(r?.data)).catch(() => null),
      b("/movies?start=0&length=-1").then((r) => list(r?.data)).catch(() => null),
    ]);
    if (!settings?.general || !Array.isArray(profiles)) throw Error("Bazarr-Einstellungen nicht lesbar.");
    return { settings, profiles, series, movies };
  }
  async read() {
    this.ready();
    const { s } = await this.hub.context(["Bazarr"]);
    const st = await this.state(s);
    return projection(st.settings, st.profiles, st.series, st.movies);
  }
  async save(body) {
    if (body.confirmation !== "OK") throw Error("Untertitel-Einstellungen mit OK bestätigen.");
    this.ready();
    const input = validate(body);
    return this.hub.mutate(["Bazarr"], async ({ s, plan }) => {
      const b = (r, o) => s.additional.bazarr(r, o);
      const before = await this.state(s);
      // Vorzustand einmalig sichern (für eine manuelle Rückkehr)
      this.hub.engine.vault.ensure?.(`snapshot:${plan.rootId || plan.id}:bazarr:subtitles`, () => ({
        general: before.settings.general, profiles: before.profiles,
      }));
      const others = before.profiles.filter((p) => p.name !== PROFILE_NAME);
      const own = before.profiles.find((p) => p.name === PROFILE_NAME);
      const profileId = own?.profileId ?? Math.max(0, ...before.profiles.map((p) => Number(p.profileId) || 0)) + 1;
      const profile = {
        profileId, name: PROFILE_NAME, cutoff: null, mustContain: [], mustNotContain: [], originalFormat: false, tag: null,
        items: input.languages.map((language, i) => ({ id: i + 1, language, audio_exclude: "False", audio_only_include: "False", hi: "False", forced: "False" })),
      };
      // Aktive Sprachen: bisher aktive behalten (andere Profile brauchen sie), gewählte ergänzen
      const enabled = new Set([...others.flatMap((p) => list(p.items).map((i) => i.language)), ...input.languages]);
      const providers = [...new Set([...list(before.settings.general.enabled_providers).filter((p) => !PROVIDER_NAMES.has(p)), ...input.providers])];
      const form = new URLSearchParams();
      for (const code of enabled) form.append("languages-enabled", code);
      form.append("languages-profiles", JSON.stringify([...others, profile]));
      for (const p of providers) form.append("settings-general-enabled_providers", p);
      if (input.defaults) {
        form.append("settings-general-serie_default_enabled", "true");
        form.append("settings-general-serie_default_profile", String(profileId));
        form.append("settings-general-movie_default_enabled", "true");
        form.append("settings-general-movie_default_profile", String(profileId));
      }
      if (input.login) {
        form.append("settings-opensubtitlescom-username", input.login.username);
        form.append("settings-opensubtitlescom-password", input.login.password);
      }
      await b("/system/settings", { method: "POST", body: form });
      let assigned = { series: 0, movies: 0 };
      if (input.applyExisting) {
        const after = await this.state(s);
        for (const [route, rows, key, idField] of [
          ["/series", after.series, "series", "sonarrSeriesId"], ["/movies", after.movies, "movies", "radarrId"],
        ]) {
          const missing = list(rows).filter((r) => (r.profileId === null || r.profileId === undefined) && Number.isSafeInteger(r[idField]));
          for (let i = 0; i < missing.length; i += 100) {
            const chunk = missing.slice(i, i + 100), f = new URLSearchParams();
            for (const r of chunk) { f.append(key === "series" ? "seriesid" : "radarrid", String(r[idField])); f.append("profileid", String(profileId)); }
            await b(route, { method: "POST", body: f });
          }
          assigned[key] = missing.length;
        }
      }
      const result = await this.state(s);
      const view = projection(result.settings, result.profiles, result.series, result.movies);
      const problems = [];
      if (!view.profile || view.profile.languages.join() !== input.languages.join()) problems.push("Sprachprofil");
      if (input.defaults && !(view.defaults.series && view.defaults.movies)) problems.push("Standard für neue Titel");
      if (!input.providers.every((p) => view.providers.includes(p))) problems.push("Anbieter");
      if (input.login && !view.opensubtitles) problems.push("OpenSubtitles-Konto");
      if (problems.length) throw Error("Bazarr hat nicht alles übernommen: " + problems.join(", ") + ".");
      return { ...view, assigned };
    });
  }
}
