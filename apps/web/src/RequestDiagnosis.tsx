import { useState } from "react";
import { get } from "./ServerCheck";
import { action } from "./RetirementPanel";
type Diagnosis = {
  importInfo?: {
    phase: string;
    downloadComplete: boolean;
    seeding: boolean;
    imported: boolean;
    availableInJellyfin: boolean | null;
    completedHandling: boolean | null;
    queued: number | null;
    queueLimited: boolean;
    blockers: string[];
    messages: string[];
    issues: string[];
  };
  requestId: number;
  service: string;
  observedAt: string;
  approved: boolean;
  library: {
    present: boolean;
    monitored: boolean;
    hasFile: boolean;
    status: string;
  };
  sources:
    | {
        name: string;
        automatic: boolean;
        interactive: boolean;
        disabledUntil?: string | null;
      }[]
    | null;
  clientReady: boolean;
  healthWarnings?: string[];
  clients: { name: string; type: string }[] | null;
  search: {
    active: boolean;
    known: boolean;
    lastRequestedAt: string | null;
    lastStatus?: string | null;
  };
  lastGrab: { title: string; source: string; at: string } | null;
  vpn: { state: string; reason: string };
  blockers: string[];
  canSearch: boolean;
  issues: string[];
  releases: {
    total: number;
    results: {
      title: string;
      source: string;
      quality: string;
      size: number | null;
      seeders: number | null;
      rejected: boolean;
      reasons: string[];
    }[];
  } | null;
};
export function RequestDiagnosis({
  id,
  onChange,
}: {
  id: number;
  onChange: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    [data, setData] = useState<Diagnosis | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  async function inspect(releases = false) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      setData(
        releases
          ? await action("/api/media/releases", { requestId: id })
          : await get("/api/media/diagnosis?requestId=" + id),
      );
    } catch (e) {
      setData(null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function search() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await action<{ alreadyRunning: boolean }>(
        "/api/media/research",
        { requestId: id },
      );
      setMessage(
        result.alreadyRunning
          ? "Für dieses Medium läuft bereits eine Suche."
          : "Suchauftrag übergeben. Die ARR-App wählt passende Treffer und kann Downloads automatisch starten.",
      );
      setData(await get("/api/media/diagnosis?requestId=" + id));
      await onChange();
    } catch (e) {
      setError((e as Error).message);
      setData(null);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="request-diagnosis">
      <button
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          if (!open) void inspect();
        }}
      >
        {open ? "Diagnose schließen" : "Warum wartet die Anfrage?"}
      </button>
      {open && (
        <div className="diagnosis-content">
          {busy && <p role="status">Dienste werden geprüft …</p>}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {message && (
            <p className="notice" role="status">
              {message}
            </p>
          )}
          <div className="button-group">
            <button disabled={busy} onClick={() => void inspect()}>
              Zustand erneut prüfen
            </button>
          </div>
          {data && (
            <>
              <h4>Dein Weg zum Download</h4>
              <ul className="diagnosis-checks">
                <li>
                  {data.approved
                    ? "✓ Anfrage freigegeben"
                    : "○ Anfrage noch nicht suchbereit"}
                </li>
                <li>
                  {data.library.present
                    ? `✓ In ${data.service} angekommen`
                    : `! Noch nicht in ${data.service} angekommen`}
                  {data.library.present && !data.library.monitored
                    ? " · Überwachung ausgeschaltet"
                    : ""}
                </li>
                <li>
                  {data.sources === null
                    ? "? Quellen der ARR-App nicht erreichbar"
                    : `${data.sources.filter((v) => v.automatic).length} Quellen für automatische Suche aktiviert in ${data.service}`}
                </li>
                <li>
                  {data.clients === null
                    ? "? Downloadclient-Verbindung unbekannt"
                    : data.clients.length
                      ? `✓ Aktivierte Downloadclients: ${data.clients.map((v) => v.name).join(", ")}`
                      : "! Kein aktivierter Downloadclient"}
                </li>
                <li>
                  {data.clientReady
                    ? "✓ qBittorrent antwortet"
                    : "! qBittorrent nicht erreichbar"}
                </li>
                <li>
                  {data.vpn.state === "connected"
                    ? "✓ Mullvad-Ausgang geprüft"
                    : `! ${data.vpn.reason}`}
                </li>
                <li>
                  {!data.search.known
                    ? "? Suchaufträge nicht erreichbar"
                    : data.search.active
                      ? "✓ Für dieses Medium ist ein Suchauftrag aktiv"
                      : "○ Aktuell kein laufender Suchauftrag nachgewiesen"}
                </li>
              </ul>
              {data.search.lastStatus === "completed" && (
                <p>
                  Der letzte Suchauftrag ist abgeschlossen. Das bestätigt noch
                  keinen passenden Download; prüfe die Treffer und Ablehnungen.
                </p>
              )}
              {data.search.lastStatus === "failed" && (
                <p className="notice">
                  Der letzte Suchauftrag ist fehlgeschlagen. Prüfe Quellen,
                  Dienstverbindungen und die interaktive Trefferabfrage.
                </p>
              )}
              {data.importInfo && (
                <section className="import-status">
                  <h4>Nach dem Download</h4>
                  <p>
                    {data.importInfo.availableInJellyfin === true
                      ? "✓ In Jellyfin nachgewiesen"
                      : data.importInfo.imported
                        ? "✓ In der ARR-Bibliothek importiert · Jellyfin-Verfügbarkeit noch nicht nachgewiesen"
                        : data.importInfo.downloadComplete
                          ? "✓ Download vollständig · Import noch nicht bestätigt"
                          : "Ein vollständig zugeordneter Download ist noch nicht nachgewiesen."}
                  </p>
                  {data.importInfo.seeding && (
                    <p className="muted">
                      Der Torrent bleibt zum Verteilen verfügbar. Das ist normal
                      und sollte den Import per Hardlink nicht verhindern.
                    </p>
                  )}
                  <p>
                    Verarbeitung abgeschlossener Downloads:{" "}
                    {data.importInfo.completedHandling === null
                      ? "Unbekannt"
                      : data.importInfo.completedHandling
                        ? "Aktiviert"
                        : "Ausgeschaltet"}
                  </p>
                  {data.importInfo.blockers.map((b) => (
                    <p className="warning" key={b}>
                      {b}
                    </p>
                  ))}
                  {data.importInfo.issues.length > 0 && (
                    <p className="muted">
                      Noch nicht prüfbar: {data.importInfo.issues.join(", ")}
                    </p>
                  )}
                  {data.importInfo.queueLimited && (
                    <p className="muted">
                      Nur ein Ausschnitt der ARR-Warteschlange konnte geprüft
                      werden.
                    </p>
                  )}
                  {data.importInfo.messages.length > 0 && (
                    <details open>
                      <summary>Importmeldungen aus {data.service}</summary>
                      {data.importInfo.messages.map((m, i) => (
                        <p className="import-message" key={i}>
                          {m}
                        </p>
                      ))}
                    </details>
                  )}
                  <button
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(
                          JSON.stringify(
                            {
                              service: data.service,
                              requestId: data.requestId,
                              observedAt: data.observedAt,
                              import: data.importInfo,
                            },
                            null,
                            2,
                          ),
                        );
                        setMessage("Import-Diagnose kopiert.");
                      } catch {
                        setError(
                          "Kopieren nicht möglich. Die Importmeldungen kannst du direkt markieren.",
                        );
                      }
                    }}
                  >
                    Import-Diagnose kopieren
                  </button>
                </section>
              )}
              {data.search.lastRequestedAt && (
                <p className="muted">
                  Letzte Suche aus StackPilot:{" "}
                  {new Date(data.search.lastRequestedAt).toLocaleString(
                    "de-AT",
                  )}
                </p>
              )}
              {data.healthWarnings?.map((w) => (
                <p className="notice" key={w}>
                  {w}
                </p>
              ))}
              {data.issues.length > 0 && (
                <p className="notice">
                  Nicht vollständig geprüft: {data.issues.join(", ")}. Fehlende
                  Nachweise bedeuten keinen Erfolg.
                </p>
              )}
              {data.sources && data.sources.length > 0 && (
                <details>
                  <summary>Verwendete Quellen in {data.service}</summary>
                  {data.sources.map((s, i) => (
                    <p key={i}>
                      {s.name} ·{" "}
                      {s.automatic
                        ? "Automatische Suche aktiv"
                        : "Automatische Suche aus"}
                      {s.disabledUntil
                        ? " · Vorübergehend nicht verfügbar bis " +
                          new Date(s.disabledUntil).toLocaleString("de-AT")
                        : ""}
                    </p>
                  ))}
                </details>
              )}
              {data.lastGrab && (
                <div className="notice">
                  <b>Zuletzt ausgewählter Release</b>
                  <p>{data.lastGrab.title}</p>
                  <small>
                    {data.lastGrab.source || "Quelle nicht gemeldet"} ·{" "}
                    {new Date(data.lastGrab.at).toLocaleString("de-AT")}
                  </small>
                </div>
              )}
              {data.blockers.length > 0 && (
                <ul>
                  {data.blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              )}
              <p className="muted">
                Eine neue Quelle startet nicht zwingend eine neue Suche für alte
                Anfragen. Eine automatische Suche kann passende Downloads
                starten. Die Trefferprüfung allein lädt nichts herunter.
              </p>
              <div className="button-group">
                <button
                  className="primary"
                  disabled={busy || !data.canSearch}
                  onClick={() => void search()}
                >
                  Jetzt erneut suchen
                </button>
                <button
                  disabled={busy || !data.library.present}
                  onClick={() => void inspect(true)}
                >
                  Treffer und Ablehnungen prüfen
                </button>
              </div>
              {data.releases && (
                <div className="release-results">
                  <h4>Gefundene Veröffentlichungen ({data.releases.total})</h4>
                  {data.releases.total > 0 && (
                    <p className="muted">
                      Die Trefferprüfung startet keinen Download. Bei einer
                      automatischen Suche übernimmt {data.service} die Auswahl
                      anhand deiner Profile.
                    </p>
                  )}
                  {!data.releases.total && (
                    <p>
                      Die Quellen haben keine Treffer geliefert. Das beweist
                      keinen VPN-Fehler. Titel, Veröffentlichung, Quellen und
                      deren Kategorien prüfen.
                    </p>
                  )}
                  {data.releases.results.map((r, i) => (
                    <article className="release-row" key={i}>
                      <b>{r.title}</b>
                      <p>
                        {r.source || "Unbekannte Quelle"} ·{" "}
                        {r.quality || "Qualität unbekannt"}
                        {r.seeders !== null
                          ? " · " + r.seeders + " Seeder"
                          : ""}
                        {r.size !== null
                          ? " · " +
                            (r.size / 1024 ** 3).toLocaleString("de-AT", {
                              maximumFractionDigits: 1,
                            }) +
                            " GB"
                          : ""}
                      </p>
                      <small>
                        {r.rejected
                          ? "Abgelehnt"
                          : "Kein Ablehnungsgrund gemeldet"}
                      </small>
                      {r.reasons.map((reason, n) => (
                        <p key={n}>{reason}</p>
                      ))}
                    </article>
                  ))}
                  {data.releases.total > 100 && (
                    <p>Die ersten 100 Treffer werden angezeigt.</p>
                  )}
                </div>
              )}
              <small className="muted">
                Geprüft: {new Date(data.observedAt).toLocaleTimeString("de-AT")}
              </small>
            </>
          )}
        </div>
      )}
    </div>
  );
}
