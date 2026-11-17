import { positiveId } from './media-hub.js';
const normalize = value => String(value || '').replaceAll('-', '').toLowerCase();
const autoMask = 128 | 256 | 512 | 32768 | 65536 | 131072;
export function requestPermissions(before, enabled) {
  if (!Number.isSafeInteger(before) || before < 0 || before > 2147483647 || (before & (2 | 16)))
    throw Error('Administratoren und Konten mit Freigaberechten hier nicht ändern.');
  return enabled ? before | 128 : before & ~autoMask;
}
export class ViewerRequests {
  constructor(hub, connection, viewers) { Object.assign(this, {hub, connection, viewers}); }
  async context() {
    const {s} = await this.hub.context(['Seerr','Jellyfin']);
    const connection = await this.connection.context();
    const links = (await connection.request('/sso/OID/Get'))?.stackpilot?.CanonicalLinks;
    if (!links) throw Error('Die Zuordnung der Zuschauer zu Jellyfin fehlt.');
    const {viewers} = await this.viewers.list();
    const users=[];
    for(let skip=0;skip<10000;skip+=100){
      const page=await s.additional.seerr(`/user?take=100&skip=${skip}`);
      if(!Array.isArray(page.results))throw Error('Seerr-Nutzerliste nicht bestätigt.');
      users.push(...page.results);
      if(page.results.length<100)break;
      if(skip===9900)throw Error('Seerr-Nutzerliste zu groß für einen sicheren Abgleich.');
    }
    const rows=viewers.filter(v=>v.active).map(v=>{
      const link=normalize(links[v.username]);
      const matches=users.filter(u=>link && normalize(u.jellyfinUserId)===link);
      const user=matches.length===1?matches[0]:null;
      const permissions=user?.permissions;
      const editable=!!user && user.id!==1 && Number.isSafeInteger(permissions) && !(permissions & (2|16));
      return {username:v.username,user,editable};
    });
    return {s,rows};
  }
  project(rows) {
    return {viewers:rows.map(({username,user,editable})=>({username,editable,
      userId:user?.id ?? null, permissions: user?.permissions ?? null,
      autoApprove:!!(user?.permissions & 128),
      movieAutoApprove:!!(user?.permissions & (128|256)),tvAutoApprove:!!(user?.permissions & (128|512)),
    }))};
  }
  async list(){return this.project((await this.context()).rows);}
  async change(body){
    if(body.confirmation!=='OK'||typeof body.enabled!=='boolean')throw Error('Freigaberecht bestätigen.');
    return this.hub.mutate(['Seerr'],async()=>{
      const {s,rows}=await this.context();
      const row=rows.find(r=>r.username===body.username);
      if(!row?.editable || row.user.id!==positiveId(body.userId) || row.user.permissions!==body.previousPermissions)
        throw Error('Kontozuordnung oder Rechte geändert. Neu laden.');
      const user=await s.additional.seerr(`/user/${row.user.id}`);
      if(user.id!==row.user.id || normalize(user.jellyfinUserId)!==normalize(row.user.jellyfinUserId) || user.permissions!==row.user.permissions)
        throw Error('Seerr-Konto wurde inzwischen geändert.');
      const permissions=requestPermissions(user.permissions,body.enabled);
      await s.additional.seerr(`/user/${user.id}`,{method:'PUT',body:{...(typeof user.username==='string'?{username:user.username}:{}),permissions}});
      const saved=await s.additional.seerr(`/user/${user.id}`);
      if(saved.permissions!==permissions || normalize(saved.jellyfinUserId)!==normalize(user.jellyfinUserId))
        throw Error('Seerr hat die Rechte nicht bestätigt. Erneut prüfen.');
      return {ok:true};
    });
  }
}
