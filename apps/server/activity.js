import { Services } from "./service-api.js";
const text = (value, limit = 180) =>
  typeof value === "string" ? value.slice(0, limit) : "";
const number = (value) =>
  Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
export function sessionSummary(session) {
  const item = session.NowPlayingItem;
  const background = /^(StackPilot|Seerr|Jellyseerr)$/i.test(
    session.Client || "",
  );
  if (
    !item &&
    (background ||
      !session.UserName ||
      !session.DeviceName ||
      (!session.IsActive &&
        !(Date.now() - Date.parse(session.LastActivityDate) < 120000)))
  )
    return null;
  const duration = number(item?.RunTimeTicks),
    position = number(session.PlayState?.PositionTicks);
  return {
    id: text(session.Id, 100),
    user: text(session.UserName),
    device: text(session.DeviceName || session.Client),
    title: text(item?.Name),
    series: text(item?.SeriesName),
    state: !item ? "idle" : session.PlayState?.IsPaused ? "paused" : "playing",
    progress: duration ? Math.min(1, position / duration) : null,
    transcode: session.PlayState?.PlayMethod === "Transcode",
  };
}
export function torrentSummary(torrent) {
  return {
    id: text(torrent.hash, 64),
    name: text(torrent.name),
    state: text(torrent.state, 50),
    progress: Math.min(1, number(torrent.progress)),
    size: number(torrent.size),
    downloaded: number(torrent.downloaded),
    downloadRate: number(torrent.dlspeed),
    uploadRate: number(torrent.upspeed),
    etaSeconds: number(torrent.eta) < 8640000 ? number(torrent.eta) : null,
  };
}
export class ActivityMonitor {
  constructor(engine, guard, options = {}) {
    this.engine = engine;
    this.guard = guard;
    this.makeServices =
      options.services ||
      ((plan, relay) => new Services(plan, engine.vault, relay));
    this.pending = null;
    this.cached = null;
    this.session = null;
    this.services = null;
    this.diagnostics = {};
  }
  get() {
    if (this.pending) return this.pending;
    if (this.cached && Date.now() - Date.parse(this.cached.observedAt) < 10000)
      return Promise.resolve(this.cached);
    this.pending = this.collect()
      .then((result) => (this.cached = result))
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }
  async collect() {
    this.diagnostics = {};
    const current = this.engine.current();
    const result = {
      observedAt: new Date().toISOString(),
      configured: !!current,
      installationStatus: current?.job.status || null,
      vpn: this.guard.status,
      jellyfin: { state: "not-installed", sessions: [] },
      downloads: {
        state: "not-installed",
        torrents: [],
        count: 0,
        queued: 0,
        downloadRate: 0,
        uploadRate: 0,
      },
      arr: [],
    };
    if (!current) return result;
    const plan = current.plan;
    let services;
    try {
      const relay = await this.engine.relay(plan);
      if (this.services?.planId !== plan.id || this.services.relay !== relay)
        this.services = {
          planId: plan.id,
          relay,
          value: this.makeServices(plan, relay),
        };
      services = this.services.value;
      services.timeout = 6000;
    } catch {
      if (plan.spec.selected.includes("Jellyfin"))
        result.jellyfin.state = "unavailable";
      if (plan.spec.selected.includes("qBittorrent"))
        result.downloads.state = "unavailable";
      result.arr = plan.spec.selected
        .filter((n) => ["Sonarr", "Radarr", "Lidarr"].includes(n))
        .map((service) => ({ service, state: "unavailable", queued: null }));
      return result;
    }
    await Promise.all([
      (async () => {
        if (!plan.spec.selected.includes("Jellyfin")) return;
        let phase = "login";
        try {
          if (!this.session || this.session.planId !== plan.id)
            this.session = {
              planId: plan.id,
              ...(await services.additional.jellyfinLogin("activity")),
            };
          const login = this.session;
          phase = "sessions";
          const sessions = await services.request("Jellyfin", "/Sessions", {
            headers: {
              Authorization: `MediaBrowser Client="StackPilot", Device="activity", DeviceId="stackpilot-activity", Version="0.1.0", Token="${login.AccessToken}"`,
            },
          });
          if (!Array.isArray(sessions)) throw new Error("shape");
          result.jellyfin = {
            state: "ready",
            sessions: sessions.map(sessionSummary).filter(Boolean).slice(0, 30),
          };
        } catch (error) {
          this.diagnostics.Jellyfin = {
            phase,
            code: /HTTP (\d+)/.exec(error.message)?.[1] || error.name,
          };
          this.session = null;
          result.jellyfin.state = "unavailable";
        }
      })(),
      (async () => {
        if (!plan.spec.selected.includes("qBittorrent")) return;
        try {
          const [torrents, transfer] = await Promise.all([
            services.qbit("/torrents/info"),
            services.qbit("/transfer/info"),
          ]);
          if (
            !Array.isArray(torrents) ||
            !Number.isFinite(transfer?.dl_info_speed) ||
            !Number.isFinite(transfer?.up_info_speed)
          )
            throw new Error("shape");
          result.downloads = {
            state: "ready",
            count: torrents.length,
            queued: torrents.filter((t) => /^queuedDL$/i.test(t.state)).length,
            torrents: torrents.slice(0, 50).map(torrentSummary),
            downloadRate: number(transfer.dl_info_speed),
            uploadRate: number(transfer.up_info_speed),
          };
        } catch {
          result.downloads.state = "unavailable";
        }
      })(),
      ...plan.spec.selected
        .filter((n) => ["Sonarr", "Radarr", "Lidarr"].includes(n))
        .map(async (service) => {
          try {
            const queue = await services.arr(
              service,
              "/queue?page=1&pageSize=1&includeUnknownSeriesItems=false",
            );
            if (!Number.isFinite(queue?.totalRecords)) throw new Error("shape");
            result.arr.push({
              service,
              state: "ready",
              queued: queue.totalRecords,
            });
          } catch {
            result.arr.push({ service, state: "unavailable", queued: null });
          }
        }),
    ]);
    result.arr.sort((a, b) => a.service.localeCompare(b.service));
    return result;
  }
}
