import { formatBytes } from "../../../packages/domain/format.js";
import { useEffect, useRef, useState } from "react";
import { get } from "./ServerCheck";
import { action } from "./RetirementPanel";
import { OperationNotices, useOperations } from "./Operations";
import { EmptyState, SectionHeading, StatusBadge } from "./ui";
import "./activity.css";
import { usePreference, oneOf } from "./preferences";
import { Problem } from "./Problem";
type Session = {
  id: string;
  user: string;
  device: string;
  title: string;
  series: string;
  state: string;
  progress: number | null;
  transcode: boolean;
};
type Torrent = {
  id: string;
  name: string;
  state: string;
  progress: number;
  downloadRate: number;
  uploadRate: number;
  etaSeconds: number | null;
  size: number;
  downloaded: number;
};
type Activity = {
  configured: boolean;
  observedAt: string;
  installationStatus: string | null;
  vpn: {
    state: string;
    reason: string;
    checkedAt: string | null;
    enforced: boolean;
  };
  jellyfin: { state: string; sessions: Session[] };
  downloads: {
    state: string;
    torrents: Torrent[];
    count: number;
    queued: number;
    downloadRate: number;
    uploadRate: number;
  };
  arr: { service: string; state: string; queued: number | null }[];
};
function useActivity() {
  const version = useRef(0);
  const [data, setData] = useState<Activity | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function refresh() {
    const current = ++version.current;
    setBusy(true);
    try {
      const result = await get<Activity>("/api/activity");
      if (current !== version.current) return;
      setData(result);
      setError("");
    } catch {
      if (current !== version.current) return;
      setData(null);
      setError("Aktivitäten sind gerade nicht erreichbar. Bitte erneut prüfen.");
    } finally {
      if (current === version.current) setBusy(false);
    }
  }
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState !== "hidden") void refresh();
    }, 15000);
    return () => {
      ++version.current;
      clearInterval(timer);
    };
  }, []);
  return { data, error, busy, refresh };
}
const rate = (n: number) => Number.isFinite(n)
  ? `${(n / 1024 ** 2).toLocaleString("de-AT", { maximumFractionDigits: 1 })} MiB/s`
  : "—";
