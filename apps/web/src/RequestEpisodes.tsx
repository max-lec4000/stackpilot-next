import { ImportedReplacement } from "./ImportedReplacement";
import { useEffect, useState } from "react";
import { action } from "./RetirementPanel";
import { get } from "./ServerCheck";
import { useConfirm } from "./ui";

type Episode = {
  id: number;
  number: number;
  title: string;
  hasFile: boolean;
  removableFileId: number | null;
  canSearch: boolean;
  canSearchSeason: boolean;
  searchBlocker: string | null;
};
type SeriesLimits = {
  episodeGiB: number;
  packageGiB: number;
  automatic?: boolean;
  previousProfile?: string;
  pending?: boolean;
};

function SeasonEpisodes({ requestId, season }: { requestId: number; season: number }) {
  const { ask, dialog } = useConfirm();
  const [cap, setCap] = useState("");
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

  async function search(episodeId?: number) {
    const capGiB = Number(cap || 0);
    if (cap && (capGiB < 0.5 || capGiB > 200 || !Number.isInteger(capGiB * 2))) {
      setError("Gib eine Obergrenze zwischen 0,5 und 200 GiB in halben Schritten ein.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await action<{ alreadyRunning?: boolean; grabbed?: boolean }>(
        "/api/media/research", { requestId, season, episodeId, capGiB },
      );
      setMessage(result.grabbed ? (episodeId ? "Einzelfolge an den Downloadclient übergeben." : "Staffelpaket an den Downloadclient übergeben.") : result.alreadyRunning ? "Für diese Serie läuft bereits eine Suche." :
        "Suche gestartet. Bei einem passenden Treffer kann Sonarr den Download starten.");
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(episode: Episode) {
    if (!episode.removableFileId || !(await ask(
      `Datei von Staffel ${season}, Folge ${episode.number} aus der Mediathek entfernen? Sonarr kann sie bei aktiver Überwachung erneut laden.`,
      "Folgendatei entfernen",
    ))) return;
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

  async function changePackage(mode: "pause" | "remove" | "replace") {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const remove = mode !== "pause";
      const transfer = await get<{ name: string; review: string }>(
        `/api/media/season-transfer?requestId=${requestId}&season=${season}${remove ? "&remove=1" : ""}`,
      );
      const question = mode === "replace"
        ? `Ersatz für „${transfer.name}“ suchen? Das alte Paket wird erst entfernt, wenn qBittorrent das neue bestätigt. Seine Dateien bleiben erhalten.`
        : remove
        ? `„${transfer.name}“ aus qBittorrent entfernen? Die Dateien bleiben erhalten. Sonarr kann das Paket erneut finden.`
        : `„${transfer.name}“ pausieren? Bisher geladene Dateien bleiben erhalten.`;
      if (!(await ask(question, "Staffelpaket ändern"))) return;
      await action(`/api/media/season-transfer/${mode}`, {
        requestId, season, review: transfer.review, confirmation: "OK",
      });
      setMessage(mode === "replace" ? "Ersatzpaket gestartet. Die bisherigen Dateien bleiben erhalten." : remove ? "Staffelpaket aus qBittorrent entfernt. Dateien bleiben erhalten." : "Staffelpaket pausiert.");
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
      {dialog}
      {rows?.length === 0 && <p>Sonarr meldet keine Folgen für diese Staffel.</p>}
      {rows?.some((episode) => episode.canSearch) && (
        <label>
          Größenobergrenze für die nächste Folge oder das Staffelpaket (GiB)
          <input type="number" min="0.5" max="200" step="0.5" value={cap}
            onChange={(event) => setCap(event.target.value)} disabled={busy} />
        </label>
      )}
      {rows?.some((episode) => episode.canSearch && episode.canSearchSeason) && (
        <button disabled={busy} onClick={() => void search()}>Nur Staffel {season} suchen</button>
      )}
      {rows && rows.length > 0 && (
        <ul>
          {rows.map((episode) => (
            <li key={episode.id}>
              Folge {episode.number}{episode.title ? ` · ${episode.title}` : ""}
              {episode.hasFile ? <> · Datei vorhanden
                <ImportedReplacement requestId={requestId} episodeId={episode.id} />
                {episode.removableFileId && <> <button disabled={busy} className="danger" onClick={() => void remove(episode)}>
                  Datei von Folge {episode.number} löschen
                </button></>}
              </> : episode.canSearch ? (
                <> <button disabled={busy} onClick={() => void search(episode.id)}>
                  Folge {episode.number} herunterladen
                </button></>
              ) : <small> · {episode.searchBlocker}</small>}
            </li>
          ))}
        </ul>
      )}
      <button disabled={busy} onClick={() => void changePackage("pause")}>Staffelpaket pausieren …</button>
      <button disabled={busy} onClick={() => void changePackage("remove")}>Pausiertes Staffelpaket entfernen …</button>
      <button disabled={busy} onClick={() => void changePackage("replace")}>Pausiertes Staffelpaket ersetzen …</button>
      <button disabled={busy} onClick={() => void load()}>Folgen aktualisieren</button>
    </details>
  );
}

export function RequestEpisodes({ requestId, seasons }: { requestId: number; seasons: number[] }) {
  const [data, setData] = useState<{ requestId: number; seasons: number[] } | null>(null);
  const [episodeGiB, setEpisodeGiB] = useState(""), [packageGiB, setPackageGiB] = useState("");
  const [automatic, setAutomatic] = useState(false);
  const [saved, setSaved] = useState<SeriesLimits | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(""), [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void get<{ seasons: number[]; limits?: SeriesLimits }>(`/api/media/episode-seasons?requestId=${requestId}`)
      .then((result) => {
        if (!active || !Array.isArray(result.seasons)) return;
        setData({ requestId, seasons: result.seasons });
        setEpisodeGiB(result.limits?.episodeGiB ? String(result.limits.episodeGiB) : "");
        setPackageGiB(result.limits?.packageGiB ? String(result.limits.packageGiB) : "");
        setSaved(result.limits ?? null);
        setAutomatic(result.limits?.automatic === true);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [requestId]);
  const numbers = [...new Set([...seasons, ...(data?.requestId === requestId ? data.seasons : [])])].sort((a, b) => a - b);
  return (
    <section aria-label="Staffeln und Folgen">
      {data?.requestId === requestId && data.seasons.length > 0 && (
        <details>
          <summary>Größenlimits für diese Serie</summary>
          <form onSubmit={async (event) => {
            event.preventDefault();
            setSaving(true);
            setError("");
            setNotice("");
            try {
              const { limits } = await action<{ limits: SeriesLimits }>("/api/media/series-limits", {
                requestId, automatic, episodeGiB: Number(episodeGiB || 0), packageGiB: Number(packageGiB || 0), confirmation: "OK",
              });
              setNotice(limits.automatic ? "Automatische Größenlimits in Sonarr aktiv." :
                saved?.automatic ? "Bisheriges Sonarr-Profil wieder aktiv. Größenlimits gespeichert." : "Größenlimits gespeichert.");
              setSaved(limits);
              setAutomatic(limits.automatic === true);
            } catch (error) { setError((error as Error).message); }
            finally { setSaving(false); }
          }}>
            <label>Folgenrelease (GiB)<input type="number" min="0.5" max="200" step="0.5" disabled={saving}
              value={episodeGiB} onChange={(event) => setEpisodeGiB(event.target.value)} /></label>
            <label>Je Staffelpaket (GiB)<input type="number" min="0.5" max="200" step="0.5" disabled={saving}
              value={packageGiB} onChange={(event) => setPackageGiB(event.target.value)} /></label>
            <label className="checkline"><input type="checkbox" checked={automatic} disabled={saving}
              onChange={(event) => setAutomatic(event.target.checked)} /> Auch automatische Downloads in Sonarr begrenzen</label>
            <p>Ein leeres Feld entfernt das jeweilige Limit. Bei automatischen Downloads gilt das Folgenlimit für den ganzen Release, auch wenn er mehrere Folgen enthält.</p>
            {saved?.automatic && <p>Für die Rückkehr zu „{saved.previousProfile}“ das Häkchen entfernen und speichern. Die Limits für gezielte Downloads bleiben gespeichert.</p>}
            {saved?.pending && <p>Profilwechsel ausstehend. Erneut speichern, um die Zuordnung zu prüfen.</p>}
            <button disabled={saving}>{saving ? "Sonarr wird geprüft …" : "Größenlimits speichern"}</button>
            {notice && <p role="status">{notice}</p>}
            {error && <p role="alert">{error}</p>}
          </form>
        </details>
      )}
      {numbers.map((season) => <SeasonEpisodes key={`${requestId}:${season}`} requestId={requestId} season={season} />)}
    </section>
  );
}
