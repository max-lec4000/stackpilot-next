import { useCallback, useEffect, useState } from "react";
import { get } from "./ServerCheck";
import { action } from "./RetirementPanel";
import { ConfirmBar, StatusBadge, useAction, useConfirm } from "./ui";
import { formatBytes } from "../../../packages/domain/format.js";

type Last = { at: string; archive: string; ok: boolean; rolledBack?: boolean; error?: string; warning?: string; apps?: string[]; previous?: string; durationSeconds?: number };
type Status = { running: { startedAt: string; step: string; archive: string } | null; last: Last | null; previous: { name: string; createdAt: string }[]; recoveryRequired: boolean };
type Check = { name: string; createdAt: string | null; entries: number; totalBytes: number; sameStack: boolean; apps: string[]; kept: string[]; skippedCount: number };
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("de-AT", { dateStyle: "short", timeStyle: "short" }) : "–");

/** Gesamtsicherung → Wiederherstellen per Knopf (Phase 7 Paket 7.5). */
export function StackRestorePanel() {
  const [data, setData] = useState<Status | null>(null), [archives, setArchives] = useState<{ name: string; createdAt: string }[]>([]),
    [chosen, setChosen] = useState(""), [check, setCheck] = useState<Check | null>(null), [phrase, setPhrase] = useState(""), [confirm, setConfirm] = useState(false);
  const { busy, error, notice, setError, run } = useAction();
  const { ask, dialog } = useConfirm();
  const load = useCallback(async () => {
    try {
      const [s, b] = await Promise.all([get<Status>("/api/stack-restore"), get<{ archives: { name: string; createdAt: string }[] }>("/api/stack-backup")]);
      setData(s); setArchives(b.archives || []);
    } catch (e) { setError((e as Error).message); }
  }, [setError]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!data?.running) return;
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [data?.running, load]);
  if (!data) return error ? <p className="error" role="alert">{error}</p> : null;
  return (
    <section className="stack-restore" aria-label="Wiederherstellen">
      <h3>Wiederherstellen</h3>
      <p className="muted">
        Spielt die Einstellungen und Datenbanken der Apps aus einer Sicherung auf diesen Server zurück – etwa nach einer
        verkorksten Änderung. Filme und Serien bleiben unberührt, ebenso die StackPilot-Anmeldungen und die Wiedergabe-Statistik.
        Der bisherige Stand wird aufgehoben; startet danach eine App nicht richtig, kehrt StackPilot automatisch zurück.
      </p>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="success" role="status">{notice}</p>}
      {dialog}
      {data.recoveryRequired && (
        <div className="notice">
          <p><b>Eine Wiederherstellung wurde unterbrochen.</b> „Zurückrollen“ hält die Apps kurz an und stellt den vorherigen Stand her.</p>
          <button className="primary" disabled={!!busy} onClick={async () => {
            if (await ask("Apps kurz anhalten und den Stand vor der Wiederherstellung zurückholen?", "Zurückrollen"))
              await run("recover", async () => { const r = await action<{ message: string }>("/api/stack-restore/recover", { confirmation: "OK" }); await load(); return r.message; });
          }}>{busy === "recover" ? "Wird zurückgerollt …" : "Zurückrollen"}</button>
        </div>
      )}
      {data.running ? (
        <p><StatusBadge tone="info">läuft</StatusBadge> {data.running.step} … <span className="muted">({data.running.archive}; die Apps sind dabei einige Minuten nicht erreichbar)</span></p>
      ) : (
        <>
          {data.last && (
            <p>
              Zuletzt {when(data.last.at)}: {data.last.ok
                ? <><StatusBadge tone="success">zurückgespielt</StatusBadge> <span className="muted">{data.last.archive} · {data.last.apps?.join(", ")}</span>
                  {data.last.warning && <><br /><span className="warning">Hinweis: {data.last.warning}</span></>}</>
                : <><StatusBadge tone={data.last.rolledBack ? "warning" : "danger"}>{data.last.rolledBack ? "zurückgekehrt" : "nicht durchgeführt"}</StatusBadge> <span className="muted">{data.last.error}</span></>}
            </p>
          )}
          {!archives.length ? <p className="muted">Noch keine Sicherung im Sicherungsordner.</p> : (
            <div className="person-field">
              <label>Sicherung{" "}
                <select value={chosen} disabled={!!busy} onChange={(e) => { setChosen(e.target.value); setCheck(null); setConfirm(false); setPhrase(""); }}>
                  <option value="">– wählen –</option>
                  {archives.map((a) => <option key={a.name} value={a.name}>{when(a.createdAt)} · {a.name}</option>)}
                </select>
              </label>
              <button disabled={!!busy || !chosen} onClick={() => void run("check", async () => {
                setCheck(await action<Check>("/api/stack-restore/check", { name: chosen }));
              })}>{busy === "check" ? "Wird geprüft …" : "Prüfen"}</button>
            </div>
          )}
          {check && (
            <div className="tile">
              <p>
                {check.sameStack ? <StatusBadge tone="success">vollständig lesbar</StatusBadge> : <StatusBadge tone="danger">anderer Stack</StatusBadge>}{" "}
                Gesichert {when(check.createdAt)} · {formatBytes(check.totalBytes)} in {check.entries} Dateien
              </p>
              <p>Zurück kommen: <b>{check.apps.join(", ")}</b></p>
              <p className="muted">Bleibt auf aktuellem Stand: {check.kept.join(", ")}.{check.skippedCount ? ` ${check.skippedCount} Links/Sockets waren nicht in der Sicherung.` : ""}</p>
              {check.sameStack && !confirm && <button className="primary" disabled={!!busy} onClick={() => setConfirm(true)}>Wiederherstellen …</button>}
              {confirm && (
                <ConfirmBar label="Wiederherstellen" busy={busy === "restore"} busyLabel="Wird gestartet …" onCancel={() => { setConfirm(false); setPhrase(""); }}
                  onOk={() => run("restore", async () => {
                    await action("/api/stack-restore/start", { name: check.name, phrase, confirmation: "OK" });
                    setConfirm(false); setCheck(null); setPhrase(""); await load();
                    return "Wiederherstellung läuft. Die Apps sind einige Minuten nicht erreichbar.";
                  })}>
                  <p>
                    Alle Apps werden angehalten, ihre Einstellungen und Datenbanken durch den Stand vom {when(check.createdAt)} ersetzt
                    und wieder gestartet. Änderungen seitdem (neue Anfragen, Downloads-Verlauf, Einstellungen) gehen in den Apps verloren;
                    der jetzige Stand bleibt als Kopie liegen.
                  </p>
                  <label>Zur Sicherheit <b>WIEDERHERSTELLEN</b> eintippen{" "}
                    <input value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="off" aria-label="Bestätigungswort" />
                  </label>
                </ConfirmBar>
              )}
            </div>
          )}
        </>
      )}
      {!!data.previous.length && (
        <ul className="storage-list">
          {data.previous.map((p) => (
            <li key={p.name}>
              Stand vor der Wiederherstellung vom {when(p.createdAt)} <span className="muted">· {p.name}</span>{" "}
              <button disabled={!!busy || !!data.running} onClick={async () => {
                if (await ask("Den aufgehobenen Stand endgültig löschen? Danach gibt es keinen Weg zurück außer einer Sicherung.", "Stand löschen", "Löschen"))
                  await run("prev", async () => { const r = await action<{ message: string }>("/api/stack-restore/previous/remove", { name: p.name, confirmation: "OK" }); await load(); return r.message; });
              }}>Löschen …</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
