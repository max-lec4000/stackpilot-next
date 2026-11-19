import { useEffect, useState } from "react";
import { action } from "./RetirementPanel";
import { get } from "./ServerCheck";
import { Problem } from "./Problem";
type Preview = { ready: boolean; current: boolean; currentVersion?: string; nextVersion?: string; blockers: string[]; review: string };
type Job = { id: string; state: string; phase: string; message?: string; target?: string };
const terminal = (state: string) => ["completed", "failed"].includes(state);
function savedJob() {
  try { const value = sessionStorage.getItem("stackpilot-code-update"); return value === "stackpilot-update" ? value : ""; } catch { return ""; }
}
export function ServiceUpdates() {
  const [preview, setPreview] = useState<Preview | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [confirmed, setConfirmed] = useState(false), [jobId, setJobId] = useState(savedJob), [job, setJob] = useState<Job | null>(null), [waiting, setWaiting] = useState(false);
  useEffect(() => {
    try { if (jobId) sessionStorage.setItem("stackpilot-code-update", jobId); else sessionStorage.removeItem("stackpilot-code-update"); } catch {}
    if (!jobId) return;
    let active = true, timer: ReturnType<typeof setInterval>;
    const read = async () => {
      try {
        const value = await get<Job>("/api/updates/job?id=" + encodeURIComponent(jobId));
        if (!active) return;
        setJob(value); setWaiting(false);
        if (terminal(value.state)) clearInterval(timer);
      } catch { if (active) setWaiting(true); }
    };
    timer = setInterval(() => { if (document.visibilityState !== "hidden") void read(); }, 4000);
    void read();
    return () => { active = false; clearInterval(timer); };
  }, [jobId]);
  async function check() {
    setBusy(true); setError(""); setPreview(null); setConfirmed(false);
    try { setPreview(await action<Preview>("/api/updates/preview", {})); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="tile">
    <h3>StackPilot aktualisieren</h3>
    <p>Prüft GitHub auf eine neue Version, installiert sie und startet StackPilot kurz neu. Mediencontainer laufen weiter und werden nicht aktualisiert.</p>
    <button disabled={busy || (!!jobId && !terminal(job?.state || ""))} onClick={() => void check()}>{busy ? "Wird geprüft …" : "Neue Version prüfen"}</button>
    {error && <Problem message={error} />}
    {preview && <>
      <p>Installiert: {preview.currentVersion || "Nicht bestätigt"} · Ziel: {preview.nextVersion || "Nicht bestätigt"}</p>
      {preview.current && !preview.blockers.length && <p role="status">Der Quellstand ist bereits aktuell.</p>}
      {!!preview.blockers.length && <ul>{preview.blockers.map((item) => <li key={item}>{item}</li>)}</ul>}
      {preview.ready && !confirmed && <button className="primary" disabled={busy} onClick={() => setConfirmed(true)}>Version {preview.nextVersion} installieren …</button>}
      {preview.ready && confirmed && <div className="notice update-confirm" role="dialog" aria-label="Update bestätigen">
        <p><b>StackPilot auf {preview.nextVersion} aktualisieren?</b> StackPilot startet dabei kurz neu, Mediencontainer laufen weiter.</p>
        <div className="service-update-actions">
          <button className="primary" disabled={busy} onClick={async () => {
            setBusy(true); setError("");
            try {
              const value = await action<Job>("/api/updates/start", { confirmation: "OK", review: preview.review });
              setJob(value); setJobId(value.id); setPreview(null);
            } catch (e) { setError((e as Error).message); }
            finally { setBusy(false); setConfirmed(false); }
          }}>{busy ? "Wird gestartet …" : "OK"}</button>
          <button disabled={busy} onClick={() => setConfirmed(false)}>Abbrechen</button>
        </div>
      </div>}
    </>}
    {jobId && <div className="notice" role="status">
      <b>{job?.phase || "Updateauftrag wird gelesen …"}</b>
      {job?.message && <p>{job.message}</p>}
      {waiting && <p>Der Auftrag ist gerade nicht erreichbar. Ein Neustart kann die Verbindung kurz unterbrechen; die Anzeige prüft weiter. Ein Erfolg ist damit noch nicht bestätigt.</p>}
      <p>Der unabhängige Wartungsauftrag läuft bei einem Ansichtswechsel weiter.</p>
      <button onClick={() => { setJobId(""); setJob(null); setWaiting(false); }}>Nur Anzeige schließen</button>
    </div>}
  </div>;
}
