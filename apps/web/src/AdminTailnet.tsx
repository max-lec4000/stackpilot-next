import {useState} from 'react';
import {get} from './ServerCheck';
import {action} from './RetirementPanel';
type State={url:string|null;ipUrl:string|null;addresses:string[];message:string;reachedViaTailnet:boolean};
export function AdminTailnetPanel(){
 const [state,setState]=useState<State|null>(null),[sources,setSources]=useState(''),[target,setTarget]=useState(''),[grant,setGrant]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 return <section className="tile"><h3>StackPilot im privaten Tailnet</h3>
 <p>Verwaltung ohne SSH-Tunnel über HTTP und den verschlüsselten Tailscale-Verbindungsweg. Keine öffentliche Freigabe über Funnel. LAN-Zugriff bleibt bestehen.</p>
 <button disabled={busy} onClick={async()=>{setBusy(true);setError('');try{const r=await get<State>('/api/admin-tailnet');setState(r);setTarget(r.addresses[0]||'');setGrant('');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>Privaten StackPilot-Zugriff prüfen</button>
 {state&&<><p role="status">{state.message}</p>{state.url&&<p><a href={state.url} target="_blank" rel="noreferrer">StackPilot im Tailnet öffnen</a></p>}{state.ipUrl&&<p>Ohne Namensauflösung: <a href={state.ipUrl} target="_blank" rel="noreferrer">{state.ipUrl}</a></p>}
 <label>Tailscale-IP deiner Verwaltungsgeräte<input value={sources} onChange={e=>{setSources(e.target.value);setGrant('');}} placeholder="100.x.x.x, 100.y.y.y"/></label>
 <button disabled={busy||!target||!sources.trim()} onClick={async()=>{setBusy(true);setError('');try{const r=await action<{grant:unknown}>('/api/admin-tailnet/grant',{sources,target});setGrant(JSON.stringify(r.grant,null,2));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>Passende Zugriffsregel anzeigen</button>
 {grant&&<><p>Diesen einzelnen Eintrag im vorhandenen <b>grants</b>-Array der <a href="https://login.tailscale.com/admin/acls" target="_blank" rel="noreferrer">Tailscale-Zugriffsregeln</a> ergänzen. Bestehende Regeln behalten. Er erlaubt nur den ausgewählten Geräten TCP 5173 auf diesem Server. StackPilot ändert die Regeln nicht automatisch.</p><pre style={{whiteSpace:'pre-wrap'}}>{grant}</pre></>}
 <p>Die Adresse anschließend auf deinem Verwaltungsgerät öffnen, anmelden und diese Prüfung dort wiederholen. Erst ein Aufruf über die Tailnet-Adresse bestätigt diesen Gerätezugriff; ein erfolgreicher Test am Server selbst genügt nicht.</p></>}
 {error&&<p role="alert">{error}</p>}
 </section>;
}
