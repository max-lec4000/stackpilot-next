import { useEffect, useState } from "react";
import { get } from "./ServerCheck";
import { action } from "./RetirementPanel";
type Check = { name: string; state: string; message: string };
type Connection = { ready: boolean; checks: Check[] };
export function DevelopmentDiagnostics() {
  const [enabled, setEnabled] = useState(false),
    [policyEnabled, setPolicyEnabled] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [connection, setConnection] = useState<Connection | null>(null),
    [uploaded, setUploaded] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    get<{ enabled: boolean; policyEnabled: boolean }>("/api/development/status")
      .then((v) => {
        if (active) {
          setEnabled(v.enabled);
          setPolicyEnabled(v.policyEnabled);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  async function check() {
    setBusy(true);
    setError("");
    setConnection(null);
    try {
      setConnection(await get<Connection>("/api/remote-access/connection"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function report(upload: boolean) {
    setBusy(true);
    setError("");
    setUploaded(null);
    try {
      if (upload) {
        const r = await action<{ url: string }>(
          "/api/development/report/publish",
          {},
        );
        setUploaded(r.url);
      } else {
        const r = await get<{ createdAt: string }>("/api/development/report");
        const url = URL.createObjectURL(
          new Blob([JSON.stringify(r, null, 2)], { type: "application/json" }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = `stackpilot-diagnose-${r.createdAt.replace(/[:.]/g, "-")}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="tile">
      <h3>Verbindung prüfen & Entwicklungsbericht</h3>
      <p>
        Prüft Authentik vom Server und den tatsächlichen SSO-Einstieg aus
        Jellyfin. Gesetzte HTTPS-Routen allein bestätigen keine funktionierende
        Anmeldung.
      </p>
      <div className="row">
        <button disabled={busy} onClick={() => void check()}>
          SSO-Verbindungsweg prüfen
        </button>
        <button disabled={busy} onClick={() => void report(false)}>
          Diagnose als JSON herunterladen
        </button>
      </div>
      {policyEnabled && (
        <details>
          <summary>Entwicklungsberichte mit GitHub teilen</summary>
          <p>
            Für diese Installation ausdrücklich erlauben oder wieder
            ausschalten. Ziel: max-lec4000/stackpilot, dev-private/reports/. Der
            bereinigte Bericht enthält Netzwerkadressen und Pfade. Die Freigabe
            bleibt lokal und wird nicht aus dem Repository übernommen.
          </p>
          <p role="status">
            {enabled
              ? "GitHub-Upload ist für diese Installation freigegeben."
              : "GitHub-Upload ist ausgeschaltet."}
          </p>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const result = await action<{
                  enabled: boolean;
                  policyEnabled: boolean;
                }>("/api/development/consent", { enabled: !enabled });
                setEnabled(result.enabled);
                setPolicyEnabled(result.policyEnabled);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {enabled
              ? "Uploadfreigabe ausschalten"
              : "Upload für diese Installation erlauben"}
          </button>
        </details>
      )}
      {enabled && (
        <>
          <p>
            Entwicklungsmodus: Der Bericht enthält Netzwerkadressen, Pfade und
            ausgewählte Konfigurationszustände. Keine Passwörter, Tokens,
            MFA-Geheimnisse, Kontolisten oder Rohlogs. Upload ausschließlich
            nach max-lec4000/stackpilot unter dev-private/reports/.
          </p>
          <button disabled={busy} onClick={() => void report(true)}>
            Diagnosebericht erstellen & auf GitHub ablegen
          </button>
        </>
      )}
      {busy && <p role="status">Prüfung läuft …</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {uploaded && (
        <p role="status">
          <a href={uploaded} target="_blank" rel="noreferrer">
            Entwicklungsbericht auf GitHub öffnen
          </a>
        </p>
      )}
      {connection && (
        <div aria-live="polite">
          <p className={connection.ready ? "notice" : "warning"}>
            {connection.ready
              ? "SSO-Verbindungsweg bestätigt. Persönliche MFA und Geräte noch testen."
              : "Verbindungsweg noch nicht bestätigt."}
          </p>
          {connection.checks.map((c) => (
            <p key={c.name}>
              <b>
                {c.name} ·{" "}
                {c.state === "ok"
                  ? "Bestätigt"
                  : c.state === "blocked"
                    ? "Blockiert"
                    : "Unbestätigt"}
              </b>
              <br />
              {c.message}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
