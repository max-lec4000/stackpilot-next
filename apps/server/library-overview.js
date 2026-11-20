// Medien → Bibliotheken (Phase 7.4b): Jellyfin-Bibliotheken mit Ordnern und Anzahl,
// Scanstatus, einzeln scannen, „Neu hinzugekommen“. Der vollständige Abgleich (Jellyfin-Scan,
// danach Seerr) bleibt bei hub.library.run().

const text = (v, n = 160) => (typeof v === "string" ? v.replace(/[\x00-\x1f\x7f]+/g, " ").trim().slice(0, n) : "");
const list = (v) => (Array.isArray(v) ? v : []);
const ID = /^[a-f0-9]{32}$/;
const COUNTS = {
  movies: [["Movie", "Filme"]],
  tvshows: [["Series", "Serien"], ["Episode", "Folgen"]],
  music: [["MusicAlbum", "Alben"], ["Audio", "Titel"]],
};
const id = (v) => String(v || "").replaceAll("-", "").toLowerCase();

export class LibraryOverview {
  constructor(hub) {
    this.hub = hub;
  }
  ready() {
    const current = this.hub.engine.current();
    if (current?.job.status !== "completed" || !current.plan.spec.selected.includes("Jellyfin"))
      throw Object.assign(Error("Jellyfin ist nicht eingerichtet."), { userFacing: true });
  }
  async read() {
    this.ready();
    const { s, plan } = await this.hub.context(["Jellyfin"]);
    const j = (r) => this.hub.library.request(s, plan, r);
    const [folders, tasks, latest] = await Promise.all([
      j("/Library/VirtualFolders"), j("/ScheduledTasks").catch(() => []),
      j("/Items?SortBy=DateCreated&SortOrder=Descending&Limit=12&Recursive=true&IncludeItemTypes=Movie,Episode,MusicAlbum&Fields=DateCreated").catch(() => null),
    ]);
    if (!Array.isArray(folders)) throw Error("Jellyfin-Bibliotheken nicht lesbar.");
    const libraries = await Promise.all(folders.map(async (f) => {
      const counts = await Promise.all((COUNTS[f.CollectionType] || []).map(async ([type, label]) => {
        try {
          const r = await j(`/Items?ParentId=${id(f.ItemId)}&Recursive=true&Limit=0&IncludeItemTypes=${type}`);
          return { label, count: Number.isSafeInteger(r?.TotalRecordCount) ? r.TotalRecordCount : null };
        } catch { return { label, count: null }; }
      }));
      return {
        id: id(f.ItemId), name: text(f.Name, 80), type: text(f.CollectionType, 20) || "mixed",
        locations: list(f.Locations).map((l) => text(l, 200)).slice(0, 10),
        scanning: f.RefreshStatus === "Running" || (Number.isFinite(f.RefreshProgress) && f.RefreshProgress < 100),
        progress: Number.isFinite(f.RefreshProgress) ? Math.round(f.RefreshProgress) : null,
        counts,
      };
    }));
    const task = list(tasks).find((t) => t.Key === "RefreshLibrary");
    return {
      checkedAt: new Date().toISOString(),
      libraries,
      scan: task ? {
        running: ["Running", "Cancelling"].includes(task.State),
        progress: Number.isFinite(task.CurrentProgressPercentage) ? Math.round(task.CurrentProgressPercentage) : null,
        lastEnd: task.LastExecutionResult?.EndTimeUtc || null,
        lastStatus: text(task.LastExecutionResult?.Status, 30) || null,
      } : null,
      sync: this.hub.library.status?.() || null,
      latest: list(latest?.Items).map((i) => ({
        type: i.Type === "Episode" ? "episode" : i.Type === "MusicAlbum" ? "album" : "movie",
        title: i.Type === "Episode"
          ? `${text(i.SeriesName, 80)}${Number.isSafeInteger(i.ParentIndexNumber) && Number.isSafeInteger(i.IndexNumber) ? ` · S${String(i.ParentIndexNumber).padStart(2, "0")}E${String(i.IndexNumber).padStart(2, "0")}` : ""} – ${text(i.Name, 80)}`
          : text(i.Name, 120),
        added: typeof i.DateCreated === "string" ? i.DateCreated : null,
      })),
    };
  }
  /** Eine Bibliothek neu einlesen (nur neue/geänderte Dateien, Metadaten bleiben). */
  async scan(body) {
    this.ready();
    const lib = id(body.libraryId);
    if (!ID.test(lib)) throw Error("Ungültige Bibliothek.");
    return this.hub.mutate(["Jellyfin"], async ({ s, plan }) => {
      const folders = await this.hub.library.request(s, plan, "/Library/VirtualFolders");
      const folder = list(folders).find((f) => id(f.ItemId) === lib);
      if (!folder) throw Error("Bibliothek nicht gefunden.");
      await this.hub.library.request(s, plan,
        `/Items/${lib}/Refresh?Recursive=true&MetadataRefreshMode=Default&ImageRefreshMode=Default&ReplaceAllMetadata=false&ReplaceAllImages=false`,
        { method: "POST" });
      return { ok: true, message: `„${text(folder.Name, 80)}“ wird eingelesen. Neue Titel erscheinen in wenigen Minuten.` };
    });
  }
}
