import { useState } from "react";
import { action } from "./RetirementPanel";
import { formatBytes } from "../../../packages/domain/format.js";
type Preview = {
  id: string;
  chosen: string[] | null;
  started: boolean;
  title: string;
  size: number | null;
  hasFile: boolean;
  message: string;
  downloadWarning: string | null;
  downloads: { hash: string; name: string; size: number | null }[];
};
export function MovieRemoval({
  requestId,
  onChange,
}: {
  requestId: number;
  onChange: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    [preview, setPreview] = useState<Preview | null>(null),
    [selected, setSelected] = useState<string[]>([]),
    [confirmation, setConfirmation] = useState(""),
    [busy, setBusy] = useState(false),
    [started, setStarted] = useState(false),
    [message, setMessage] = useState("");
  async function load() {
    setOpen(true);
    setBusy(true);
    setMessage("");
    try {
      const result = await action<Preview>("/api/media/movie-removal/preview", {
        requestId,
      });
      setPreview(result);
      setSelected(result.chosen || []);
      setConfirmation("");
      setStarted(result.started);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!preview) return;
    setBusy(true);
    setStarted(true);
    try {
      const result = await action<{
        complete: boolean;
        message: string;
        detail?: string;
      }>("/api/media/movie-removal/execute", {
        planId: preview.id,
        downloads: selected,
        confirmation,
      });
      setMessage(result.message + (result.detail ? " " + result.detail : ""));
      if (result.complete) {
        setPreview(null);
        await onChange();
      }
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="movie-removal">
      <button
        className="danger"
        disabled={busy}
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : void load())}
      >
        {open ? "Löschbereich schließen" : "Film löschen"}
      </button>
      {open && (
        <div className="diagnosis-content">
          <h4>Film löschen</h4>
          {message && (
            <p role="status" className="notice">
              {message}
            </p>
          )}
          {busy && !preview && <p>Film und Downloads werden geprüft …</p>}
          {!preview && !busy && !started && (
            <button onClick={() => void load()}>Erneut prüfen</button>
          )}
          {preview && (
            <>
              <p>
                <b>{preview.title}</b> ·{" "}
                {preview.hasFile
                  ? formatBytes(preview.size)
                  : "Noch keine importierte Filmdatei nachgewiesen"}
              </p>
              <p>{preview.message}</p>
              <div className="notice">
                Für eine kleinere Version am besten vor dem Löschen unter
                „Qualität ändern“ das Profil „1080p ohne Remux“ auch als
                Standard für zukünftige Anfragen speichern. Danach den Löschplan
                neu öffnen. Eine bestimmte Dateigröße wird dadurch nicht
                garantiert.
              </div>
              {preview.downloadWarning && (
                <p className="warning">{preview.downloadWarning}</p>
              )}
              {preview.downloads.length > 0 ? (
                <fieldset disabled={busy || started}>
                  <legend>
                    Zusätzlich komplette Downloads mit Dateien löschen
                    (optional)
                  </legend>
                  {preview.downloads.map((t) => (
                    <label className="checkline" key={t.hash}>
                      <input
                        type="checkbox"
                        checked={selected.includes(t.hash)}
                        onChange={(e) =>
                          setSelected((ids) =>
                            e.target.checked
                              ? [...ids, t.hash]
                              : ids.filter((v) => v !== t.hash),
                          )
                        }
                      />
                      <span>
                        {t.name} · {formatBytes(t.size)}
                      </span>
                    </label>
                  ))}
                </fieldset>
              ) : (
                <p className="muted">
                  Keine eindeutig zugeordneten Torrents gefunden. Unter
                  Downloads können weitere Kopien vorhanden sein.
                </p>
              )}
              <p className="warning">
                Das betrifft die gemeinsame Bibliothek aller Zuschauer. Die
                Löschung kann nicht durch StackPilot rückgängig gemacht werden.
                Ohne ausgewählte Downloads kann deren vollständige Kopie weiter
                Speicher belegen.
              </p>
              <label>
                Zum Löschen OK eingeben
                <input
                  aria-label="Löschung bestätigen"
                  value={confirmation}
                  disabled={busy}
                  onChange={(e) => setConfirmation(e.target.value)}
                  autoComplete="off"
                  placeholder="OK"
                />
              </label>
              <div className="button-group">
                <button
                  className="danger"
                  disabled={busy || confirmation !== "OK"}
                  onClick={() => void remove()}
                >
                  {busy
                    ? "Wird entfernt …"
                    : started
                      ? "Löschung fortsetzen"
                      : "Film und ausgewählte Dateien löschen"}
                </button>
                <button
                  disabled={busy}
                  onClick={() => {
                    setOpen(false);
                    setPreview(null);
                  }}
                >
                  Schließen
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
