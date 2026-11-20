import { useState } from "react";
import { get } from "./ServerCheck";
import { action } from "./RetirementPanel";
import { StatusBadge, useAction, useConfirm } from "./ui";

type Sub = { token: string | null; language: string; code: string; forced: boolean; hi: boolean; file: string | null };
type Missing = { language: string; code: string; forced: boolean; hi: boolean };
type Hit = { kind: "movie" | "tv"; id: number; title: string; year: string | null; missing: number; profile: boolean };
type Detail = { kind: "movie" | "tv"; id: number; title: string; profile: boolean; subtitles?: Sub[]; missing?: Missing[];
  episodes?: { id: number; label: string; subtitles: Sub[]; missing: Missing[] }[] };
const flags = (x: { forced: boolean; hi: boolean }) => [x.forced ? "nur erzwungene" : null, x.hi ? "für Hörgeschädigte" : null].filter(Boolean).join(", ");

/** Qualität & Quellen → Untertitel → je Titel (Phase 7 Paket 7.3). */
export function SubtitleTitles() {
  const [query, setQuery] = useState(""), [hits, setHits] = useState<Hit[] | null>(null),
    [detail, setDetail] = useState<Detail | null>(null), [onlyMissing, setOnlyMissing] = useState(true);
  const { busy, error, notice, setNotice, run } = useAction();
  const { ask, dialog } = useConfirm();
  const open = (h: { kind: string; id: number }) => run("open", async () => {
    setDetail(await get<Detail>(`/api/subtitles/title?kind=${h.kind}&id=${h.id}`));
  });
  const act = (key: string, body: Record<string, unknown>) => run(key, async () => {
    if (!detail) return;
    const r = await action<{ message: string }>("/api/subtitles/title", { kind: detail.kind, id: detail.id, ...body });
    setDetail(await get<Detail>(`/api/subtitles/title?kind=${detail.kind}&id=${detail.id}`));
    return r.message;
  });
  const subList = (subs: Sub[], missing: Missing[], episodeId?: number) => (
    <ul className="subtitle-title-subs">
      {subs.map((s, i) => (
        <li key={(s.token || "e") + i}>
          <span><b>{s.language}</b>{flags(s) && <span className="muted"> · {flags(s)}</span>}
            <span className="muted"> · {s.file || "in der Videodatei eingebettet"}</span></span>
          {s.token && (
            <span className="couchdeck-actions">
              <button disabled={!!busy} onClick={async () => {
                if (await ask(<>Untertitel „{s.language}“ ersetzen? Bazarr sperrt diesen Untertitel, löscht ihn und sucht einen anderen. Findet es keinen, fehlt die Sprache danach.</>, "Untertitel ersetzen", "Ersetzen"))
                  await act("replace:" + s.token, { action: "replace", token: s.token, episodeId, confirmation: "OK" });
              }}>{busy === "replace:" + s.token ? "Wird ersetzt …" : "Ersetzen"}</button>
              <button disabled={!!busy} onClick={async () => {
                if (await ask(<>Untertitel „{s.language}“ löschen? Die Datei wird entfernt.</>, "Untertitel löschen", "Löschen"))
                  await act("delete:" + s.token, { action: "delete", token: s.token, episodeId, confirmation: "OK" });
              }}>Löschen</button>
            </span>
          )}
        </li>
      ))}
      {missing.map((m, i) => (
        <li key={"m" + m.code + i}>
          <span><b>{m.language}</b> <StatusBadge tone="warning">fehlt</StatusBadge>{flags(m) && <span className="muted"> · {flags(m)}</span>}</span>
          <button disabled={!!busy} onClick={() => void act(`search:${episodeId ?? 0}:${m.code}`, { action: "search", language: m.code, forced: m.forced, hi: m.hi, episodeId })}>
            {busy === `search:${episodeId ?? 0}:${m.code}` ? "Wird gesucht …" : "Suchen"}</button>
        </li>
      ))}
      {!subs.length && !missing.length && <li className="muted">Keine Untertitel und keine fehlenden.</li>}
    </ul>
  );
  const episodes = detail?.episodes?.filter((e) => !onlyMissing || e.missing.length) || [];
  return (
    <section className="tile subtitle-titles" aria-label="Untertitel je Titel">
      <h3>Untertitel je Titel</h3>
      <p className="muted">Einen Film oder eine Serie suchen, fehlende Untertitel holen oder einen schlechten (z. B. nicht synchronen) ersetzen.</p>
      <form className="person-field" onSubmit={(e) => { e.preventDefault(); setDetail(null); setNotice("");
        void run("find", async () => { setHits((await get<{ results: Hit[] }>("/api/subtitles/titles?q=" + encodeURIComponent(query))).results); }); }}>
        <input type="search" value={query} placeholder="Titel" aria-label="Titel suchen" onChange={(e) => setQuery(e.target.value)} />
        <button type="submit" disabled={!!busy || query.trim().length < 2}>{busy === "find" ? "Sucht …" : "Suchen"}</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="success" role="status">{notice}</p>}
      {dialog}
      {hits && !detail && (
        hits.length ? (
          <ul className="subtitle-title-hits">
            {hits.map((h) => (
              <li key={h.kind + h.id}>
                <button disabled={!!busy} onClick={() => void open(h)}>
                  <b>{h.title}</b>{h.year ? ` (${h.year})` : ""} <span className="muted">· {h.kind === "movie" ? "Film" : "Serie"}</span>
                  {h.missing > 0 && <> <StatusBadge tone="warning">{h.missing} fehlen</StatusBadge></>}
                  {!h.profile && <span className="muted"> · ohne Sprachprofil</span>}
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="muted">Nichts gefunden. Nur Titel, die Radarr bzw. Sonarr schon haben, kennt Bazarr.</p>
      )}
      {detail && (
        <div className="subtitle-title-detail">
          <div className="download-issues-head">
            <h4>{detail.title}</h4>
            <span className="couchdeck-actions">
              <button disabled={!!busy} onClick={() => void act("missing", { action: "search-missing" })}>Alle fehlenden suchen</button>
              <button disabled={!!busy} onClick={() => setDetail(null)}>Zurück zur Liste</button>
            </span>
          </div>
          {!detail.profile && <p className="notice">Dieser Titel hat kein Sprachprofil in Bazarr – es fehlen daher keine Untertitel. Oben unter Einstellungen „auch für vorhandene Titel“ wählen.</p>}
          {detail.kind === "movie" ? subList(detail.subtitles || [], detail.missing || []) : (
            <>
              <label><input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} /> Nur Folgen mit fehlenden Untertiteln</label>
              {!episodes.length && <p className="muted">{onlyMissing ? "Keine Folge mit fehlenden Untertiteln." : "Keine Folgen in Bazarr."}</p>}
              {episodes.slice(0, 100).map((e) => (
                <details key={e.id} open={episodes.length <= 3}>
                  <summary>{e.label}{e.missing.length ? ` · ${e.missing.length} fehlen` : ""}</summary>
                  {subList(e.subtitles, e.missing, e.id)}
                </details>
              ))}
              {episodes.length > 100 && <p className="muted">Die ersten 100 von {episodes.length} Folgen.</p>}
            </>
          )}
        </div>
      )}
    </section>
  );
}
