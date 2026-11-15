import { useState } from "react";
import { action } from "./RetirementPanel";
import { get } from "./ServerCheck";

type Episode = {
  id: number;
  number: number;
  title: string;
  hasFile: boolean;
  removableFileId: number | null;
  canSearch: boolean;
};

function SeasonEpisodes({ requestId, season }: { requestId: number; season: number }) {
  const [rows, setRows] = useState<Episode[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    setBusy(true);
    setError("");
    try {
      setRows((await get<{ episodes: Episode[] }>(
        `/api/media/episodes?requestId=${requestId}&season=${season}`,
      )).episodes);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function search(episodeId: number) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await action<{ alreadyRunning?: boolean }>(
        "/api/media/research", { requestId, season, episodeId },
      );
      setMessage(result.alreadyRunning ? "Für diese Serie läuft bereits eine Suche." :
        "Suche gestartet. Bei einem passenden Treffer kann Sonarr den Download starten.");
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(episode: Episode) {
    if (!episode.removableFileId || !window.confirm(
      `Datei von Staffel ${season}, Folge ${episode.number} aus der Mediathek entfernen? Sonarr kann sie bei aktiver Überwachung erneut laden.`,
    )) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action("/api/media/episodes/delete-file", {
        requestId, season, episodeId: episode.id, fileId: episode.removableFileId, confirmation: "OK",
      });
      setMessage("Sonarr hat die Datei aus der Mediathek entfernt.");
      await load();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <details onToggle={(event) => {
      if (event.currentTarget.open && rows === null && !busy) void load();
    }}>
      <summary>Staffel {season}</summary>
      {busy && <p role="status">Sonarr wird geprüft …</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {message && <p className="notice" role="status">{message}</p>}
      {rows?.length === 0 && <p>Sonarr meldet keine Folgen für diese Staffel.</p>}
      {rows && rows.length > 0 && (
        <ul>
          {rows.map((episode) => (
            <li key={episode.id}>
              Folge {episode.number}{episode.title ? ` · ${episode.title}` : ""}
              {episode.hasFile ? <> · Datei vorhanden
                {episode.removableFileId && <> <button disabled={busy} className="danger" onClick={() => void remove(episode)}>
                  Datei von Folge {episode.number} löschen
                </button></>}
              </> : episode.canSearch && (
                <> <button disabled={busy} onClick={() => void search(episode.id)}>
                  Folge {episode.number} suchen
                </button></>
              )}
            </li>
          ))}
        </ul>
      )}
      <button disabled={busy} onClick={() => void load()}>Folgen aktualisieren</button>
    </details>
  );
}

export function RequestEpisodes({ requestId, seasons }: { requestId: number; seasons: number[] }) {
  return (
    <section aria-label="Staffeln und Folgen">
      {seasons.map((season) => <SeasonEpisodes key={`${requestId}:${season}`} requestId={requestId} season={season} />)}
    </section>
  );
}
