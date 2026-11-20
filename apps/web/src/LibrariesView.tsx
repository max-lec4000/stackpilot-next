import { useCallback, useEffect, useState } from "react";
import { get } from "./ServerCheck";
import { action } from "./RetirementPanel";
import { SectionHeading, StatusBadge, useAction } from "./ui";

type Library = { id: string; name: string; type: string; locations: string[]; scanning: boolean; progress: number | null; counts: { label: string; count: number | null }[] };
type Overview = {
  checkedAt: string; libraries: Library[];
  scan: { running: boolean; progress: number | null; lastEnd: string | null; lastStatus: string | null } | null;
  sync: { state?: string; message?: string; progress?: number | null } | null;
  latest: { type: string; title: string; added: string | null }[];
};
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("de-AT", { dateStyle: "short", timeStyle: "short" }) : "–");

/** Medien → Bibliotheken (Phase 7.4b). */
export function LibrariesView() {
  const [data, setData] = useState<Overview | null>(null);
  const { busy, error, notice, setError, run } = useAction();
  const load = useCallback(async () => {
    try { setData(await get<Overview>("/api/media/libraries")); } catch (e) { setError((e as Error).message); }
  }, [setError]);
  useEffect(() => {
    void load();
    const t = setInterval(() => { if (document.visibilityState !== "hidden") void load(); }, 15000);
    return () => clearInterval(t);
  }, [load]);
  if (!data) return error ? <p className="error" role="alert">{error}</p> : <p className="muted">Wird geladen …</p>;
  const scanning = !!data.scan?.running || data.libraries.some((l) => l.scanning);
  return (
    <section className="managed-services libraries-view" aria-label="Bibliotheken">
      <SectionHeading title="Bibliotheken" description="Was Jellyfin in deinen Ordnern gefunden hat – und neu einlesen, wenn etwas fehlt."
        actions={<button className="primary" disabled={!!busy || scanning} onClick={() => void run("all", async () => {
          const r = await action<{ message?: string }>("/api/media/library/refresh", {});
          await load();
          return r.message || "Jellyfin liest alle Bibliotheken ein; danach gleicht StackPilot Seerr ab.";
        })}>Alles einlesen und abgleichen</button>} />
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="success" role="status">{notice}</p>}
      <p className="muted">
        {data.scan?.running ? `Jellyfin liest gerade ein${data.scan.progress !== null ? ` (${data.scan.progress} %)` : ""}.`
          : `Letzter vollständiger Scan: ${when(data.scan?.lastEnd || null)}${data.scan?.lastStatus && data.scan.lastStatus !== "Completed" ? ` (${data.scan.lastStatus})` : ""}.`}
        {data.sync?.message ? ` ${data.sync.message}` : ""}
      </p>
      <div className="library-cards">
        {data.libraries.map((l) => (
          <article key={l.id} className="library-card" aria-label={`Bibliothek ${l.name}`}>
            <div className="library-card-head">
              <h3>{l.name}</h3>
              {l.scanning && <StatusBadge tone="info">Wird eingelesen{l.progress !== null ? ` · ${l.progress} %` : ""}</StatusBadge>}
            </div>
            <p className="library-counts">{l.counts.length ? l.counts.map((c) => `${c.count ?? "?"} ${c.label}`).join(" · ") : "–"}</p>
            <p className="muted library-paths">{l.locations.join(", ")}</p>
            <button disabled={!!busy || l.scanning} onClick={() => void run(l.id, async () => {
              const r = await action<{ message: string }>("/api/media/libraries/scan", { libraryId: l.id });
              setTimeout(() => void load(), 3000);
              return r.message;
            })}>{busy === l.id ? "Wird angestoßen …" : "Diese Bibliothek einlesen"}</button>
          </article>
        ))}
      </div>
      <h3>Neu hinzugekommen</h3>
      {!data.latest.length && <p className="muted">Noch nichts.</p>}
      <ul className="library-latest">
        {data.latest.map((i, n) => (
          <li key={n}><span className="muted">{i.type === "episode" ? "Folge" : i.type === "album" ? "Album" : "Film"}</span> <b>{i.title}</b> <span className="muted">· {when(i.added)}</span></li>
        ))}
      </ul>
      <p className="muted">Einzeln einlesen findet neue oder geänderte Dateien; vorhandene Metadaten und Bilder bleiben. Falsch erkannte Titel korrigierst du in Jellyfin („Identifizieren“).</p>
    </section>
  );
}
