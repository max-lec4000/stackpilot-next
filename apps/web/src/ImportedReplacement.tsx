import { useState } from 'react';
import { get } from './ServerCheck';
import { action } from './RetirementPanel';
type Preview={id:string;message:string;previousSize:number;capGiB:number;candidates:{guid:string;indexerId:number;title:string;size:number}[]};
type Job={id:string;requestId:number;episodeId:number|null;state:string;message:string;backupPath:string};
export function ImportedReplacement({requestId,episodeId}:{requestId:number;episodeId?:number}){
  const [preview,setPreview]=useState<Preview|null>(null),[jobs,setJobs]=useState<Job[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  async function load(){setJobs((await get<{jobs:Job[]}>('/api/media/replacements')).jobs.filter(j=>j.requestId===requestId&&j.episodeId===(episodeId||null)));}
  return <div className="tile"><h4>Vorhandene Version ersetzen</h4><p>Zuerst das gewünschte Qualitätsprofil speichern, dann einen passenden Ersatz auswählen. Die bisherige Version bleibt während des Downloads verfügbar.</p>
    <button disabled={busy} onClick={async()=>{setBusy(true);setMessage('');try{setPreview(await action<Preview>('/api/media/replacement/preview',{requestId,episodeId}));await load();}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}}>Passenden Ersatz suchen</button>
    <button disabled={busy} onClick={async()=>{setBusy(true);try{await load();}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}}>Austauschstatus laden</button>
    {preview&&<><p>{preview.message}</p>{!preview.candidates.length&&<p>Kein eindeutig passender Ersatz gefunden. Die vorhandene Datei bleibt erhalten.</p>}{preview.candidates.map(c=><div key={c.guid}><p>{c.title} · {(c.size/1024**3).toFixed(2)} GiB</p><button disabled={busy} onClick={async()=>{setBusy(true);try{const r=await action<{message:string}>('/api/media/replacement/start',{previewId:preview.id,guid:c.guid,indexerId:c.indexerId,confirmation:'OK'});setMessage(r.message);setPreview(null);await load();}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}}>Sicherung erstellen und durch diesen Treffer ersetzen</button></div>)}</>}
    {jobs.map(job=><div key={job.id}><p>{job.message||'Austausch angefordert; Status erneut laden.'}</p><p style={{overflowWrap:"anywhere"}}>Sicherung: {job.backupPath}</p>{['completed','starting','requested','importing'].includes(job.state)&&<button disabled={busy} onClick={async()=>{setBusy(true);try{const r=await action<{message:string}>('/api/media/replacement/restore',{id:job.id,confirmation:'OK'});setMessage(r.message);await load();}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}}>Zur gesicherten Version zurückkehren</button>}</div>)}
    {message&&<p role="status">{message}</p>}
  </div>;
}
