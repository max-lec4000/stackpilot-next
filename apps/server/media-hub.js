import { qbitAdapter } from "./adapters/qbittorrent.js";
import { createCappedCouchdeckRequest } from "./couchdeck-film-requests.js";
import { inspectPath } from "./inventory.js";
import { storageHealth } from "../../packages/domain/storage-health.js";
import { LiveCache, allArrQueue, requestPage } from "./request-index.js";
import { requestJourney } from "../../packages/domain/request-journey.js";
import { requestQualityOptions, qualityPolicyKey } from "./quality-policy.js";
import { RemovedMovies, removedMovieKey } from "./removed-movies.js";
import { torrentSummary } from "./activity.js";
import { LibrarySync } from "./library-sync.js";
import { activeSearch } from "../../packages/domain/search-status.js";
import { randomUUID } from "node:crypto";
import { Services } from "./service-api.js";
const str = (v, n = 300) => (typeof v === "string" ? v.slice(0, n) : "");
export const positiveId = (v) => {
  if (
    !["string", "number"].includes(typeof v) ||
    !Number.isSafeInteger(Number(v)) ||
    Number(v) < 1
  )
    throw Error("Ungültige ID.");
  return Number(v);
};
export const mediaType = (v) => {
  if (!["movie", "tv"].includes(v)) throw Error("Film oder Serie auswählen.");
  return v;
};
export function mediaSummary(v) {
  return {
    id: v.id,
    type: v.mediaType || v.type,
    title: str(v.title || v.name),
    overview: str(v.overview, 1500),
    year: str(
      v.releaseDate || v.firstAirDate || v.release_date || v.first_air_date,
      4,
    ),
    poster: /^\/[a-zA-Z0-9_-]+\.(jpg|png)$/.test(
      v.posterPath || v.poster_path || "",
    )
      ? v.posterPath || v.poster_path
      : null,
    status: Number(v.mediaInfo?.status) || 0,
    availabilityNote: str(v.availabilityNote, 400),
    availabilityCheckFailed: !!v.availabilityCheckFailed,
    requested: !!v.mediaInfo?.requests?.some((r) => ![3, 5].includes(r.status)),
  };
}
export class MediaHub {
  constructor(engine, guard, options = {}) {
    this.engine = engine;
    this.guard = guard;
    this.storage = options.storage || inspectPath;
    this.metadata = new Map();
    this.readCache = new LiveCache(10000);
    this.removedMovies = new RemovedMovies(this);
    this.library = options.library || new LibrarySync(this);
    this.makeServices =
      options.services || ((p, r) => new Services(p, engine.vault, r));
  }
  async context(names = [], expectedPlan) {
    const current = this.engine.current();
    if (!current || current.job.status !== "completed")
      throw Object.assign(Error("Zuerst die Einrichtung abschließen."), {
        userFacing: true,
      });
    const plan = expectedPlan?.id === current.plan.id ? expectedPlan : current.plan;
    for (const name of names)
      if (!plan.spec.selected.includes(name))
        throw Object.assign(Error(`${name} ist noch nicht eingerichtet.`), {
          userFacing: true,
        });
    const relay = await this.engine.relay(plan);
    if (
      this.cachedServices?.planId !== plan.id ||
      this.cachedServices?.relay !== relay
    )
      this.cachedServices = {
        planId: plan.id,
        relay,
        value: this.makeServices(plan, relay),
      };
    return { plan, s: this.cachedServices.value };
  }
  async mutate(names, fn, context = () => this.context(names)) {
    const owner = "media:" + randomUUID();
    if (!this.engine.store.claim(owner))
      throw Error("Ein anderer Auftrag läuft. Bitte danach erneut versuchen.");
    const timer = setInterval(() => this.engine.store.claim(owner), 10000);
    timer.unref?.();
    try {
      const ctx = await context();
      const result = await fn({ ...ctx, leaseOwner: owner });
      this.invalidateRequests();
      return result;
    } finally {
      this.invalidateRequests();
      clearInterval(timer);
      this.engine.store.release(owner);
    }
  }
  invalidateRequests() {
    this.readCache.clear();
  }
  async requireVpn() {
    const status = await this.guard.check(true);
    if (status.state !== "connected")
      throw Error("Downloads gesperrt: zuerst Mullvad verbinden und prüfen.");
  }
  async search(query, page = 1) {
    query = str(query, 160).trim();
    if (query.length < 2) throw Error("Mindestens zwei Zeichen eingeben.");
    page = Math.min(20, positiveId(page));
    const { s, plan } = await this.context(["Seerr"]);
    const r = await s.additional.seerr(
      `/search?query=${encodeURIComponent(query)}&page=${page}&language=de`,
    );
    const results = [];
    for (const item of (r.results || []).filter((v) =>
      ["movie", "tv"].includes(v.mediaType),
    )) {
      let value = item;
      if (item.mediaType === "movie") {
        try {
          value = await this.removedMovies.reconcile(s, plan, item, item.id);
        } catch {
          value = {
            ...item,
            mediaInfo: { ...item.mediaInfo, status: 0 },
            availabilityCheckFailed: true,
            availabilityNote:
              "Verfügbarkeit nach der Löschung konnte nicht geprüft werden. Details erneut öffnen.",
          };
        }
      }
      results.push(mediaSummary(value));
    }
    return { page: r.page, totalPages: r.totalPages, results };
  }
  async detail(type, id) {
    type = mediaType(type);
    id = positiveId(id);
    const { s, plan } = await this.context(["Seerr"]);
    let r = await s.additional.seerr(`/${type}/${id}?language=de`);
    if (type === "movie") {
      try {
        r = await this.removedMovies.reconcile(s, plan, r, id);
      } catch {
        r = {
          ...r,
          mediaInfo: { ...r.mediaInfo, status: 0 },
          availabilityCheckFailed: true,
          availabilityNote:
            "Verfügbarkeit nach der Löschung konnte nicht geprüft werden. Bitte erneut prüfen; es wird keine doppelte Anfrage gestartet.",
        };
      }
    }
    return {
      ...mediaSummary({ ...r, mediaType: type }),
      runtime: Number(r.runtime) || null,
      sizeDefaultRate: this.sizeLimits?.config(plan).rate || 0,
      sizeDefaultCap: this.sizeLimits?.config(plan).capGiB || 0,
      savedProfileId:
        this.engine.vault.get(qualityPolicyKey(plan, type, id))?.profileId ||
        null,
      savedProfileName: str(
        this.engine.vault.get(qualityPolicyKey(plan, type, id))?.profileName,
        160,
      ),
      savedSizeCap:
        this.engine.vault.get(qualityPolicyKey(plan, type, id))?.size?.capGiB ||
        null,
      seasons: (r.seasons || [])
        .filter((v) => v.seasonNumber > 0)
        .map((v) => ({
          number: v.seasonNumber,
          episodes: v.episodeCount,
          name: str(v.name),
          requested: !!r.mediaInfo?.requests?.some(
            (q) =>
              ![3, 5].includes(q.status) &&
              q.seasons?.some((sn) => sn.seasonNumber === v.seasonNumber),
          ),
          available:
            r.mediaInfo?.seasons?.some(
              (sn) => sn.seasonNumber === v.seasonNumber && sn.status === 5,
            ) || false,
        })),
    };
  }
  async request(body, couchdeck) {
    const type = mediaType(body.type),
      id = positiveId(body.id);
    await this.requireVpn();
    return this.mutate(
      ["Seerr", "qBittorrent", type === "movie" ? "Radarr" : "Sonarr"],
      async ({ plan, s }) => {
        if (!plan.spec.vpn || plan.id !== this.guard.checkedPlanId)
          throw Error("VPN-Zustand hat sich geändert. Erneut prüfen.");
        if (couchdeck) {
          const user = await s.additional.seerr(`/user/${positiveId(couchdeck.userId)}`);
          const normalize = (value) => String(value || "").toLowerCase().replaceAll("-", "");
          if (!user?.jellyfinUserId || normalize(user.jellyfinUserId) !== normalize(couchdeck.owner))
            throw Error("Das Seerr-Konto konnte nicht dem Wohnzimmer-Konto zugeordnet werden.");

        }
        if (typeof plan.spec.path === "string") {
          const storage = storageHealth(await this.storage(plan.spec.path));
          if (storage.state === "critical")
            throw Object.assign(Error(storage.reason), { userFacing: true });
        }
        let detail = await s.additional.seerr(`/${type}/${id}?language=de`);
        if (type === "movie")
          detail = await this.removedMovies.reconcile(s, plan, detail, id);
        if (detail.mediaInfo?.status === 5)
          throw Error("Dieses Medium ist bereits verfügbar.");
        const active = (detail.mediaInfo?.requests || []).filter(
          (r) => ![3, 5].includes(r.status),
        );
        if (type === "movie" && active.length && !couchdeck)
          throw Error("Dieses Medium wurde bereits angefragt.");
        let seasons;
        if (type === "tv") {
          if (
            !Array.isArray(body.seasons) ||
            !body.seasons.length ||
            body.seasons.length > 100
          )
            throw Error("Gewünschte Staffeln auswählen.");
          seasons = [...new Set(body.seasons.map(positiveId))];
          const available = new Set(
            (detail.seasons || []).map((v) => v.seasonNumber),
          );
          if (
            seasons.some(
              (n) =>
                !available.has(n) ||
                active.some((r) =>
                  r.seasons?.some((sn) => sn.seasonNumber === n),
                ) ||
                detail.mediaInfo?.seasons?.some(
                  (sn) => sn.seasonNumber === n && sn.status === 5,
                ),
            )
          )
            throw Error(
              "Eine gewählte Staffel ist bereits angefragt, verfügbar oder ungültig.",
            );
        }
        const savedQuality = this.engine.vault.get(
          qualityPolicyKey(plan, type, id),
        );
        if (
          body.expectedFilmProfile !== undefined &&
          (savedQuality?.profileId || 0) !== body.expectedFilmProfile
        )
          throw Error(
            "Das gespeicherte Filmprofil wurde geändert. Details neu öffnen.",
          );
        let qualityOptions = await requestQualityOptions(
          this,
          s,
          plan,
          type,
          id,
        );
        if (
          body.sizeGiBPerHour !== undefined &&
          (typeof body.sizeGiBPerHour !== "number" ||
            ![0, 1, 2, 3, 4, 6, 8].includes(body.sizeGiBPerHour))
        )
          throw Error("Ungültige Größenregel.");
        if (type !== "movie" && body.sizeGiBPerHour)
          throw Error("Größenregeln sind derzeit nur für Filme verfügbar.");
        const sizeDefault = this.sizeLimits?.config(plan);
        if (
          (body.expectedSizeDefault !== undefined && sizeDefault?.rate !== body.expectedSizeDefault) ||
          (body.expectedSizeDefaultCap !== undefined && (sizeDefault?.capGiB || 0) !== body.expectedSizeDefaultCap)
        )
          throw Error(
            "Der Größenstandard wurde geändert. Filmdetails neu öffnen.",
          );
        let sizePolicy = null;
        if (type === "movie" && this.sizeLimits) {
          const useDefault = body.sizeGiBPerHour === undefined && !savedQuality;
          const rate = body.sizeGiBPerHour ?? (useDefault ? sizeDefault.rate : 0);
          const capGiB = couchdeck?.capGiB ?? (useDefault ? sizeDefault.capGiB || 0 : 0);
          if (rate || capGiB) {
            sizePolicy = await this.sizeLimits.forRequest(
              s,
              plan,
              detail,
              rate,
              capGiB,
            );
            qualityOptions = {
              serverId: sizePolicy.serverId,
              profileId: sizePolicy.profileId,
            };
          }
        }
        try {
          if (detail.removedMovie) {
            const state = await s.additional.seerr(
              `/media/${positiveId(detail.mediaInfo?.id)}/unknown`,
              { method: "POST", body: { is4k: false } },
            );
            if (state?.status !== 1)
              throw Error("Seerr hat den Status nicht zurückgesetzt.");
          }
          const r = couchdeck ? await createCappedCouchdeckRequest(this, s, plan, couchdeck, id, sizePolicy, detail) : await s.additional.seerr("/request", {
            method: "POST",
            body: {
              mediaType: type,
              mediaId: id,
              is4k: false,
              ...(couchdeck ? { userId: couchdeck.userId } : {}),
              ...qualityOptions,
              ...(seasons ? { seasons } : {}),
            },
          });
          if (type === "movie" && detail.removedMovie) {
            const key = removedMovieKey(plan, id),
              marker = this.engine.vault.get(key);
            this.engine.vault.set(key, {
              ...marker,
              newRequestId: positiveId(r.id),
            });
          }
          if (sizePolicy)
            this.engine.vault.set(
              `quality-policy:${plan.rootId || plan.id}:movie:${id}`,
              {
                profileId: sizePolicy.profileId,
                profileName: `StackPilot 1080p ≤ ${sizePolicy.capGiB} GiB`,
                serverId: sizePolicy.serverId,
                compact: true,
                size: sizePolicy,
              },
            );
          let warning = null;
          if (qualityOptions.profileId) {
            const saved =
              r.profileId === undefined
                ? await s.additional.seerr(`/request/${positiveId(r.id)}`)
                : r;
            if (
              Number(saved.profileId) !== qualityOptions.profileId ||
              Number(saved.serverId) !== qualityOptions.serverId
            )
              warning =
                "Die Anfrage wurde angelegt, aber Seerr bestätigt das vorgegebene Profil nicht. Nicht erneut anfragen; unter Meine Anfragen das aktuelle Radarr-Profil prüfen.";
          }
          return { ok: true, id: r.id, warning, ...(couchdeck ? { status: r.status } : {}) };
        } catch {
          throw Error(
            "Seerr konnte die Anfrage nicht anlegen. Verbindung, Standardserver und Qualitätsprofil prüfen.",
          );
        }
      },
    );
  }
  async requests(options = {}) {
    if (options.force === true) this.readCache.clear();
    const page = positiveId(options.page || 1),
      pageSize = 8;
    if (page > 10000) throw Error("Seitenzahl zu groß.");
    const filters = {
      all: "all",
      active: "unavailable",
      completed: "completed",
      failed: "failed",
    };
    const filter = options.filter || "all",
      type = options.type || "all";
    if (
      !Object.hasOwn(filters, filter) ||
      !["all", "movie", "tv"].includes(type)
    )
      throw Error("Ungültiger Anfragenfilter.");
    const { s, plan } = await this.context(["Seerr"]);
    const excluded = this.records?.archivedEntries(plan) || new Set();
    const r = await this.readCache.read(
      `requests:${plan.id}:${page}:${filter}:${type}`,
      () =>
        requestPage(s, {
          page,
          pageSize,
          filter: filters[filter],
          type,
          excluded,
        }),
    );
    const visibleItems = (r.results || []).slice(0, pageSize);
    let queues = [];
    const searchCommands = {};
    const movieFiles = new Map();
    const unavailable = [];
    await Promise.all(
      ["Sonarr", "Radarr"]
        .filter((n) => plan.spec.selected.includes(n))
        .map(async (name) => {
          try {
            const rows = await this.readCache.read(
              `queue:${plan.id}:${name}`,
              () => allArrQueue(s, name),
            );
            queues.push(...rows.map((v) => ({ ...v, service: name })));
          } catch {
            unavailable.push(name);
          }
          if (name === "Radarr")
            try {
              const movieIds = [
                ...new Set(
                  visibleItems
                    .filter((v) => v.media?.mediaType === "movie")
                    .map((v) => positiveId(v.media.tmdbId)),
                ),
              ];
              const movies = (
                await Promise.all(
                  movieIds.map((id) =>
                    this.readCache.read(`movie:${plan.id}:${id}`, () =>
                      s.arr(name, `/movie?tmdbId=${id}`),
                    ),
                  ),
                )
              ).flat();
              if (Array.isArray(movies))
                for (const movie of movies)
                  if (movie.hasFile)
                    movieFiles.set(movie.tmdbId, {
                      size: movie.movieFile?.size ?? null,
                    });
            } catch {}
          try {
            const commands = await this.readCache.read(
              `commands:${plan.id}:${name}`,
              () => s.arr(name, "/command"),
            );
            searchCommands[name] = Array.isArray(commands) ? commands : null;
          } catch {
            searchCommands[name] = null;
          }
        }),
    );
    let torrents = [];
    if (plan.spec.selected.includes("qBittorrent"))
      try {
        torrents = await this.readCache.read(`torrents:${plan.id}`, () =>
          s.qbit("/torrents/info"),
        );
      } catch {
        unavailable.push("qBittorrent");
      }
    const items = (r.results || []).slice(0, pageSize),
      results = new Array(items.length);
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, items.length) }, async () => {
        while (cursor < items.length) {
          const index = cursor++,
            request = items[index];
          const m = request.media;
          let detail = null;
          const metadataKey = `${plan.id}:${m.mediaType}:${m.tmdbId}`;
          try {
            const cached = this.metadata.get(metadataKey);
            if (cached && cached.expires > Date.now()) detail = cached.value;
            else {
              detail = await s.additional.seerr(
                `/${mediaType(m.mediaType)}/${positiveId(m.tmdbId)}?language=de`,
              );
              this.metadata.set(metadataKey, {
                value: {
                  title: detail.title,
                  name: detail.name,
                  posterPath: detail.posterPath,
                },
                expires: Date.now() + 300000,
              });
              if (this.metadata.size > 250)
                this.metadata.delete(this.metadata.keys().next().value);
            }
          } catch {}
          const matched = queues.filter((q) =>
            m.mediaType === "movie"
              ? q.movie?.tmdbId === m.tmdbId
              : !!m.tvdbId && q.series?.tvdbId === m.tvdbId,
          );
          const transfer = [
            ...new Map(
              matched
                .map((q) =>
                  torrents.find(
                    (t) =>
                      t.hash?.toLowerCase() === q.downloadId?.toLowerCase(),
                  ),
                )
                .filter(Boolean)
                .map((t) => [t.hash, t]),
            ).values(),
          ];
          const uniqueDownloads = [
            ...new Map(matched.map((q) => [q.downloadId || q.id, q])).values(),
          ];
          let state = unavailable.includes(
            m.mediaType === "movie" ? "Radarr" : "Sonarr",
          )
            ? "unknown"
            : "waiting";
          const latestSearch = this.engine.vault.get(
            `request-search:${plan.rootId || plan.id}:${request.id}`,
          );
          const arrId = latestSearch?.arrId || m.externalServiceId;
          const matchingSearch = searchCommands[
            m.mediaType === "movie" ? "Radarr" : "Sonarr"
          ]?.find((c) => activeSearch(c, m.mediaType, arrId));
          if (state === "waiting" && matchingSearch)
            state =
              matchingSearch.status === "queued"
                ? "search-queued"
                : "searching";
          if (m.mediaType === "movie" && movieFiles.has(m.tmdbId))
            state = "library-sync";
          if (request.status === 1) state = "pending";
          if (request.status === 3) state = "declined";
          if (request.status === 4) state = "failed";
          if (
            request.status === 5 ||
            (m.status === 5 && ![3, 4].includes(request.status))
          )
            state = "available";
          if (
            m.status !== 5 &&
            request.status === 2 &&
            state !== "library-sync"
          ) {
            if (
              matched.some(
                (q) =>
                  q.trackedDownloadState === "importPending" ||
                  q.status === "completed",
              )
            )
              state = "importing";
            else if (matched.length) state = "downloading";
            if (state === "downloading" && transfer.length) {
              if (transfer.every((t) => /^(paused|stopped)DL$/i.test(t.state)))
                state = "paused";
              else if (transfer.every((t) => /^queuedDL$/i.test(t.state)))
                state = "queued";
            }
            if (
              matched.some(
                (q) =>
                  q.trackedDownloadStatus === "warning" ||
                  q.trackedDownloadStatus === "error",
              )
            )
              state = "attention";
          }
          let jellyfinAvailable = null;
          if (
            m.mediaType === "movie" &&
            request.status !== 3 &&
            (movieFiles.has(m.tmdbId) || m.status === 5 || request.status === 5)
          ) {
            jellyfinAvailable = await this.library.available(s, plan, m.tmdbId);
            if (jellyfinAvailable === null && !unavailable.includes("Jellyfin"))
              unavailable.push("Jellyfin");
            if (jellyfinAvailable === true) state = "available";
            else if (state === "available")
              state = movieFiles.has(m.tmdbId) ? "library-sync" : "unknown";
          }
          const sumKnown = (rows, key) =>
            rows.length &&
            rows.every((r) => Number.isFinite(r[key]) && r[key] >= 0)
              ? rows.reduce((sum, r) => sum + r[key], 0)
              : null;
          const size =
            sumKnown(transfer, "size") ??
            sumKnown(uniqueDownloads, "size") ??
            movieFiles.get(m.tmdbId)?.size ??
            null;
          const downloaded =
            sumKnown(transfer, "downloaded") ??
            (uniqueDownloads.length &&
            uniqueDownloads.every(
              (q) => Number.isFinite(q.size) && Number.isFinite(q.sizeleft),
            )
              ? uniqueDownloads.reduce(
                  (sum, q) => sum + Math.max(0, q.size - q.sizeleft),
                  0,
                )
              : null);
          results[index] = {
            id: request.id,
            mediaId: m.tmdbId,
            type: m.mediaType,
            title: detail
              ? mediaSummary(detail).title
              : (m.mediaType === "movie" ? "Film" : "Serie") + " #" + m.tmdbId,
            poster: detail ? mediaSummary(detail).poster : null,
            state,
            journey: requestJourney(state),
            createdAt: request.createdAt,
            seasons: (request.seasons || []).map((v) => v.seasonNumber),
            progress: transfer.length
              ? Math.min(
                  ...transfer.map((t) =>
                    Math.max(0, Math.min(1, Number(t.progress) || 0)),
                  ),
                )
              : null,
            sizeBytes: size,
            downloadedBytes: downloaded,
            jellyfinAvailable,
            tracking: unavailable.length ? "partial" : "ready",
          };
        }
      }),
    );
    return {
      results,
      unavailable,
      total: r.pageInfo?.results ?? results.length,
      page,
      pageSize,
      pages: Math.max(
        1,
        Math.ceil((r.pageInfo?.results ?? results.length) / pageSize),
      ),
      librarySync: this.library.status(),
    };
  }
  async downloads(options = {}) {
    const page = positiveId(options.page || 1),
      filter = options.filter || "all",
      pageSize = 8;
    if (options.query !== undefined && (typeof options.query !== "string" || options.query.length > 160))
      throw Error("Ungültiger Downloadsuchbegriff.");
    const query = (options.query || "").trim().toLocaleLowerCase("de");
    const filters = {
      all: "all",
      active: "downloading",
      completed: "completed",
      paused: "stopped",
    };
    if (page > 10000 || !Object.hasOwn(filters, filter))
      throw Error("Ungültiger Downloadfilter.");
    const current = this.engine.current();
    if (
      !current ||
      current.job.status !== "completed" ||
      !current.plan.spec.selected.includes("qBittorrent")
    )
      return {
        configured: false,
        torrents: [],
        page,
        hasMore: false,
        vpn: this.guard.status,
        downloadRate: 0,
        uploadRate: 0,
      };
    const { s } = await this.context(["qBittorrent"]);
    const [rows, transfer] = await Promise.all([
      s.qbit(
        `/torrents/info?filter=${filters[filter]}&sort=added_on&reverse=true${query ? "" : `&offset=${(page - 1) * pageSize}&limit=${pageSize + 1}`}`,
      ),
      s.qbit("/transfer/info"),
    ]);
    if (
      !Array.isArray(rows) ||
      !Number.isFinite(transfer?.dl_info_speed) ||
      !Number.isFinite(transfer?.up_info_speed)
    )
      throw Error("Downloadstatus konnte nicht gelesen werden.");
    const matches = query ? rows.filter((torrent) => String(torrent.name || "").toLocaleLowerCase("de").includes(query)) : rows;
    const visible = query ? matches.slice((page - 1) * pageSize, page * pageSize + 1) : matches;
    return {
      configured: true,
      page,
      hasMore: visible.length > pageSize,
      total: query ? matches.length : null,
      torrents: visible.slice(0, pageSize).map(torrentSummary),
      vpn: this.guard.status,
      downloadRate: transfer.dl_info_speed,
      uploadRate: transfer.up_info_speed,
    };
  }
  async downloadAction(body) {
    const hash = str(body.hash, 65);
    if (!/^[a-f0-9]{40,64}$/i.test(hash))
      throw Error("Genau einen gültigen Download auswählen.");
    if (!["pause", "resume", "remove", "priority"].includes(body.action))
      throw Error("Unbekannte Downloadaktion.");
    const priorities = { up: "increasePrio", down: "decreasePrio", first: "topPrio", last: "bottomPrio" };
    if (body.action === "priority" && !Object.hasOwn(priorities, body.priority))
      throw Error("Ungültige Downloadpriorität.");
    if (body.action === "remove" && body.confirmation !== "OK")
      throw Error("Entfernen mit OK bestätigen. Dateien bleiben erhalten.");
    if (["resume", "priority"].includes(body.action)) await this.requireVpn();
    return this.mutate(["qBittorrent"], async ({ plan, s }) => {
      if (
        ["resume", "priority"].includes(body.action) &&
        (!plan.spec.vpn || plan.id !== this.guard.checkedPlanId)
      )
        throw Error("VPN-Zustand hat sich geändert.");
      const qbit = qbitAdapter(s);
      if (!(await qbit.find(hash))) throw Error("Download nicht mehr vorhanden.");
      // Anhalten, Fortsetzen und Entfernen gelten erst nach Bestätigung durch qBittorrent
      if (body.action === "remove") await qbit.remove(hash, body.deleteFiles === true);
      else if (body.action === "priority") await qbit.priority(hash, body.priority);
      else if (body.action === "pause") await qbit.stop(hash);
      else await qbit.start(hash);
      if (["pause", "remove"].includes(body.action)) {
        const key = `download-policy:${plan.rootId || plan.id}:paused`;
        const paused = this.engine.vault.get(key) || [];
        this.engine.vault.set(
          key,
          paused.filter((v) => v.toLowerCase() !== hash.toLowerCase()),
        );
      }
      return { ok: true };
    });
  }
}
