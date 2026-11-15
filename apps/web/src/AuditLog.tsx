import { useEffect, useState } from "react";
import { get } from "./ServerCheck";
type Log = {
  page: number;
  pages: number;
  total: number;
  events: {
    id: number;
    at: string;
    actor: string;
    action: string;
    status: string;
  }[];
};
export function AuditLog() {
  const [data, setData] = useState<Log | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function load(page = 1) {
    setBusy(true);
    setError("");
    try {
      setData(await get<Log>(`/api/audit?page=${page}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <>
      <h3>Dein Änderungsverlauf</h3>
      <p>
        Lokales Protokoll bestätigter Aktionen. Zugangsdaten und Anfrageinhalte
        werden nicht mitgeschrieben. Bei Hintergrundaufträgen bestätigt der
        Eintrag die Anforderung; deren Ergebnis steht im Auftragsverlauf.
      </p>
      <button disabled={busy} onClick={() => void load(data?.page || 1)}>
        Aktualisieren
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {data && (
        <>
          {!data.total && <p>Noch keine protokollierten Aktionen.</p>}
          {data.events.map((e) => (
            <article className="tile" key={e.id}>
              <b>{e.action}</b>
              <p>
                {new Date(e.at).toLocaleString("de-AT")} · {e.actor}
              </p>
              <span className="badge">
                {e.status === "completed"
                  ? "Anforderung abgeschlossen"
                  : e.status === "failed"
                    ? "Nicht vollständig ausgeführt"
                    : "Läuft oder wurde unterbrochen"}
              </span>
            </article>
          ))}
          <div className="pagination">
            <button
              disabled={busy || data.page <= 1}
              onClick={() => void load(data.page - 1)}
            >
              Zurück
            </button>
            <span>
              Seite {data.page} von {data.pages}
            </span>
            <button
              disabled={busy || data.page >= data.pages}
              onClick={() => void load(data.page + 1)}
            >
              Weiter
            </button>
          </div>
        </>
      )}
    </>
  );
}
