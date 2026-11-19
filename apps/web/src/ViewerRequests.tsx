import { useEffect, useState } from 'react';
import { get } from './ServerCheck';
import { action } from './RetirementPanel';
type Row={username:string;editable:boolean;reason?:string|null;needsAccount?:boolean;userId:number|null;permissions:number|null;autoApprove:boolean;movieAutoApprove:boolean;tvAutoApprove:boolean};

/** Pro Zuschauer ein Schalter: Anfragen brauchen eine Freigabe – oder laufen automatisch. */
export function ViewerRequests(){
  const [rows,setRows]=useState<Row[]>([]),[busy,setBusy]=useState(''),[loading,setLoading]=useState(true),[error,setError]=useState('');
  async function load(){
    setLoading(true);setError('');
    try{setRows((await get<{viewers:Row[]}>('/api/viewer-requests')).viewers);}
    catch(e){setError((e as Error).message);}
    finally{setLoading(false);}
  }
  useEffect(()=>{void load();},[]);
  async function toggle(row:Row){
    const automatic=row.movieAutoApprove||row.tvAutoApprove;
    setBusy(row.username);setError('');
    try{
      await action('/api/viewer-requests',{username:row.username,userId:row.userId,previousPermissions:row.permissions,enabled:!automatic,confirmation:'OK'});
      await load();
    }catch(e){setError((e as Error).message);}
    finally{setBusy('');}
  }
  return <section className="viewer-requests" aria-label="Freigabe für Anfragen">
    <h4>Freigabe für Anfragen</h4>
    <p className="muted">Gilt für neue Film- und Serienanfragen, auch aus Streamyfin und Couchdeck. Bereits wartende Anfragen gibst du unter „Meine Anfragen“ frei.</p>
    {error && <p className="error" role="alert">{error}</p>}
    {loading && !rows.length && <p className="muted">Wird geladen …</p>}
    <ul className="viewer-request-list">
      {rows.map(row=>{
        const automatic=row.movieAutoApprove||row.tvAutoApprove;
        const mixed=row.movieAutoApprove!==row.tvAutoApprove;
        return <li key={row.username}>
          <label className={'switch'+(row.editable?'':' disabled')}>
            <input type="checkbox" role="switch" checked={!automatic} disabled={!row.editable||!!busy||loading}
              aria-label={`Freigabe für Anfragen von ${row.username}`} onChange={()=>void toggle(row)} />
            <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>
            <span className="switch-text">
              <b>{row.username}</b>
              <span>{busy===row.username ? 'Wird gespeichert …'
                : !row.editable ? (row.reason || 'Kontozuordnung oder Rechte konnten nicht bestätigt werden.')
                : automatic ? (mixed ? `Teilweise automatisch (Filme ${row.movieAutoApprove?'ja':'nein'}, Serien ${row.tvAutoApprove?'ja':'nein'}) – einschalten verlangt wieder für alles eine Freigabe`
                  : 'Anfragen laufen ohne Freigabe')
                : row.needsAccount ? 'Braucht Freigabe · beim Ausschalten wird das Seerr-Konto angelegt'
                : 'Braucht Freigabe'}</span>
            </span>
          </label>
        </li>;
      })}
    </ul>
  </section>;
}
