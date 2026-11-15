import { verifyCurrentQuality } from "./quality-policy.js";
import { importStatus } from "./import-status.js";
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
      if (commands.some((c) => activeSearch(c, kind, item.id)))
        return { ok: true, alreadyRunning: true };
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
      const key = `request-search:${plan.rootId || plan.id}:${id}`,
        previous = this.hub.engine.vault.get(key);
      if (previous && Date.now() - Date.parse(previous.startedAt) < 30000)
        throw Error(
          "Eine Suche wurde gerade beauftragt. Bitte kurz warten und den Zustand erneut prüfen.",
        );
      const searches =
        kind === "movie"
          ? [{ name: "MoviesSearch", movieIds: [item.id] }]
          : (request.seasons || [])
              .filter(
                (v) =>
                  Number.isSafeInteger(v.seasonNumber) && v.seasonNumber > 0,
              )
              .map((v) => ({
                name: "SeasonSearch",
                seriesId: item.id,
                seasonNumber: v.seasonNumber,
              }));
      if (!searches.length || searches.length > 100)
        throw Error("Keine gültigen angefragten Staffeln gefunden.");
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
          "Suchauftrag nicht vollständig bestätigt. Vor erneutem Versuch die Suchaufträge in Radarr/Sonarr prüfen.",
        );
      }
    });
  }
}
