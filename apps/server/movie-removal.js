import { removedMovieKey } from "./removed-movies.js";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { positiveId } from "./media-hub.js";
const hash = (v) =>
  typeof v === "string" && /^[a-f0-9]{40,64}$/i.test(v)
    ? v.toLowerCase()
    : null;
const fingerprint = (movie) =>
  JSON.stringify([
    movie.id,
    movie.tmdbId,
    movie.path,
    movie.movieFile?.id || movie.movieFileId || null,
    movie.movieFile?.size ?? null,
    movie.movieFile?.relativePath ?? null,
    movie.qualityProfileId,
  ]);
const torrentFingerprint = (t) =>
  JSON.stringify([
    t.hash?.toLowerCase(),
    t.name,
    t.size,
    t.category,
    t.save_path,
    t.content_path,
    t.added_on,
  ]);
export class MovieRemoval {
  constructor(hub, diagnostics) {
    this.hub = hub;
    this.diagnostics = diagnostics;
  }
  key(id) {
    if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id))
      throw Error("Ungültiger Löschplan.");
    return `movie-removal:${id}`;
  }
  async preview(id) {
    const { s, plan } = await this.hub.context(["Seerr", "Radarr"]);
    const activeKey = `movie-removal-active:${plan.rootId || plan.id}:${positiveId(id)}`;
    const activeId = this.hub.engine.vault.get(activeKey);
    const active = activeId
      ? this.hub.engine.vault.get(this.key(activeId))
      : null;
    if (
      active &&
      active.planId === plan.id &&
      active.steps.started &&
      !active.steps.done
    )
      return {
        ...this.public(active),
        message:
          "Eine bestätigte Löschung ist noch nicht abgeschlossen. Mit der gespeicherten Auswahl fortsetzen.",
      };
    const target = await this.diagnostics.target(s, positiveId(id));
    if (target.kind !== "movie" || !target.item)
      throw Error(
        "Nur ein vorhandener Film im verwalteten Radarr kann gelöscht werden.",
      );
    const movie = target.item;
    if (
      typeof movie.path !== "string" ||
      !movie.path.startsWith("/data/media/movies/") ||
      path.posix.normalize(movie.path) !== movie.path ||
      movie.path.split("/").filter(Boolean).length < 4
    )
      throw Error(
        "Filmpfad liegt nicht in einem eigenen Ordner der verwalteten Filmbibliothek. Keine Löschung möglich.",
      );
    if (
      movie.movieFile?.relativePath &&
      (path.posix.isAbsolute(movie.movieFile.relativePath) ||
        movie.movieFile.relativePath.split("/").includes(".."))
    )
      throw Error("Filmdateipfad ist nicht eindeutig. Keine Löschung möglich.");
    const downloads = [];
    let downloadWarning = null;
    if (plan.spec.selected.includes("qBittorrent")) {
      try {
        const [queue, history, torrents] = await Promise.all([
          s.arr("Radarr", "/queue?page=1&pageSize=250&includeMovie=true"),
          s.arr("Radarr", `/history/movie?movieId=${movie.id}`),
          s.qbit("/torrents/info"),
        ]);
        if (
          !Array.isArray(queue.records) ||
          !Array.isArray(history) ||
          !Array.isArray(torrents)
        )
          throw Error("shape");
        const ids = new Set(
          [
            ...queue.records.filter(
              (q) => q.movieId === movie.id || q.movie?.id === movie.id,
            ),
            ...history.filter((h) => h.movieId === movie.id),
          ]
            .map((v) => hash(v.downloadId))
            .filter(Boolean),
        );
        for (const t of torrents)
          if (ids.has(hash(t.hash)) && t.category === "stackpilot-movies")
            downloads.push({
              hash: hash(t.hash),
              name: String(t.name || "Download").slice(0, 240),
              size: Number.isFinite(t.size) ? t.size : null,
              fingerprint: torrentFingerprint(t),
            });
        if (queue.totalRecords > 250)
          downloadWarning =
            "Die Radarr-Warteschlange wurde nur teilweise geprüft. Weitere Downloads können vorhanden sein.";
      } catch {
        downloadWarning =
          "Zugehörige Downloads konnten nicht vollständig geprüft werden. Sie werden nicht automatisch gelöscht.";
      }
    }
    const draft = {
      id: randomUUID(),
      planId: plan.id,
      rootId: plan.rootId || plan.id,
      requestId: positiveId(id),
      mediaRecordId: positiveId(target.request.media.id),
      serverId: target.request.serverId ?? null,
      movieId: positiveId(movie.id),
      tmdbId: positiveId(movie.tmdbId),
      title: String(movie.title || "Film").slice(0, 240),
      size: Number.isFinite(movie.movieFile?.size)
        ? movie.movieFile.size
        : null,
      hasFile: !!movie.hasFile,
      fingerprint: fingerprint(movie),
      downloads,
      downloadWarning,
      expires: Date.now() + 1800000,
      steps: {},
      chosen: null,
    };
    this.hub.engine.vault.set(this.key(draft.id), draft);
    return {
      ...this.public(draft),
      message:
        "Entfernt den Film samt Bibliotheksdateien aus Radarr und diese Anfrage aus Seerr. Andere Anfragen bleiben erhalten. Ein erneuter Download wird nicht gestartet. Ausgewählte Torrents werden mit ihrem gesamten Inhalt gelöscht, auch wenn sie mehrere Dateien enthalten. Hardlinks oder andere Kopien können weiter Speicher belegen. Radarr kann Dateien zunächst in seinen konfigurierten Papierkorb verschieben.",
    };
  }
  public(d) {
    return {
      id: d.id,
      title: d.title,
      size: d.size,
      hasFile: d.hasFile,
      chosen: d.chosen,
      started: !!d.steps.started,
      downloads: d.downloads.map(({ hash, name, size }) => ({
        hash,
        name,
        size,
      })),
      downloadWarning: d.downloadWarning,
    };
  }
  async execute(body) {
    if (body.confirmation !== "OK") throw Error("Löschen mit OK bestätigen.");
    const key = this.key(body.planId);
    let record = this.hub.engine.vault.get(key);
    if (!record || (!record.steps.started && record.expires < Date.now()))
      throw Error("Löschplan abgelaufen. Neu prüfen.");
    if (
      !Array.isArray(body.downloads) ||
      body.downloads.some((h) => !record.downloads.some((t) => t.hash === h))
    )
      throw Error("Nur geprüfte Downloads auswählen.");
    const chosen = [...new Set(body.downloads)].sort();
    if (
      record.chosen &&
      JSON.stringify(record.chosen) !== JSON.stringify(chosen)
    )
      throw Error(
        "Auswahl wurde bereits bestätigt. Den gleichen Löschauftrag fortsetzen.",
      );
    return this.hub
      .mutate(["Seerr", "Radarr"], async ({ s, plan }) => {
        record = this.hub.engine.vault.get(key);
        if (record.planId !== plan.id)
          throw Error("Stack wurde geändert. Löschplan erneut prüfen.");
        if (record.steps.done)
          return {
            ok: true,
            message: "Film wurde bereits entfernt.",
            complete: true,
          };
        const save = () => this.hub.engine.vault.set(key, record);
        const readMovie = async () => {
          try {
            return await s.arr("Radarr", `/movie/${record.movieId}`);
          } catch (e) {
            if (/HTTP 404/.test(e.message)) return null;
            throw e;
          }
        };
        try {
          const movie = await readMovie();
          if (movie && fingerprint(movie) !== record.fingerprint)
            throw Error(
              "Filmdatei, Pfad oder Qualitätsprofil wurde geändert. Neuen Löschplan erstellen.",
            );
          if (!movie && !record.steps.started)
            throw Error("Film ist nicht mehr vorhanden. Neu laden.");
          // Verify the reviewed request-to-server assignment again before the first write.
          if (!record.steps.started) {
            const target = await this.diagnostics.target(s, record.requestId);
            if (
              target.kind !== "movie" ||
              target.item?.id !== record.movieId ||
              target.request.media.id !== record.mediaRecordId
            )
              throw Error("Filmzuordnung wurde geändert. Neu prüfen.");
          }
          let torrents = [];
          if (chosen.length) {
            if (!plan.spec.selected.includes("qBittorrent"))
              throw Error("Downloadclient fehlt.");
            torrents = await s.qbit("/torrents/info");
            if (!Array.isArray(torrents))
              throw Error("Downloads nicht prüfbar.");
            for (const id of chosen) {
              const t = torrents.find((t) => hash(t.hash) === id),
                original = record.downloads.find((t) => t.hash === id);
              if (t && torrentFingerprint(t) !== original.fingerprint)
                throw Error(
                  "Download wurde geändert. Neuen Löschplan erstellen.",
                );
            }
          }
          record.chosen = chosen;
          record.steps.started = true;
          save();
          this.hub.engine.vault.set(
            `movie-removal-active:${plan.rootId || plan.id}:${record.requestId}`,
            record.id,
          );
          if (movie && !record.steps.unmonitored) {
            await s.arr("Radarr", `/movie/${movie.id}`, {
              method: "PUT",
              body: { ...movie, monitored: false },
            });
            record.steps.unmonitored = true;
            save();
          }
          for (const id of chosen) {
            if (record.steps[id]) continue;
            await s.qbit("/torrents/delete", {
              hashes: id,
              deleteFiles: "true",
            });
            const pausedKey = `download-policy:${plan.rootId || plan.id}:paused`;
            const paused = this.hub.engine.vault.get(pausedKey) || [];
            this.hub.engine.vault.set(
              pausedKey,
              paused.filter((h) => h.toLowerCase() !== id),
            );
            record.steps[id] = true;
            save();
          }
          if (!record.steps.movie) {
            const fresh = await readMovie();
            if (fresh && fingerprint(fresh) !== record.fingerprint)
              throw Error(
                "Filmdatei wurde geändert. Neuen Löschplan erstellen.",
              );
            if (fresh)
              await s.arr(
                "Radarr",
                `/movie/${record.movieId}?deleteFiles=true&addImportExclusion=false`,
                { method: "DELETE" },
              );
            if (await readMovie())
              throw Error("Radarr hat die Entfernung noch nicht bestätigt.");
            record.steps.movie = true;
            save();
          }
          let reviewedRequest;
          try {
            reviewedRequest = await s.additional.seerr(
              `/request/${record.requestId}`,
            );
          } catch (e) {
            if (!/HTTP 404/.test(e.message)) throw e;
          }
          if (
            reviewedRequest &&
            (reviewedRequest.media?.id !== record.mediaRecordId ||
              reviewedRequest.media?.tmdbId !== record.tmdbId ||
              reviewedRequest.media?.mediaType !== "movie" ||
              (reviewedRequest.serverId ?? null) !== record.serverId)
          )
            throw Error("Filmzuordnung wurde geändert. Neu prüfen.");
          if (!record.steps.media) {
            const mediaState = await s.additional.seerr(
              `/media/${record.mediaRecordId}/unknown`,
              {
                method: "POST",
                body: { is4k: false },
              },
            );
            if (mediaState?.status !== 1)
              throw Error(
                "Seerr hat den Verfügbarkeitsstatus nicht zurückgesetzt.",
              );
            record.steps.media = true;
            save();
          }
          if (!record.steps.request) {
            try {
              await s.additional.seerr(`/request/${record.requestId}`, {
                method: "DELETE",
              });
            } catch (e) {
              if (!/HTTP 404/.test(e.message)) throw e;
            }
            record.steps.request = true;
            save();
          }
          record.completedAt = new Date().toISOString();
          this.hub.engine.vault.set(removedMovieKey(plan, record.tmdbId), {
            requestId: record.requestId,
            mediaRecordId: record.mediaRecordId,
            removedAt: record.completedAt,
          });
          record.steps.done = true;
          save();
          this.hub.library.cache.clear();
          return {
            ok: true,
            complete: true,
            message:
              "Film und Anfrage entfernt. Bibliotheksabgleich wird angefordert. Für die kleinere Version den passenden Seerr-Standard wählen und den Film neu anfragen. Nicht ausgewählte Downloads, Kopien und ein möglicher Radarr-Papierkorb bleiben erhalten.",
          };
        } catch (error) {
          return {
            ok: false,
            complete: false,
            message:
              "Entfernung nicht vollständig abgeschlossen. Bereits bestätigte Schritte bleiben gespeichert. Mit unveränderter Auswahl erneut versuchen; geänderte Dateien werden nicht gelöscht.",
            detail:
              /Filmdatei|Filmzuordnung|Download wurde|Film ist nicht mehr/.test(
                error.message,
              )
                ? error.message
                : null,
          };
        }
      })
      .then((result) => {
        if (result.complete) void this.hub.library.run(true);
        return result;
      });
  }
}
