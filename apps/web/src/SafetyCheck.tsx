import { useEffect, useState } from "react";
import { get } from "./ServerCheck";
import { action } from "./RetirementPanel";
type Job = {
  id: string;
  status: string;
  error: string | null;
  finishedAt?: string;
  steps: { id: string; label: string; status: string }[];
};
export function SafetyCheckView() {
  const [jobs, setJobs] = useState<Job[]>([]),
    [error, setError] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [busy, setBusy] = useState(false);
  async function refresh() {
    try {
      const data = await get<{ operations: Job[] }>("/api/safety");
      setJobs(data.operations);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, []);
  const interrupted = jobs.find((j) => ["failed", "paused"].includes(j.status)),
    running = jobs.some((j) => ["queued", "running"].includes(j.status));
  return (
    <div className="tile">
      <h2>VPN & Ausfallsperre prüfen</h2>
      <p>
        Der Test hält qBittorrent an, unterbricht kurz den VPN-Tunnel und prüft
        direkte TCP-, DNS- und HTTPS-Verbindungen. Danach wird Mullvad erneut
        geprüft. Deine Dateien bleiben erhalten.
      </p>
      <p>
        Downloads bleiben nach dem Test pausiert. Du kannst sie unter Downloads
        geschützt fortsetzen. Bei einem Fehler bleibt der Downloadclient
        angehalten. Der Auftrag läuft auch ohne offenen Browser weiter.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <label>
        Mit OK bestätigen
        <input
          value={confirmation}
          disabled={busy || running}
          onChange={(e) => setConfirmation(e.target.value)}
          maxLength={2}
          placeholder="OK"
        />
      </label>
      <button
        className="primary"
        disabled={busy || running || confirmation !== "OK"}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await action("/api/safety/start", {
              confirmation,
              operationId: interrupted?.id,
            });
            setConfirmation("");
            await refresh();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {running
          ? "Schutztest läuft …"
          : interrupted
            ? "Zustand prüfen und Test wiederholen"
            : "Schutztest starten"}
      </button>
      {jobs.map((j) => (
        <article className="tile" key={j.id}>
          <b>
            {j.status === "completed"
              ? "Schutztest bestanden"
              : j.status === "failed"
                ? "Prüfung fehlgeschlagen"
                : j.status === "paused"
                  ? "Prüfung unterbrochen"
                  : "Prüfung läuft"}
          </b>
          {j.finishedAt && (
            <p>Geprüft: {new Date(j.finishedAt).toLocaleString("de-AT")}</p>
          )}
          {j.error && <p className="warning">{j.error}</p>}
          <details open={j.status !== "completed"}>
            <summary>Prüfschritte</summary>
            <ul>
              {j.steps.map((s) => (
                <li key={s.id}>
                  {s.status === "completed"
                    ? "✓"
                    : s.status === "failed"
                      ? "!"
                      : "○"}{" "}
                  {s.label}
                </li>
              ))}
            </ul>
          </details>
        </article>
      ))}
    </div>
  );
}
