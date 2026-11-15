import { useEffect, useState } from "react";
import { get } from "./ServerCheck";
import { action } from "./RetirementPanel";
import { DetailPanel, EmptyState } from "./ui";
type Notice = { id: string; title: string; message: string; target: string; created: string; seen: boolean };
type Inbox = { results: Notice[]; unread: number; error: string | null; checkedAt: string | null };
export function NotificationInbox() {
  const [open, setOpen] = useState(false), [data, setData] = useState<Inbox | null>(null), [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const load = async () => {
      try { const value = await get<Inbox>("/api/notifications"); if (active) { setData(value); setError(""); } }
      catch { if (active) setError("Meldungen sind gerade nicht erreichbar."); }
    };
    void load();
    const timer = setInterval(() => { if (document.visibilityState !== "hidden") void load(); }, 60000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  return <>
    <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog">Hinweise{data && data.unread > 0 ? ` (${data.unread})` : ""}</button>
    {open && <DetailPanel title="Deine Hinweise" onClose={() => setOpen(false)}>
      <p className="muted">Lokale Hinweise zu Betrieb und Anfragen. Große Anfragebestände werden seitenweise geprüft; Meldungen können deshalb verzögert erscheinen.</p>
      {(error || data?.error) && <p role="alert" className="error">{error || data?.error}</p>}
      {!data && !error && <p role="status">Hinweise werden geladen …</p>}
      {data && <>
        <button disabled={!data.results.some((notice) => !notice.seen)} onClick={async () => {
          try { setData(await action<Inbox>("/api/notifications/read", { ids: data.results.filter((notice) => !notice.seen).map((notice) => notice.id) })); }
          catch (e) { setError((e as Error).message); }
        }}>Angezeigte Meldungen als gelesen markieren</button>
        {!data.results.length && <EmptyState title="Noch keine Meldungen" description="Neue Betriebsprobleme und beobachtete Statuswechsel erscheinen hier." />}
        {data.results.map((notice) => <article className="tile" key={notice.id}>
          <b>{!notice.seen && <span aria-label="Ungelesen">● </span>}{notice.title}</b>
          <p>{notice.message}</p><small>{new Date(notice.created).toLocaleString("de-AT")}</small>{" "}
          {["#/einrichten", "#/verwaltung", "#/anfragen"].includes(notice.target) && <a href={notice.target} onClick={() => setOpen(false)}>Bereich öffnen</a>}
        </article>)}
      </>}
    </DetailPanel>}
  </>;
}
