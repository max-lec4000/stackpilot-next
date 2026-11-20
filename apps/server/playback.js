// Medien → Wiedergaben (Phase 7 Paket 7.4): laufende Jellyfin-Wiedergaben mit Gerät, Fortschritt,
// Abspielart (direkt / umgewandelt) und dem Grund fürs Umwandeln in Alltagssprache; eine
// Wiedergabe beenden (OK); Bitrate-Grenze für unterwegs (Jellyfin RemoteClientBitrateLimit)
// und die Hardwarebeschleunigung als Hinweis. IP-Adressen werden nicht angezeigt.

const text = (v, n = 120) => (typeof v === "string" ? v.replace(/[\x00-\x1f\x7f]+/g, " ").trim().slice(0, n) : "");
const fail = (m) => Object.assign(Error(m), { userFacing: true });
const pad = (n) => String(n).padStart(2, "0");
const TICKS = 10_000_000;
export const BITRATES = [0, 4, 8, 15, 20, 40, 80]; // Mbit/s, 0 = unbegrenzt

// Gründe fürs Umwandeln (Jellyfin TranscodeReasons) mit Hinweis, was hilft
export const REASONS = {
  ContainerNotSupported: ["Dateiformat passt nicht zum Gerät", "Meist harmlos; Jellyfin verpackt nur um."],
  VideoCodecNotSupported: ["Videoformat kann das Gerät nicht", "Z. B. HEVC/AV1 auf älteren Geräten – eine 1080p-H.264-Fassung hilft."],
  AudioCodecNotSupported: ["Tonformat kann das Gerät nicht", "Z. B. DTS/TrueHD – nur der Ton wird umgewandelt, das kostet wenig."],
  SubtitleCodecNotSupported: ["Untertitel werden ins Bild eingebrannt", "Bild-Untertitel (PGS/ASS) – Textuntertitel (SRT) wählen spart viel Rechenleistung."],
  ContainerBitrateExceedsLimit: ["Bitrate über der Grenze", "Gerät oder Grenze für unterwegs erlaubt weniger – Grenze erhöhen oder kleinere Fassung."],
  VideoBitrateNotSupported: ["Videobitrate zu hoch fürs Gerät", "Kleinere Fassung oder höhere Grenze im Gerät."],
  VideoResolutionNotSupported: ["Auflösung zu hoch fürs Gerät", "Z. B. 4K auf einem 1080p-Gerät."],
  VideoRangeTypeNotSupported: ["HDR kann das Gerät nicht", "Jellyfin rechnet HDR in SDR um – das ist aufwendig."],
  VideoBitDepthNotSupported: ["10-Bit-Video kann das Gerät nicht", "Eine 8-Bit-Fassung hilft."],
  VideoProfileNotSupported: ["Videoprofil passt nicht", ""],
  VideoLevelNotSupported: ["Videolevel passt nicht", ""],
  VideoFramerateNotSupported: ["Bildrate passt nicht", ""],
  InterlacedVideoNotSupported: ["Zeilensprung-Video", ""],
  AnamorphicVideoNotSupported: ["Anamorphes Video", ""],
  RefFramesNotSupported: ["Referenzbilder passen nicht", ""],
  AudioChannelsNotSupported: ["Zu viele Tonkanäle fürs Gerät", "Nur der Ton wird umgewandelt."],
  AudioProfileNotSupported: ["Tonprofil passt nicht", ""],
  AudioSampleRateNotSupported: ["Abtastrate passt nicht", ""],
  AudioBitDepthNotSupported: ["Ton-Bittiefe passt nicht", ""],
  AudioBitrateNotSupported: ["Tonbitrate zu hoch", ""],
  AudioIsExternal: ["Externe Tonspur", ""],
  SecondaryAudioNotSupported: ["Zweite Tonspur nicht direkt abspielbar", ""],
  UnknownVideoStreamInfo: ["Videodaten unbekannt", "Bibliothek neu einlesen hilft manchmal."],
  UnknownAudioStreamInfo: ["Tondaten unbekannt", ""],
  DirectPlayError: ["Direktes Abspielen fehlgeschlagen", "Das Gerät ist auf Umwandeln ausgewichen."],
  StreamCountExceedsLimit: ["Zu viele Spuren", ""],
  VideoCodecTagNotSupported: ["Video-Kennung passt nicht", ""],
};

const clock = (ticks) => {
  const s = Math.max(0, Math.floor(Number(ticks) / TICKS) || 0);
  return s >= 3600 ? `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}` : `${Math.floor(s / 60)}:${pad(s % 60)}`;
};

