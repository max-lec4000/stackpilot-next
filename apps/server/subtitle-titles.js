// Qualität & Quellen → Untertitel je Titel (Phase 7 Paket 7.3): einen Film oder eine Serie
// suchen, vorhandene und fehlende Untertitel sehen, fehlende suchen, einen schlechten
// Untertitel ersetzen (Bazarr sperrt ihn und sucht einen anderen) oder löschen.
// Dateipfade bleiben im Server; die Oberfläche bekommt nur Kennungen.
import { createHash } from "node:crypto";

const list = (v) => (Array.isArray(v) ? v : []);
const text = (v, n = 160) => (typeof v === "string" ? v.replace(/[\x00-\x1f\x7f]+/g, " ").trim().slice(0, n) : "");
const fail = (m) => Object.assign(Error(m), { userFacing: true });
const token = (p) => createHash("sha256").update(String(p)).digest("hex").slice(0, 16);
const flag = (v) => v === true || v === "True" || v === "true";
const pad = (n) => String(n).padStart(2, "0");
const positive = (v) => (Number.isSafeInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);

export function projectSubs(row) {
  return {
    subtitles: list(row.subtitles).filter((x) => x?.code2).slice(0, 40).map((x) => ({
      token: x.path ? token(x.path) : null, language: text(x.name, 40) || x.code2, code: text(x.code2, 8),
      forced: flag(x.forced), hi: flag(x.hi), file: x.path ? text(String(x.path).split("/").pop(), 160) : null,
    })),
    missing: list(row.missing_subtitles).filter((x) => x?.code2).slice(0, 20).map((x) => ({
      language: text(x.name, 40) || x.code2, code: text(x.code2, 8), forced: flag(x.forced), hi: flag(x.hi),
    })),
  };
}

