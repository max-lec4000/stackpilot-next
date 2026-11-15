// Deliberate read-only projections, never export indexer fields, credentials, media or client names.
const number = (v) => (Number.isFinite(v) ? v : null);
const boolean = (v) => (typeof v === "boolean" ? v : null);
function qualities(items, enabled = true) {
  return (items || []).flatMap((v) =>
    v.items?.length
      ? qualities(v.items, enabled && v.allowed !== false)
      : [{ id: number(v.quality?.id), allowed: enabled && boolean(v.allowed) }],
  );
}
export async function configurationReport(hub) {
  const { s, plan } = await hub.context([]),
    sections = {};
  const read = async (key, fn, pick) => {
    try {
      sections[key] = { state: "read", value: pick(await fn()) };
    } catch {
      sections[key] = { state: "unconfirmed" };
    }
  };
  for (const name of ["Radarr", "Sonarr", "Lidarr"].filter((n) =>
    plan.spec.selected.includes(n),
  )) {
    await read(
      name,
      async () => {
        const [profiles, roots, clients, indexers, health] = await Promise.all(
          [
            "/qualityprofile",
            "/rootfolder",
            "/downloadclient",
            "/indexer",
            "/health",
          ].map((route) => s.arr(name, route)),
        );
        if (![profiles, roots, clients, indexers, health].every(Array.isArray))
          throw Error("Incomplete");
        return { profiles, roots, clients, indexers, health };
      },
      (r) => ({
        profiles: r.profiles.map((p) => ({
          id: number(p.id),
          upgradeAllowed: boolean(p.upgradeAllowed),
          cutoff: number(p.cutoff),
          minFormatScore: number(p.minFormatScore),
          qualities: qualities(p.items),
          formatItems: (p.formatItems || []).map((v) => ({
            format: number(v.format),
            score: number(v.score),
          })),
        })),
        roots: r.roots.map((p) => ({
          path: typeof p.path === "string" ? p.path.slice(0, 500) : null,
          accessible: boolean(p.accessible),
          freeSpace: number(p.freeSpace),
        })),
        downloadClients: r.clients.map((p) => ({
          id: number(p.id),
          enabled: boolean(p.enable),
        })),
        indexers: r.indexers.map((p) => ({
          id: number(p.id),
          enableAutomaticSearch: boolean(p.enableAutomaticSearch),
          enableInteractiveSearch: boolean(p.enableInteractiveSearch),
          enableRss: boolean(p.enableRss),
          priority: number(p.priority),
        })),
        healthIssueCount: r.health.length,
      }),
    );
  }
  if (plan.spec.selected.includes("Prowlarr"))
    await read(
      "Prowlarr",
      () => s.arr("Prowlarr", "/indexer"),
      (rows) => ({
        sources: rows.map((v) => ({
          id: number(v.id),
          enabled: boolean(v.enable),
          priority: number(v.priority),
        })),
      }),
    );
  if (plan.spec.selected.includes("qBittorrent"))
    await read(
      "qBittorrent",
      () => s.qbit("/app/preferences"),
      (p) => ({
        savePath: p.save_path,
        tempPath: p.temp_path,
        tempEnabled: boolean(p.temp_path_enabled),
        automaticManagement: boolean(p.auto_tmm_enabled),
        upnp: boolean(p.upnp),
        webUpnp: boolean(p.web_ui_upnp),
      }),
    );
  if (plan.spec.selected.includes("Seerr"))
    await read(
      "Seerr",
      async () => {
        const [radarr, sonarr] = await Promise.all(
          ["/settings/radarr", "/settings/sonarr"].map((route) =>
            s.additional.seerr(route),
          ),
        );
        if (!Array.isArray(radarr) || !Array.isArray(sonarr))
          throw Error("Incomplete");
        const pick = (rows) =>
          rows.map((v) => ({
            id: number(v.id),
            isDefault: boolean(v.isDefault),
            is4k: boolean(v.is4k),
            activeProfileId: number(v.activeProfileId),
            port: number(v.port),
            useSsl: boolean(v.useSsl),
            rootFolder:
              typeof v.rootFolder === "string"
                ? v.rootFolder.slice(0, 500)
                : null,
          }));
        return { radarr: pick(radarr), sonarr: pick(sonarr) };
      },
      (r) => r,
    );
  return sections;
}
