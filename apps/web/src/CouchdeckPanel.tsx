import { useCallback, useEffect, useRef, useState } from "react";
import { get } from "./ServerCheck";
import { action } from "./RetirementPanel";
import { StatusBadge, type StatusTone } from "./ui";

type Status = {
  installed: boolean;
  version: string | null;
  outdated?: boolean;
  updateVersion?: string | null;
  controllable: boolean;
  state: "missing" | "running" | "off" | "no-display" | "unknown";
  since: string | null;
  linked: { at: string | null; user: string | null; seerr: boolean } | null;
  helper: { available: boolean; running: string | null; failed: string | null };
};
const stateText: Record<Status["state"], [string, StatusTone]> = {
  missing: ["Nicht installiert", "neutral"],
  running: ["Läuft auf dem Bildschirm", "success"],
  off: ["Geschlossen", "neutral"],
  "no-display": ["Wartet auf einen Bildschirm", "warning"],
  unknown: ["Zustand noch nicht gemeldet", "neutral"],
};
const jobText: Record<string, string> = {
  install: "Couchdeck wird installiert …",
  "install-youtube": "Couchdeck wird mit YouTube installiert …",
  remove: "Couchdeck wird entfernt …",
};

/** Couchdeck: die Oberfläche am Fernseher – starten, schließen, installieren, verbinden. */
export function useCouchdeck() {
  const [status, setStatus] = useState<Status | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(""),
    [youtube, setYoutube] = useState(true),
    [confirmRemove, setConfirmRemove] = useState(false);
  const alive = useRef(true);
  const load = useCallback(async () => {
    try {
      const next = await get<Status>("/api/couchdeck");
      if (alive.current) setStatus(next);
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [load]);
  async function run(name: string, version?: string) {
    setBusy(name);
    setError("");
    try {
      setStatus(await action<Status>("/api/couchdeck/action", { action: name, version }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
      setConfirmRemove(false);
    }
  }
  return { status, error, busy, youtube, setYoutube, confirmRemove, setConfirmRemove, load, run };
}

export function CouchdeckStatus({ status }: { status: Status }) {
  const job = status.helper.running;
  const [label, tone] = stateText[status.state];
  return (
    <StatusBadge tone={job ? "info" : tone}>
      {job ? jobText[job] || label : status.state === "running" ? "Läuft" : label}
    </StatusBadge>
  );
}

export function CouchdeckPanel({ controller }: { controller: ReturnType<typeof useCouchdeck> }) {
  const { status, error, busy, youtube, setYoutube, confirmRemove, setConfirmRemove, run } = controller;
  if (!status)
    return error ? (
      <p className="error" role="alert">
        {error}
      </p>
    ) : null;
  const job = status.helper.running;
  const locked = !!busy || !!job;
  return (
    <div className="service-detail">
      <div className="service-detail-state">
        <CouchdeckStatus status={status} />
        {status.version && <span>Version {status.version}</span>}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {status.helper.failed && !job && (
        <p className="error" role="alert">
          Der letzte Auftrag ({status.helper.failed}) ist fehlgeschlagen. Details am Server:
          journalctl -u 'stackpilot-root@*' -n 40
        </p>
      )}
      {!status.installed ? (
        <div className="couchdeck-actions">
          <label className="couchdeck-check">
            <input
              type="checkbox"
              checked={youtube}
              disabled={locked}
              onChange={(event) => setYoutube(event.target.checked)}
            />
            YouTube einschließen (lädt yt-dlp von GitHub, geprüft per Prüfsumme)
          </label>
          <button
            className="primary"
            disabled={locked || !status.helper.available}
            onClick={() => void run(youtube ? "install-youtube" : "install")}
          >
            Couchdeck installieren
          </button>
          {!status.helper.available && (
            <p>
              Dafür fehlt die Root-Hilfe. Am Server einmal <code>sudo bash install.sh</code>{" "}
              ausführen.
            </p>
          )}
        </div>
      ) : (
        <>
          <p>
            {status.linked
              ? `Verbunden als „${status.linked.user}“${status.linked.seerr ? ", Anfragen über Seerr eingerichtet" : ""}.`
              : "Noch nicht mit Jellyfin und Seerr verbunden."}
          </p>
          <div className="couchdeck-actions">
            {status.state === "off" ? (
              <button
                className="primary"
                disabled={locked || !status.controllable}
                onClick={() => void run("start")}
              >
                Couchdeck starten
              </button>
            ) : (
              <button disabled={locked || !status.controllable} onClick={() => void run("stop")}>
                Couchdeck schließen
              </button>
            )}
            {status.updateVersion && (
              <button className="primary" disabled={locked || !status.helper.available}
                onClick={() => void run("update", status.updateVersion!)}>
                Auf neue Version aktualisieren
              </button>
            )}
            <button disabled={locked} onClick={() => void run("link")}>
              {busy === "link"
                ? "Wird verbunden …"
                : status.linked
                  ? "Verbindung erneuern"
                  : "Mit Jellyfin und Seerr verbinden"}
            </button>
            {confirmRemove ? (
              <>
                <button className="danger" disabled={locked} onClick={() => void run("remove")}>
                  Wirklich entfernen
                </button>
                <button disabled={locked} onClick={() => setConfirmRemove(false)}>
                  Abbrechen
                </button>
              </>
            ) : (
              <button disabled={locked} onClick={() => setConfirmRemove(true)}>
                Entfernen
              </button>
            )}
          </div>
          {!status.controllable && (
            <p>
              Starten und Schließen ist erst nach einem Neustart von StackPilot möglich (neue
              Gruppenzugehörigkeit).
            </p>
          )}
        </>
      )}
    </div>
  );
}
