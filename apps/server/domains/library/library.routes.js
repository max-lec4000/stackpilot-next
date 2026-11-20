// Medien: Suche, Details, Cover, Musik, Bibliotheksabgleich, Medienbestand (Serien und Filme
// löschen) und der gesicherte Austausch importierter Versionen.
import { globalSearch } from "../../global-search.js";
import { musicInventory, withMusicTrack } from "../../music-library.js";
import { inspectMusicTags } from "../../music-tags.js";
import { rawResponse } from "../../routes.js";

const q = (url, name) => url.searchParams.get(name);
const userFacing = (m) => Object.assign(Error(m), { userFacing: true });

/** Cover von TMDB (nur feste Adresse, Bildtypen, höchstens 2 MB). */
async function poster(path) {
  if (!/^\/[a-zA-Z0-9_-]+\.(jpg|png)$/.test(path)) throw Error("Ungültiges Cover.");
  const response = await fetch("https://image.tmdb.org/t/p/w342" + path, { redirect: "error", signal: AbortSignal.timeout(8000) });
  const type = response.headers.get("content-type") || "";
  if (!response.ok || !/^image\/(jpeg|png|webp)$/.test(type) || Number(response.headers.get("content-length")) > 2097152)
    throw Error("Cover nicht erreichbar.");
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 2097152) throw Error("Cover zu groß.");
    chunks.push(chunk);
  }
  return rawResponse(Buffer.concat(chunks), { "Content-Type": type });
}

export function libraryRoutes({ hub, installer, importedReplacement, seriesRemoval, movieRemoval, libraryOverview, seriesMonitoring, playback, titleIdentify }) {
  const get = (path, handler) => ({ method: "GET", path, guard: "session", handler });
  const post = (path, handler) => ({ method: "POST", path, guard: "session", handler });
  const ok = (path, confirm, handler) => ({ method: "POST", path, guard: "ok", confirm, handler });
  const mediaPath = () => {
    const current = installer().current();
    if (!current || current.job.status !== "completed") throw userFacing("Zuerst die Einrichtung abschließen.");
    return current.plan.spec.path;
  };
  return [
    get("/api/search", ({ url }) => globalSearch(q(url, "query"), hub)),
    get("/api/media/search", ({ url }) => hub.search(q(url, "q"), q(url, "page") || 1)),
    get("/api/media/detail", ({ url }) => hub.detail(q(url, "type"), q(url, "id"))),
    get("/api/media/poster", ({ url }) => poster(q(url, "path") || "")),
    get("/api/music", () => musicInventory(mediaPath())),
    get("/api/music/tags", ({ url }) => withMusicTrack(mediaPath(), q(url, "path"), async (file, before) => {
      const report = await inspectMusicTags(file, before), after = await file.stat();
      if (after.size !== before.size || after.mtimeMs !== before.mtimeMs)
        return { state: "unconfirmed", fields: {}, embeddedCover: null, message: "Datei wurde während der Prüfung geändert. Erneut prüfen." };
      return report;
    })),
    get("/api/media/replacements", () => importedReplacement.jobs()),
    get("/api/media/series-inventory", () => seriesRemoval.list()),
    get("/api/media/libraries", () => libraryOverview.read()),
    // Medien → Serien (Paket 7.2): Einschalten prüft OK im Modul, Ausschalten nicht
    get("/api/media/series-monitoring", () => seriesMonitoring.list()),
    post("/api/media/series-monitoring", ({ body }) => seriesMonitoring.change(body)),
    ok("/api/media/series-monitoring/search", "Suche mit OK bestätigen.", ({ body }) => seriesMonitoring.search(body)),
    // Medien → Wiedergaben (Paket 7.4)
    get("/api/media/playback", () => playback.read()),
    ok("/api/media/playback/stop", "Beenden mit OK bestätigen.", ({ body }) => playback.stop(body)),
    ok("/api/media/playback/limit", "Bitrate-Grenze mit OK bestätigen.", ({ body }) => playback.setLimit(body)),
    // Titel korrigieren (Jellyfin identifizieren, Paket 7.4)
    get("/api/media/identify/search", ({ url }) => titleIdentify.search(q(url, "q"))),
    post("/api/media/identify/candidates", ({ body }) => titleIdentify.candidates(body)),
    ok("/api/media/identify/apply", "Zuordnung mit OK bestätigen.", ({ body }) => titleIdentify.apply(body)),

    post("/api/media/library/refresh", () => hub.library.run(true)),
    // Medien → Bibliotheken (7.4b)
    post("/api/media/libraries/scan", ({ body }) => libraryOverview.scan(body)),
    post("/api/media/replacement/preview", ({ body }) => importedReplacement.preview(body)),
    ok("/api/media/replacement/start", "Austausch bestätigen.", ({ body }) => importedReplacement.start(body)),
    ok("/api/media/replacement/restore", "Wiederherstellung bestätigen.", ({ body }) => importedReplacement.restore(body)),
    post("/api/media/series-removal/preview", ({ body }) => seriesRemoval.preview(body)),
    ok("/api/media/series-removal/execute", "Dateilöschung und Überwachung ausdrücklich bestätigen.", ({ body }) => seriesRemoval.execute(body)),
    post("/api/media/movie-removal/preview", ({ body }) => movieRemoval.preview(body.requestId)),
    ok("/api/media/movie-removal/execute", "Löschen mit OK bestätigen.", ({ body }) => movieRemoval.execute(body)),
  ];
}
