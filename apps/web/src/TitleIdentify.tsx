import { useState } from "react";
import { get } from "./ServerCheck";
import { action } from "./RetirementPanel";
import { ConfirmBar, useAction } from "./ui";

type Item = { id: string; kind: "movie" | "tv"; title: string; year: number | null; providers: Record<string, string>; folder: string | null };
type Candidate = { token: string; name: string; year: number | null; overview: string | null; source: string | null; providers: Record<string, string> };
const ids = (p: Record<string, string>) => Object.entries(p).map(([k, v]) => `${k.toUpperCase()} ${v}`).join(" · ");

/** Medien → Bibliotheken → Titel korrigieren (Phase 7 Paket 7.4). */
export function TitleIdentify() {
  const [q, setQ] = useState(""), [items, setItems] = useState<Item[] | null>(null), [item, setItem] = useState<Item | null>(null),
    [form, setForm] = useState({ name: "", year: "", tmdb: "" }), [cands, setCands] = useState<Candidate[] | null>(null),
    [pick, setPick] = useState<Candidate | null>(null);
  const { busy, error, notice, setNotice, run } = useAction();
  const search = () => run("find", async () => {
    setItem(null); setCands(null); setNotice("");
    setItems((await get<{ items: Item[] }>("/api/media/identify/search?q=" + encodeURIComponent(q))).items);
  });
  const find = (it: Item, f = form) => run("cands", async () => {
    setPick(null);
    const r = await action<{ candidates: Candidate[] }>("/api/media/identify/candidates", { id: it.id, name: f.name || undefined, year: f.year || undefined, tmdb: f.tmdb || undefined });
    setCands(r.candidates);
  });
  return (
    <section className="tile title-identify" aria-label="Titel korrigieren">
      <h3>Titel korrigieren</h3>
      <p className="muted">Zeigt Jellyfin einen falschen Film oder eine falsche Serie (Bild, Beschreibung, Jahr), hier neu zuordnen.</p>
      <form className="person-field" onSubmit={(e) => { e.preventDefault(); void search(); }}>
        <input type="search" value={q} placeholder="Titel in Jellyfin" aria-label="Titel in Jellyfin suchen" onChange={(e) => setQ(e.target.value)} />
        <button type="submit" disabled={!!busy || q.trim().length < 2}>{busy === "find" ? "Sucht …" : "Suchen"}</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="success" role="status">{notice}</p>}
      {items && !item && (items.length ? (
        <ul className="subtitle-title-hits">
          {items.map((i) => (
            <li key={i.id}><button disabled={!!busy} onClick={() => { setItem(i); const f = { name: i.title, year: i.year ? String(i.year) : "", tmdb: "" }; setForm(f); void find(i, f); }}>
              <b>{i.title}</b>{i.year ? ` (${i.year})` : ""} <span className="muted">· {i.kind === "movie" ? "Film" : "Serie"}{i.folder ? ` · ${i.folder}` : ""}</span>
            </button></li>
          ))}
        </ul>
      ) : <p className="muted">Nichts gefunden.</p>)}
      {item && (
        <div className="subtitle-title-detail">
          <p><b>{item.title}</b>{item.year ? ` (${item.year})` : ""} <span className="muted">· jetzt: {ids(item.providers) || "ohne Kennung"}{item.folder ? ` · ${item.folder}` : ""}</span></p>
          <form className="identify-form" onSubmit={(e) => { e.preventDefault(); void find(item); }}>
            <label>Name <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label>Jahr <input value={form.year} inputMode="numeric" size={5} onChange={(e) => setForm({ ...form, year: e.target.value })} /></label>
            {item.kind === "movie" && <label>TMDb-Nr. <input value={form.tmdb} inputMode="numeric" size={9} onChange={(e) => setForm({ ...form, tmdb: e.target.value })} /></label>}
            <button type="submit" disabled={!!busy}>{busy === "cands" ? "Sucht …" : "Neu suchen"}</button>
            <button type="button" disabled={!!busy} onClick={() => { setItem(null); setCands(null); }}>Zurück</button>
          </form>
          {cands && !cands.length && <p className="muted">Keine Treffer – Namen oder Jahr ändern, oder die TMDb-Nummer eingeben.</p>}
          <ul className="identify-candidates">
            {cands?.map((c) => (
              <li key={c.token}>
                <div><b>{c.name}</b>{c.year ? ` (${c.year})` : ""} <span className="muted">· {ids(c.providers)}{c.source ? ` · ${c.source}` : ""}</span></div>
                {c.overview && <p className="muted">{c.overview}</p>}
                {pick?.token !== c.token ? <button disabled={!!busy} onClick={() => setPick(c)}>Diesen nehmen …</button> : (
                  <ConfirmBar label="Titel zuordnen" busy={busy === "apply"} busyLabel="Wird zugeordnet …" onCancel={() => setPick(null)}
                    onOk={() => run("apply", async () => {
                      const r = await action<{ message: string }>("/api/media/identify/apply", { token: c.token, confirmation: "OK" });
                      setPick(null); setCands(null); setItem(null); setItems(null);
                      return r.message;
                    })}>
                    <p>„{item.title}“ in Jellyfin als „{c.name}{c.year ? ` (${c.year})` : ""}“ zuordnen? Bilder und Beschreibung werden ersetzt. Radarr/Sonarr bleiben unverändert.</p>
                  </ConfirmBar>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
