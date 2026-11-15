import { formatBytes } from "../../../packages/domain/format.js";
import { useState } from "react";
import { get } from "./ServerCheck";
import { action } from "./RetirementPanel";
type Quality = {
  sizeDefaultRate?: number;
  runtime?: number | null;
  sizePolicy?: { capGiB: number } | null;
  service: string;
  kind: string;
  currentProfileId: number;
  hasFile: boolean;
  canSetDefault: boolean;
  defaultProfileId?: number;
  requestProfileId?: number | null;
  savedProfileId?: number | null;
  fileQuality?: string | null;
  fileSize?: number | null;
  canCreateCompact: boolean;
  profiles: { id: number; name: string; allowed: string[] }[];
};
export function QualityEditor({
  requestId,
  onChange,
}: {
  requestId: number;
  onChange?: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    [data, setData] = useState<Quality | null>(null),
    [profile, setProfile] = useState(""),
    [future, setFuture] = useState(false),
    [searchAfterSave, setSearchAfterSave] = useState(false),
    [sizeRate, setSizeRate] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  async function refresh() {
    setBusy(true);
    setError("");
    try {
      const result = await get<Quality>(
        "/api/media/quality?requestId=" + requestId,
      );
      setData(result);
      setProfile(String(result.currentProfileId));
      setFuture(false);
      setSizeRate(0);
    } catch (e) {
      setData(null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const selected = data?.profiles.find((v) => String(v.id) === profile);
  return (
    <div className="quality-editor">
      <button
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          if (!open) void refresh();
        }}
      >
        {open ? "Qualität schließen" : "Qualität ändern"}
      </button>
      {open && (
        <div className="diagnosis-content">
          <h4>Qualitätsprofil</h4>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {message && (
            <p role="status" className="notice">
              {message}
            </p>
          )}
          {!data && (
            <button disabled={busy} onClick={() => void refresh()}>
              {busy ? "Wird geladen …" : "Profile neu laden"}
            </button>
          )}
          {data && (
            <>
              <p>
                Aktuell in {data.service}:{" "}
                <b>
                  {data.profiles.find((v) => v.id === data.currentProfileId)
                    ?.name || "Unbekannt"}
                </b>
              </p>
              <p>
                Seerr-Standard für neue Anfragen:{" "}
                <b>
                  {data.profiles.find((p) => p.id === data.defaultProfileId)
                    ?.name || "Nicht bestätigt"}
                </b>
              </p>
              {data.requestProfileId != null && (
                <p className="muted">
                  Bei Erstellung der Anfrage vorgegeben:{" "}
                  {data.profiles.find((p) => p.id === data.requestProfileId)
                    ?.name || "Profil #" + data.requestProfileId}
                  . Für die aktuelle Suche gilt das Profil in {data.service}.
                </p>
              )}
              {data.savedProfileId != null &&
                data.savedProfileId !== data.currentProfileId && (
                  <p className="warning">
                    Das aktuelle Dienstprofil weicht von deiner zuletzt
                    gespeicherten Auswahl ab. Vor einer neuen Suche erneut
                    bestätigen.
                  </p>
                )}
              {data.hasFile && (
                <p>
                  Bereits importierte Datei:{" "}
                  {data.fileQuality || "Qualität nicht gemeldet"} ·{" "}
                  {formatBytes(data.fileSize)}. Ein Profilwechsel ersetzt diese
                  Datei nicht.
                </p>
              )}
              <label>
                Neues Qualitätsprofil
                <select
                  aria-label="Neues Qualitätsprofil"
                  value={profile}
                  disabled={busy}
                  onChange={(e) => setProfile(e.target.value)}
                >
                  {data.profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                  {data.canCreateCompact && (
                    <option value="1080p-compact">
                      1080p ohne Remux · neues StackPilot-Profil
                    </option>
                  )}
                </select>
              </label>
              <p>
                {profile === "1080p-compact"
                  ? "Erlaubt 1080p-Veröffentlichungen ohne Remux. Automatische Qualitäts-Upgrades bleiben für dieses neue Profil ausgeschaltet."
                  : selected?.allowed.length
                    ? "Erlaubte Qualitäten: " + selected.allowed.join(", ")
                    : "Keine erlaubten Qualitäten gemeldet."}
              </p>
              <p className="muted">
                1080p bezeichnet die Auflösung, nicht eine feste Dateigröße.
                Bereits heruntergeladene Dateien bleiben erhalten. Die neuen
                Regeln gelten auch für die spätere Bewertung laufender
                Downloads. Ein laufender Download wird dadurch nicht umgewandelt
                oder abgebrochen.
                {data.kind === "tv"
                  ? " Das Profil gilt für die gesamte Serie."
                  : ""}
              </p>
              {data.kind === "movie" && (
                <label>
                  Größenregel für diesen Film
                  <select
                    aria-label="Größenregel für diesen Film"
                    value={sizeRate}
                    disabled={busy || !data.runtime}
                    onChange={(e) => {
                      setSizeRate(Number(e.target.value));
                      if (!Number(e.target.value) && !data.canSetDefault) setFuture(false);
                    }}
                  >
                    <option value={0}>Vorhandenes Profil verwenden</option>
                    {[1, 2, 3, 4, 6, 8].map((rate) => (
                      <option key={rate} value={rate}>
                        {rate} GiB pro Stunde · 1080p ohne Remux
                      </option>
                    ))}
                  </select>
                  {sizeRate > 0 && data.runtime ? (
                    <span>
                      Bei {data.runtime} Minuten: höchstens{" "}
                      {Math.ceil(((data.runtime * sizeRate) / 60) * 2) / 2} GiB.
                      Eigene native Radarr-Regel, keine globale Größenänderung.
                    </span>
                  ) : data.sizePolicy ? (
                    <span>Aktuelle Grenze: {data.sizePolicy.capGiB} GiB.</span>
                  ) : null}
                  {!data.runtime && (
                    <span>
                      Laufzeit fehlt; keine verlässliche Größenregel ableitbar.
                    </span>
                  )}
                </label>
              )}
              <label>
                <input
                  type="checkbox"
                  checked={future}
                  disabled={busy || (!data.canSetDefault && sizeRate === 0)}
                  onChange={(e) => setFuture(e.target.checked)}
                />
                Auch als Standard für zukünftige{" "}
                {sizeRate > 0 ? "StackPilot-Filmanfragen" : data.kind === "movie" ? "Filmanfragen" : "Serienanfragen"}{" "}
                verwenden
              </label>
              {!!data.sizeDefaultRate && (
                <p>Größenstandard in StackPilot: {data.sizeDefaultRate} GiB pro Stunde.</p>
              )}
              {!data.canSetDefault && sizeRate === 0 && (
                <p className="muted">
                  Dieser Server ist nicht der Seerr-Standard; hier wird nur das
                  aktuelle Medium geändert.
                </p>
              )}
              <div className="notice">
                <b>Geplante Änderung</b>
                <p>
                  {
                    data.profiles.find((p) => p.id === data.currentProfileId)
                      ?.name
                  }{" "}
                  →{" "}
                  {sizeRate > 0 ? `1080p ohne Remux · ${sizeRate} GiB pro Stunde` :
                    profile === "1080p-compact" ? "1080p ohne Remux" : selected?.name}
                </p>
                <p>
                  {future
                    ? "Aktuelles Medium und zukünftige Anfragen."
                    : "Nur dieses Medium."}{" "}
                  Bestehende Dateien bleiben erhalten.{" "}
                  {searchAfterSave && !data.hasFile
                    ? "StackPilot prüft nach dem Speichern, ob eine neue Suche sofort möglich ist. "
                    : "Die Suche lässt sich anschließend separat starten. "}
                  Diese Auswahl gilt für dieses Medium
                  auch bei späteren StackPilot-Anfragen.
                </p>
              </div>
              {!data.hasFile && (
                <label>
                  <input type="checkbox" checked={searchAfterSave} disabled={busy}
                    onChange={(e) => setSearchAfterSave(e.target.checked)} />
                  Nach dem Speichern mit dem neuen Profil suchen
                </label>
              )}
              <button
                className="primary"
                disabled={
                  busy ||
                  (!future &&
                    sizeRate === 0 &&
                    profile === String(data.currentProfileId) &&
                    data.savedProfileId === data.currentProfileId)
                }
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  setMessage("");
                  try {
                    const result = await action<{
                      profileName: string;
                      warning: string | null;
                    }>("/api/media/quality", {
                      requestId,
                      profile,
                      previousProfileId: data.currentProfileId,
                      alsoFuture: future,
                      sizeGiBPerHour: sizeRate,
                      confirmation: "OK",
                    });
                    let outcome = "Profil „" + result.profileName + "“ übernommen.";
                    if (result.warning) outcome += " " + result.warning;
                    if (searchAfterSave && !data.hasFile) {
                      try {
                        const search = await action<{ alreadyRunning?: boolean }>(
                          "/api/media/research", { requestId },
                        );
                        outcome += search.alreadyRunning
                          ? " Für dieses Medium läuft bereits eine Suche."
                          : " Neue Suche mit dem geprüften Profil gestartet.";
                      } catch (e) {
                        outcome += " Neue Suche nicht gestartet. " + (e as Error).message;
                      }
                    }
                    setMessage(outcome);
                    setSearchAfterSave(false);
                    await refresh();
                    await onChange?.();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "Wird gespeichert …" : "Profil übernehmen"}
              </button>
              {!data.hasFile &&
                data.savedProfileId === data.currentProfileId &&
                profile === String(data.currentProfileId) && (
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError("");
                      try {
                        const result = await action<{
                          alreadyRunning?: boolean;
                        }>("/api/media/research", { requestId });
                        setMessage(
                          result.alreadyRunning
                            ? "Für dieses Medium läuft bereits eine Suche."
                            : "Suchauftrag mit geprüftem Profil gestartet. Passende Treffer können Downloads starten.",
                        );
                        await onChange?.();
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Mit diesem Profil neu suchen
                  </button>
                )}
              {data.kind === "movie" && !data.hasFile &&
                data.savedProfileId === data.currentProfileId && (
                  <button disabled={busy || sizeRate !== 0 || profile !== String(data.currentProfileId)}
                    onClick={async () => {
                      setBusy(true);
                      setError("");
                      setMessage("");
                      try {
                        const preview = await get<{ name: string; review: string }>(
                          "/api/media/replace-download?requestId=" + requestId,
                        );
                        if (!window.confirm(
                          `„${preview.name}“ stoppen und mit dem gespeicherten Profil neu suchen? Die bisher geladenen Dateien bleiben erhalten. Radarr schließt den bisherigen Treffer von der neuen Suche aus.`,
                        )) return;
                        const result = await action<{ alreadyRunning?: boolean }>("/api/media/research", {
                          requestId, replaceReview: preview.review, confirmation: "OK",
                        });
                        setMessage(result.alreadyRunning
                          ? "Eine Suche läuft bereits. Der Download wurde beim Austausch nicht verändert."
                          : "Alter Transfer entfernt, Dateien erhalten. Neue Suche gestartet.");
                        await onChange?.();
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}>
                    Laufenden Film-Download ersetzen …
                  </button>
                )}
              <button
                disabled={busy}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      JSON.stringify({ requestId, ...data }, null, 2),
                    );
                    setMessage("Qualitätsdiagnose kopiert.");
                  } catch {
                    setError(
                      "Kopieren nicht möglich. Die aktuellen Profilnamen und Dateidaten oben verwenden.",
                    );
                  }
                }}
              >
                Qualitätsdiagnose kopieren
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
