const text = (v, n = 500) => (typeof v === "string" ? v.slice(0, n) : "");
export function importMessage(value, secrets = []) {
  let message = text(value, 1800)
    .replace(/https?:\/\/[^\s<>"']+/gi, "[Adresse ausgeblendet]")
    .replace(
      /\b(api[-_]?key|passkey|token|password|cookie)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[ausgeblendet]",
    );
  for (const secret of secrets)
    if (typeof secret === "string" && secret.length > 5)
      message = message.replaceAll(secret, "[ausgeblendet]");
  return message;
}
export async function importStatus(
  s,
  plan,
  target,
  history,
  clients,
  libraryMonitor = null,
) {
  const { kind, service, item, mediaId } = target;
  const issues = [];
  let queue = null,
    torrents = null,
    handling = null;
  await Promise.all([
    (async () => {
      try {
        const r = await s.arr(
          service,
          "/queue?page=1&pageSize=250&includeMovie=true&includeSeries=true&includeUnknownSeriesItems=false",
        );
        if (!Array.isArray(r.records)) throw Error("shape");
        queue = r;
      } catch {
        issues.push("Import-Warteschlange");
      }
    })(),
    (async () => {
      if (!plan.spec.selected.includes("qBittorrent")) {
        issues.push("Kein verwalteter Downloadclient");
        return;
      }
      try {
        const r = await s.qbit("/torrents/info");
        if (!Array.isArray(r)) throw Error("shape");
        torrents = r;
      } catch {
        issues.push("Torrent-Zuordnung");
      }
    })(),
    (async () => {
      try {
        const r = await s.arr(service, "/config/downloadclient");
        if (typeof r?.enableCompletedDownloadHandling !== "boolean")
          throw Error("shape");
        handling = r.enableCompletedDownloadHandling;
      } catch {
        issues.push("Abgeschlossene Downloads");
      }
    })(),
  ]);
  const rows = (queue?.records || []).filter(
    (q) =>
      item &&
      (kind === "movie"
        ? q.movieId === item.id || q.movie?.tmdbId === mediaId
        : q.seriesId === item.id),
  );
  const relevant = (history || [])
    .filter(
      (h) =>
        item &&
        (kind === "movie" ? h.movieId === item.id : h.seriesId === item.id),
    )
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  const ids = new Set(
    [...rows.map((q) => q.downloadId), ...relevant.map((h) => h.downloadId)]
      .filter((v) => typeof v === "string")
      .map((v) => v.toLowerCase()),
  );
  const matching = (torrents || []).filter((t) =>
    ids.has(t.hash?.toLowerCase()),
  );
  const completed = matching.filter((t) => Number(t.progress) >= 1);
  const client =
    (clients || []).find((v) => v.name === "StackPilot qBittorrent") ||
    (clients || []).find((v) => v.enable && v.implementation === "QBittorrent");
  const expectedCategory = client?.fields?.find(
    (f) => f.name === (kind === "movie" ? "movieCategory" : "tvCategory"),
  )?.value;
  const secrets = [];
  if (typeof s.credentials === "function")
    for (const name of plan.spec.selected) {
      try {
        const c = s.credentials(name);
        secrets.push(c.password, c.apiKey);
      } catch {}
    }
  const messages = rows
    .flatMap((q) =>
      (q.statusMessages || []).flatMap((m) => [
        m.title,
        ...(Array.isArray(m.messages) ? m.messages : []),
      ]),
    )
    .filter((v) => typeof v === "string" && v.trim())
    .slice(0, 20)
    .map((v) => importMessage(v, secrets));
  const blocked = rows.some(
    (q) =>
      q.trackedDownloadStatus === "warning" ||
      q.trackedDownloadStatus === "error" ||
      q.trackedDownloadState === "importBlocked",
  );
  const blockers = [];
  if (handling === false)
    blockers.push(
      "Die Verarbeitung abgeschlossener Downloads ist in der ARR-App ausgeschaltet.",
    );
  if (
    completed.some((t) => expectedCategory && t.category !== expectedCategory)
  )
    blockers.push(
      "Die Torrent-Kategorie passt nicht zum zugeordneten ARR-Downloadclient.",
    );
  if (
    completed.some(
      (t) =>
        typeof (t.content_path || t.save_path) === "string" &&
        !(t.content_path || t.save_path).startsWith("/data/"),
    )
  )
    blockers.push(
      "Der fertige Download liegt außerhalb des gemeinsamen /data-Pfads. Die Containerpfade müssen übereinstimmen.",
    );
  if (blocked)
    blockers.push(
      "Die ARR-App meldet ein Importproblem. Die Importmeldungen unten enthalten den konkreten Grund.",
    );
  let library = null;
  if (
    kind === "movie" &&
    item?.hasFile &&
    plan.spec.selected.includes("Jellyfin")
  ) {
    try {
      if (libraryMonitor) {
        library = await libraryMonitor.available(s, plan, mediaId);
        if (library === null) issues.push("Jellyfin-Verfügbarkeit");
      } else {
        const login = await s.additional.jellyfinLogin("import-check");
        const r = await s.request(
          "Jellyfin",
          `/Items?Recursive=true&IncludeItemTypes=Movie&AnyProviderIdEquals=Tmdb.${mediaId}&Fields=ProviderIds&Limit=10`,
          {
            headers: {
              Authorization: `MediaBrowser Client="StackPilot", Device="import-check", DeviceId="stackpilot-import-check", Version="0.1.0", Token="${login.AccessToken}"`,
            },
          },
        );
        if (!Array.isArray(r?.Items)) throw Error("shape");
        library = r.Items.some((v) => Number(v.ProviderIds?.Tmdb) === mediaId);
      }
    } catch {
      issues.push("Jellyfin-Verfügbarkeit");
    }
  }
  const imported = kind === "movie" && !!item?.hasFile;
  const phase =
    library === true
      ? "available"
      : imported
        ? "library-sync"
        : blockers.length
          ? "blocked"
          : completed.length
            ? "pending"
            : matching.length
              ? "downloading"
              : "unknown";
  return {
    phase,
    downloadComplete: completed.length > 0,
    seeding: completed.some((t) =>
      /^(uploading|stalledUP|forcedUP|queuedUP)$/.test(t.state),
    ),
    imported,
    availableInJellyfin: library,
    completedHandling: handling,
    queued: queue !== null ? rows.length : null,
    queueLimited: !!queue && queue.totalRecords > queue.records.length,
    blockers,
    messages,
    issues,
  };
}
