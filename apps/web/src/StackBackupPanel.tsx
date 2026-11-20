import { useCallback, useEffect, useState } from "react";
import { get } from "./ServerCheck";
import { action } from "./RetirementPanel";
import { ConfirmBar, StatusBadge, useAction } from "./ui";
import { formatBytes } from "../../../packages/domain/format.js";

type Last = { at: string; ok: boolean; verified?: boolean; size?: number; entries?: number; durationSeconds?: number; skipped?: string[]; skippedCount?: number; error?: string; scheduled?: boolean; file?: string };
type Status = {
  configured: boolean; target: string | null; suggestedTarget: string; schedule: string | null; nextRun: string | null; keep: number;
  running: { startedAt: string; step: string } | null; last: Last | null; resumeRequired: boolean;
  archives: { name: string; size: number; createdAt: string }[];
};
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("de-AT", { dateStyle: "short", timeStyle: "short" }) : "–");

/** Gesamtsicherung (Phase 7.5): verschlüsseltes Archiv aller App-Einstellungen und Datenbanken. */
export function StackBackupPanel() {
  const [data, setData] = useState<Status | null>(null),
    [target, setTarget] = useState(""),
    [confirm, setConfirm] = useState<"setup" | "run" | "resume" | null>(null),
    [passphrase, setPassphrase] = useState<string | null>(null),
    [changeTarget, setChangeTarget] = useState(false);
  const { busy, error, notice, setError, run } = useAction();
  const load = useCallback(async () => {
    try { const s = await get<Status>("/api/stack-backup"); setData(s); return s; } catch (e) { setError((e as Error).message); return null; }
  }, [setError]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!data?.running) return;
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [data?.running, load]);
  if (!data) return error ? <p className="error" role="alert">{error}</p> : <p className="muted">Wird geladen …</p>;

  const setupForm = (
    <form className="stack-backup-setup" onSubmit={(e) => { e.preventDefault(); setConfirm("setup"); }}>
      <label>Sicherungsordner am Server
        <input value={target} placeholder={data.suggestedTarget} onChange={(e) => { setTarget(e.target.value); setConfirm(null); }} disabled={!!busy} />
      </label>
      <p className="muted">Am besten eine andere Platte oder später das NAS. Leer lassen für {data.suggestedTarget}.</p>
      {confirm !== "setup" && <button className="primary" disabled={!!busy}>{data.configured ? "Ordner ändern" : "Einrichten"}</button>}
      {confirm === "setup" && (
        <ConfirmBar label="Gesamtsicherung einrichten" busy={busy === "setup"} busyLabel="Wird geprüft …" onCancel={() => setConfirm(null)}
          onOk={() => run("setup", async () => {
            const r = await action<{ target: string; passphrase: string | null }>("/api/stack-backup/setup", { target: target.trim() || undefined, confirmation: "OK" });
            setConfirm(null); setChangeTarget(false); setTarget("");
            if (r.passphrase) setPassphrase(r.passphrase);
            await load();
            return `Sicherungsordner: ${r.target}`;
          })}>
          <p>Sicherungen kommen nach <b>{target.trim() || data.suggestedTarget}</b>. Wöchentlich sonntags um 03:30, die letzten {data.keep} bleiben.{!data.configured && " Danach siehst du einmal das Sicherungspasswort."}</p>
        </ConfirmBar>
      )}
    </form>
  );

  return (
    <div className="tile stack-backup">
      <p>
        Ein verschlüsseltes Archiv aller App-Einstellungen, Datenbanken und von StackPilot selbst – ohne Filme, Serien
        und Musik. Damit lässt sich der Stack nach einem Plattenausfall oder einer Neuinstallation wiederherstellen.
        Während der Sicherung stehen die Apps ein paar Minuten still.
      </p>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="success" role="status">{notice}</p>}
      {passphrase && (
        <div className="remote-setup-invitation" role="status">
          <b>Sicherungspasswort – wird nur jetzt angezeigt.</b>
          <p>Ohne dieses Passwort lässt sich keine Sicherung wiederherstellen. Bewahre es außerhalb des Servers auf (z. B. im Passwortmanager).</p>
          <p><code className="stack-backup-pass">{passphrase}</code></p>
          <button onClick={() => void navigator.clipboard?.writeText(passphrase)}>Kopieren</button>
          <button onClick={() => setPassphrase(null)}>Notiert – ausblenden</button>
        </div>
      )}
      {data.resumeRequired && (
        <div className="notice">
          <p><b>Eine Sicherung wurde unterbrochen.</b> Apps sind womöglich noch angehalten.</p>
          {confirm !== "resume" ? <button className="primary" disabled={!!busy} onClick={() => setConfirm("resume")}>Apps wieder starten</button> : (
            <ConfirmBar label="Apps wieder starten" busy={busy === "resume"} onCancel={() => setConfirm(null)}
              onOk={() => run("resume", async () => { const r = await action<{ started: number }>("/api/stack-backup/resume", { confirmation: "OK" }); setConfirm(null); await load(); return `${r.started} Apps gestartet.`; })}>
              <p>Die Apps, die die unterbrochene Sicherung angehalten hat, wieder starten?</p>
            </ConfirmBar>
          )}
        </div>
      )}
      {!data.configured ? setupForm : (
        <>
          <p>
            <StatusBadge tone={data.last?.ok ? "success" : data.last ? "danger" : "warning"}>
              {data.running ? "Läuft" : data.last?.ok ? "Letzte Sicherung in Ordnung" : data.last ? "Letzte Sicherung fehlgeschlagen" : "Noch keine Sicherung"}
            </StatusBadge>{" "}
            <span className="muted">Ordner {data.target} · {data.schedule} · nächste {when(data.nextRun)}</span>
          </p>
          {data.running && <p role="status">Sicherung läuft seit {when(data.running.startedAt)}: {data.running.step} …</p>}
          {data.last && !data.running && (
            data.last.ok ? (
              <p className="muted">
                {when(data.last.at)}{data.last.scheduled ? " (automatisch)" : ""}: {formatBytes(data.last.size || 0)}, {data.last.entries} Dateien,
                {" "}{data.last.durationSeconds} s{data.last.verified ? " · Archiv geprüft" : ""}
                {data.last.skippedCount ? ` · ${data.last.skippedCount} Links/Sockets übersprungen (${(data.last.skipped || []).slice(0, 3).join(", ")}${(data.last.skippedCount || 0) > 3 ? " …" : ""})` : ""}
              </p>
            ) : <p className="error">{when(data.last.at)}: {data.last.error}</p>
          )}
          <div className="couchdeck-actions">
            {confirm !== "run" && <button className="primary" disabled={!!busy || !!data.running} onClick={() => setConfirm("run")}>Jetzt sichern</button>}
            <button disabled={!!busy} onClick={() => setChangeTarget(!changeTarget)}>Ordner ändern</button>
          </div>
          {confirm === "run" && (
            <ConfirmBar label="Jetzt sichern" busy={busy === "run"} busyLabel="Wird gestartet …" onCancel={() => setConfirm(null)}
              onOk={() => run("run", async () => { await action("/api/stack-backup/run", { confirmation: "OK" }); setConfirm(null); await load(); return "Sicherung gestartet."; })}>
              <p>Jetzt sichern? Alle Apps (Jellyfin, Seerr, Downloads …) stehen dafür ein paar Minuten still und starten danach von selbst wieder.</p>
            </ConfirmBar>
          )}
          {changeTarget && setupForm}
          {!!data.archives.length && (
            <ul className="stack-backup-list">
              {data.archives.map((a) => (
                <li key={a.name}>
                  <span>{when(a.createdAt)} · {formatBytes(a.size)}</span>
                  <a className="button" href={`/api/stack-backup/download?name=${encodeURIComponent(a.name)}`} download>Herunterladen</a>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
