// Medien → Serien (Phase 7 Paket 7.2): Überwachung zentral – ganze Serie, neue Staffeln und
// einzelne Staffeln an/aus, fehlende Folgen gezielt suchen. Sonarr bleibt die Quelle: StackPilot
// schreibt die Serie zurück und liest sie danach erneut. Überwachung einschalten kann Downloads
// auslösen und braucht deshalb OK; ausschalten nicht.

const text = (v, n = 160) => (typeof v === "string" ? v.replace(/[\x00-\x1f\x7f]+/g, " ").trim().slice(0, n) : "");
const positive = (v) => (Number.isSafeInteger(v) && v > 0 ? v : null);
const fail = (m) => Object.assign(Error(m), { userFacing: true });

export function projectSeries(v) {
  const seasons = (Array.isArray(v.seasons) ? v.seasons : [])
    .filter((x) => Number.isSafeInteger(x.seasonNumber))
    .sort((a, b) => a.seasonNumber - b.seasonNumber)
    .map((x) => ({
      number: x.seasonNumber, monitored: x.monitored === true,
      files: x.statistics?.episodeFileCount ?? 0, aired: x.statistics?.episodeCount ?? 0, total: x.statistics?.totalEpisodeCount ?? 0,
    }));
  const st = v.statistics || {};
  return {
    id: v.id, title: text(v.title, 120) || "Unbenannte Serie", year: Number.isSafeInteger(v.year) && v.year > 0 ? v.year : null,
    monitored: v.monitored === true, newSeasons: v.monitorNewItems === "all", ended: v.status === "ended",
    // episodeCount zählt bei Sonarr nur überwachte, schon erschienene Folgen
    files: st.episodeFileCount ?? 0, aired: st.episodeCount ?? 0, total: st.totalEpisodeCount ?? 0,
    missing: Math.max(0, (st.episodeCount ?? 0) - (st.episodeFileCount ?? 0)),
    seasons,
  };
}

export class SeriesMonitoring {
  constructor(hub) {
    this.hub = hub;
  }
  ready() {
    const current = this.hub.engine.current();
    if (current?.job.status !== "completed" || !current.plan.spec.selected.includes("Sonarr")) throw fail("Sonarr ist nicht eingerichtet.");
  }
  async list() {
    this.ready();
    const { s } = await this.hub.context(["Sonarr"]);
    const all = await s.arr("Sonarr", "/series");
    if (!Array.isArray(all)) throw Error("Serien nicht lesbar.");
    const series = all.filter((v) => positive(v.id)).map(projectSeries)
      .sort((a, b) => a.title.localeCompare(b.title, "de"));
    return { checkedAt: new Date().toISOString(), series: series.slice(0, 1000), total: series.length };
  }
  /** body: { seriesId, monitored?, newSeasons?, seasons?: { [Staffelnummer]: boolean }, confirmation? } */
  async change(body) {
    this.ready();
    const id = positive(body.seriesId);
    if (!id) throw fail("Ungültige Serie.");
    const has = (k) => Object.hasOwn(body, k);
    for (const k of ["monitored", "newSeasons"]) if (has(k) && typeof body[k] !== "boolean") throw fail("Ungültige Angabe.");
    const seasons = has("seasons") ? body.seasons : {};
    if (!seasons || typeof seasons !== "object" || Array.isArray(seasons) ||
        Object.entries(seasons).some(([n, on]) => !/^\d{1,4}$/.test(n) || typeof on !== "boolean")) throw fail("Ungültige Staffelangabe.");
    if (!has("monitored") && !has("newSeasons") && !Object.keys(seasons).length) throw fail("Nichts zu ändern.");
    return this.hub.mutate(["Sonarr"], async ({ s }) => {
      const before = await s.arr("Sonarr", `/series/${id}`);
      if (before?.id !== id) throw fail("Serie nicht gefunden. Neu laden.");
      for (const n of Object.keys(seasons))
        if (!before.seasons?.some((x) => x.seasonNumber === Number(n))) throw fail(`Staffel ${n} gibt es bei dieser Serie nicht.`);
      const enabling = (body.monitored === true && !before.monitored) || (body.newSeasons === true && before.monitorNewItems !== "all") ||
        Object.entries(seasons).some(([n, on]) => on && !before.seasons.find((x) => x.seasonNumber === Number(n)).monitored);
      if (enabling && body.confirmation !== "OK") throw fail("Überwachung einschalten mit OK bestätigen – Sonarr lädt dann fehlende Folgen.");
      const next = {
        ...before,
        ...(has("monitored") ? { monitored: body.monitored } : {}),
        ...(has("newSeasons") ? { monitorNewItems: body.newSeasons ? "all" : "none" } : {}),
        seasons: before.seasons.map((x) => (Object.hasOwn(seasons, String(x.seasonNumber)) ? { ...x, monitored: seasons[x.seasonNumber] } : x)),
      };
      await s.arr("Sonarr", `/series/${id}?moveFiles=false`, { method: "PUT", body: next });
      const after = projectSeries(await s.arr("Sonarr", `/series/${id}`));
      if ((has("monitored") && after.monitored !== body.monitored) || (has("newSeasons") && after.newSeasons !== body.newSeasons) ||
          Object.entries(seasons).some(([n, on]) => after.seasons.find((x) => x.number === Number(n))?.monitored !== on))
        throw Error("Sonarr hat die Änderung nicht bestätigt. Neu laden.");
      return after;
    });
  }
  /** Fehlende, überwachte Folgen einer Serie oder Staffel suchen (OK + VPN). */
  async search(body) {
    this.ready();
    if (body.confirmation !== "OK") throw fail("Suche mit OK bestätigen.");
    const id = positive(body.seriesId);
    if (!id) throw fail("Ungültige Serie.");
    const season = body.season === undefined || body.season === null ? null : body.season;
    if (season !== null && !(Number.isSafeInteger(season) && season >= 0)) throw fail("Ungültige Staffel.");
    await this.hub.requireVpn();
    return this.hub.mutate(["Sonarr"], async ({ s }) => {
      const v = projectSeries(await s.arr("Sonarr", `/series/${id}`));
      if (v.id !== id) throw fail("Serie nicht gefunden. Neu laden.");
      if (!v.monitored) throw fail("Die Serie wird nicht überwacht – Sonarr sucht nur überwachte Folgen.");
      if (season !== null && !v.seasons.find((x) => x.number === season)?.monitored) throw fail(`Staffel ${season} wird nicht überwacht.`);
      const cmd = season === null ? { name: "SeriesSearch", seriesId: id } : { name: "SeasonSearch", seriesId: id, seasonNumber: season };
      const r = await s.arr("Sonarr", "/command", { method: "POST", body: cmd });
      if (!positive(r?.id)) throw Error("Sonarr hat die Suche nicht angenommen.");
      return { ok: true, message: `Sonarr sucht fehlende Folgen von „${v.title}“${season !== null ? `, Staffel ${season}` : ""}. Treffer erscheinen unter Downloads.` };
    });
  }
}
