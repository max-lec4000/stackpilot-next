// Medien → Bibliotheken → Titel korrigieren (Phase 7 Paket 7.4): einen falsch erkannten Film
// oder eine Serie in Jellyfin neu zuordnen („Identifizieren“). Kandidaten kommen aus Jellyfins
// Metadaten-Suche (TMDb/TVDb/IMDb); die Oberfläche bekommt nur Kennungen, das Ergebnis selbst
// bleibt im Server und wird nach OK angewandt und zurückgelesen.
import { randomUUID } from "node:crypto";

const text = (v, n = 160) => (typeof v === "string" ? v.replace(/[\x00-\x1f\x7f]+/g, " ").trim().slice(0, n) : "");
const fail = (m) => Object.assign(Error(m), { userFacing: true });
const ID = /^[a-f0-9]{32}$/;
const norm = (v) => String(v || "").replaceAll("-", "").toLowerCase();
const providers = (p) => Object.fromEntries(Object.entries(p && typeof p === "object" ? p : {})
  .filter(([k, v]) => ["Tmdb", "Imdb", "Tvdb"].includes(k) && v).map(([k, v]) => [k.toLowerCase(), text(String(v), 20)]));
const TTL = 15 * 60 * 1000;

export class TitleIdentify {
  constructor(hub) {
    this.hub = hub;
    this.found = new Map();
  }
  ready() {
    const current = this.hub.engine.current();
    if (current?.job.status !== "completed" || !current.plan.spec.selected.includes("Jellyfin")) throw fail("Jellyfin ist nicht eingerichtet.");
  }
  async j(route, options) {
    const { s, plan } = await this.hub.context(["Jellyfin"]);
    return this.hub.library.request(s, plan, route, options);
  }
  static item(i) {
    return {
      id: norm(i.Id), kind: i.Type === "Series" ? "tv" : "movie", title: text(i.Name), year: Number.isSafeInteger(i.ProductionYear) ? i.ProductionYear : null,
      providers: providers(i.ProviderIds), folder: i.Path ? text(String(i.Path).split("/").filter(Boolean).pop(), 160) : null,
    };
  }
  async search(q) {
    this.ready();
    const term = text(q, 80);
    if (term.length < 2) throw fail("Mindestens zwei Zeichen eingeben.");
    const r = await this.j(`/Items?SearchTerm=${encodeURIComponent(term)}&IncludeItemTypes=Movie,Series&Recursive=true&Limit=20&Fields=ProductionYear,ProviderIds,Path`);
    return { items: (Array.isArray(r?.Items) ? r.Items : []).filter((i) => ID.test(norm(i.Id))).map(TitleIdentify.item) };
  }
  async load(id) {
    if (!ID.test(id || "")) throw fail("Ungültiger Titel.");
    const r = await this.j(`/Items?Ids=${id}&Fields=ProductionYear,ProviderIds,Path`);
    const i = (Array.isArray(r?.Items) ? r.Items : []).find((x) => norm(x.Id) === id && ["Movie", "Series"].includes(x.Type));
    if (!i) throw fail("Titel nicht mehr in Jellyfin. Neu suchen.");
    return i;
  }
  /** body: { id, name?, year?, tmdb? } → Kandidaten aus der Metadaten-Suche */
  async candidates(body) {
    this.ready();
    const i = await this.load(body.id);
    const name = text(body.name, 120) || i.Name;
    const year = body.year === undefined || body.year === null || body.year === "" ? i.ProductionYear : Number(body.year);
    if (year !== undefined && year !== null && !(Number.isSafeInteger(year) && year >= 1880 && year <= 2100)) throw fail("Ungültiges Jahr.");
    const tmdb = body.tmdb ? String(body.tmdb).trim() : "";
    if (tmdb && !/^\d{1,9}$/.test(tmdb)) throw fail("TMDb-Nummer besteht nur aus Ziffern.");
    const kind = i.Type === "Series" ? "Series" : "Movie";
    const results = await this.j(`/Items/RemoteSearch/${kind}`, { method: "POST", body: {
      SearchInfo: { Name: name, ...(year ? { Year: year } : {}), ...(tmdb ? { ProviderIds: { Tmdb: tmdb } } : {}) },
      ItemId: norm(i.Id), IncludeDisabledProviders: false,
    } });
    const now = Date.now();
    for (const [k, v] of this.found) if (now - v.at > TTL) this.found.delete(k);
    const list = (Array.isArray(results) ? results : []).slice(0, 12).map((r) => {
      const token = randomUUID();
      this.found.set(token, { itemId: norm(i.Id), result: r, at: now });
      return { token, name: text(r.Name), year: Number.isSafeInteger(r.ProductionYear) ? r.ProductionYear : null,
        overview: text(r.Overview, 300) || null, source: text(r.SearchProviderName, 40) || null, providers: providers(r.ProviderIds) };
    });
    return { item: TitleIdentify.item(i), candidates: list };
  }
  async apply(body) {
    this.ready();
    if (body.confirmation !== "OK") throw fail("Zuordnung mit OK bestätigen.");
    const hit = this.found.get(body.token);
    if (!hit || Date.now() - hit.at > TTL) throw fail("Auswahl abgelaufen. Erneut suchen.");
    return this.hub.mutate(["Jellyfin"], async () => {
      await this.load(hit.itemId);
      await this.j(`/Items/RemoteSearch/Apply/${hit.itemId}?ReplaceAllImages=true`, { method: "POST", body: hit.result });
      this.found.delete(body.token);
      const want = providers(hit.result.ProviderIds);
      // Jellyfin aktualisiert im Hintergrund; kurz warten und Kennungen vergleichen
      for (let n = 0; n < 10; n++) {
        const after = TitleIdentify.item(await this.load(hit.itemId));
        if (Object.entries(want).some(([k, v]) => after.providers[k] === v))
          return { ok: true, item: after, message: `„${after.title}“ ist jetzt zugeordnet. Bilder und Beschreibung werden nachgeladen.` };
        await new Promise((r) => setTimeout(r, this.pollMs ?? 1500));
      }
      return { ok: true, message: "Jellyfin übernimmt die Zuordnung noch. In einer Minute neu laden." };
    });
  }
}
