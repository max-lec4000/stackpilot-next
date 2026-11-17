import { useEffect,useState } from 'react';
import { get } from './ServerCheck';
import { action } from './RetirementPanel';
type Preview={downloads:{hash:string;name:string;shared:boolean;files:{name:string;size:number}[]}[];downloadWarning:string|null;review:string;title:string;message:string;files:{id:number;path:string;size:number;links:number}[];episodes:{id:number;season:number;number:number}[];possibleDownloads:{name:string;size:number}[]};
export function SeriesRemoval(){
  const [series,setSeries]=useState<{id:number;title:string;files:number}[]>([]),[id,setId]=useState(''),[season,setSeason]=useState(''),[episode,setEpisode]=useState('');
  const [preview,setPreview]=useState<Preview|null>(null),[downloads,setDownloads]=useState<string[]>([]),[stop,setStop]=useState(true),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  useEffect(()=>{void get<{series:typeof series}>('/api/media/series-inventory').then(r=>setSeries(r.series)).catch(e=>setMessage(e.message));},[]);
  const selection={seriesId:Number(id),season:season?Number(season):null,episodeId:episode?Number(episode):null};
  return <div className="tile"><h3>Serienbibliothek bereinigen</h3>
    <p>Findet auch Serien, deren Anfrage bereits archiviert oder entfernt wurde. Filme können unter „Meine Anfragen → Film löschen“ entfernt werden.</p>
    <label>Serie<select aria-label="Serie" value={id} disabled={busy} onChange={e=>{setId(e.target.value);setEpisode('');setPreview(null);}}><option value="">Serie auswählen</option>{series.map(v=><option key={v.id} value={v.id}>{v.title} · {v.files} Dateien</option>)}</select></label>
    <label>Staffel (leer = ganze Serie)<input type="number" min="1" value={season} disabled={busy} onChange={e=>{setSeason(e.target.value);setEpisode('');setPreview(null);}}/></label>
    <button disabled={busy||!id} onClick={async()=>{setBusy(true);setMessage('');try{setDownloads([]);setPreview(await action<Preview>('/api/media/series-removal/preview',selection));}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}}>Betroffene Dateien prüfen</button>
    {preview&&<><p>{preview.message}</p>
      {!episode && <label>Nur eine Folge auswählen<select value="" disabled={busy} onChange={e=>{setEpisode(e.target.value);setPreview(null);}}><option value="">Alle angezeigten Folgen</option>{preview.episodes.map(e=><option key={e.id} value={e.id}>Staffel {e.season}, Folge {e.number}</option>)}</select></label>}
      {episode && <button disabled={busy} onClick={()=>{setEpisode('');setPreview(null);}}>Wieder ganze Staffel oder Serie auswählen</button>}
      <ul>{preview.files.map(f=><li style={{overflowWrap:"anywhere"}} key={f.id}>{f.path} · {(f.size/1024**3).toFixed(2)} GiB{f.links>1?` · ${f.links} Hardlinks, andere Verknüpfungen bleiben erhalten`:''}</li>)}</ul>
      {!!preview.possibleDownloads.length&&<><p>Mögliche Downloadkopien separat unter Downloads prüfen:</p><ul>{preview.possibleDownloads.map((v,i)=><li key={i}>{v.name}</li>)}</ul></>}
      {preview.downloadWarning&&<p>{preview.downloadWarning}</p>}
      {preview.downloads.map(d=><div key={d.hash}><label><input type="checkbox" disabled={busy||d.shared} checked={downloads.includes(d.hash)} onChange={e=>setDownloads(e.target.checked?[...downloads,d.hash]:downloads.filter(h=>h!==d.hash))}/>{d.name}{d.shared?' · enthält weitere Folgen, nicht einzeln löschbar':''}</label><ul>{d.files.map(f=><li style={{overflowWrap:"anywhere"}} key={f.name}>{f.name} · {(f.size/1024**3).toFixed(2)} GiB</li>)}</ul></div>)}
      <label><input type="checkbox" checked={stop} disabled={busy} onChange={e=>setStop(e.target.checked)}/>Überwachung beenden, damit die ausgewählten Folgen nicht automatisch erneut geladen werden</label>
      <button className="danger" disabled={busy||!preview.files.length} onClick={async()=>{setBusy(true);try{const r=await action<{message:string}>('/api/media/series-removal/execute',{...selection,review:preview.review,downloads,stopMonitoring:stop,confirmation:'OK'});setMessage(r.message);setPreview(null);}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}}>Bestätigen – diese Bibliotheksdateien löschen</button></>}
    {message&&<p role="status">{message}</p>}
  </div>;
}
