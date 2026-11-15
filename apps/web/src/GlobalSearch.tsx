import { useEffect, useState } from "react";
import { get } from "./ServerCheck";
import { DetailPanel, EmptyState } from "./ui";
import { Icon } from "./Icon";
type Result = { applications: { title: string; state: string }[]; media: { id: number; type: string; title: string; year: string; requested: boolean; available: boolean }[]; requested: { title: string }[]; unavailable: string[] };
export function GlobalSearch({ onDiscover }: { onDiscover: (query: string) => void }) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(""), [data, setData] = useState<Result | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k" && !document.querySelector("dialog[open]")) { event.preventDefault(); setOpen(true); }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  useEffect(() => {
    if (!open || query.trim().length < 2) { setData(null); setBusy(false); return; }
    let active = true;
    setBusy(true); setData(null); setError("");
    const timer = setTimeout(() => {
      get<Result>("/api/search?query=" + encodeURIComponent(query.trim()))
        .then((value) => { if (active) setData(value); })
        .catch((e) => { if (active) setError((e as Error).message); })
        .finally(() => { if (active) setBusy(false); });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [open, query]);
  function close() { setOpen(false); setQuery(""); setData(null); setError(""); }
  return <>
    <button type="button" aria-label="StackPilot durchsuchen" aria-haspopup="dialog" onClick={() => setOpen(true)}><Icon name="search" />Suche</button>
    {open && <DetailPanel title="StackPilot durchsuchen" onClose={close}>
      <label>Apps, Filme und Serien<input type="search" autoFocus maxLength={160} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Mindestens zwei Zeichen" /></label>
      {busy && <p role="status">Wird gesucht …</p>}{error && <p role="alert" className="error">{error}</p>}
      {data && <>
        {data.unavailable.length > 0 && <p className="notice">Nicht erreichbar: {data.unavailable.join(", ")}. Andere Ergebnisse bleiben verfügbar.</p>}
        <h3>Anwendungen</h3>
        {data.applications.map((item) => <p key={item.title}><a href="#/anwendungen" onClick={close}>{item.title}</a></p>)}
        {!data.applications.length && <p className="muted">Keine passende Anwendung gefunden.</p>}
        <h3>Medien</h3>
        {data.media.map((item) => <article className="tile" key={item.type + item.id}><b>{item.title}</b><p className="muted">{item.type === "movie" ? "Film" : "Serie"} · {item.year}{item.requested ? " · Bereits angefragt" : ""}{item.available ? " · Als verfügbar gemeldet" : ""}</p><button onClick={() => { onDiscover(item.title); close(); }}>Details und Anfrage öffnen</button></article>)}
        {!data.media.length && <EmptyState title="Keine passenden Medien gefunden" />}
        {data.requested.length > 0 && <p><a href="#/anfragen" onClick={close}>{data.requested.length} gefundene Medien sind angefragt – Anfragen öffnen</a></p>}
        <small>Die Mediensuche zeigt die ersten zwölf Treffer der ersten Ergebnisseite. Archivierte lokale Anfragen sind hier nicht vollständig durchsuchbar.</small>
      </>}
    </DetailPanel>}
  </>;
}
