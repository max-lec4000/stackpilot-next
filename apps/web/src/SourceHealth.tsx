import { useCallback, useEffect, useState } from "react";
import { get } from "./ServerCheck";
import { action } from "./RetirementPanel";
import { StatusBadge, useAction, type StatusTone } from "./ui";

type Source = { id: number; name: string; enabled: boolean; state: "ok" | "failing" | "blocked" | "off"; disabledTill: string | null; lastFailure: string | null; queries: number | null; grabs: number | null; failedQueries: number | null; averageMs: number | null };
type Health = {
  checkedAt: string; sources: Source[]; warnings: string[];
  arr: { name: string; connected: boolean; indexers: number | null; problems: string[] }[];
  summary: { ok: number; failing: number; blocked: number; off: number };
};
type TestResult = { results: { id: number; name: string; ok: boolean; message: string | null }[] };

const stateLabel: Record<Source["state"], [string, StatusTone]> = {
  ok: ["In Ordnung", "success"], failing: ["Zuletzt Fehler", "warning"], blocked: ["Zeitweise gesperrt", "danger"], off: ["Ausgeschaltet", "neutral"],
};
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("de-AT", { dateStyle: "short", timeStyle: "short" }) : "");

/** Qualität & Quellen → Zustand der Quellen (Phase 7.3b). */
export function SourceHealth() {
  const [data, setData] = useState<Health | null>(null), [tests, setTests] = useState<TestResult | null>(null);
  const { busy, error, notice, setError, run } = useAction();
  const load = useCallback(async () => {
    try { setData(await get<Health>("/api/sources/health")); } catch (e) { setError((e as Error).message); }
  }, [setError]);
  useEffect(() => { void load(); }, [load]);
  if (!data) return error ? <p className="error" role="alert">{error}</p> : <p className="muted">Zustand wird geladen …</p>;
  const { summary } = data;
  const problems = summary.failing + summary.blocked + data.arr.filter((a) => !a.connected || a.problems.length || a.indexers === 0).length;
  return (
    <section className="tile source-health" aria-label="Zustand der Quellen">
      <div className="source-health-head">
        <h3>Zustand der Quellen</h3>
        <StatusBadge tone={problems ? "warning" : "success"}>
          {data.sources.length ? `${summary.ok} in Ordnung${summary.failing ? ` · ${summary.failing} mit Fehlern` : ""}${summary.blocked ? ` · ${summary.blocked} gesperrt` : ""}${summary.off ? ` · ${summary.off} aus` : ""}` : "Keine Quellen"}
        </StatusBadge>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="success" role="status">{notice}</p>}
      {!!data.warnings.length && <ul className="source-health-warnings">{data.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
      {!!data.sources.length && (
        <ul className="source-health-list">
          {data.sources.map((s) => {
            const t = tests?.results.find((r) => r.id === s.id);
            return (
              <li key={s.id}>
                <b>{s.name}</b> <StatusBadge tone={stateLabel[s.state][1]}>{stateLabel[s.state][0]}</StatusBadge>
                <span className="muted">
                  {s.state === "blocked" && s.disabledTill ? ` bis ${when(s.disabledTill)}` : ""}
                  {s.lastFailure && s.state !== "ok" ? ` · letzter Fehler ${when(s.lastFailure)}` : ""}
                  {s.queries !== null ? ` · ${s.queries} Suchen` : ""}{s.grabs !== null ? `, ${s.grabs} Treffer genommen` : ""}
                  {s.failedQueries ? `, ${s.failedQueries} fehlgeschlagen` : ""}{s.averageMs !== null ? ` · ⌀ ${s.averageMs} ms` : ""}
                </span>
                {t && <span className={t.ok ? "success" : "error"}> {t.ok ? "Test bestanden" : `Test fehlgeschlagen${t.message ? `: ${t.message}` : ""}`}</span>}
                {(s.state === "failing" || s.state === "blocked" || (t && !t.ok)) && (
                  <button className="source-renew" disabled={!!busy} title="Zugangsdaten (Passwort, API-Schlüssel, Cookie) neu eingeben und testen"
                    onClick={() => window.dispatchEvent(new CustomEvent("stackpilot:edit-source", { detail: s.id }))}>Zugang erneuern</button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <ul className="source-health-apps">
        {data.arr.map((a) => (
          <li key={a.name}>
            <b>{a.name}</b>{" "}
            {!a.connected ? <span className="warning">nicht mit Prowlarr verbunden</span>
              : a.indexers === null ? <span className="muted">Anzahl unbekannt</span>
              : <span className={a.indexers ? "muted" : "warning"}>{a.indexers} {a.indexers === 1 ? "Quelle" : "Quellen"} angekommen</span>}
            {a.problems.map((p, i) => <span key={i} className="muted"> · {p}</span>)}
          </li>
        ))}
      </ul>
      <div className="couchdeck-actions">
        <button disabled={!!busy || !data.sources.some((s) => s.enabled)} onClick={() => void run("test", async () => {
          const r = await action<TestResult>("/api/sources/test-all", {});
          setTests(r); await load();
          const bad = r.results.filter((x) => !x.ok).length;
          return bad ? `${bad} von ${r.results.length} Quellen haben den Test nicht bestanden.` : `Alle ${r.results.length} Quellen bestanden.`;
        })}>{busy === "test" ? "Wird getestet …" : "Alle testen"}</button>
        <button disabled={!!busy || !data.arr.some((a) => a.connected)} onClick={() => void run("sync", async () => {
          const r = await action<{ message: string }>("/api/sources/sync", {});
          setTimeout(() => void load(), 8000);
          return r.message;
        })}>An Radarr/Sonarr übertragen</button>
        <span className="muted">Stand {when(data.checkedAt)}</span>
      </div>
    </section>
  );
}
