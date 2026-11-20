import { useCallback, useEffect, useState } from "react";
import { get } from "./ServerCheck";
import { action } from "./RetirementPanel";
import { ConfirmBar, StatusBadge, useAction } from "./ui";

type Result = { name: string; phase: string; error?: string };
type Status = { enabled: boolean; day: number | "daily"; hour: number; nextRun: string | null; running: boolean; pending: string[];
  last: { at: string; skipped?: string; results: Result[]; failed?: number; error?: string } | null; days: (number | "daily")[] };
const DAY = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const dayLabel = (d: number | "daily") => (d === "daily" ? "jede Nacht" : `jeden ${DAY[d]}`);
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("de-AT", { weekday: "short", dateStyle: "short", timeStyle: "short" }) : "–");

/** Container-Updates → Wartungsfenster (Phase 7 Paket 7.5). */
export function UpdateWindowPanel() {
  const [data, setData] = useState<Status | null>(null), [draft, setDraft] = useState<{ enabled: boolean; day: number | "daily"; hour: number } | null>(null),
    [confirm, setConfirm] = useState(false);
  const { busy, error, notice, setError, run } = useAction();
  const load = useCallback(async () => {
    try { setData(await get<Status>("/api/update-window")); } catch (e) { setError((e as Error).message); }
  }, [setError]);
  useEffect(() => { void load(); }, [load]);
  if (!data) return error ? <p className="error" role="alert">{error}</p> : null;
  const d = draft || { enabled: data.enabled, day: data.day, hour: data.hour };
  const changed = d.enabled !== data.enabled || d.day !== data.day || d.hour !== data.hour;
  return (
    <section className="update-window" aria-label="Wartungsfenster">
      <h3>Wartungsfenster</h3>
      <p className="muted">
        Bereitstehende App-Updates spielt StackPilot automatisch zur gewählten Zeit ein – mit Prüfung und Rückweg je App, nur
        wenn gerade nichts abgespielt wird und keine Sicherung läuft. Couchdeck bleibt beim Knopf.
      </p>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="success" role="status">{notice}</p>}
      <p>
        {data.enabled ? <StatusBadge tone="success">an</StatusBadge> : <StatusBadge tone="neutral">aus</StatusBadge>}{" "}
        {data.enabled ? `${dayLabel(data.day)} ${data.hour}–${data.hour + 1} Uhr · nächstes Fenster ${when(data.nextRun)}` : "Updates nur per Knopf."}
        {data.pending.length ? <span className="muted"> · bereit: {data.pending.join(", ")}</span> : <span className="muted"> · gerade keine Updates bereit</span>}
      </p>
      {data.last && (
        <p className="muted">
          Letztes Fenster {when(data.last.at)}: {data.last.skipped ? `übersprungen – ${data.last.skipped}`
            : data.last.error ? data.last.error
            : data.last.results.length ? data.last.results.map((r) => `${r.name} ${r.phase === "failed" ? "fehlgeschlagen" : "aktualisiert"}`).join(", ") : "nichts zu tun"}
        </p>
      )}
      <div className="couchdeck-actions">
        <label><input type="checkbox" checked={d.enabled} disabled={!!busy} onChange={(e) => { setDraft({ ...d, enabled: e.target.checked }); setConfirm(false); }} /> Automatisch einspielen</label>
        <select value={String(d.day)} disabled={!!busy || !d.enabled} aria-label="Tag" onChange={(e) => { setDraft({ ...d, day: e.target.value === "daily" ? "daily" : Number(e.target.value) }); setConfirm(false); }}>
          {data.days.map((x) => <option key={String(x)} value={String(x)}>{dayLabel(x)}</option>)}
        </select>
        <select value={d.hour} disabled={!!busy || !d.enabled} aria-label="Uhrzeit" onChange={(e) => { setDraft({ ...d, hour: Number(e.target.value) }); setConfirm(false); }}>
          {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h}:00–{h + 1}:00</option>)}
        </select>
        {changed && !confirm && <button className="primary" disabled={!!busy} onClick={() => setConfirm(true)}>Speichern …</button>}
      </div>
      {confirm && (
        <ConfirmBar label="Wartungsfenster speichern" busy={busy === "save"} busyLabel="Wird gespeichert …" onCancel={() => setConfirm(false)}
          onOk={() => run("save", async () => {
            await action("/api/update-window", { ...d, confirmation: "OK" });
            setConfirm(false); setDraft(null); await load();
            return d.enabled ? `Updates kommen ab jetzt ${dayLabel(d.day)} zwischen ${d.hour} und ${d.hour + 1} Uhr.` : "Automatische Updates sind aus.";
          })}>
          <p>{d.enabled
            ? `App-Updates ${dayLabel(d.day)} zwischen ${d.hour} und ${d.hour + 1} Uhr automatisch einspielen? Die betroffenen Apps sind dabei je ein paar Minuten nicht erreichbar.${d.day === 0 && d.hour === 3 ? " Hinweis: Sonntag 03:30 läuft die Gesamtsicherung – dann wird das Fenster eher übersprungen." : ""}`
            : "Automatische Updates ausschalten?"}</p>
        </ConfirmBar>
      )}
    </section>
  );
}