export class SubtitleTitles {
  constructor(hub) {
    this.hub = hub;
  }
  ready() {
    const current = this.hub.engine.current();
    if (current?.job.status !== "completed" || !current.plan.spec.selected.includes("Bazarr"))
      throw fail("Bazarr ist nicht eingerichtet.");
  }
  async b(route, options) {
    const { s } = await this.hub.context(["Bazarr"]);
    return s.additional.bazarr(route, options);
  }
  /** Titelsuche über Filme und Serien in Bazarr. */
  async search(query) {
    this.ready();
    const q = text(query, 80).toLowerCase();
    if (q.length < 2) throw fail("Mindestens zwei Zeichen eingeben.");
    const [movies, series] = await Promise.all([
      this.b("/movies?start=0&length=-1").then((r) => list(r?.data)).catch(() => []),
      this.b("/series?start=0&length=-1").then((r) => list(r?.data)).catch(() => []),
    ]);
    const hit = (r) => String(r.title || "").toLowerCase().includes(q);
    const results = [
      ...movies.filter(hit).filter((m) => positive(m.radarrId)).map((m) => ({
        kind: "movie", id: m.radarrId, title: text(m.title), year: text(String(m.year ?? ""), 4) || null,
        missing: list(m.missing_subtitles).length, profile: m.profileId != null })),
      ...series.filter(hit).filter((v) => positive(v.sonarrSeriesId)).map((v) => ({
        kind: "tv", id: v.sonarrSeriesId, title: text(v.title), year: text(String(v.year ?? ""), 4) || null,
        missing: Number(v.episodeMissingCount) || 0, profile: v.profileId != null })),
    ].sort((a, b) => a.title.localeCompare(b.title, "de")).slice(0, 30);
    return { results };
  }
  async movie(id) {
    const r = await this.b(`/movies?radarrid[]=${id}`);
    const m = list(r?.data).find((x) => x.radarrId === id);
    if (!m) throw fail("Film nicht in Bazarr gefunden. Neu suchen.");
    return m;
  }
  async episodes(id) {
    const r = await this.b(`/episodes?seriesid[]=${id}`);
    return list(r?.data).filter((e) => e.sonarrSeriesId === id && positive(e.sonarrEpisodeId))
      .sort((a, b) => a.season - b.season || a.episode - b.episode).slice(0, 1000);
  }
  async detail(kind, rawId) {
    this.ready();
    const id = positive(rawId);
    if (!id || !["movie", "tv"].includes(kind)) throw fail("Ungültige Auswahl.");
    if (kind === "movie") {
      const m = await this.movie(id);
      return { kind, id, title: text(m.title), profile: m.profileId != null, ...projectSubs(m) };
    }
    const s = await this.b(`/series?seriesid[]=${id}`).then((r) => list(r?.data).find((x) => x.sonarrSeriesId === id)).catch(() => null);
    const eps = await this.episodes(id);
    if (!s && !eps.length) throw fail("Serie nicht in Bazarr gefunden. Neu suchen.");
    return {
      kind, id, title: text(s?.title) || "Serie", profile: s ? s.profileId != null : true,
      episodes: eps.map((e) => ({ id: e.sonarrEpisodeId, label: `S${pad(e.season)}E${pad(e.episode)} – ${text(e.title, 80)}`, ...projectSubs(e) })),
    };
  }
  /**
   * body: { kind, id, action, episodeId?, language?, forced?, hi?, token?, confirmation? }
   * search-missing – alle fehlenden des Titels suchen
   * search         – eine fehlende Sprache suchen
   * replace (OK)   – vorhandenen Untertitel sperren, löschen und einen anderen suchen
   * delete (OK)    – vorhandenen Untertitel löschen
   */
  async act(body) {
    this.ready();
    const id = positive(body.id), kind = body.kind;
    if (!id || !["movie", "tv"].includes(kind)) throw fail("Ungültige Auswahl.");
    if (!["search-missing", "search", "replace", "delete"].includes(body.action)) throw fail("Unbekannte Aktion.");
    if (["replace", "delete"].includes(body.action) && body.confirmation !== "OK")
      throw fail(body.action === "replace" ? "Ersetzen mit OK bestätigen." : "Löschen mit OK bestätigen.");
    return this.hub.mutate(["Bazarr"], async ({ s }) => {
      const b = (route, options) => s.additional.bazarr(route, options);
      if (body.action === "search-missing") {
        await b(kind === "movie" ? `/movies?radarrid=${id}&action=search-missing` : `/series?seriesid=${id}&action=search-missing`, { method: "PATCH" });
        return { ok: true, message: "Bazarr sucht die fehlenden Untertitel. Das dauert meist ein bis zwei Minuten – danach neu laden." };
      }
      const episodeId = kind === "tv" ? positive(body.episodeId) : null;
      if (kind === "tv" && !episodeId) throw fail("Folge wählen.");
      const row = kind === "movie" ? await this.movie(id) : (await this.episodes(id)).find((e) => e.sonarrEpisodeId === episodeId);
      if (!row) throw fail("Folge nicht gefunden. Neu laden.");
      const target = kind === "movie" ? `radarrid=${id}` : `seriesid=${id}&episodeid=${episodeId}`;
      const base = kind === "movie" ? "/movies" : "/episodes";
      if (body.action === "search") {
        const m = list(row.missing_subtitles).find((x) => x.code2 === body.language && flag(x.forced) === !!body.forced && flag(x.hi) === !!body.hi);
        if (!m) throw fail("Diese Sprache fehlt nicht (mehr). Neu laden.");
        await this.slow(() => b(`${base}/subtitles?${target}&language=${encodeURIComponent(m.code2)}&forced=${flag(m.forced)}&hi=${flag(m.hi)}`, { method: "PATCH" }));
        const after = projectSubs(kind === "movie" ? await this.movie(id) : (await this.episodes(id)).find((e) => e.sonarrEpisodeId === episodeId) || {});
        return after.missing.some((x) => x.code === m.code2 && x.forced === flag(m.forced) && x.hi === flag(m.hi))
          ? { ok: true, found: false, message: `Kein passender Untertitel (${text(m.name, 40) || m.code2}) gefunden. Später erneut versuchen oder weitere Anbieter einschalten.` }
          : { ok: true, found: true, message: `Untertitel (${text(m.name, 40) || m.code2}) geladen.` };
      }
      const sub = list(row.subtitles).find((x) => x.path && token(x.path) === body.token);
      if (!sub) throw fail("Der Untertitel ist nicht mehr da. Neu laden.");
      const lang = `language=${encodeURIComponent(sub.code2)}&forced=${flag(sub.forced)}&hi=${flag(sub.hi)}`;
      if (body.action === "delete") {
        await b(`${base}/subtitles?${target}&${lang}&path=${encodeURIComponent(sub.path)}`, { method: "DELETE" });
        return { ok: true, message: `Untertitel (${text(sub.name, 40) || sub.code2}) gelöscht.` };
      }
      // Ersetzen: Herkunft aus dem Verlauf; ohne Herkunft (z. B. fremde Datei) nur neu suchen
      const history = await b(kind === "movie" ? `/movies/history?radarrid=${id}` : `/episodes/history?episodeid=${episodeId}`).catch(() => null);
      const origin = list(history?.data).find((h) => h.subtitles_path === sub.path && h.provider && h.subs_id);
      if (!origin) {
        await this.slow(() => b(`${base}/subtitles?${target}&${lang}`, { method: "PATCH" }));
        return { ok: true, message: "Herkunft unbekannt – Bazarr hat neu gesucht und überschreibt den Untertitel nur, wenn es einen passenden findet." };
      }
      const form = new URLSearchParams({
        ...(kind === "movie" ? { radarrid: String(id) } : { seriesid: String(id), episodeid: String(episodeId) }),
        provider: origin.provider, subs_id: origin.subs_id, language: sub.code2, subtitles_path: sub.path,
      });
      await this.slow(() => b(`${base}/blacklist?${form}`, { method: "POST" }));
      return { ok: true, message: `Untertitel von ${text(origin.provider, 40)} gesperrt und gelöscht; Bazarr sucht einen anderen. Danach neu laden.` };
    });
  }
  /** Bazarr sucht synchron; dauert das länger als unsere Wartezeit, läuft es trotzdem weiter. */
  async slow(fn) {
    try {
      await fn();
    } catch (e) {
      if (/nicht erreichbar|fehlgeschlagen|timeout/i.test(e.message))
        throw fail("Bazarr antwortet noch nicht – die Suche läuft vermutlich weiter. In ein, zwei Minuten neu laden.");
      throw e;
    }
  }
}
