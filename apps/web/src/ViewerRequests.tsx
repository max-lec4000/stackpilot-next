import { useState } from 'react';
import { get } from './ServerCheck';
import { action } from './RetirementPanel';
type Row={username:string;editable:boolean;reason?:string|null;userId:number|null;permissions:number|null;autoApprove:boolean;movieAutoApprove:boolean;tvAutoApprove:boolean};
export function ViewerRequests(){
  const [rows,setRows]=useState<Row[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function load(){setBusy(true);setError('');try{setRows((await get<{viewers:Row[]}>('/api/viewer-requests')).viewers);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <details onToggle={e=>{if(e.currentTarget.open)void load();}}>
    <summary>Anfragen ohne Freigabe</summary>
    <p>Gilt für neue Seerr-Anfragen, auch aus Streamyfin und Couchdeck. Bereits wartende Anfragen unter „Meine Anfragen“ freigeben.</p>
    {error && <p role="alert">{error}</p>}
    {rows.map(row=><div className="tile" key={row.username}>
      <b>{row.username}</b>
      <p>{row.editable ? `Filme: ${row.movieAutoApprove?'automatisch':'mit Freigabe'} · Serien: ${row.tvAutoApprove?'automatisch':'mit Freigabe'}` : row.reason || 'Kontozuordnung oder Rechte konnten nicht bestätigt werden.'}</p>
      <button disabled={busy||!row.editable} onClick={async()=>{
        setBusy(true);setError('');
        try{await action('/api/viewer-requests',{username:row.username,userId:row.userId,previousPermissions:row.permissions,enabled:!(row.movieAutoApprove||row.tvAutoApprove),confirmation:'OK'});await load();}
        catch(e){setError((e as Error).message);}finally{setBusy(false);}
      }}>{row.movieAutoApprove||row.tvAutoApprove?'Freigabe für neue Anfragen verlangen':'Neue Filme und Serien automatisch freigeben'}</button>
    </div>)}
  </details>;
}
