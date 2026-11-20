import { useCallback, useEffect, useState } from "react";
import { get } from "./ServerCheck";
import { action } from "./RetirementPanel";
import { ConfirmBar, StatusBadge, useAction } from "./ui";

type Issue = { id: string; service: string; kind: string; title: string; release: string; cause: string; hint: string; messages: string[]; progress: number | null; size: number | null; importable?: boolean };
type ImportFile = { token: string; name: string; size: number | null; quality: string | null; rejections: string[]; suggestedEpisodeIds: number[]; suggestion: string | null };
type Preview = { kind: string; title: string; files: ImportFile[]; episodes: { id: number; label: string; hasFile: boolean }[] | null };
const gb = (n: number | null) => (n ? `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)} GB` : "");

/** Dateien eines fertigen Downloads von Hand dem Film bzw. den Folgen zuordnen (Phase 7 Paket 7.2). */
function ManualImport({ issue, onDone, onCancel }: { issue: Issue; onDone: (message: string) => unknown; onCancel: () => void }) {
  const [preview, setPreview] = useState<Preview | null>(null),
    [pick, setPick] = useState<Record<string, number[] | true>>({}),
    [confirm, setConfirm] = useState(false);
  const { busy, error, setError, run } = useAction();
  useEffect(() => {
    get<Preview>("/api/downloads/issues/import?id=" + issue.id).then((p) => {
      setPreview(p);
      // Vorauswahl: Dateien ohne Ablehnung bzw. mit erkannter Folge
      const initial: Record<string, number[] | true> = {};
      for (const f of p.files)
        if (p.kind === "movie" ? !f.rejections.length || p.files.length === 1 : f.suggestedEpisodeIds.length) initial[f.token] = p.kind === "movie" ? true : f.suggestedEpisodeIds;
      setPick(initial);
    }, (e) => setError((e as Error).message));
  }, [issue.id, setError]);
  const chosen = Object.entries(pick);
  const complete = chosen.length > 0 && chosen.every(([, v]) => v === true || v.length > 0);
  return (
    <div className="manual-import">
      <h4>Dateien zuordnen</h4>
      {error && <p className="error" role="alert">{error}</p>}
      {!preview && !error && <p className="muted">Dateien werden gelesen …</p>}
      {preview && !preview.files.length && <p className="muted">Im Download liegen keine Dateien, die {issue.service} übernehmen könnte.</p>}
      {preview && !!preview.files.length && (
        <ul className="manual-import-files">
          {preview.files.map((f) => {
            const on = f.token in pick;
            return (
              <li key={f.token}>
                <label>
                  <input type="checkbox" checked={on} disabled={!!busy}
                    onChange={(e) => setPick((p) => {
                      const n = { ...p };
                      if (e.target.checked) n[f.token] = preview.kind === "movie" ? true : f.suggestedEpisodeIds; else delete n[f.token];
                      return n;
                    })} />{" "}
                  <b>{f.name}</b> <span className="muted">{[gb(f.size), f.quality].filter(Boolean).join(" · ")}</span>
                </label>
                {!!f.rejections.length && <p className="muted">{issue.service} meldet: {f.rejections.join("; ")}</p>}
                {on && preview.episodes && (
                  <label className="person-field">Folge{" "}
                    <select value={(pick[f.token] as number[])[0] ?? ""} disabled={!!busy}
                      onChange={(e) => setPick((p) => ({ ...p, [f.token]: e.target.value ? [Number(e.target.value)] : [] }))}>
                      <option value="">– Folge wählen –</option>
                      {preview.episodes.map((ep) => <option key={ep.id} value={ep.id}>{ep.label}{ep.hasFile ? " (vorhanden)" : ""}</option>)}
                    </select>
                    {(pick[f.token] as number[]).length > 1 && <span className="muted"> + {(pick[f.token] as number[]).length - 1} weitere erkannte Folgen</span>}
                  </label>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!confirm ? (
        <span className="couchdeck-actions">
          {preview && !!preview.files.length && <button disabled={!!busy || !complete} onClick={() => setConfirm(true)}>Importieren …</button>}
          <button disabled={!!busy} onClick={onCancel}>Abbrechen</button>
        </span>
      ) : (
        <ConfirmBar label="Importieren" busy={busy === "import"} busyLabel="Wird importiert …" onCancel={() => setConfirm(false)}
          onOk={() => run("import", async () => {
            const files = chosen.map(([token, v]) => (v === true ? { token } : { token, episodeIds: v }));
            const r = await action<{ message: string }>("/api/downloads/issues/import", { id: issue.id, files, confirmation: "OK" });
            await onDone(r.message);
            return r.message;
          })}>
          <p>
            {chosen.length} {chosen.length === 1 ? "Datei" : "Dateien"} als „{preview?.title}“ in die Bibliothek übernehmen? {issue.service} ordnet
            sie zu, benennt sie um und meldet sie an Jellyfin. Eine schlechtere vorhandene Datei wird dabei ersetzt.
          </p>
        </ConfirmBar>
      )}
    </div>
  );
}
type Issues = { issues: Issue[]; total: number; unavailable: string[] };

/**
 * Downloads → Braucht Aufmerksamkeit (Phase 7.2a): hängende oder blockierte Downloads aus
 * Radarr/Sonarr mit Ursache und geführter Aktion.
 */
export function DownloadIssues({ vpnConnected, onChange }: { vpnConnected: boolean; onChange: () => unknown }) {
  const [data, setData] = useState<Issues | null>(null),
    [replace, setReplace] = useState<Issue | null>(null),
    [importing, setImporting] = useState<string | null>(null);
  const { busy, error, notice, setError, setNotice, run } = useAction();
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
            {importing === i.id && (
              <ManualImport issue={i} onCancel={() => setImporting(null)} onDone={async (message) => {
                setImporting(null);
                setNotice(message);
                await load();
                await onChange();
              }} />
            )}
            {importing === i.id ? null : replace?.id !== i.id ? (
              <span className="couchdeck-actions">
                {i.importable && <button disabled={!!busy} onClick={() => { setReplace(null); setImporting(i.id); }}>Dateien zuordnen …</button>}
                <button disabled={!!busy || !vpnConnected} title={vpnConnected ? undefined : "Nur mit verbundenem VPN"}
                  onClick={() => setReplace(i)}>Anderen Treffer suchen</button>
              </span>
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
