import { useCallback, useEffect, useState } from "react";
import { get } from "./ServerCheck";
import { action } from "./RetirementPanel";
import { ConfirmBar, StatusBadge, useAction } from "./ui";

type Issue = { id: string; service: string; kind: string; title: string; release: string; cause: string; hint: string; messages: string[]; progress: number | null; size: number | null };
type Issues = { issues: Issue[]; total: number; unavailable: string[] };

/**
 * Downloads → Braucht Aufmerksamkeit (Phase 7.2a): hängende oder blockierte Downloads aus
 * Radarr/Sonarr mit Ursache und geführter Aktion.
 */
export function DownloadIssues({ vpnConnected, onChange }: { vpnConnected: boolean; onChange: () => unknown }) {
  const [data, setData] = useState<Issues | null>(null),
    [replace, setReplace] = useState<Issue | null>(null);
  const { busy, error, notice, setError, run } = useAction();
  const load = useCallback(async () => {
    try {
      setData(await get<Issues>("/api/downloads/issues"));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [setError]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => { if (document.visibilityState !== "hidden") void load(); }, 60000);
    return () => clearInterval(timer);
  }, [load]);

  if (!data?.issues.length && !data?.unavailable.length && !error && !notice) return null;
  return (
    <section className="download-issues tile" aria-label="Braucht Aufmerksamkeit">
      <div className="download-issues-head">
        <h3>Braucht Aufmerksamkeit{data ? ` (${data.total})` : ""}</h3>
        {!!data?.issues.length && (
          <button disabled={!!busy} onClick={() => void run("retry", async () => {
            const r = await action<{ message: string }>("/api/downloads/issues/retry", {});
            setTimeout(() => void load(), 15000);
            return r.message;
          })}>{busy === "retry" ? "Wird angestoßen …" : "Import erneut prüfen"}</button>
        )}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="success" role="status">{notice}</p>}
      {!!data?.unavailable.length && <p className="notice">Nicht erreichbar: {data.unavailable.join(", ")}. Probleme dort sind hier nicht zu sehen.</p>}
      <ul className="download-issue-list">
        {data?.issues.map((i) => (
          <li key={i.id}>
            <div className="download-issue-title">
              <b>{i.title}</b>
              <StatusBadge tone="warning">{i.cause}</StatusBadge>
              <span className="muted">{i.service}{i.progress !== null ? ` · ${Math.round(i.progress * 100)} %` : ""}</span>
            </div>
            <p className="muted">{i.hint}</p>
            {!!i.messages.length && (
              <details>
                <summary>Meldungen von {i.service}</summary>
                <p className="muted download-issue-release">{i.release}</p>
                <ul>{i.messages.map((m, n) => <li key={n}>{m}</li>)}</ul>
              </details>
            )}
            {replace?.id !== i.id ? (
              <button disabled={!!busy || !vpnConnected} title={vpnConnected ? undefined : "Nur mit verbundenem VPN"}
                onClick={() => setReplace(i)}>Anderen Treffer suchen</button>
            ) : (
              <ConfirmBar label="Anderen Treffer suchen" busy={busy === "replace"} busyLabel="Wird ersetzt …"
                onCancel={() => setReplace(null)}
                onOk={() => run("replace", async () => {
                  const r = await action<{ message: string }>("/api/downloads/issues/replace", { id: i.id, confirmation: "OK" });
                  setReplace(null);
                  await load();
                  await onChange();
                  return r.message;
                })}>
                <p>
                  Diesen Download entfernen und einen anderen Treffer suchen? {i.service} sperrt den bisherigen Treffer und
                  sucht automatisch Ersatz. Die Dateien dieses Downloads werden gelöscht; schon in die Bibliothek übernommene
                  Dateien bleiben.
                </p>
              </ConfirmBar>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
