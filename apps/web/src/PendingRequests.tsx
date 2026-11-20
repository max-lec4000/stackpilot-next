import { useCallback, useEffect, useState } from "react";
import { get } from "./ServerCheck";
import { action } from "./RetirementPanel";
import { ConfirmBar, useAction } from "./ui";

type Pending = { id: number; type: string; title: string; seasons: number[]; createdAt: string; requestedBy: string | null };
type BatchResult = { results: { requestId: number; ok: boolean; error?: string }[]; done: number; failed: number };

const BATCH = 25;

/**
 * Anfragen, die auf eine Freigabe warten (Phase 7.1b): auswählen und gesammelt freigeben oder
 * ablehnen. Eine Begründung beim Ablehnen speichert StackPilot im eigenen Verlauf.
 */
export function PendingRequests({ onChange, reloadKey = 0 }: { onChange: () => unknown; reloadKey?: number }) {
  const [items, setItems] = useState<Pending[] | null>(null),
    [total, setTotal] = useState(0),
    [selected, setSelected] = useState<number[]>([]),
    [mode, setMode] = useState<"approve" | "decline" | null>(null),
    [reason, setReason] = useState(""),
    [outcome, setOutcome] = useState<{ text: string; failed: { title: string; error: string }[] } | null>(null);
  const { busy, error, setError, run } = useAction();
  const load = useCallback(async () => {
    try {
      const data = await get<{ results: Pending[]; total: number }>("/api/media/requests/pending");
      setItems(data.results);
      setTotal(data.total);
      setSelected((sel) => sel.filter((id) => data.results.some((r) => r.id === id)));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [setError]);
  // Neu laden, wenn die Anfragenliste neu geladen wurde (z. B. nach einer Ablehnung in den Details)
  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  if (!items?.length && !error && !outcome) return null;
  const chosen = items?.filter((r) => selected.includes(r.id)) || [];
  const allChosen = !!items?.length && chosen.length === Math.min(items.length, BATCH);
  const toggle = (id: number) =>
    setSelected((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : sel.length < BATCH ? [...sel, id] : sel));
  const submit = (act: "approve" | "decline") =>
    run(act, async () => {
      const result = await action<BatchResult>("/api/media/request/batch", {
        action: act, requestIds: chosen.map((r) => r.id), confirmation: "OK", ...(act === "decline" && reason.trim() ? { reason: reason.trim() } : {}),
      });
      const verb = act === "approve" ? "freigegeben" : "abgelehnt";
      setOutcome({
        text: `${result.done} ${result.done === 1 ? "Anfrage" : "Anfragen"} ${verb}.` + (result.failed ? ` ${result.failed} nicht:` : ""),
        failed: result.results.filter((r) => !r.ok).map((r) => ({
          title: items?.find((i) => i.id === r.requestId)?.title || `Anfrage ${r.requestId}`, error: r.error || "",
        })),
      });
      setMode(null);
      setReason("");
      setSelected([]);
      await load();
      await onChange();
      return "";
    });

  return (
    <section className="pending-requests tile" aria-label="Wartet auf deine Freigabe">
      <h3>Wartet auf deine Freigabe ({total})</h3>
      {error && <p className="error" role="alert">{error}</p>}
      {outcome && (
        <div role="status" className={outcome.failed.length ? "notice" : "success"}>
          <p>{outcome.text}</p>
          {!!outcome.failed.length && <ul>{outcome.failed.map((f, i) => <li key={i}><b>{f.title}</b> – {f.error}</li>)}</ul>}
        </div>
      )}
      {!!items?.length && (
        <>
          <label className="pending-all">
            <input type="checkbox" checked={allChosen} disabled={!!busy}
              onChange={() => setSelected(allChosen ? [] : items.slice(0, BATCH).map((r) => r.id))} />
            Alle auswählen{items.length > BATCH ? ` (die ersten ${BATCH})` : ""}
          </label>
          <ul className="pending-list">
            {items.map((r) => (
              <li key={r.id}>
                <label>
                  <input type="checkbox" checked={selected.includes(r.id)} disabled={!!busy}
                    onChange={() => toggle(r.id)} aria-label={`${r.title} auswählen`} />
                  <span className="pending-title"><b>{r.title}</b></span>
                  <span className="muted">
                    {r.type === "movie" ? "Film" : "Serie"}
                    {r.seasons.length ? " · Staffel " + r.seasons.join(", ") : ""}
                    {r.requestedBy ? " · von " + r.requestedBy : ""}
                    {" · " + new Date(r.createdAt).toLocaleDateString("de-AT")}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {!mode && (
            <div className="couchdeck-actions">
              <button className="primary" disabled={!!busy || !chosen.length} onClick={() => { setOutcome(null); setMode("approve"); }}>
                Freigeben{chosen.length ? ` (${chosen.length})` : ""}
              </button>
              <button className="danger" disabled={!!busy || !chosen.length} onClick={() => { setOutcome(null); setMode("decline"); }}>
                Ablehnen{chosen.length ? ` (${chosen.length})` : ""}
              </button>
            </div>
          )}
          {mode === "approve" && (
            <ConfirmBar label="Anfragen freigeben" busy={busy === "approve"} busyLabel="Wird freigegeben …"
              onCancel={() => setMode(null)} onOk={() => submit("approve")}>
              <p>
                {chosen.length === 1 ? <>„{chosen[0].title}“</> : <>{chosen.length} Anfragen</>} freigeben? Danach sucht
                StackPilot nach passenden Downloads (mit deinen Größenregeln).
              </p>
            </ConfirmBar>
          )}
          {mode === "decline" && (
            <ConfirmBar label="Anfragen ablehnen" busy={busy === "decline"} busyLabel="Wird abgelehnt …" okLabel="Ablehnen"
              onCancel={() => setMode(null)} onOk={() => submit("decline")}>
              <p>{chosen.length === 1 ? <>„{chosen[0].title}“</> : <>{chosen.length} Anfragen</>} ablehnen?</p>
              <label className="pending-reason">
                Begründung (freiwillig, nur in StackPilot sichtbar – Seerr speichert keine)
                <input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="z. B. gibt es schon auf DVD" />
              </label>
            </ConfirmBar>
          )}
        </>
      )}
    </section>
  );
}
