import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { verifyCurrentQuality } from "./quality-policy.js";
import { importQueueRoute, importStatus, matchesImportTarget } from "./import-status.js";
import {
  activeSearch,
  searchTargets,
} from "../../packages/domain/search-status.js";
import { positiveId, mediaType } from "./media-hub.js";
const text = (v, n = 180) => (typeof v === "string" ? v.slice(0, n) : "");

function rejection(value) {
  const reason = String(value).toLowerCase();
  if (/language|sprache/.test(reason)) return "Sprache passt nicht zum Profil.";
  if (/quality|resolution/.test(reason))
    return "Qualität passt nicht zum Profil.";
  if (/seed|peer/.test(reason)) return "Zu wenige erreichbare Gegenstellen.";
  if (/size|large|small/.test(reason))
    return "Dateigröße liegt außerhalb der Vorgaben.";
  if (/already|existing|upgrade|cutoff/.test(reason))
    return "Vorhandene Datei oder Upgrade-Regeln verhindern den Download.";
  if (/custom.?format|score/.test(reason))
    return "Bewertung oder benutzerdefinierte Formate passen nicht.";
  if (/delay|pending/.test(reason))
    return "Wartezeit oder Verzögerungsregel ist aktiv.";
  if (/indexer|torrent/.test(reason))
    return "Quelle oder Torrent erfüllt die Vorgaben nicht.";
  return "Weitere Profil- oder Freigaberegel verhindert den automatischen Download.";
}
export class RequestDiagnostics {
  constructor(hub) {
    this.hub = hub;
  }
  async target(s, id) {
    const request = await s.additional.seerr(`/request/${positiveId(id)}`);
    if (!request?.media) throw Error("Anfrage nicht mehr vorhanden.");
    const kind = mediaType(request.media.mediaType);
    const mediaId = positiveId(request.media.tmdbId);
    const service = kind === "movie" ? "Radarr" : "Sonarr";
    if (!this.hub.engine.current()?.plan.spec.selected.includes(service))
      throw Error(`${service} ist nicht eingerichtet.`);
    const configs = await s.additional.seerr(
      `/settings/${service.toLowerCase()}`,
    );
    const configured = Array.isArray(configs)
      ? configs.find((v) =>
          request.serverId !== undefined && request.serverId !== null
            ? Number(v.id) === Number(request.serverId)
            : v.isDefault && !v.is4k,
        )
      : null;
    if (
      request.is4k ||
      !configured ||
      configured.hostname !== service.toLowerCase() ||
      Number(configured.port) !== (kind === "movie" ? 7878 : 8989) ||
      configured.useSsl ||
      ![undefined, "", "/"].includes(configured.baseUrl)
    )
      throw Object.assign(
        Error(
          "Diese Anfrage ist in Seerr einem anderen Server oder einer anderen Dienstkonfiguration zugeordnet. Die Serverauswahl in Seerr prüfen; StackPilot startet dafür keine Suche im verwalteten Standarddienst.",
        ),
        { userFacing: true },
      );
    let tvdbId = request.media.tvdbId;
    if (kind === "tv" && !tvdbId) {
      const detail = await s.additional.seerr(`/tv/${mediaId}`);
      tvdbId = detail.externalIds?.tvdbId;
    }
    const list = await s.arr(
      service,
      kind === "movie"
        ? `/movie?tmdbId=${mediaId}`
        : `/series?tvdbId=${positiveId(tvdbId)}`,
    );
    if (!Array.isArray(list))
      throw Error("Die Medienliste der ARR-App ist nicht erreichbar.");
    const item = list.find((v) =>
      kind === "movie" ? v.tmdbId === mediaId : v.tvdbId === Number(tvdbId),
    );
    if (item) positiveId(item.id);
    return { request, kind, mediaId, service, item, server: configured };
  }
  async inspect(id, includeReleases = false) {
    const { s, plan } = await this.hub.context(["Seerr"]);
    let target;
    try {
      target = await this.target(s, id);
    } catch (error) {
      if (error.userFacing) throw error;
      throw Object.assign(
        Error(
          "Die Anfrage oder ihre Zuordnung in Radarr/Sonarr konnte nicht geprüft werden. Unter Verwaltung → Verbindungen prüfen.",
        ),
        { userFacing: true },
      );
    }
    const { request, kind, service, item } = target;
    const issues = [];
    const read = async (route, key) => {
      try {
        const value = await s.arr(service, route);
        if (!Array.isArray(value)) throw Error("shape");
        return value;
      } catch {
        issues.push(key);
        return null;
      }
    };
    const [indexers, health, clients, commands, history] = await Promise.all([
      read("/indexer", "Quellen"),
      read("/health", "Dienststatus"),
      read("/downloadclient", "Downloadclient"),
      read("/command", "Suchaufträge"),
      item
        ? (async () => {
            try {
              const result = await s.arr(
                service,
                kind === "movie"
                  ? `/history/movie?movieId=${item.id}`
                  : `/history?page=1&pageSize=30&seriesId=${item.id}&sortKey=date&sortDirection=descending`,
              );
              const records = Array.isArray(result) ? result : result?.records;
              if (!Array.isArray(records)) throw Error("shape");
              return records;
            } catch {
              issues.push("Verlauf");
              return null;
            }
          })()
        : Promise.resolve([]),
    ]);
    let clientReady = false;
    try {
      if (!plan.spec.selected.includes("qBittorrent"))
        throw Error("not managed");
      const transfer = await s.qbit("/transfer/info");
      clientReady =
        Number.isFinite(transfer?.dl_info_speed) &&
        Number.isFinite(transfer?.up_info_speed);
    } catch {}
    let vpn;
    try {
      vpn = await this.hub.guard.check(true);
    } catch {
      vpn = { state: "unknown", reason: "VPN-Prüfung nicht erreichbar." };
    }
    const sources =
      indexers?.map((v) => ({
        name: text(v.name),
        automatic: !!v.enableAutomaticSearch,
        interactive: !!v.enableInteractiveSearch,
      })) ?? null;
    const relevantHealth = (health || []).filter((v) =>
      /Indexer|DownloadClient|RootFolder|DiskSpace|Import/.test(v.source || ""),
    );
    const healthWarnings = relevantHealth.map((v) =>
      /Indexer/.test(v.source)
        ? "Die ARR-App meldet ein Quellenproblem. Verbindung und Suchmöglichkeiten prüfen."
        : /DownloadClient/.test(v.source)
          ? "Die ARR-App meldet ein Problem mit dem Downloadclient."
          : "Die ARR-App meldet ein Speicher- oder Importproblem.",
    );
    const active =
      commands?.some((c) => item && activeSearch(c, kind, item.id)) || false;
    const latestCommand = item
      ? [...(commands || [])]
          .filter((c) => searchTargets(c, kind, item.id))
          .sort((a, b) => Number(b.id) - Number(a.id))[0]
      : null;
    const relevant = (history || []).filter((h) =>
      kind === "movie" ? h.movieId === item?.id : h.seriesId === item?.id,
    );
    const grabbed = relevant.find((h) => h.eventType === "grabbed");
    const blockers = [];
    try {
      await verifyCurrentQuality(this.hub, s, plan, target);
    } catch {
      blockers.push(
        "Das aktuelle Qualitätsprofil entspricht nicht nachweislich deiner gespeicherten Auswahl. Unter Qualität ändern erneut prüfen und speichern.",
      );
    }
    if (request.status !== 2)
      blockers.push(
        request.status === 1
          ? "Die Anfrage wartet noch auf Freigabe."
          : request.status === 5
            ? "Die Anfrage ist bereits abgeschlossen."
            : "Die Anfrage ist nicht für eine erneute Suche freigegeben.",
      );
    if (!item)
      blockers.push(
        `Das Medium ist noch nicht in ${service} angekommen. Seerr-Verbindung und Anfrage dort prüfen.`,
      );
    else {
      if (!item.monitored)
        blockers.push(`Das Medium wird in ${service} nicht überwacht.`);
      if (kind === "movie" && item.hasFile)
        blockers.push("Der Film hat bereits eine Mediendatei.");
    }
    if (!indexers)
      blockers.push(
        "Die in der ARR-App eingerichteten Quellen sind unbekannt.",
      );
    else if (!sources.some((v) => v.automatic))
      blockers.push(
        `In ${service} ist keine aktuell nutzbare Quelle für automatische Suchen eingerichtet. Prowlarr-Verbindung und Synchronisierung prüfen.`,
      );
    if (!clients)
      blockers.push(
        "Die Downloadclient-Verbindung konnte nicht geprüft werden.",
      );
    else if (
      !clients.some((v) => v.enable && v.implementation === "QBittorrent")
    )
      blockers.push(
        `In ${service} fehlt ein aktivierter qBittorrent-Downloadclient.`,
      );
    if (!clientReady)
      blockers.push(
        "qBittorrent ist nicht erreichbar. Unter Downloads den Clientzustand prüfen und gegebenenfalls geschützt fortsetzen.",
      );
    if (!commands || !health)
      blockers.push(
        "Suchaufträge oder Dienststatus sind nicht vollständig prüfbar.",
      );
    if (relevantHealth.some((v) => v.type === "error"))
      blockers.push(
        "Die ARR-App meldet ein kritisches Quellen-, Downloadclient- oder Speicherproblem. Zuerst die Dienstverbindungen prüfen.",
      );
    if (vpn.state !== "connected")
      blockers.push(
        "VPN ist nicht nachgewiesen; eine neue automatische Suche bleibt gesperrt.",
      );
    if (active)
      blockers.push("Für dieses Medium läuft bereits ein Suchauftrag.");
    let releases = null;
    if (includeReleases && item) {
      try {
        const rows = await s.arr(
          service,
          kind === "movie"
            ? `/release?movieId=${item.id}`
            : `/release?seriesId=${item.id}`,
        );
        if (!Array.isArray(rows)) throw Error("shape");
        releases = {
          total: rows.length,
          results: rows.slice(0, 100).map((v) => ({
            title: text(v.title, 240),
            source: text(v.indexer),
            quality: text(v.quality?.quality?.name),
            size: Number.isFinite(v.size) ? v.size : null,
            seeders: Number.isFinite(v.seeders) ? v.seeders : null,
            rejected: !!v.rejected,
            reasons: [
              ...new Set(
                (Array.isArray(v.rejections) ? v.rejections : []).map(
                  rejection,
                ),
              ),
            ],
          })),
        };
      } catch {
        issues.push("Treffersuche");
      }
    }
    const importInfo = await importStatus(
      s,
      plan,
      target,
      history,
      clients,
      this.hub.library,
    );
    const key = `request-search:${plan.rootId || plan.id}:${positiveId(id)}`;
    const lastSearch = this.hub.engine.vault.get(key);
    return {
      requestId: Number(id),
      service,
      observedAt: new Date().toISOString(),
      approved: request.status === 2,
      library: item
        ? {
            present: true,
            monitored: !!item.monitored,
            hasFile: !!item.hasFile,
            status: text(item.status),
          }
        : { present: false, monitored: false, hasFile: false, status: "" },
      sources,
      clientReady,
      healthWarnings: [...new Set(healthWarnings)],
      clients:
        clients
          ?.filter((v) => v.enable)
          .map((v) => ({ name: text(v.name), type: text(v.implementation) })) ??
        null,
      search: {
        active,
        known: commands !== null,
        lastStatus: [
          "queued",
          "started",
          "completed",
          "failed",
          "aborted",
        ].includes(latestCommand?.status)
          ? latestCommand.status
          : null,
        lastRequestedAt: lastSearch?.startedAt || null,
      },
      lastGrab: grabbed
        ? {
            title: text(grabbed.sourceTitle, 240),
            source: text(grabbed.data?.indexer),
            at: grabbed.date,
          }
        : null,
      vpn: { state: vpn.state, reason: vpn.reason },
      blockers,
      canSearch: blockers.length === 0,
      importInfo,
      issues,
      releases,
    };
  }
  async seriesEpisodes(s, target, season, onlySeason = true) {
    if (target.kind !== "tv" || !target.item ||
        !target.request.seasons?.some((entry) => entry.seasonNumber === season))
      throw Error("Diese Staffel ist der Sonarr-Anfrage nicht zugeordnet.");
    const episodes = await s.arr("Sonarr", `/episode?seriesId=${target.item.id}`);
    if (!Array.isArray(episodes)) throw Error("Folgen konnten nicht gelesen werden.");
    return episodes.filter((episode) =>
      episode.seriesId === target.item.id && (!onlySeason || episode.seasonNumber === season));
  }
  seasonMonitored(target, season) {
    return !target.item.seasons?.some((entry) =>
      entry.seasonNumber === season && entry.monitored === false,
    );
  }
  async episodes(requestId, season) {
    const { s } = await this.hub.context(["Seerr", "Sonarr"]);
    const target = await this.target(s, positiveId(requestId));
    const seasonNumber = positiveId(season);
    const rows = await this.seriesEpisodes(s, target, seasonNumber, false);
    const fileCounts = new Map();
    for (const row of rows) if (row.episodeFileId > 0)
      fileCounts.set(row.episodeFileId, (fileCounts.get(row.episodeFileId) || 0) + 1);
    return { episodes: rows.filter((episode) => episode.seasonNumber === seasonNumber).map((episode) => ({
      id: episode.id,
      number: episode.episodeNumber,
      title: text(episode.title),
      hasFile: episode.hasFile === true,
      removableFileId: episode.hasFile && fileCounts.get(episode.episodeFileId) === 1 ? episode.episodeFileId : null,
      canSearch: target.request.status === 2 && target.item.monitored &&
        this.seasonMonitored(target, seasonNumber) && episode.monitored && !episode.hasFile && Date.parse(episode.airDateUtc) <= Date.now(),
    })) };
  }
  async deleteEpisodeFile(body) {
    if (body.confirmation !== "OK") throw Error("Dateilöschung mit OK bestätigen.");
    const season = positiveId(body.season), episodeId = positiveId(body.episodeId),
      fileId = positiveId(body.fileId);
    return this.hub.mutate(["Seerr", "Sonarr"], async ({ s }) => {
      const target = await this.target(s, positiveId(body.requestId));
      const rows = await this.seriesEpisodes(s, target, season, false);
      const owners = rows.filter((episode) => episode.episodeFileId === fileId);
      if (owners.length !== 1 || owners[0].id !== episodeId ||
          owners[0].seasonNumber !== season || !owners[0].hasFile)
        throw Error("Datei wurde geändert oder gehört zu mehreren Folgen. Folgen neu laden.");
      const file = await s.arr("Sonarr", `/episodefile/${fileId}`);
      if (file?.id !== fileId || file.seriesId !== target.item.id)
        throw Error("Sonarr hat die Dateizuordnung nicht bestätigt.");
      await s.arr("Sonarr", `/episodefile/${fileId}`, { method: "DELETE" });
      const updated = await s.arr("Sonarr", `/episode/${episodeId}`);
      if (updated?.id !== episodeId || updated.hasFile !== false)
        throw Error("Sonarr hat die Dateilöschung noch nicht bestätigt. Folgen neu laden.");
      return { ok: true };
    });
  }
  async replacement(s, target, queue) {
    const { kind, item, request } = target;
    if (kind !== "movie" || request.status !== 2 || !item?.monitored || item.hasFile)
      throw Error("Ein Austausch ist nur für einen genehmigten Film ohne importierte Datei verfügbar.");
    const entries = queue.records.filter((row) => matchesImportTarget(row, target));
    const entry = entries[0];
    const hash = entry?.downloadId?.toLowerCase();
    if (entries.length !== 1 || !/^[a-f0-9]{40}$/.test(hash || "") ||
        queue.records.filter((row) => row.downloadId?.toLowerCase() === hash).length !== 1)
      throw Error("Genau ein eindeutig zugeordneter Film-Download ist erforderlich.");
    const torrents = await s.qbit("/torrents/info");
    const torrent = Array.isArray(torrents) && torrents.find((row) => row.hash === hash);
    if (!torrent || torrent.category !== "stackpilot-movies" ||
        !Number.isFinite(torrent.progress) || torrent.progress >= 1 ||
        !/^(downloading|queuedDL|stalledDL|forcedDL|stoppedDL|pausedDL)$/.test(torrent.state))
      throw Error("Der Transfer ist nicht eindeutig als unvollständiger Film-Download bestätigt.");
    const queueId = positiveId(entry.id);
    return {
      hash, queueId, name: text(torrent.name),
      review: createHash("sha256").update(JSON.stringify([
        request.id, item.id, item.qualityProfileId, queueId, hash,
      ])).digest("hex"),
    };
  }
  async replacePreview(id) {
    const { plan, s } = await this.hub.context(["Seerr", "qBittorrent"]);
    const target = await this.target(s, positiveId(id));
    await verifyCurrentQuality(this.hub, s, plan, target);
    const queue = await this.completeQueue(s, target.service);
    const { name, review } = await this.replacement(s, target, queue);
    return { name, review };
  }
  async completeQueue(s, service) {
    let queue;
    try {
      queue = await s.arr(service, importQueueRoute);
    } catch {
      throw Error("Download- und Importwarteschlange ist nicht erreichbar.");
    }
    if (!Array.isArray(queue?.records) ||
        !Number.isSafeInteger(queue.totalRecords) || queue.totalRecords > queue.records.length)
      throw Error("Download- und Importwarteschlange konnte nicht vollständig geprüft werden.");
    return queue;
  }
  async waitForTorrent(s, hash, matches) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const torrents = await s.qbit("/torrents/info");
      if (!Array.isArray(torrents)) break;
      if (matches(torrents.find((row) => row.hash === hash))) return true;
      if (attempt < 7) await delay(250);
    }
    return false;
  }
  async detachFilmDownload(s, target, candidate) {
    const { hash, queueId } = candidate;
    const movieId = positiveId(target.item.id);
    const blocklistRoute = `/blocklist/movie?movieId=${movieId}`;
    const [history, oldBlocks] = await Promise.all([
      s.arr("Radarr", `/history/movie?movieId=${movieId}`),
      s.arr("Radarr", blocklistRoute),
    ]);
    const grabbed = Array.isArray(history) && history.find((entry) =>
      entry.eventType === "grabbed" && entry.downloadId?.toLowerCase() === hash,
    );
    if (!grabbed?.sourceTitle || !Array.isArray(oldBlocks))
      throw Error("Radarrs Abrufhistorie oder Blockliste für den Transfer ist nicht bestätigt.");
    const previousIds = new Set(oldBlocks.map((entry) => entry.id));
    try {
      await s.qbit("/torrents/stop", { hashes: hash });
      if (!await this.waitForTorrent(s, hash, (torrent) =>
        Number.isFinite(torrent?.progress) && torrent.progress < 1 &&
        /^(stopped|paused)DL$/.test(torrent.state)))
        throw Error("Downloadstopp nicht bestätigt.");
      const queue = await this.completeQueue(s, "Radarr");
      if ((await this.replacement(s, target, queue)).review !== candidate.review)
        throw Error("Warteschlange wurde geändert.");
      await s.arr("Radarr", `/queue/${queueId}?removeFromClient=false&blocklist=true&skipRedownload=true`,
        { method: "DELETE" });
      let confirmed = false;
      for (let attempt = 0; attempt < 8 && !confirmed; attempt++) {
        const blocks = await s.arr("Radarr", blocklistRoute);
        confirmed = Array.isArray(blocks) && blocks.some((entry) =>
          entry.movieId === movieId && entry.sourceTitle === grabbed.sourceTitle &&
          Number.isSafeInteger(entry.id) && !previousIds.has(entry.id),
        );
        if (!confirmed && attempt < 7) await delay(250);
      }
      if (!confirmed) throw Error("Radarr hat die Blockliste nicht bestätigt.");
      await s.qbit("/torrents/delete", { hashes: hash, deleteFiles: "false" });
      if (!await this.waitForTorrent(s, hash, (torrent) => torrent === undefined))
        throw Error("Alter Download ist noch im Client.");
    } catch {
      throw Error("Austausch nicht vollständig bestätigt. Der alte Transfer kann gestoppt sein. Warteschlange prüfen und bei Bedarf die normale Suche verwenden. StackPilot hat keine Dateilöschung angefordert.");
    }
  }
  async search(body) {
    const id = positiveId(body.requestId);
    await this.hub.requireVpn();
    return this.hub.mutate(["Seerr", "qBittorrent"], async ({ plan, s }) => {
      if (!plan.spec.vpn || plan.id !== this.hub.guard.checkedPlanId)
        throw Error("VPN-Zustand hat sich geändert. Erneut prüfen.");
      const target = await this.target(s, id);
      const { request, kind, service, item } = target;
      if (
        request.status !== 2 ||
        !item ||
        !item.monitored ||
        (kind === "movie" && item.hasFile)
      )
        throw Error(
          "Anfrage ist nicht suchbereit. Zuerst die Diagnose öffnen.",
        );
      await verifyCurrentQuality(this.hub, s, plan, target);
      const [indexers, clients, commands, health] = await Promise.all([
        s.arr(service, "/indexer"),
        s.arr(service, "/downloadclient"),
        s.arr(service, "/command"),
        s.arr(service, "/health"),
      ]);
      if (
        !Array.isArray(indexers) ||
        !Array.isArray(clients) ||
        !Array.isArray(commands) ||
        !Array.isArray(health)
      )
        throw Error(
          "Quellen oder Downloadclient konnten nicht geprüft werden.",
        );
      if (!indexers.some((v) => v.enableAutomaticSearch))
        throw Error(
          `Keine aktive Quelle für automatische Suchen in ${service}.`,
        );
      if (
        health.some(
          (v) =>
            v.type === "error" &&
            /Indexer|DownloadClient|RootFolder|DiskSpace|Import/.test(
              v.source || "",
            ),
        )
      )
        throw Error(
          "Die ARR-App meldet kritische Probleme mit Quellen, Downloadclient oder Speicher.",
        );
      if (!clients.some((v) => v.enable && v.implementation === "QBittorrent"))
        throw Error("Aktivierter qBittorrent-Downloadclient fehlt.");
      const key = `request-search:${plan.rootId || plan.id}:${id}`;
      const previous = this.hub.engine.vault.get(key);
      if (commands.some((command) =>
        activeSearch(command, kind, item.id) ||
        (previous?.arrId === item.id && previous.commandIds?.includes(command.id) &&
          ["queued", "started"].includes(command.status))))
        return { ok: true, alreadyRunning: true };
      const queue = await this.completeQueue(s, service);
      let candidate;
      if (body.replaceReview !== undefined) {
        if (body.confirmation !== "OK" || body.episodeId !== undefined)
          throw Error("Austausch zuerst bestätigen.");
        candidate = await this.replacement(s, target, queue);
        if (candidate.review !== body.replaceReview)
          throw Error("Download oder Qualitätsprofil wurde geändert. Austausch erneut prüfen.");
      } else if (queue.records.some((row) => matchesImportTarget(row, target))) {
        throw Error("Für dieses Medium läuft bereits ein Download oder Import. Prüfe zuerst die Warteschlange in Radarr oder Sonarr.");
      }
      let transfer;
      try {
        transfer = await s.qbit("/transfer/info");
      } catch {
        throw Error(
          "qBittorrent ist nicht erreichbar. Zuerst den Downloadclient prüfen.",
        );
      }
      if (
        !Number.isFinite(transfer?.dl_info_speed) ||
        !Number.isFinite(transfer?.up_info_speed)
      )
        throw Error("Downloadclient-Zustand ist unbekannt.");
      if (previous && Date.now() - Date.parse(previous.startedAt) < 30000)
        throw Error(
          "Eine Suche wurde gerade beauftragt. Bitte kurz warten und den Zustand erneut prüfen.",
        );
      let episodeSearch;
      if (body.episodeId !== undefined) {
        const rows = await this.seriesEpisodes(s, target, positiveId(body.season));
        const episode = rows.find((row) => row.id === positiveId(body.episodeId));
        if (!episode || !this.seasonMonitored(target, episode.seasonNumber) ||
            !episode.monitored || episode.hasFile ||
            !(Date.parse(episode.airDateUtc) <= Date.now()))
          throw Error("Diese Folge ist nicht als fehlende, überwachte Folge bestätigt.");
        episodeSearch = { name: "EpisodeSearch", episodeIds: [episode.id] };
      }
      const searches = episodeSearch ? [episodeSearch] :
        kind === "movie"
          ? [{ name: "MoviesSearch", movieIds: [item.id] }]
          : (request.seasons || [])
              .filter(
                (v) =>
                  Number.isSafeInteger(v.seasonNumber) && v.seasonNumber > 0 &&
                  this.seasonMonitored(target, v.seasonNumber),
              )
              .map((v) => ({
                name: "SeasonSearch",
                seriesId: item.id,
                seasonNumber: v.seasonNumber,
              }));
      if (!searches.length || searches.length > 100)
        throw Error("Keine gültigen angefragten Staffeln gefunden.");
      if (candidate) {
        const downloadClients = clients.filter((client) => client.enable && client.implementation === "QBittorrent");
        if (downloadClients.length !== 1 || downloadClients[0].name !== "StackPilot qBittorrent" ||
            downloadClients[0].removeFailedDownloads !== false)
          throw Error("Radarr muss den verwalteten qBittorrent verwenden und fehlgeschlagene Downloads behalten.");
        await this.detachFilmDownload(s, target, candidate);
      }
      const progress = {
        startedAt: new Date().toISOString(),
        arrId: item.id,
        kind,
        commandIds: [],
      };
      this.hub.engine.vault.set(key, progress);
      try {
        for (const command of searches) {
          const result = await s.arr(service, "/command", {
            method: "POST",
            body: command,
          });
          progress.commandIds.push(result.id);
          this.hub.engine.vault.set(key, progress);
        }
        return { ok: true, alreadyRunning: false };
      } catch {
        throw Error(
          candidate
            ? "Alter Download entfernt, Dateien erhalten. Die neue Suche wurde nicht bestätigt. Vor erneutem Versuch den Suchauftrag in Radarr prüfen."
            : "Suchauftrag nicht vollständig bestätigt. Vor erneutem Versuch die Suchaufträge in Radarr/Sonarr prüfen.",
        );
      }
    });
  }
}
