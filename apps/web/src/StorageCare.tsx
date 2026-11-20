import { useCallback, useEffect, useState } from "react";
import { get } from "./ServerCheck";
import { action } from "./RetirementPanel";
import { StatusBadge, useAction, useConfirm } from "./ui";
import { formatBytes } from "../../../packages/domain/format.js";

const size = (n: number | null) => (n ? formatBytes(n) : "?");
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("de-AT") : "–");

type Bin = { service: string; enabled?: boolean; ours?: boolean; foreign?: string | null; days?: number; usage?: { bytes: number; files: number } | null; choices?: number[]; error?: string };

/** Speicher → Papierkorb für Radarr/Sonarr (Phase 7 Paket 7.4). */
export function RecycleBin() {
  const [rows, setRows] = useState<Bin[] | null>(null), [days, setDays] = useState<Record<string, number>>({});
  const { busy, error, notice, setError, run } = useAction();
  const { ask, dialog } = useConfirm();
  const load = useCallback(async () => {
    try { setRows((await get<{ services: Bin[] }>("/api/storage/recycle-bin")).services); } catch (e) { setError((e as Error).message); }
  }, [setError]);
  useEffect(() => { void load(); }, [load]);
  if (!rows?.length) return error ? <p className="error" role="alert">{error}</p> : null;
  const save = (b: Bin, enabled: boolean) => async () => {
    const d = days[b.service] ?? (b.ours && b.days ? b.days : 30);
    const text = enabled
      ? <>{b.service}: Gelöschte Dateien {d} Tage im Papierkorb aufheben?{b.foreign ? ` Der bisherige Papierkorb (${b.foreign}) wird nicht mehr benutzt.` : ""} Das braucht so lange zusätzlichen Platz.</>
      : <>{b.service}: Papierkorb ausschalten? Gelöschte Dateien sind dann sofort weg. Was schon drin liegt, bleibt bis zum Leeren.</>;
    if (await ask(text, "Papierkorb")) await run(b.service, async () => {
      const r = await action<{ message: string }>("/api/storage/recycle-bin", { service: b.service, enabled, days: d, confirmation: "OK" });
      setDays({}); await load(); return r.message;
    });
  };
  return (
    <section className="tile recycle-bin" aria-label="Papierkorb">
      <h3>Papierkorb</h3>
      <p className="muted">Löscht Radarr oder Sonarr eine Datei (Upgrade, Löschen eines Titels), landet sie zuerst hier und verschwindet erst nach der eingestellten Zeit.</p>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="success" role="status">{notice}</p>}
      {dialog}
      <ul className="storage-list">
        {rows.map((b) => b.error ? <li key={b.service} className="error">{b.error}</li> : (
          <li key={b.service}>
            <b>{b.service === "Radarr" ? "Filme" : "Serien"}</b>{" "}
            {b.ours ? <StatusBadge tone="success">an · {b.days} Tage</StatusBadge> : b.foreign ? <StatusBadge tone="info">eigener Ordner</StatusBadge> : <StatusBadge tone="neutral">aus</StatusBadge>}
            {b.ours && b.usage && <span className="muted"> · {formatBytes(b.usage.bytes)} in {b.usage.files} Dateien</span>}
            {b.foreign && <span className="muted"> · {b.foreign}</span>}
            <span className="couchdeck-actions">
              <select value={days[b.service] ?? (b.ours && b.days ? b.days : 30)} disabled={!!busy} aria-label={`Aufbewahrung ${b.service}`}
                onChange={(e) => setDays({ ...days, [b.service]: Number(e.target.value) })}>
                {(b.choices || []).map((c) => <option key={c} value={c}>{c} Tage</option>)}
              </select>
              {(!b.ours || (days[b.service] !== undefined && days[b.service] !== b.days)) && <button disabled={!!busy} onClick={save(b, true)}>{b.ours ? "Speichern …" : "Einschalten …"}</button>}
              {b.enabled && <button disabled={!!busy} onClick={save(b, false)}>Ausschalten …</button>}
              {b.ours && !!b.usage?.files && <button disabled={!!busy} onClick={async () => {
                if (await ask(<>Papierkorb von {b.service} jetzt leeren? {b.usage?.files} Dateien ({formatBytes(b.usage?.bytes || 0)}) werden endgültig gelöscht.</>, "Papierkorb leeren", "Leeren"))
                  await run("empty:" + b.service, async () => { const r = await action<{ message: string }>("/api/storage/recycle-bin/empty", { service: b.service, confirmation: "OK" }); await load(); return r.message; });
              }}>Leeren …</button>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

type Dup = { title: string; kind: string; versions: { token: string; file: string; size: number | null; managed: boolean }[] };
/** Speicher → Aufräumen → Doppelte Fassungen (Phase 7 Paket 7.4). */
export function Duplicates() {
  const [data, setData] = useState<{ groups: Dup[]; total: number } | null>(null);
  const { busy, error, notice, setError, run } = useAction();
  const { ask, dialog } = useConfirm();
  const load = useCallback(async () => {
    try { setData(await get<{ groups: Dup[]; total: number }>("/api/storage/duplicates")); } catch (e) { setError((e as Error).message); }
  }, [setError]);
  useEffect(() => { void load(); }, [load]);
  return (
    <section className="tile duplicates" aria-label="Doppelte Fassungen">
      <h3>Doppelte Fassungen{data ? ` (${data.total})` : ""}</h3>
      <p className="muted">Titel, die Jellyfin mehrfach findet – meist eine alte Datei neben der neuen. Die Datei, die Radarr bzw. Sonarr verwaltet, bleibt; zusätzliche lassen sich hier löschen.</p>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="success" role="status">{notice}</p>}
      {dialog}
      {!data ? (!error && <p className="muted">Wird gesucht …</p>) : !data.groups.length ? <p className="muted">Keine doppelten Fassungen gefunden.</p> : (
        <ul className="storage-list">
          {data.groups.map((g) => (
            <li key={g.versions[0].token}>
              <b>{g.title}</b>
              <ul className="subtitle-title-subs">
                {g.versions.map((v) => (
                  <li key={v.token}>
                    <span>{v.file} <span className="muted">· {size(v.size)}</span> {v.managed && <StatusBadge tone="success">verwaltet</StatusBadge>}</span>
                    {!v.managed && <button disabled={!!busy} onClick={async () => {
                      if (await ask(<>Zusätzliche Fassung „{v.file}“ ({size(v.size)}) endgültig löschen?</>, "Fassung löschen", "Löschen"))
                        await run(v.token, async () => { const r = await action<{ message: string }>("/api/storage/duplicates/remove", { token: v.token, confirmation: "OK" }); await load(); return r.message; });
                    }}>{busy === v.token ? "Wird gelöscht …" : "Löschen …"}</button>}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type Keep = { days: number; choices: number[]; total: number; bytes: number; candidates: { title: string; size: number | null; viewers: number; lastPlayed: string | null; added: string }[] };
/** Speicher → Aufräumen → Lange nicht gesehen (Aufbewahrung, Phase 7 Paket 7.4). Nur Vorschläge. */
export function RetentionHints() {
  const [days, setDays] = useState(365), [data, setData] = useState<Keep | null>(null);
  const { error, setError } = useAction();
  useEffect(() => {
    setData(null);
    get<Keep>("/api/storage/retention?days=" + days).then(setData, (e) => setError((e as Error).message));
  }, [days, setError]);
  return (
    <section className="tile retention" aria-label="Lange nicht gesehen">
      <h3>Lange nicht gesehen</h3>
      <p className="muted">
        Filme, die seit dem gewählten Zeitraum niemand angesehen hat. Nur ein Vorschlag – gelöscht wird nichts automatisch.
        Löschen wie gewohnt über die Anfrage des Films (Anfragen → Details → Film löschen).
      </p>
      <label className="person-field">Nicht gesehen seit{" "}
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {(data?.choices || [90, 180, 365, 730]).map((c) => <option key={c} value={c}>{c >= 365 ? `${c / 365} ${c === 365 ? "Jahr" : "Jahren"}` : `${c} Tagen`}</option>)}
        </select>
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      {!data ? (!error && <p className="muted">Wird berechnet …</p>) : !data.total ? <p className="muted">Keine Filme in diesem Zeitraum.</p> : (
        <>
          <p>{data.total} Filme · zusammen {formatBytes(data.bytes)}</p>
          <ul className="storage-list">
            {data.candidates.map((c, i) => (
              <li key={i}><b>{c.title}</b> <span className="muted">· {size(c.size)} · {c.lastPlayed ? `zuletzt gesehen ${date(c.lastPlayed)}` : "nie angesehen"} · da seit {date(c.added)}</span></li>
            ))}
          </ul>
          {data.total > data.candidates.length && <p className="muted">Die {data.candidates.length} größten von {data.total}.</p>}
        </>
      )}
    </section>
  );
}