function vpnLabel(vpn: Activity["vpn"]) {
  return vpn.state === "connected" ? "VPN verbunden"
    : vpn.state === "not-required" ? "Nicht erforderlich"
      : vpn.state === "checking" ? "VPN wird geprüft" : "Downloads gesperrt";
}
function VpnStatus({ vpn }: { vpn: Activity["vpn"] }) {
  return (
    <details className={`download-vpn ${vpn.state === "connected" ? "is-protected" : "is-blocked"}`}>
      <summary>
        <StatusBadge tone={vpn.state === "connected" ? "success" : vpn.state === "not-required" ? "neutral" : "warning"}>
          {vpnLabel(vpn)}
        </StatusBadge>
        <span>Schutzdetails</span>
      </summary>
      <p>{vpn.reason}</p>
      {vpn.checkedAt && <small>Geprüft: {new Date(vpn.checkedAt).toLocaleTimeString("de-AT")}</small>}
    </details>
  );
}
function SessionRow({ session: s }: { session: Session }) {
  return (
    <li className="dashboard-session">
      <span className="dashboard-play-icon" aria-hidden="true">{s.state === "paused" ? "Ⅱ" : s.state === "idle" ? "○" : "▷"}</span>
      <div>
        <b>{s.title || "Gerät verbunden"}</b>
        <small>{[s.series, s.user, s.device].filter(Boolean).join(" · ")}</small>
        <span className="dashboard-session-state">
          {s.state === "paused" ? "Pausiert" : s.state === "idle" ? "Keine Wiedergabe" : s.state === "playing" ? "Spielt gerade" : "Status unbekannt"}
          {s.transcode ? " · Transcoding" : ""}
        </span>
        {s.progress !== null && s.state !== "idle" && <progress max={1} value={s.progress} aria-label={`Wiedergabefortschritt ${s.title || s.device}`} />}
      </div>
    </li>
  );
}
export function ActivityOverview({
  onSetup,
  onManage,
  onNavigate,
}: {
  onSetup: () => void;
  onManage: () => void;
  onNavigate?: (view: string) => void;
}) {
  const activity = useActivity(), operations = useOperations(), data = activity.data, ops = operations.data;
  const [showAllSessions, setShowAllSessions] = useState(false);
  const choices = [["apps", "Anwendungen"], ["transfers", "Transfers"], ["playback", "Jellyfin-Aktivität"], ["queues", "ARR-Warteschlangen"]];
  const [panels, setPanels] = usePreference<string[]>("dashboard-panels", ["apps", "transfers", "playback", "queues"], (value): value is string[] => Array.isArray(value) && value.length <= 4 && value.every((item) => typeof item === "string" && ["apps", "transfers", "playback", "queues"].includes(item)) && new Set(value).size === value.length);
  const go = (view: string) => onNavigate ? onNavigate(view) : onManage();
  const sessions = data?.jellyfin.sessions || [];
  const playbackCount = sessions.filter((s) => ["playing", "paused"].includes(s.state)).length;
  const sortedSessions = [...sessions].sort((a, b) => Number(a.state === "idle") - Number(b.state === "idle"));
  const applicationsKnown = !!ops && !ops.tasks.some((t) => t.id === "apps" && t.state === "unknown");
  return (
    <div className="dashboard">
      <SectionHeading title="Dein Stack im Überblick" description="Apps, Schutz und Medienaktivität an einem Ort." actions={
        <button disabled={activity.busy || operations.busy} onClick={() => { void activity.refresh(); void operations.refresh(true); }}>
          {activity.busy || operations.busy ? "Wird aktualisiert …" : "Aktualisieren"}
        </button>
      } />
      <details className="dashboard-customize"><summary>Dashboard anpassen</summary>
        <p>VPN und Speicher bleiben sichtbar. Weitere Bereiche kannst du auf diesem Browser auswählen.</p>
        <div className="button-group">{choices.map(([id, title]) => <label key={id}><input type="checkbox" checked={panels.includes(id)} onChange={(event) => setPanels((old) => event.target.checked ? [...old, id] : old.filter((item) => item !== id))} />{title}</label>)}</div>
      </details>
      {(activity.error || operations.error) && <p className="error" role="alert">{[activity.error, operations.error].filter(Boolean).join(" ")}</p>}
      {!data && !ops && !activity.error && !operations.error && <p role="status">Dashboard wird geladen …</p>}
      {data && !data.configured ? (
        <EmptyState title="Dein Medienzuhause einrichten" description="Wähle deine Apps aus und richte sie gemeinsam ein." action={<button className="primary" onClick={onSetup}>Stack einrichten</button>} />
      ) : (data || ops) && (
        <>
          <div className="dashboard-metrics">
            <article className="dashboard-metric" hidden={!panels.includes("apps")}>
              <h3>Anwendungen</h3>
              <strong>{applicationsKnown ? `${ops!.applications.filter((a) => a.state === "running").length} / ${ops!.applications.length}` : "—"}</strong>
              <small>{applicationsKnown ? "Container laufen" : "Containerzustand nicht bestätigt"}</small>
              <button onClick={() => go("Anwendungen")}>Apps ansehen</button>
            </article>
            <article className="dashboard-metric">
              <h3>VPN-Schutz</h3>
              <StatusBadge tone={!data ? "neutral" : data.vpn.state === "connected" ? "success" : data.vpn.state === "not-required" ? "neutral" : "warning"}>
                {data ? vpnLabel(data.vpn) : "Nicht bestätigt"}
              </StatusBadge>
              {data && <details><summary>Schutzdetails</summary><p>{data.vpn.reason}</p>{data.vpn.checkedAt && <small>Geprüft: {new Date(data.vpn.checkedAt).toLocaleTimeString("de-AT")}</small>}</details>}
            </article>
            <article className="dashboard-metric">
              <h3>Freier Speicher</h3>
              <strong>{ops?.storage.freeBytes !== null && ops?.storage.freeBytes !== undefined ? formatBytes(ops.storage.freeBytes) : "—"}</strong>
              <small>{ops?.storage.totalBytes ? `von ${formatBytes(ops.storage.totalBytes)} am Medienpfad` : "Gesamtgröße nicht bestätigt"}</small>
              {ops && ["warning", "critical"].includes(ops.storage.state) && <StatusBadge tone="warning">Speicher prüfen</StatusBadge>}
            </article>
            <article className="dashboard-metric" hidden={!panels.includes("transfers")}>
              <h3>Transfers</h3>
              <strong>{data?.downloads.state === "ready" ? `${rate(data.downloads.downloadRate)} ↓` : "—"}</strong>
              <small>{data?.downloads.state === "ready" ? `${data.downloads.count} Torrents · ${data.downloads.queued} warten · ${rate(data.downloads.uploadRate)} ↑` : data?.downloads.state === "not-installed" ? "Kein Downloadclient eingerichtet" : "Transferdaten nicht bestätigt"}</small>
              <button onClick={() => go("Downloads")}>Downloads ansehen</button>
            </article>
          </div>
          {ops && <OperationNotices data={ops} onSetup={onSetup} onManage={onManage} />}
          {data && data.installationStatus !== "completed" && !ops?.tasks.some((t) => t.id === "setup") && <p className="notice">Die Einrichtung ist noch nicht abgeschlossen. <button onClick={onSetup}>Auftrag ansehen</button></p>}
          <div className="dashboard-panels">
            <article className="dashboard-panel" hidden={!panels.includes("playback")}>
              <SectionHeading title="Jellyfin-Aktivität" description={data?.jellyfin.state === "ready" ? `${playbackCount} ${playbackCount === 1 ? "Wiedergabe" : "Wiedergaben"} · ${sessions.length} ${sessions.length === 1 ? "verbundenes Gerät" : "verbundene Geräte"}` : undefined} />
              {data?.jellyfin.state === "ready" ? sessions.length ? (
                <>
                  <ul className="dashboard-session-list">{(showAllSessions ? sortedSessions : sortedSessions.slice(0, 4)).map((s) => <SessionRow session={s} key={s.id} />)}</ul>
                  {sessions.length > 4 && <button aria-expanded={showAllSessions} onClick={() => setShowAllSessions(!showAllSessions)}>{showAllSessions ? "Weniger Geräte" : `Alle ${sessions.length} Geräte ansehen`}</button>}
                </>
              ) : <p className="dashboard-empty">Gerade sind keine Geräte verbunden.</p> : <p className="dashboard-empty">{data?.jellyfin.state === "not-installed" ? "Jellyfin ist noch nicht eingerichtet." : "Jellyfin-Aktivität ist nicht bestätigt. Das bedeutet nicht, dass niemand schaut."}</p>}
            </article>
            <article className="dashboard-panel" hidden={!panels.includes("queues")}>
              <SectionHeading title="ARR-Warteschlangen" actions={<button onClick={onManage}>Verbindungen</button>} />
              {data?.arr.length ? <ul className="dashboard-queue-list">{data.arr.map((a) => <li key={a.service}><b>{a.service}</b><span>{a.state === "ready" && a.queued !== null ? `${a.queued} ${a.queued === 1 ? "Eintrag" : "Einträge"}` : "Nicht bestätigt"}</span></li>)}</ul> : <p className="dashboard-empty">{data ? "Noch keine ARR-App eingerichtet." : "Warteschlangen nicht bestätigt."}</p>}
              <p className="dashboard-note">Einträge je App; Fortschritt einzelner Dateien unter Downloads.</p>
            </article>
          </div>
          <p className="dashboard-updated">{data ? `Aktivitäten: ${new Date(data.observedAt).toLocaleTimeString("de-AT")}` : "Aktivitäten nicht bestätigt"}{ops ? ` · Betrieb: ${new Date(ops.observedAt).toLocaleTimeString("de-AT")}` : " · Betriebsstand nicht bestätigt"}</p>
        </>
      )}
    </div>
  );
}
type DownloadPage = {
  configured: boolean;
  torrents: Torrent[];
  vpn: Activity["vpn"];
  downloadRate: number;
  uploadRate: number;
  hasMore: boolean;
  total?: number | null;
};
function useDownloadPage(page: number, filter: string, query: string) {
  const version = useRef(0);
  const [data, setData] = useState<DownloadPage | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function refresh() {
    const token = ++version.current;
    setBusy(true);
    try {
      const result = await get<DownloadPage>(`/api/downloads/list?page=${page}&filter=${filter}&query=${encodeURIComponent(query)}`);
      if (token !== version.current) return;
      setData(result);
      setError("");
    } catch {
      if (token !== version.current) return;
      setData(null);
      setError("Downloads konnten nicht geladen werden. Bitte erneut prüfen.");
    } finally {
      if (token === version.current) setBusy(false);
    }
  }
  useEffect(() => {
    setData(null);
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState !== "hidden") void refresh();
    }, 15000);
    return () => { ++version.current; clearInterval(timer); };
  }, [page, filter, query]);
  return { data, error, busy, refresh };
}
const downloadStates: Record<string, string> = {
  downloading: "Lädt herunter", forcedDL: "Lädt herunter", forcedMetaDL: "Metadaten werden geladen",
  forcedUP: "Verteilt", checkingResumeData: "Prüft gespeicherte Daten", moving: "Verschiebt Dateien",
  allocating: "Bereitet Speicher vor", unknown: "Status unbekannt", stalledDL: "Wartet auf Daten",
  metaDL: "Metadaten werden geladen", queuedDL: "In Warteschlange", stoppedDL: "Angehalten",
  pausedDL: "Pausiert", uploading: "Verteilt", stalledUP: "Verteilt", stoppedUP: "Angehalten",
  pausedUP: "Pausiert", queuedUP: "Wartet auf Upload", checkingDL: "Wird geprüft", checkingUP: "Wird geprüft",
  error: "Fehler", missingFiles: "Dateien fehlen",
};
const stopped = (state: string) => /^(stopped|paused)(DL|UP)$/.test(state);
const pausable = (state: string) => /^(downloading|forcedDL|forcedMetaDL|metaDL|stalledDL|queuedDL|uploading|forcedUP|stalledUP|queuedUP)$/.test(state);
export function DownloadsView() {
  const [page, setPage] = useState(1), [filter, setFilter] = usePreference<string>("download-filter", "all", oneOf("all", "active", "completed", "paused")), [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => { setPage(1); setSearch(query.trim()); }, 300);
    return () => clearTimeout(timer);
  }, [query]);
  const { data, error, busy: loading, refresh } = useDownloadPage(page, filter, search);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [failed, setFailed] = useState(false);
  async function control(t: Torrent, operation: "pause" | "resume" | "remove", deleteFiles = false) {
    if (operation === "remove" && !window.confirm(deleteFiles
      ? `„${t.name}“ mitsamt dem gesamten Torrentinhalt unwiderruflich löschen? Bibliothekskopien und andere Hardlinks bleiben erhalten. Eine weiterhin überwachte Anfrage kann erneut laden.`
      : `„${t.name}“ aus qBittorrent entfernen? Die Dateien bleiben erhalten.`)) return;
    setBusy(true); setMessage(""); setFailed(false);
    try {
      await action("/api/downloads/action", { hash: t.id, action: operation, deleteFiles, confirmation: operation === "remove" ? "OK" : undefined });
      setMessage(operation === "remove" ? deleteFiles ? "Download samt Dateien entfernt. Bibliothekskopien und andere Hardlinks bleiben erhalten." : "Download entfernt. Dateien bleiben erhalten." : operation === "pause" ? "Download pausiert." : "Download geschützt fortgesetzt.");
      await refresh();
    } catch (e) { setFailed(true); setMessage((e as Error).message); }
    finally { setBusy(false); }
  }
  async function resumeClient() {
    setBusy(true); setMessage(""); setFailed(false);
    try {
      await action("/api/downloads/resume", {});
      setMessage("Downloadclient freigegeben. Durch StackPilot angehaltene Downloads wurden fortgesetzt.");
      await refresh();
    } catch (e) { setFailed(true); setMessage((e as Error).message); }
    finally { setBusy(false); }
  }
  async function prioritize(t: Torrent, priority: "up" | "down") {
    setBusy(true); setMessage(""); setFailed(false);
    try {
      await action("/api/downloads/action", { hash: t.id, action: "priority", priority });
      setMessage("Priorität an qBittorrent übergeben. Die dortige Warteschlangensteuerung bestimmt die Reihenfolge.");
      await refresh();
    } catch (e) { setFailed(true); setMessage((e as Error).message); }
    finally { setBusy(false); }
  }
  const visible = data?.torrents || [];
  return (
    <div className="downloads-view">
      <div className="downloads-toolbar">
        <label>Status<select aria-label="Downloadfilter" value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); setQuery(""); }}>
          <option value="all">Alle Downloads</option><option value="active">Wird heruntergeladen</option><option value="completed">Download vollständig</option><option value="paused">Angehalten</option>
        </select></label>
        <label>Alle Downloads durchsuchen<input type="search" maxLength={160} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Downloadtitel" /></label>
        <button disabled={loading || busy} onClick={() => void refresh()}>{loading ? "Wird geladen …" : "Aktualisieren"}</button>
      </div>
      {error && <Problem message={error}><button onClick={() => void refresh()}>Erneut versuchen</button></Problem>}
      {!data && !error && <p role="status">Downloads werden geladen …</p>}
      {data && <>
        <div className="downloads-summary">
          <VpnStatus vpn={data.vpn} />
          <small>{data.configured ? `${rate(data.downloadRate)} ↓ · ${rate(data.uploadRate)} ↑` : "Transferdaten nicht bestätigt"}</small>
          {data.configured && <details className="download-client-control"><summary>Downloadclient steuern</summary><p>Fortsetzen prüft das VPN erneut. Manuell pausierte Torrents werden nicht pauschal gestartet.</p><button disabled={busy || data.vpn.state !== "connected"} onClick={() => void resumeClient()}>{busy ? "Wird geprüft …" : "Geschützt fortsetzen"}</button></details>}
        </div>
        {message && <p role={failed ? "alert" : "status"} className={failed ? "error" : "notice"}>{message}</p>}
        {!data.configured ? <EmptyState title="Noch kein Downloadclient eingerichtet" description="Ein vollständig eingerichteter Downloadclient ist Voraussetzung für diese Ansicht." /> : <>
          <p className="downloads-page-count" role="status">{query.trim() ? `${data.total ?? "—"} Treffer · ${visible.length} auf dieser Seite` : `${data.torrents.length} Downloads auf dieser Seite`}</p>
          {!visible.length && <EmptyState title={query.trim() ? "Keine passenden Downloads" : filter !== "all" || page > 1 ? "Keine Downloads in dieser Ansicht" : "Die Warteschlange ist leer"} description={query.trim() ? "Passe den Suchbegriff oder Statusfilter an." : "Neue Downloads erscheinen hier automatisch."} action={query.trim() ? <button onClick={() => setQuery("")}>Suche zurücksetzen</button> : undefined} />}
          <div className="download-list">
            {visible.map((t) => {
              const issue = ["error", "missingFiles"].includes(t.state);
              const fullyTransferred = t.progress >= 1;
              const complete = fullyTransferred && !issue;
              const paused = stopped(t.state), canPause = pausable(t.state);
              return <article className="download-row" data-download-state={t.state} key={t.id} aria-label={t.name}>
                <div className="download-row-main">
                  <div className="download-row-title"><h3>{t.name}</h3><StatusBadge tone={issue ? "danger" : paused ? "neutral" : complete ? "success" : "info"}>{downloadStates[t.state] || "Status unbekannt"}</StatusBadge></div>
                  <p className="download-row-metrics">
                    {issue ? <span>{t.size > 0 ? `Dateigröße ${formatBytes(t.size)}` : "Größe nicht gemeldet"} · Dateizustand prüfen</span> : complete ? <span>{t.size > 0 ? formatBytes(t.size) : "Größe nicht gemeldet"} · Download vollständig</span> : <><span>{Math.round(t.progress * 100)} %</span><span>{t.size > 0 ? `${formatBytes(Math.min(t.downloaded, t.size))} / ${formatBytes(t.size)}` : "Größe wird ermittelt"}</span><span>{rate(t.downloadRate)} ↓</span>{t.etaSeconds !== null && t.etaSeconds > 0 && !paused && <span>noch etwa {Math.ceil(t.etaSeconds / 60)} Min.</span>}</>}
                    {complete && t.uploadRate > 0 && <span>{rate(t.uploadRate)} ↑</span>}
                  </p>
                  {!fullyTransferred && !issue && <progress max={1} value={t.progress} aria-label={`Downloadfortschritt ${t.name}`} />}
                </div>
                <div className="download-row-actions">
                  {canPause && <button disabled={busy} onClick={() => void control(t, "pause")}>{complete ? "Verteilen pausieren" : "Pausieren"}</button>}
                  {paused && <button disabled={busy || data.vpn.state !== "connected"} onClick={() => void control(t, "resume")}>{complete ? "Verteilen geschützt fortsetzen" : "Geschützt fortsetzen"}</button>}
                  <details>
                    <summary>Weitere Aktionen</summary>
                    <div className="download-extra-actions">
                      {!fullyTransferred && <>
                        <button disabled={busy || data.vpn.state !== "connected"} onClick={() => void prioritize(t, "up")}>Priorität erhöhen</button>
                        <button disabled={busy || data.vpn.state !== "connected"} onClick={() => void prioritize(t, "down")}>Priorität senken</button>
                      </>}
                      {!canPause && !paused && <><button disabled={busy} onClick={() => void control(t, "pause")}>Pausieren</button><button disabled={busy || data.vpn.state !== "connected"} onClick={() => void control(t, "resume")}>Geschützt fortsetzen</button></>}
                      <button disabled={busy} onClick={() => void control(t, "remove")}>Entfernen · Dateien behalten</button>
                      <button className="danger" disabled={busy} onClick={() => void control(t, "remove", true)}>Download-Dateien löschen</button>
                    </div>
                  </details>
                </div>
              </article>;
            })}
          </div>
          {(page > 1 || data.hasMore) && <nav className="ui-pagination" aria-label="Downloadseiten"><button disabled={busy || loading || page <= 1} onClick={() => { setPage((p) => p - 1); }}>← Zurück</button><span>Seite {page}</span><button disabled={busy || loading || !data.hasMore} onClick={() => { setPage((p) => p + 1); }}>Weiter →</button></nav>}
        </>}
      </>}
    </div>
  );
}
