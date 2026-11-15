import { useEffect, useState } from "react";
import { get } from "./ServerCheck";
import { action } from "./RetirementPanel";
type Preview = {
  requestId: number;
  review: string;
  title: string;
  canCancel: boolean;
  editableSeasons?: number[];
  monitoredSeasons?: number[];
  blockers: string[];
  message: string;
  resuming?: boolean;
  aborting?: boolean;
};
export function RequestActions({
  id,
  onChange,
  pending = false,
}: {
  id: number;
  onChange: () => Promise<void>;
  pending?: boolean;
}) {
  const [preview, setPreview] = useState<Preview | null>(null),
    [season, setSeason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function inspect() {
    setBusy(true);
    setError("");
    try {
      setSeason("");
      setPreview(
        await get<Preview>(`/api/media/request-action?requestId=${id}`),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const stopsMonitoring = !!preview?.monitoredSeasons?.length;
  const seasons = stopsMonitoring ? preview?.monitoredSeasons : preview?.editableSeasons;
  return (
    <div className="request-actions">
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await action("/api/media/request/archive", {
              requestId: id,
              ...(pending || preview?.aborting
                ? { abandon: true, confirmation: "OK" }
                : {}),
            });
            await onChange();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {pending || preview?.aborting
          ? "Abbruch verwerfen und archivieren"
          : "Archivieren"}
      </button>
      <button disabled={busy} onClick={() => void inspect()}>
        Anfrage abbrechen …
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {preview && (
        <div className="notice">
          <b>{preview.resuming ? "Abbruch bestätigen" : "Anfrage abbrechen"}</b>
          <p>{preview.message}</p>
          {preview.blockers.map((b) => (
            <p key={b}>{b}</p>
          ))}
          {!!seasons?.length && (
            <div>
              <label>
                {stopsMonitoring ? "Überwachung einer Staffel stoppen" : "Einzelne Staffel entfernen"}
                <select value={season} disabled={busy} onChange={(e) => setSeason(e.target.value)}>
                  <option value="">Staffel auswählen</option>
                  {seasons.map((number) =>
                    <option key={number} value={number}>Staffel {number}</option>)}
                </select>
              </label>
              {stopsMonitoring && <p>Sonarr stoppt die Überwachung der ausgewählten Staffel. Die Seerr-Anfrage, laufende Downloads und vorhandene Dateien bleiben erhalten.</p>}
              <button disabled={busy || !season} onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await action("/api/media/request/cancel-season", {
                    requestId: id, review: preview.review, season: Number(season), confirmation: "OK",
                  });
                  setPreview(null);
                  await onChange();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}>
                {stopsMonitoring ? "Überwachung stoppen" : "Staffel aus Anfrage entfernen"}
              </button>
            </div>
          )}
          <button
            className="danger"
            disabled={busy || !preview.canCancel}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await action("/api/media/request/cancel", {
                  requestId: id,
                  review: preview.review,
                  confirmation: "OK",
                });
                setPreview(null);
                await onChange();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            OK – Anfrage abbrechen
          </button>
          <button disabled={busy} onClick={() => void inspect()}>
            Zustand erneut prüfen
          </button>
          <button disabled={busy} onClick={() => setPreview(null)}>
            Schließen
          </button>
        </div>
      )}
    </div>
  );
}
export function RequestArchive() {
  const [data, setData] = useState<{
      results: {
        id: number;
        title: string;
        type: string;
        cancelled: boolean;
        cancelPending?: boolean;
        updatedAt: string;
      }[];
      page: number;
      pages: number;
      total: number;
    } | null>(null),
    [page, setPage] = useState(1),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    void load();
  }, []);
  async function load(next = page) {
    setBusy(true);
    setError("");
    try {
      const result = await get<NonNullable<typeof data>>(
        `/api/media/archive?page=${next}`,
      );
      setData(result);
      setPage(result.page);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h3>Archivierte und abgebrochene Anfragen</h3>
      <p>
        Archivieren verändert weder Überwachung noch Downloads. Abgebrochene
        Anfragen bleiben hier nachvollziehbar; das Medium kann erneut angefragt
        werden.
      </p>
      <button disabled={busy} onClick={() => void load()}>
        Archiv laden
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {data && (
        <>
          <p>{data.total} Einträge</p>
          {!data.results.length && <p>Dein Archiv ist leer.</p>}
          {data.results.map((r) => (
            <article className="tile" key={r.id}>
              <h3>{r.title}</h3>
              <p>
                {r.type === "movie" ? "Film" : "Serie"} ·{" "}
                {r.cancelPending
                  ? "Abbruch unbestätigt"
                  : r.cancelled
                    ? "Abgebrochen"
                    : "Archiviert"}{" "}
                · {new Date(r.updatedAt).toLocaleDateString("de-AT")}
              </p>
              {r.cancelPending && (
                <RequestActions id={r.id} pending onChange={() => load()} />
              )}
              {!r.cancelled && !r.cancelPending && (
                <button
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await action("/api/media/request/archive", {
                        requestId: r.id,
                        restore: true,
                      });
                      await load();
                    } catch (e) {
                      setError((e as Error).message);
                      setBusy(false);
                    }
                  }}
                >
                  Zurück zu den Anfragen
                </button>
              )}
            </article>
          ))}
          <div className="pagination">
            <button
              disabled={busy || page <= 1}
              onClick={() => void load(page - 1)}
            >
              Zurück
            </button>
            <span>
              Seite {data.page} von {data.pages}
            </span>
            <button
              disabled={busy || page >= data.pages}
              onClick={() => void load(page + 1)}
            >
              Weiter
            </button>
          </div>
        </>
      )}
    </>
  );
}
