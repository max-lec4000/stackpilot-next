import { RequestActions, RequestArchive } from "./RequestActions";
import { requestJourney } from "../../../packages/domain/request-journey.js";
import { MovieRemoval } from "./MovieRemoval";
import { formatBytes } from "../../../packages/domain/format.js";
import { QualityEditor } from "./QualityEditor";
import { RequestEpisodes } from "./RequestEpisodes";
import { RequestDiagnosis } from "./RequestDiagnosis";
import { useEffect, useRef, useState } from "react";
import { get } from "./ServerCheck";
import { action } from "./RetirementPanel";
import { DetailPanel, EmptyState, Pagination, SectionHeading, StatusBadge } from "./ui";
import "./media.css";
import { usePreference, oneOf } from "./preferences";
type MediaItem = {
  id: number;
  type: "movie" | "tv";
  title: string;
  overview: string;
  year: string;
  poster: string | null;
  status: number;
  requested: boolean;
  availabilityNote?: string;
  availabilityCheckFailed?: boolean;
};
type Detail = MediaItem & {
  runtime?: number | null;
  sizeDefaultRate?: number;
  sizeDefaultCap?: number;
  savedProfileId?: number | null;
  savedProfileName?: string;
  savedSizeCap?: number | null;
  seasons: {
    number: number;
    name: string;
    episodes: number;
    requested: boolean;
    available: boolean;
  }[];
};
export function Poster({
  path,
  title,
}: {
  path: string | null;
  title: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [path]);
  return (
    <div className="media-poster">
      {path && !failed ? (
        <img
          src={"/api/media/poster?path=" + encodeURIComponent(path)}
          alt={"Cover: " + title}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <span aria-hidden="true">✦</span>
      )}
    </div>
  );
}
export function Discover({ onNavigate, initialSearch = "" }: { onNavigate?: (view: string) => void; initialSearch?: string }) {
  const [query, setQuery] = useState(initialSearch),
    [searched, setSearched] = useState(""),
    [page, setPage] = useState(1),
    [pages, setPages] = useState(1),
    [results, setResults] = useState<MediaItem[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [detail, setDetail] = useState<Detail | null>(null),
    [visible, setVisible] = useState(12),
    [seasons, setSeasons] = useState<number[]>([]),
    [sizeChoice, setSizeChoice] = useState("default");
  const version = useRef(0),
    dialog = useRef<HTMLDialogElement>(null),
    resultGrid = useRef<HTMLDivElement>(null),
    opener = useRef<HTMLElement | null>(null);
  useEffect(() => { if (initialSearch.trim().length >= 2) void search(); }, []);
  function showMore() {
    const firstNew = visible;
    setVisible((count) => count + 12);
    requestAnimationFrame(() => {
      const next = resultGrid.current?.children[firstNew]?.querySelector("button");
      next?.focus({ preventScroll: true });
      next?.scrollIntoView({ block: "nearest" });
    });
  }
  function closeDetail() {
    dialog.current?.close();
    setDetail(null);
    opener.current?.focus({ preventScroll: true });
  }
  useEffect(() => {
    if (detail) {
      if (!dialog.current?.open) dialog.current?.showModal();
      dialog.current?.querySelector("button")?.focus();
    }
  }, [detail]);
  async function search(p = 1) {
    const n = ++version.current;
    setBusy(true);
    setError("");
    setMessage("");
    setDetail(null);
    try {
      const r = await get<{ results: MediaItem[]; totalPages: number }>(
        "/api/media/search?q=" +
          encodeURIComponent(query.trim()) +
          "&page=" +
          p,
      );
      if (n !== version.current) return;
      setResults(r.results);
      setVisible(12);
      setPages(Math.min(20, r.totalPages));
      setPage(p);
      setSearched(query.trim());
    } catch (e) {
      if (n === version.current) setError((e as Error).message);
    } finally {
      if (n === version.current) setBusy(false);
    }
  }
  async function open(item: MediaItem) {
    if (!detail) opener.current = document.activeElement as HTMLElement;
    const n = ++version.current;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await get<Detail>(
        `/api/media/detail?type=${item.type}&id=${item.id}`,
      );
      if (n !== version.current) return;
      setDetail(r);
      setSeasons([]);
      setSizeChoice("default");
    } catch (e) {
      if (n === version.current) setError((e as Error).message);
    } finally {
      if (n === version.current) setBusy(false);
    }
  }
  async function request() {
    if (!detail) return;
    setBusy(true);
    setError("");
    try {
      const result = await action<{ warning?: string }>("/api/media/request", {
        type: detail.type,
        id: detail.id,
        seasons,
        ...(detail.type === "movie"
          ? {
              ...(sizeChoice === "default"
                ? {
                    expectedSizeDefault: detail.sizeDefaultRate || 0,
                    expectedSizeDefaultCap: detail.sizeDefaultCap || 0,
                    expectedFilmProfile: detail.savedProfileId || 0,
                  }
                : { sizeGiBPerHour: Number(sizeChoice) }),
            }
          : {}),
      });
      setMessage(
        result.warning ||
          "Anfrage angelegt. Unter „Meine Anfragen“ kannst du den Fortschritt verfolgen.",
      );
      closeDetail();
      if (detail.type === "movie")
        setResults((r) =>
          r.map((v) =>
            v.id === detail.id && v.type === detail.type
              ? { ...v, requested: true }
              : v,
          ),
        );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="discover-view" aria-label="Medien entdecken">
      <div className="tile discovery-search">
        <form
          className="search-form"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <label>
            Was möchtest du sehen?
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Film oder Serie suchen …"
              maxLength={160}
              required
              minLength={2}
            />
          </label>
          <button
            className="primary"
            disabled={busy || query.trim().length < 2}
          >
            {busy ? "Wird geladen …" : "Suchen"}
          </button>
        </form>
        <p className="muted search-help">
          Suche über Seerr. Downloads starten ausschließlich mit geprüftem
          Mullvad-Schutz.
        </p>
      </div>
      {error && !detail && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="notice">
          {message}
          {onNavigate && (
            <button onClick={() => onNavigate("Meine Anfragen")}>Meine Anfragen öffnen</button>
          )}
        </p>
      )}
      {searched && (
        <SectionHeading
          title={`Ergebnisse für „${searched}“`}
          description={`${Math.min(visible, results.length)} von ${results.length} Treffern dieser Seite · Seite ${page} von ${Math.max(1, pages)}`}
        />
      )}
      {busy && <p className="muted" role="status">Medien werden geladen …</p>}
      {!searched && !busy && !error && (
        <EmptyState title="Was steht auf deiner Wunschliste?" description="Suche einen Film oder eine Serie. Details, Staffeln und Qualitätsauswahl öffnest du direkt am Poster." />
      )}
      <div className="media-grid" aria-busy={busy} ref={resultGrid}>
        {results.slice(0, visible).map((item) => (
          <article className="tile media-card" key={item.type + item.id}>
            <button className="media-poster-button" disabled={busy} aria-label={`Details zu ${item.title}`} onClick={() => void open(item)}>
              <Poster path={item.poster} title={item.title} />
            </button>
            <div className="media-card-body">
              <small>
                {item.type === "movie" ? "Film" : "Serie"} ·{" "}
                {item.year || "Jahr unbekannt"}
              </small>
              <h3 title={item.title}>{item.title}</h3>
              <StatusBadge tone={item.status === 5 ? "success" : item.requested ? "info" : "neutral"}>
                {item.status === 5
                  ? "In Jellyfin verfügbar"
                  : item.requested
                    ? "Bereits angefragt"
                    : "Entdecken"}
              </StatusBadge>
              <button disabled={busy} onClick={() => void open(item)}>
                Details & Anfrage
              </button>
            </div>
          </article>
        ))}
      </div>
      {visible < results.length && (
        <div className="discovery-show-more">
          <button disabled={busy} onClick={showMore}>
            {Math.min(12, results.length - visible)} weitere Treffer anzeigen
          </button>
        </div>
      )}
      {searched && !busy && !results.length && (
        <EmptyState title="Keine passenden Treffer" description="Versuche einen anderen Titel oder den Originaltitel." />
      )}
      {pages > 1 && (
        <Pagination page={page} pages={pages} disabled={busy || query.trim() !== searched} onChange={(next) => void search(next)} label="Ergebnisseiten" />
      )}
      {detail && (
        <dialog
          ref={dialog}
          className="credential-dialog media-dialog"
          aria-label={detail.title}
          onCancel={(e) => {
            if (busy) e.preventDefault();
            else closeDetail();
          }}
        >
          <button
            className="dialog-close"
            disabled={busy}
            onClick={closeDetail}
          >
            Schließen
          </button>
          <h2>{detail.title}</h2>
          <p>{detail.overview || "Keine Beschreibung vorhanden."}</p>
          {detail.type === "movie" &&
            !detail.requested &&
            detail.status !== 5 && (
              <label>
                Qualität und Größe für diese Anfrage
                <select
                  value={sizeChoice}
                  disabled={busy}
                  onChange={(e) => setSizeChoice(e.target.value)}
                >
                  <option value="default">
                    {detail.savedProfileName
                      ? `Gespeichertes Filmprofil · ${detail.savedProfileName}`
                      : detail.sizeDefaultCap
                        ? `StackPilot-Standard · 1080p ohne Remux, maximal ${detail.sizeDefaultCap} GiB`
                        : detail.sizeDefaultRate
                        ? `StackPilot-Standard · 1080p ohne Remux, ${detail.sizeDefaultRate} GiB/h`
                        : "Vorhandenes Qualitätsprofil"}
                  </option>
                  <option value="0">
                    Vorhandenes Qualitätsprofil ohne zusätzliche Größenregel
                  </option>
                  {[1, 2, 3, 4, 6, 8].map((rate) => (
                    <option key={rate} value={rate}>
                      1080p ohne Remux · höchstens {rate} GiB/h
                    </option>
                  ))}
                </select>
                {sizeChoice === "default" && detail.savedProfileName && (
                  <span>
                    Die bestätigte Auswahl für diesen Film geht dem allgemeinen
                    Standard vor.
                    {detail.savedSizeCap
                      ? ` Grenze: ${detail.savedSizeCap} GiB.`
                      : ""}
                  </span>
                )}
                {!(sizeChoice === "default" && detail.savedProfileName) &&
                  (sizeChoice === "default"
                    ? detail.sizeDefaultRate || 0
                    : Number(sizeChoice)) > 0 && (
                    <span>
                      {detail.runtime
                        ? `Bei ${detail.runtime} Minuten: höchstens ${Math.ceil(((detail.runtime * (sizeChoice === "default" ? detail.sizeDefaultRate || 0 : Number(sizeChoice))) / 60) * 2) / 2} GiB.`
                        : "Laufzeit fehlt. Eine Anfrage mit Größenregel wird nicht gestartet."}{" "}
                      Laufende Downloads und Dateien werden nicht verändert.
                    </span>
                  )}
              </label>
            )}
          {detail.availabilityNote && (
            <p className="notice">{detail.availabilityNote}</p>
          )}
          {detail.availabilityCheckFailed && (
            <button disabled={busy} onClick={() => void open(detail)}>
              Verfügbarkeit erneut prüfen
            </button>
          )}
          {detail.status === 5 ? (
            <p className="notice">Bereits in Jellyfin verfügbar.</p>
          ) : (
            <>
              <p>
                {detail.type === "tv"
                  ? "Wähle die gewünschten Staffeln."
                  : "Der Film wird über Radarr gesucht."}{" "}
                Es gelten die in Seerr eingerichteten Qualitätsprofile.
              </p>
              {detail.type === "tv" && (
                <div className="season-grid">
                  {detail.seasons.map((s) => (
                    <label key={s.number}>
                      <input
                        type="checkbox"
                        disabled={busy || s.requested || s.available}
                        checked={
                          seasons.includes(s.number) ||
                          s.requested ||
                          s.available
                        }
                        onChange={(e) =>
                          setSeasons((v) =>
                            e.target.checked
                              ? [...v, s.number]
                              : v.filter((n) => n !== s.number),
                          )
                        }
                      />
                      {s.name || "Staffel " + s.number} · {s.episodes} Folgen{" "}
                      {s.available
                        ? "· Verfügbar"
                        : s.requested
                          ? "· Angefragt"
                          : ""}
                    </label>
                  ))}
                </div>
              )}
              {error && (
                <p role="alert" className="error">
                  {error}
                </p>
              )}
              <button
                className="primary"
                disabled={
                  busy ||
                  detail.availabilityCheckFailed ||
                  (detail.type === "tv" && !seasons.length) ||
                  (detail.type === "movie" && detail.requested)
                }
                onClick={() => void request()}
              >
                {busy
                  ? "Wird angefragt …"
                  : detail.requested && detail.type === "movie"
                    ? "Bereits angefragt"
                    : "Jetzt anfragen"}
              </button>
            </>
          )}
        </dialog>
      )}
    </section>
  );
}
type RequestItem = {
  id: number;
  mediaId: number;
  type: string;
  title: string;
  poster: string | null;
  state: string;
  createdAt: string;
  seasons: number[];
  progress: number | null;
  tracking: string;
  sizeBytes?: number | null;
  downloadedBytes?: number | null;
  jellyfinAvailable?: boolean | null;
};
const stateText: Record<string, string> = {
  pending: "Wartet auf Freigabe",
  searching: "Suche läuft",
  "search-queued": "Suchauftrag wartet auf Ausführung",
  waiting: "Wartet auf passenden Download",
  downloading: "Wird heruntergeladen",
  paused: "Download pausiert",
  queued: "Wartet auf Download",
  importing: "Wird importiert",
  "library-sync": "Importiert · Bibliotheksabgleich ausstehend",
  available: "In Jellyfin verfügbar",
  declined: "Abgelehnt",
  failed: "Anfrage fehlgeschlagen",
  attention: "Benötigt Aufmerksamkeit",
  unknown: "Fortschritt gerade nicht erreichbar",
};
type RequestPage = {
  results: RequestItem[];
  unavailable: string[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
  librarySync?: {
    state: string;
    message: string;
    progress?: number | null;
    checkedAt?: string;
  };
};
function useJellyfinUrl() {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    get<{ services: { name: string; slug: string; url: string | null }[] }>("/api/managed")
      .then((data) => {
        const value = data.services.find((service) => service.slug === "jellyfin" || service.name === "Jellyfin")?.url;
        if (!value || !active) return;
        try {
          const parsed = new URL(value);
          if (["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password) setUrl(parsed.href);
        } catch {}
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);
  return url;
}
export function Requests({ onNavigate }: { onNavigate?: (view: string) => void }) {
  const [archive, setArchive] = useState(false);
  const jellyfinUrl = useJellyfinUrl();
  return (
    <section className="requests-view" aria-label="Meine Anfragen">
      <div className="row request-tabs" role="group" aria-label="Anfragenansicht">
        <button aria-pressed={!archive} onClick={() => setArchive(false)}>
          Aktuelle Anfragen
        </button>
        <button aria-pressed={archive} onClick={() => setArchive(true)}>
          Archiv
        </button>
      </div>
      {archive ? <div className="request-archive"><RequestArchive /></div> : <ActiveRequests onNavigate={onNavigate} jellyfinUrl={jellyfinUrl} />}
    </section>
  );
}
function ActiveRequests({ onNavigate, jellyfinUrl }: { onNavigate?: (view: string) => void; jellyfinUrl: string | null }) {
  const [data, setData] = useState<RequestPage | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [page, setPage] = useState(1),
    [filter, setFilter] = usePreference<string>("request-filter", "all", oneOf("all", "active", "completed", "failed")),
    [type, setType] = usePreference<string>("request-type", "all", oneOf("all", "movie", "tv")),
    [expanded, setExpanded] = useState<number | null>(null),
    [syncBusy, setSyncBusy] = useState(false),
    [syncMessage, setSyncMessage] = useState("");
  const version = useRef(0);
  async function refresh(force = false) {
    const sequence = ++version.current;
    setBusy(true);
    try {
      const result = await get<RequestPage>(
        `/api/media/requests?page=${page}&filter=${filter}&type=${type}&force=${force ? 1 : 0}`,
      );
      if (sequence !== version.current) return;
      if (result.page > result.pages) {
        setPage(result.pages);
        return;
      }
      setData(result);
      setError("");
      setExpanded((previous) =>
        previous !== null && !result.results.some((r) => r.id === previous)
          ? null
          : previous,
      );
    } catch (e) {
      if (sequence === version.current) {
        setError((e as Error).message);
        setData(null);
        setExpanded(null);
      }
    } finally {
      if (sequence === version.current) setBusy(false);
    }
  }
  useEffect(() => {
    setData(null);
    setExpanded(null);
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState !== "hidden") void refresh();
    }, 30000);
    return () => {
      clearInterval(timer);
      version.current++;
    };
  }, [page, filter, type]);
  async function sync() {
    setSyncBusy(true);
    setSyncMessage("");
    try {
      const result = await action<{ message: string }>(
        "/api/media/library/refresh",
        {},
      );
      setSyncMessage(result.message);
      await refresh();
    } catch (e) {
      setSyncMessage((e as Error).message);
    } finally {
      setSyncBusy(false);
    }
  }
  const selected = data?.results.find((request) => request.id === expanded);
  const progressVisible = (request: RequestItem) =>
    ["downloading", "paused", "queued"].includes(request.state) &&
    typeof request.progress === "number" && Number.isFinite(request.progress);
  const tone = (state: string) =>
    state === "available" ? "success" as const :
    ["failed", "declined"].includes(state) ? "danger" as const :
    ["attention", "unknown", "waiting", "paused"].includes(state) ? "warning" as const : "info" as const;
  const requestLinks = (request: RequestItem) => (
    <div className="request-links">
      {onNavigate && ["downloading", "paused", "queued", "importing", "library-sync"].includes(request.state) && (
        <button onClick={() => onNavigate("Downloads")}>Downloads ansehen</button>
      )}
      {request.state === "available" && jellyfinUrl && (
        <a className="button" href={jellyfinUrl} target="_blank" rel="noopener noreferrer">Jellyfin öffnen ↗</a>
      )}
      {request.state === "available" && !jellyfinUrl && onNavigate && (
        <button onClick={() => onNavigate("Anwendungen")}>Jellyfin-Zugang prüfen</button>
      )}
    </div>
  );
  return (
    <>
      <SectionHeading
        title="Deine Medienwünsche"
        actions={<>
          {onNavigate && <button onClick={() => onNavigate("Downloads")}>Zu Downloads</button>}
          <button disabled={busy} onClick={() => void refresh(true)}>
            {busy ? "Wird geladen …" : "Aktualisieren"}
          </button>
          <button disabled={syncBusy || ["jellyfin", "seerr"].includes(data?.librarySync?.state || "")} onClick={() => void sync()}>
            Bibliothek abgleichen
          </button>
        </>}
      />
      <div className="request-toolbar">
        <label>
          Status
          <select aria-label="Anfragenstatus" value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }}>
            <option value="all">Alle Anfragen</option>
            <option value="active">In Bearbeitung</option>
            <option value="completed">Abgeschlossen</option>
            <option value="failed">Fehlgeschlagen</option>
          </select>
        </label>
        <label>
          Medientyp
          <select aria-label="Medientyp" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
            <option value="all">Filme & Serien</option>
            <option value="movie">Filme</option>
            <option value="tv">Serien</option>
          </select>
        </label>
        {data && <span className="muted request-total">{data.total} Anfragen · Seite {data.page} von {data.pages}</span>}
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      {busy && !data && <p role="status" className="muted">Anfragen werden geladen …</p>}
      {syncMessage && syncMessage !== data?.librarySync?.message && <p role="status" className="notice">{syncMessage}</p>}
      {data?.librarySync && ["jellyfin", "seerr", "failed"].includes(data.librarySync.state) && (
        <p role="status" className="notice">
          {data.librarySync.message}
          {typeof data.librarySync.progress === "number" ? ` · ${Math.round(data.librarySync.progress)} %` : ""}
        </p>
      )}
      {data && (
        <>
          {data.unavailable.length > 0 && <p className="notice">Ein Teil des Fortschritts ist nicht erreichbar: {data.unavailable.join(", ")}. Vorhandene Anfragen bleiben erhalten.</p>}
          {!data.results.length && <EmptyState title="Keine Anfragen in dieser Ansicht" description="Wechsle den Filter oder entdecke deinen nächsten Film." action={onNavigate ? <button onClick={() => onNavigate("Medien entdecken")}>Medien entdecken</button> : undefined} />}
          <div className="request-list" aria-busy={busy}>
            {data.results.map((request) => (
              <article className="request-compact" key={request.id}>
                <Poster path={request.poster} title={request.title} />
                <div className="request-compact-main">
                  <div className="request-title-row">
                    <h3>{request.title}</h3>
                    <StatusBadge tone={tone(request.state)}>{stateText[request.state] || "Status unbekannt"}</StatusBadge>
                  </div>
                  <div className="request-metrics">
                    <span>{request.type === "movie" ? "Film" : "Serie"}{request.seasons.length ? " · Staffel " + request.seasons.join(", ") : ""}</span>
                    <span>{new Date(request.createdAt).toLocaleDateString("de-AT")}</span>
                    <span>{request.sizeBytes !== null && request.sizeBytes !== undefined
                      ? request.downloadedBytes !== null && request.downloadedBytes !== undefined && progressVisible(request)
                        ? `${formatBytes(Math.min(request.downloadedBytes, request.sizeBytes))} / ${formatBytes(request.sizeBytes)}`
                        : formatBytes(request.sizeBytes)
                      : "Größe noch nicht gemeldet"}</span>
                    {progressVisible(request) && <span>{Math.round(Math.max(0, Math.min(1, request.progress!)) * 100)} %</span>}
                  </div>
                  {progressVisible(request) && <progress max={1} value={Math.max(0, Math.min(1, request.progress!))} aria-label={"Downloadfortschritt " + request.title} />}
                </div>
                <div className="request-row-actions">
                  {requestLinks(request)}
                  <button className="request-details-button" aria-haspopup="dialog" aria-label={`Details zu ${request.title}`} onClick={() => setExpanded(request.id)}>Details</button>
                </div>
              </article>
            ))}
          </div>
          <Pagination page={data.page} pages={data.pages} disabled={busy} onChange={setPage} label="Anfragenseiten" />
        </>
      )}
      {selected && (
        <DetailPanel title={selected.title} onClose={() => setExpanded(null)}>
          <div className="request-detail-content">
            <div className="request-detail-summary">
              <Poster path={selected.poster} title={selected.title} />
              <div>
                <StatusBadge tone={tone(selected.state)}>{stateText[selected.state] || "Status unbekannt"}</StatusBadge>
                <p className="muted">{selected.type === "movie" ? "Film" : "Serie"} · {new Date(selected.createdAt).toLocaleDateString("de-AT")}</p>
                <p>{selected.sizeBytes != null ? `Dateigröße ${formatBytes(selected.sizeBytes)}` : "Dateigröße noch nicht gemeldet"}</p>
                {requestLinks(selected)}
              </div>
            </div>
            <ol className="request-journey" aria-label="Anfragefortschritt">
              {requestJourney(selected.state, selected.progress).steps.map((step) => (
                <li key={step.id} className={step.state} aria-current={step.state === "current" ? "step" : undefined}>{step.label}</li>
              ))}
            </ol>
            <p className="notice">{requestJourney(selected.state, selected.progress).reason}</p>
            {selected.state === "library-sync" && <button disabled={syncBusy} onClick={() => void sync()}>Bibliothek jetzt abgleichen</button>}
            <div className="request-detail-tools">
              <QualityEditor requestId={selected.id} onChange={refresh} />
              <RequestActions id={selected.id} onChange={refresh} />
              <RequestDiagnosis id={selected.id} onChange={refresh} />
              {selected.type === "tv" && <RequestEpisodes requestId={selected.id} seasons={selected.seasons} />}
              {selected.type === "movie" && <MovieRemoval requestId={selected.id} onChange={refresh} />}
            </div>
          </div>
        </DetailPanel>
      )}
    </>
  );
}
