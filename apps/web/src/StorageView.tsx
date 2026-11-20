import { useCallback, useEffect, useState } from "react";
import { get } from "./ServerCheck";
import { action } from "./RetirementPanel";
import { ConfirmBar, SectionHeading, useAction } from "./ui";
import { formatBytes } from "../../../packages/domain/format.js";

type Disk = { labels: string[]; total: number; free: number; used: number };
type Part = { bytes: number; items: number } | null | undefined;
type Orphan = { hash: string; name: string; size: number; category: string; ratio: number; seeding: boolean; completedAt: string | null };
type Overview = {
  checkedAt: string; disks: Disk[]; appdata: { bytes: number; partial: boolean } | null;
  library: { movies?: Part; series?: Part; music?: Part };
  downloads: { total: number; complete: number; incomplete: number; orphans: Orphan[]; orphanBytes: number } | null;
};

/** Speicher → Belegung (Phase 7.4a). */
export function StorageView() {
  const [data, setData] = useState<Overview | null>(null), [confirm, setConfirm] = useState<Orphan | null>(null);
  const { busy, error, notice, setError, run } = useAction();
  const load = useCallback(async () => {
    try { setData(await get<Overview>("/api/storage/overview")); } catch (e) { setError((e as Error).message); }
  }, [setError]);
  useEffect(() => { void load(); }, [load]);
  if (!data) return error ? <p className="error" role="alert">{error}</p> : <p className="muted">Belegung wird ermittelt … (bei großen Bibliotheken einige Sekunden)</p>;
  const parts: [string, Part, string][] = [
    ["Filme", data.library.movies, "Filme mit Datei"], ["Serien", data.library.series, "Folgen"], ["Musik", data.library.music, "Titel"],
  ];
  return (
    <section className="managed-services storage-view" aria-label="Belegung">
      <SectionHeading title="Belegung" description="Wie voll die Laufwerke sind und wofür der Platz draufgeht."
        actions={<button disabled={!!busy} onClick={() => void run("reload", async () => { await load(); return ""; })}>Neu ermitteln</button>} />
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="success" role="status">{notice}</p>}
      <div className="storage-disks">
        {data.disks.map((d) => {
          const pct = d.total ? Math.round((d.used / d.total) * 100) : 0;
          return (
            <article key={d.labels.join()} className="storage-disk">
              <h3>{d.labels.join(" · ")}</h3>
              <progress max={100} value={pct} aria-label={`Belegt ${pct} %`} className={pct >= 90 ? "critical" : pct >= 80 ? "warning" : ""} />
              <p>{formatBytes(d.used)} von {formatBytes(d.total)} belegt ({pct} %) · <b>{formatBytes(d.free)} frei</b></p>
            </article>
          );
        })}
      </div>
      <h3>Wofür</h3>
      <ul className="storage-parts">
        {parts.filter(([, p]) => p !== undefined).map(([label, p, unit]) => (
          <li key={label}><b>{label}</b> {p ? <>{formatBytes(p.bytes)} <span className="muted">· {p.items} {unit}</span></> : <span className="muted">nicht ermittelbar</span>}</li>
        ))}
        {data.downloads && (
          <li><b>Downloads</b> {formatBytes(data.downloads.total)} <span className="muted">· {data.downloads.complete} fertig, {data.downloads.incomplete} laufend – fertige, schon übernommene Downloads belegen keinen zusätzlichen Platz (gleiche Datei per Hardlink)</span></li>
        )}
        <li><b>App-Daten</b> {data.appdata ? <>{data.appdata.partial ? "mindestens " : ""}{formatBytes(data.appdata.bytes)}</> : <span className="muted">nicht ermittelbar</span>} <span className="muted">· Einstellungen, Datenbanken, Vorschaubilder{data.appdata?.partial ? " (einige Ordner gehören anderen Containern und sind nicht mitgezählt)" : ""}</span></li>
      </ul>
      {data.downloads && (
        <>
          <h3>Verwaiste Downloads {data.downloads.orphans.length ? `(${formatBytes(data.downloads.orphanBytes)})` : ""}</h3>
          <p className="muted">
            Fertige Downloads, die in keiner Bibliothek gelandet sind und auf keinen Import mehr warten. Sie belegen Platz,
            erscheinen aber nicht in Jellyfin – z. B. nach abgebrochenen Anfragen oder abgelehnten Treffern.
          </p>
          {!data.downloads.orphans.length && <p className="success">Keine verwaisten Downloads.</p>}
          <ul className="storage-orphans">
            {data.downloads.orphans.map((o) => (
              <li key={o.hash}>
                <span><b>{o.name}</b> <span className="muted">· {formatBytes(o.size)}{o.seeding ? " · wird noch verteilt" : ""}{o.ratio ? ` · Verhältnis ${o.ratio}` : ""}{o.completedAt ? ` · fertig seit ${new Date(o.completedAt).toLocaleDateString("de-AT")}` : ""}</span></span>
                {confirm?.hash !== o.hash && <button className="danger" disabled={!!busy} onClick={() => setConfirm(o)}>Samt Dateien löschen</button>}
                {confirm?.hash === o.hash && (
                  <ConfirmBar label={`${o.name} löschen`} busy={busy === o.hash} busyLabel="Wird gelöscht …" onCancel={() => setConfirm(null)}
                    onOk={() => run(o.hash, async () => {
                      const r = await action<{ freed: number }>("/api/storage/orphans/remove", { hash: o.hash, confirmation: "OK" });
                      setConfirm(null); await load();
                      return `Gelöscht, ${formatBytes(r.freed)} frei.`;
                    })}>
                    <p>
                      <b>{o.name}</b> aus qBittorrent entfernen und die Dateien löschen ({formatBytes(o.size)})? StackPilot prüft vorher noch
                      einmal, dass nichts davon in der Bibliothek liegt. Das lässt sich nicht rückgängig machen.
                    </p>
                  </ConfirmBar>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="muted">Stand {new Date(data.checkedAt).toLocaleString("de-AT", { dateStyle: "short", timeStyle: "short" })}</p>
    </section>
  );
}
