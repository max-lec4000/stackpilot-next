import { useCallback, useEffect, useMemo, useState } from "react";
import { get } from "./ServerCheck";
import { action } from "./RetirementPanel";
import { Pagination, SectionHeading, StatusBadge, useAction, useConfirm } from "./ui";

type Season = { number: number; monitored: boolean; files: number; aired: number; total: number };
type Series = { id: number; title: string; year: number | null; monitored: boolean; newSeasons: boolean; ended: boolean; files: number; aired: number; total: number; missing: number; seasons: Season[] };
type Change = { monitored?: boolean; newSeasons?: boolean; seasons?: Record<string, boolean> };
const PAGE = 25;
const seasonName = (n: number) => (n === 0 ? "Specials" : `Staffel ${n}`);

function Toggle({ checked, disabled, label, text, onChange }: { checked: boolean; disabled: boolean; label: string; text: string; onChange: () => void }) {
  return (
    <label className={"switch" + (disabled ? " disabled" : "")}>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} aria-label={label} onChange={onChange} />
      <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>
      <span className="switch-text"><b>{label}</b><span>{text}</span></span>
    </label>
  );
}

/** Medien → Serien (Phase 7 Paket 7.2): Überwachung je Serie und Staffel, fehlende Folgen suchen. */
export function SeriesMonitoring() {
  const [data, setData] = useState<{ series: Series[]; total: number } | null>(null),
    [filter, setFilter] = useState(""), [page, setPage] = useState(1), [open, setOpen] = useState<number | null>(null);
  const { busy, error, notice, setError, setNotice, run } = useAction();
  const { ask, dialog } = useConfirm();
  const load = useCallback(async () => {
    try { setData(await get<{ series: Series[]; total: number }>("/api/media/series-monitoring")); } catch (e) { setError((e as Error).message); }
  }, [setError]);
  useEffect(() => { void load(); }, [load]);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (data?.series || []).filter((v) => !q || v.title.toLowerCase().includes(q));
  }, [data, filter]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));

  const change = async (v: Series, patch: Change, what: string) => {
    const enabling = patch.monitored === true || patch.newSeasons === true || Object.values(patch.seasons || {}).some(Boolean);
    if (enabling && !(await ask(<>„{v.title}“: {what} einschalten? Sonarr sucht danach selbständig nach fehlenden Folgen und lädt sie herunter, sobald Treffer auftauchen.</>,
      "Überwachung einschalten"))) return;
    await run("change:" + v.id, async () => {
      const after = await action<Series>("/api/media/series-monitoring", { seriesId: v.id, ...patch, ...(enabling ? { confirmation: "OK" } : {}) });
      setData((d) => d && { ...d, series: d.series.map((x) => (x.id === after.id ? after : x)) });
      return `„${after.title}“: ${what} ${enabling ? "eingeschaltet" : "ausgeschaltet"}.`;
    });
  };
  const search = async (v: Series, season: number | null) => {
    if (!(await ask(<>Fehlende Folgen von „{v.title}“{season !== null ? `, ${seasonName(season)},` : ""} jetzt suchen? Treffer werden sofort geladen (nur mit verbundenem VPN).</>,
      "Fehlende Folgen suchen"))) return;
    await run("search:" + v.id, async () => {
      const r = await action<{ message: string }>("/api/media/series-monitoring/search", { seriesId: v.id, ...(season !== null ? { season } : {}), confirmation: "OK" });
      return r.message;
    });
  };

  if (!data) return error ? <p className="error" role="alert">{error}</p> : <p className="muted">Wird geladen …</p>;
  return (
    <section className="managed-services series-monitoring" aria-label="Serien">
      <SectionHeading title="Serien" description="Welche Serien und Staffeln Sonarr weiter verfolgt – neue Folgen kommen nur für überwachte Staffeln." />
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="success" role="status">{notice}</p>}
      {open === null && dialog}
      {!data.series.length ? <p className="muted">Noch keine Serien in Sonarr.</p> : (
        <>
          <label className="person-field">Suchen{" "}
            <input type="search" value={filter} placeholder="Serientitel" onChange={(e) => { setFilter(e.target.value); setPage(1); }} />
          </label>
          <ul className="series-monitoring-list">
            {shown.slice((page - 1) * PAGE, page * PAGE).map((v) => {
              const b = !!busy;
              return (
                <li key={v.id}>
                  <button className="series-monitoring-row" aria-expanded={open === v.id} onClick={() => { setOpen(open === v.id ? null : v.id); setNotice(""); }}>
                    <b>{v.title}{v.year ? ` (${v.year})` : ""}</b>
                    <span className="series-monitoring-badges">
                      {v.monitored ? <StatusBadge tone="success">überwacht</StatusBadge> : <StatusBadge tone="neutral">nicht überwacht</StatusBadge>}
                      {v.ended && <StatusBadge tone="neutral">beendet</StatusBadge>}
                      {v.missing > 0 && <StatusBadge tone="warning">{v.missing} fehlen</StatusBadge>}
                      <span className="muted">{v.files} von {v.total} Folgen</span>
                    </span>
                  </button>
                  {open === v.id && (
                    <div className="series-monitoring-detail">
                      {dialog}
                      <Toggle checked={v.monitored} disabled={b} label="Serie überwachen"
                        text={busy === "change:" + v.id ? "Wird gespeichert …" : v.monitored ? "Ja – Sonarr lädt neue Folgen überwachter Staffeln" : "Nein – keine neuen Downloads"}
                        onChange={() => void change(v, { monitored: !v.monitored }, "Überwachung der Serie")} />
                      <Toggle checked={v.newSeasons} disabled={b || !v.monitored} label="Neue Staffeln automatisch überwachen"
                        text={v.newSeasons ? "Ja" : "Nein – neue Staffeln bleiben aus, bis du sie einschaltest"}
                        onChange={() => void change(v, { newSeasons: !v.newSeasons }, "Überwachung neuer Staffeln")} />
                      <ul className="series-monitoring-seasons">
                        {v.seasons.map((s) => (
                          <li key={s.number}>
                            <Toggle checked={s.monitored} disabled={b || !v.monitored} label={seasonName(s.number)}
                              text={`${s.files} von ${s.total} Folgen vorhanden${s.monitored && s.aired > s.files ? ` · ${s.aired - s.files} fehlen` : ""}`}
                              onChange={() => void change(v, { seasons: { [s.number]: !s.monitored } }, `Überwachung von ${seasonName(s.number)}`)} />
                            {v.monitored && s.monitored && s.files < s.aired && (
                              <button disabled={b} onClick={() => void search(v, s.number)}>Fehlende suchen</button>
                            )}
                          </li>
                        ))}
                      </ul>
                      {!v.monitored && <p className="muted">Staffeln lassen sich erst einzeln schalten, wenn die Serie überwacht wird.</p>}
                      {v.monitored && v.missing > 0 && (
                        <button disabled={b} onClick={() => void search(v, null)}>{busy === "search:" + v.id ? "Wird angestoßen …" : "Alle fehlenden Folgen suchen"}</button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {!shown.length && <p className="muted">Keine Serie passt zur Suche.</p>}
          <Pagination page={page} pages={pages} onChange={setPage} disabled={!!busy} label="Serienseiten" />
        </>
      )}
    </section>
  );
}
