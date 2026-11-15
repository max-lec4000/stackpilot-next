import { useEffect, useState } from "react";
import { get } from "./ServerCheck";
import { action } from "./RetirementPanel";
type Check = { service: string; scope: string; status: string };
type Job = {
  id: string;
  kind: string;
  status: string;
  updatedAt: string;
  checks: Check[];
};
export function ConnectionChecks() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [live, setLive] = useState<
    Record<string, { time: string; checks: Check[] }>
  >({});
  useEffect(() => {
    get<{ operations: Job[] }>("/api/operations")
      .then((d) =>
        setJobs(
          d.operations
            .filter((j) => j.kind === "deployment" && j.status === "completed")
            .slice(0, 1),
        ),
      )
      .catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <h3>Echte Installationsprüfungen</h3>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!jobs.length && (
        <p>Noch kein abgeschlossener echter Installationsauftrag.</p>
      )}
      {jobs.map((job) => (
        <div className="tile" key={job.id}>
          <p>
            {live[job.id] ? "Erneut geprüft" : "Bei Installation geprüft"}:{" "}
            {new Date(live[job.id]?.time || job.updatedAt).toLocaleString(
              "de-AT",
            )}
          </p>
          <ul>
            {(live[job.id]?.checks || job.checks || []).map((c) => (
              <li key={c.service}>
                <b>{c.service}</b> ·{" "}
                {c.status === "passed" ? "Erfolgreich" : c.status}
                <br />
                {c.scope}
              </li>
            ))}
          </ul>
          <button
            disabled={!!busy}
            onClick={async () => {
              setBusy(job.id);
              setError("");
              try {
                const result = await action<{ checks: Check[] }>(
                  "/api/managed/check",
                  { operationId: job.id },
                );
                setLive((v) => ({
                  ...v,
                  [job.id]: {
                    time: new Date().toISOString(),
                    checks: result.checks,
                  },
                }));
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(null);
              }
            }}
          >
            {busy === job.id
              ? "Verbindungen werden geprüft …"
              : "Konten und Verbindungen jetzt prüfen"}
          </button>
          <p className="muted">
            Momentaufnahme. Es werden keine neuen Indexer, Torrents oder
            Konfigurationen angelegt. Ein konfiguriertes VPN wird zusätzlich
            über HTTPS geprüft. Der unterbrechende Ausfallsperrentest läuft beim
            VPN-Einrichten. Medien-Download und Transcoding werden hier nicht
            geprüft.
          </p>
        </div>
      ))}
    </>
  );
}