export function projectSession(x) {
  const item = x?.NowPlayingItem;
  if (!item || typeof x.Id !== "string") return null;
  const t = x.TranscodingInfo || null, ps = x.PlayState || {};
  const method = ps.PlayMethod === "Transcode" ? (t && t.IsVideoDirect ? "remux" : "transcode") : ps.PlayMethod === "DirectStream" ? "stream" : "direct";
  const reasons = (Array.isArray(t?.TranscodeReasons) ? t.TranscodeReasons : typeof t?.TranscodeReasons === "string" ? t.TranscodeReasons.split(",") : [])
    .map((r) => String(r).trim()).filter(Boolean).slice(0, 8)
    .map((code) => ({ code: text(code, 60), label: REASONS[code]?.[0] || text(code, 60), hint: REASONS[code]?.[1] || "" }));
  const episode = item.Type === "Episode" && Number.isSafeInteger(item.ParentIndexNumber) && Number.isSafeInteger(item.IndexNumber)
    ? `S${pad(item.ParentIndexNumber)}E${pad(item.IndexNumber)} · ` : "";
  return {
    id: x.Id, user: text(x.UserName, 60) || "unbekannt", device: text(x.DeviceName, 60), client: text(x.Client, 60),
    title: item.Type === "Episode" ? `${text(item.SeriesName)} · ${episode}${text(item.Name)}` : `${text(item.Name)}${item.ProductionYear ? ` (${item.ProductionYear})` : ""}`,
    paused: ps.IsPaused === true, position: clock(ps.PositionTicks), duration: item.RunTimeTicks ? clock(item.RunTimeTicks) : null,
    progress: item.RunTimeTicks ? Math.min(1, Math.max(0, (Number(ps.PositionTicks) || 0) / item.RunTimeTicks)) : null,
    method, reasons,
    transcode: t ? {
      video: text(t.VideoCodec, 20) || null, audio: text(t.AudioCodec, 20) || null,
      bitrateMbit: Number(t.Bitrate) > 0 ? Math.round(Number(t.Bitrate) / 100000) / 10 : null,
      height: Number(t.Height) || null, hardware: text(t.HardwareAccelerationType, 20) || null,
      videoDirect: t.IsVideoDirect === true, audioDirect: t.IsAudioDirect === true,
    } : null,
  };
}

export class Playback {
  constructor(hub) {
    this.hub = hub;
  }
  ready() {
    const current = this.hub.engine.current();
    if (current?.job.status !== "completed" || !current.plan.spec.selected.includes("Jellyfin")) throw fail("Jellyfin ist nicht eingerichtet.");
  }
  async j(route, options) {
    const { s, plan } = await this.hub.context(["Jellyfin"]);
    return this.hub.library.request(s, plan, route, options);
  }
  async read() {
    this.ready();
    const [sessions, config, encoding] = await Promise.all([
      this.j("/Sessions?ActiveWithinSeconds=960"), this.j("/System/Configuration"), this.j("/System/Configuration/encoding").catch(() => null),
    ]);
    if (!Array.isArray(sessions)) throw Error("Jellyfin-Wiedergaben nicht lesbar.");
    const rows = sessions.map(projectSession).filter(Boolean).slice(0, 30);
    const limit = Number(config?.RemoteClientBitrateLimit) || 0;
    return {
      checkedAt: new Date().toISOString(), sessions: rows,
      transcoding: rows.filter((r) => r.method === "transcode").length,
      remoteLimitMbit: limit > 0 ? Math.round(limit / 100000) / 10 : 0, choices: BITRATES,
      hardware: encoding ? (text(encoding.HardwareAccelerationType, 20) || "none") : null,
    };
  }
  async stop(body) {
    this.ready();
    if (body.confirmation !== "OK") throw fail("Beenden mit OK bestätigen.");
    if (typeof body.id !== "string" || !/^[a-f0-9-]{8,64}$/i.test(body.id)) throw fail("Ungültige Wiedergabe.");
    return this.hub.mutate(["Jellyfin"], async () => {
      const sessions = await this.j("/Sessions");
      const hit = (Array.isArray(sessions) ? sessions : []).map(projectSession).find((x) => x?.id === body.id);
      if (!hit) throw fail("Diese Wiedergabe läuft nicht mehr.");
      await this.j(`/Sessions/${encodeURIComponent(body.id)}/Playing/Stop`, { method: "POST" });
      return { ok: true, message: `Wiedergabe von „${hit.title}“ auf ${hit.device || "dem Gerät"} beendet.` };
    });
  }
  async setLimit(body) {
    this.ready();
    if (body.confirmation !== "OK") throw fail("Bitrate-Grenze mit OK bestätigen.");
    const mbit = Number(body.mbit);
    if (!BITRATES.includes(mbit)) throw fail("Ungültige Bitrate.");
    return this.hub.mutate(["Jellyfin"], async () => {
      const config = await this.j("/System/Configuration");
      if (!config || typeof config !== "object") throw Error("Jellyfin-Einstellungen nicht lesbar.");
      await this.j("/System/Configuration", { method: "POST", body: { ...config, RemoteClientBitrateLimit: mbit * 1_000_000 } });
      const after = await this.j("/System/Configuration");
      if ((Number(after?.RemoteClientBitrateLimit) || 0) !== mbit * 1_000_000) throw Error("Jellyfin hat die Grenze nicht übernommen.");
      return { ok: true, remoteLimitMbit: mbit, message: mbit ? `Unterwegs höchstens ${mbit} Mbit/s.` : "Unterwegs ohne Bitrate-Grenze." };
    });
  }
}
