import { useEffect, useMemo, useRef, useState } from "react";
import { get } from "./ServerCheck";
import { formatBytes } from "../../../packages/domain/format.js";
import { DetailPanel, EmptyState, Pagination, SectionHeading } from "./ui";
import { Problem } from "./Problem";
type Inventory = { schemaVersion: number; observedAt: string; relativeRoot: string; count: number; totalBytes: number; skippedLinks: number; unavailable: number; limited: boolean; files: { path: string; name: string; format: string; bytes: number; folderCover: boolean; tags: string }[]; possibleDuplicates: string[][] };
type Tags = { state: string; fields: Record<string, string>; embeddedCover: boolean | null; message: string };
function TagPreview({ file, onClose, onResult }: { file: string; onClose: () => void; onResult: (value: Tags) => void }) {
  const [tags, setTags] = useState<Tags | null>(null), [error, setError] = useState("");
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  async function inspect() {
    const sequence = ++generation.current;
    setTags(null); setError("");
    try { const value = await get<Tags>("/api/music/tags?path=" + encodeURIComponent(file)); if (sequence === generation.current) { setTags(value); onResult(value); } }
    catch (e) { if (sequence === generation.current) setError((e as Error).message); }
  }
  const folders = file.split("/");
  return <DetailPanel title="Musik-Tags prüfen" onClose={onClose}>
    <p>{file}</p><button onClick={() => void inspect()}>Tags und Bildframes lesen</button>
    {error && <Problem message={error} />}
    {tags && <><p className={tags.state === "inspected" ? "muted" : "notice"}>{tags.message}</p>
      <dl>{Object.entries(tags.fields).map(([name, value]) => <div key={name}><dt>{({ title: "Titel", artist: "Interpret", album: "Album", track: "Titelnummer", year: "Jahr", date: "Datum" } as Record<string, string>)[name] || name}</dt><dd>{value || "Kein lesbarer Wert"}</dd></div>)}</dl>
      <p>Eingebetteter Bildframe: {tags.embeddedCover === null ? "Nicht geprüft" : tags.embeddedCover ? "Vorhanden" : "Nicht gefunden"}. Das bestätigt keine Bildqualität.</p>
    </>}
    <details><summary>Ordnerbasierte Pflegevorschau</summary>
      <p>Nur ein Vorschlag aus dem Pfad, keine bestätigten Tags:</p>
      <p>Interpret: {folders.length >= 3 ? folders.at(-3) : "Nicht ableitbar"} · Album: {folders.length >= 2 ? folders.at(-2) : "Nicht ableitbar"}</p>
      <p>Die Vorschau schreibt nichts in Dateien. Gelesene Tags werden beim Manifest-Export mitgenommen.</p>
    </details>
  </DetailPanel>;
}
export function MusicLibrary() {
  const [data, setData] = useState<Inventory | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [query, setQuery] = useState(""), [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const filtered = useMemo(() => data?.files.filter((file) => file.path.toLocaleLowerCase("de").includes(query.toLocaleLowerCase("de"))) || [], [data, query]);
  const pages = Math.max(1, Math.ceil(filtered.length / 30)), current = Math.min(page, pages);
  async function scan() {
    setBusy(true); setError(""); setData(null);
    try { setData(await get<Inventory>("/api/music")); setPage(1); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "stackpilot-music-manifest.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className="music-library">
    <SectionHeading title="Deine portable Musikbibliothek" description="Bestand im unabhängigen Ordner media/music lesen und als Manifest mitnehmen." actions={<button disabled={busy} onClick={() => void scan()}>{busy ? "Bestand wird gelesen …" : "Musikbestand prüfen"}</button>} />
    <p>Musikdateien bleiben unabhängig von Jellyfin. Diese Bestandsprüfung liest Dateinamen, Größen und vorhandene Ordnercover. Sie verändert keine Dateien oder Tags.</p>
    {error && <Problem message={error} />}{busy && <p role="status">Musikordner wird geprüft …</p>}
    {data && <>
      <p role="status">{data.count} Audiodateien · {formatBytes(data.totalBytes)} · geprüft {new Date(data.observedAt).toLocaleString("de-AT")}</p>
      {(data.limited || data.unavailable > 0) && <p className="notice">Bestand teilweise erfasst: {data.limited ? "Prüflimit erreicht. " : ""}{data.unavailable} Einträge nicht lesbar. Angezeigte Zahlen betreffen nur den erfassten Bestand.</p>}
      <p className="muted">{data.skippedLinks} symbolische Verknüpfungen übersprungen. Tags wurden nicht ausgelesen; fehlende Ordnercover beweisen kein fehlendes eingebettetes Cover.</p>
      <div className="row"><label>Musik durchsuchen<input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} /></label><button onClick={download}>Portables Manifest herunterladen</button></div>
      {!filtered.length ? <EmptyState title="Keine passenden Audiodateien" description="Vorhandene Musik kann im getrennten Medienordner media/music verwaltet werden." /> : <div className="table-scroll"><table><thead><tr><th scope="col">Datei / relativer Pfad</th><th scope="col">Format</th><th scope="col">Größe</th><th scope="col">Ordnercover</th><th scope="col">Metadaten</th></tr></thead><tbody>{filtered.slice((current - 1) * 30, current * 30).map((file) => <tr key={file.path}><td>{file.path}</td><td>{file.format.toUpperCase()}</td><td>{formatBytes(file.bytes)}</td><td>{file.folderCover ? "Vorhanden" : "Nicht gefunden"}</td><td><button onClick={() => setSelected(file.path)}>Tags prüfen</button></td></tr>)}</tbody></table></div>}
      <Pagination page={current} pages={pages} onChange={setPage} label="Musikseiten" />
      <details><summary>{data.possibleDuplicates.length} mögliche Duplikatgruppen</summary><p>Gleicher Dateiname und gleiche Größe sind Hinweise, kein Nachweis identischer Audioinhalte. Es wird nichts gelöscht.</p>{data.possibleDuplicates.slice(0, 30).map((group, i) => <pre key={i}>{group.join("\n")}</pre>)}</details>
    </>}
    {selected && <TagPreview file={selected} onClose={() => setSelected(null)} onResult={(tags) => setData((before) => before ? { ...before, files: before.files.map((file) => file.path === selected ? { ...file, tags: tags.state, metadata: tags } : file) } : before)} />}
  </div>;
}
