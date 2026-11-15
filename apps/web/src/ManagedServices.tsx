import { useEffect, useMemo, useRef, useState } from "react";
import { get } from "./ServerCheck";
import { action } from "./RetirementPanel";
import {
  DetailPanel,
  EmptyState,
  Pagination,
  SectionHeading,
  StatusBadge,
} from "./ui";
import "./services.css";
import { usePreference, oneOf } from "./preferences";
type Service = {
  operationId: string;
  planId: string;
  name: string;
  slug: string;
  hostPort: number;
  url: string | null;
  state: string;
  installationStatus: string;
  image: string;
  username: string;
  authentication?: string;
};
const states: Record<string, string> = {
  running: "Läuft",
  exited: "Gestoppt",
  missing: "Nicht vorhanden",
  restarting: "Startet neu",
  created: "Erstellt",
  paused: "Pausiert",
  dead: "Fehler",
  completed: "Fertig",
  failed: "Fehler",
  queued: "Wartet",
  cancelled: "Beendet",
  unknown: "Unbekannt",
};
function serviceKey(service: Service) {
  return service.planId + ":" + service.slug;
}
function stateTone(state: string) {
  if (state === "running") return "success" as const;
  if (["dead", "failed"].includes(state)) return "danger" as const;
  if (["restarting", "queued", "created"].includes(state))
    return "warning" as const;
  return "neutral" as const;
}
export function ManagedServices({ compact = false }: { compact?: boolean }) {
  const [loaded, setLoaded] = useState(false),
    [loading, setLoading] = useState(false),
    [services, setServices] = useState<Service[]>([]),
    [error, setError] = useState(""),
    [query, setQuery] = useState(""),
    [filter, setFilter] = usePreference<string>("app-filter", "all", oneOf("all", "running", "other")),
    [page, setPage] = useState(1),
    [selectedKey, setSelectedKey] = useState<string | null>(null),
    [showReveal, setShowReveal] = useState(false),
    [password, setPassword] = useState(""),
    [credentials, setCredentials] = useState<{
      username: string;
      password: string;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [revealError, setRevealError] = useState("");
  const requestId = useRef(0),
    loadId = useRef(0),
    opener = useRef<HTMLButtonElement | null>(null);
  const selected = services.find((service) => serviceKey(service) === selectedKey);
  function closePanel() {
    requestId.current++;
    setSelectedKey(null);
    setShowReveal(false);
    setCredentials(null);
    setPassword("");
    setRevealError("");
    setBusy(false);
    opener.current?.focus({ preventScroll: true });
  }
  async function load() {
    const sequence = ++loadId.current;
    setLoading(true);
    try {
      const result = await get<{ services: Service[] }>("/api/managed");
      if (sequence !== loadId.current) return;
      if (!Array.isArray(result.services))
        throw Error("Der Anwendungsstatus konnte nicht gelesen werden.");
      setServices(result.services);
      setLoaded(true);
      setError("");
    } catch (e) {
      if (sequence !== loadId.current) return;
      setServices([]);
      setLoaded(false);
      setError((e as Error).message);
    } finally {
      if (sequence === loadId.current) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState !== "hidden") void load();
    }, 15000);
    return () => {
      clearInterval(timer);
      loadId.current++;
      requestId.current++;
    };
  }, []);
  useEffect(() => {
    if (selectedKey && !selected) closePanel();
  }, [selectedKey, selected]);
  useEffect(() => {
    if (!credentials) return;
    const timer = setTimeout(closePanel, 20000);
    return () => clearTimeout(timer);
  }, [credentials]);
  const filtered = useMemo(() => {
    const text = query.trim().toLocaleLowerCase("de-AT");
    return services.filter(
      (service) =>
        service.name.toLocaleLowerCase("de-AT").includes(text) &&
        (filter === "all" ||
          (filter === "running" ? service.state === "running" : service.state !== "running")),
    );
  }, [services, query, filter]);
  const pages = Math.max(1, Math.ceil(filtered.length / 12));
  const currentPage = Math.min(page, pages);
  const visible = filtered.slice((currentPage - 1) * 12, currentPage * 12);
  if (compact)
    return (
      <div className="managed-services-summary">
        <b>Deine Apps</b>
        <span>
          {loaded
            ? `${services.filter((service) => service.state === "running").length} von ${services.length} laufen`
            : "Betriebsstand nicht bestätigt"}
        </span>
        {error && <span className="error" role="alert">{error}</span>}
      </div>
    );
  return (
    <section className="managed-services" aria-label="Verwaltete Anwendungen">
      <SectionHeading
        title="Installierte Anwendungen"
        description="Containerstatus im Überblick. Zugänge und technische Details öffnest du bei Bedarf."
        actions={
          <button disabled={loading} onClick={() => void load()}>
            {loading ? "Wird aktualisiert …" : "Status aktualisieren"}
          </button>
        }
      />
      <div className="services-toolbar">
        <label>
          App suchen
          <input
            type="search"
            placeholder="Name der Anwendung"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          Status
          <select
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
              setPage(1);
            }}
          >
            <option value="all">Alle Anwendungen</option>
            <option value="running">Laufend</option>
            <option value="other">Nicht laufend / unbekannt</option>
          </select>
        </label>
        {loaded && (
          <span className="services-result-count" role="status">
            {filtered.length} von {services.length} Anwendungen
          </span>
        )}
      </div>
      {error && (
        <div className="services-error" role="alert">
          <p>{error}</p>
          <button disabled={loading} onClick={() => void load()}>Erneut prüfen</button>
        </div>
      )}
      {!loaded && !error ? (
        <p role="status">Containerstatus wird gelesen …</p>
      ) : loaded && !services.length ? (
        <EmptyState
          title="Noch keine verwalteten Anwendungen"
          description="Sobald eine Installation abgeschlossen ist, erscheinen deine Apps hier."
        />
      ) : loaded && !filtered.length ? (
        <EmptyState
          title="Keine passende Anwendung"
          description="Passe den Suchbegriff oder Statusfilter an."
          action={<button onClick={() => { setQuery(""); setFilter("all"); setPage(1); }}>Filter zurücksetzen</button>}
        />
      ) : loaded ? (
        <>
          <ul className="services-list">
            {visible.map((service) => (
              <li className="service-list-row" key={serviceKey(service)}>
                <span className="service-avatar" aria-hidden="true">
                  {service.name.slice(0, 2)}
                </span>
                <div className="service-list-name">
                  <h3>{service.name}</h3>
                  <StatusBadge tone={stateTone(service.state)}>
                    {states[service.state] || service.state || "Status unbekannt"}
                  </StatusBadge>
                </div>
                <div className="service-list-actions">
                  {service.url && (
                    <a
                      className="service-open primary"
                      href={service.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${service.name} öffnen (neuer Tab)`}
                    >
                      Öffnen <span aria-hidden="true">↗</span>
                    </a>
                  )}
                  <button
                    aria-label={`Details zu ${service.name}`}
                    aria-haspopup="dialog"
                    onClick={(event) => {
                      opener.current = event.currentTarget;
                      requestId.current++;
                      setSelectedKey(serviceKey(service));
                      setShowReveal(false);
                      setCredentials(null);
                      setPassword("");
                      setRevealError("");
                      setBusy(false);
                    }}
                  >
                    Details
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {pages > 1 && (
            <Pagination
              page={currentPage}
              pages={pages}
              onChange={setPage}
              label="Anwendungsseiten"
            />
          )}
        </>
      ) : null}
      {selected && (
        <DetailPanel title={selected.name} onClose={closePanel}>
          <div className="service-detail">
            <div className="service-detail-state">
              <StatusBadge tone={stateTone(selected.state)}>
                {states[selected.state] || selected.state || "Status unbekannt"}
              </StatusBadge>
              <span>Installationsauftrag: {states[selected.installationStatus] || selected.installationStatus || "Unbekannt"}</span>
            </div>
            {selected.url && (
              <a className="service-open primary" href={selected.url} target="_blank" rel="noopener noreferrer">
                {selected.name} öffnen <span aria-hidden="true">↗</span>
              </a>
            )}
            <dl className="service-facts">
              <div><dt>Benutzername</dt><dd>{selected.username || "Nicht hinterlegt"}</dd></div>
              {selected.authentication === "Jellyfin" && (
                <div><dt>Anmeldung</dt><dd>Mit deinem Jellyfin-Zugang</dd></div>
              )}
              <div><dt>Lokaler Webport</dt><dd>{selected.hostPort || "Nicht veröffentlicht"}</dd></div>
            </dl>
            <details className="service-technical">
              <summary>Image und lokaler Zugriff</summary>
              <p><code>{selected.image}</code></p>
              <p>Nur lokal am Server veröffentlicht. Bei Zugriff über SSH zusätzlich den Webport weiterleiten:</p>
              <pre><code>ssh -L {selected.hostPort}:127.0.0.1:{selected.hostPort} benutzer@server</code></pre>
            </details>
            <div className="service-credentials">
              {!showReveal ? (
                <button onClick={() => setShowReveal(true)}>Zugang geschützt anzeigen</button>
              ) : (
                <>
                  <h3>Geschützter Zugang</h3>
                  <p>Bestätige mit deinem StackPilot-Administratorpasswort. Nach erfolgreicher Prüfung schließt die Anzeige nach 20 Sekunden.</p>
                  {selected.authentication === "Jellyfin" && <p>Hier gilt dein Jellyfin-Zugang.</p>}
                  {revealError && <p className="error" role="alert">{revealError}</p>}
                  {!credentials ? (
                    <form
                      onSubmit={async (event) => {
                        event.preventDefault();
                        const currentRequest = ++requestId.current;
                        setBusy(true);
                        setRevealError("");
                        try {
                          const result = await action<{ username: string; password: string }>(
                            "/api/credentials/reveal",
                            {
                              operationId: selected.operationId,
                              service: selected.name,
                              password,
                            },
                          );
                          if (currentRequest !== requestId.current) return;
                          setCredentials(result);
                          setPassword("");
                        } catch (e) {
                          if (currentRequest === requestId.current)
                            setRevealError((e as Error).message);
                        } finally {
                          if (currentRequest === requestId.current) setBusy(false);
                        }
                      }}
                    >
                      <label>
                        Administratorpasswort
                        <input
                          autoComplete="current-password"
                          autoFocus
                          type="password"
                          required
                          disabled={busy}
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                        />
                      </label>
                      <button className="primary" disabled={busy}>
                        {busy ? "Zugang wird geprüft …" : "Zugang anzeigen"}
                      </button>
                    </form>
                  ) : (
                    <dl className="service-facts" aria-live="polite">
                      <div><dt>Benutzer</dt><dd><code>{credentials.username}</code></dd></div>
                      <div><dt>Passwort</dt><dd><code>{credentials.password}</code></dd></div>
                    </dl>
                  )}
                </>
              )}
            </div>
          </div>
        </DetailPanel>
      )}
    </section>
  );
}
