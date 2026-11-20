import { positiveId } from './media-hub.js';
import { seerrAdapter, normalizeJellyfinId as normalize } from './adapters/seerr.js';
const autoMask = 128 | 256 | 512 | 32768 | 65536 | 131072;
export function requestPermissions(before, enabled) {
  if (!Number.isSafeInteger(before) || before < 0 || before > 2147483647 || (before & (2 | 16)))
    throw Error('Administratoren und Konten mit Freigaberechten hier nicht ändern.');
  // enabled: true = alles automatisch, false = alles braucht Freigabe,
  // { movie, tv } = getrennt (Phase 7.1): automatisch nur für die genannte Art
  if (typeof enabled === 'boolean') return enabled ? before | 128 : before & ~autoMask;
  const base = before & ~autoMask;
  if (enabled.movie && enabled.tv) return base | 128;
  return base | (enabled.movie ? 256 : 0) | (enabled.tv ? 512 : 0);
}
const quota = (q) => {
  if (q === null) return { limit: null, days: null };
  const limit = Number(q?.limit), days = Number(q?.days);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(days) || days < 1 || days > 365)
    throw Error('Limit: 1–100 Anfragen in 1–365 Tagen (oder kein Limit).');
  return { limit, days };
};
export class ViewerRequests {
  constructor(hub, connection, viewers) { Object.assign(this, {hub, connection, viewers}); }
  async context() {
    const {s} = await this.hub.context(['Seerr','Jellyfin']);
    const connection = await this.connection.context();
    const links = (await connection.request('/sso/OID/Get'))?.stackpilot?.CanonicalLinks;
    if (!links) throw Error('Die Zuordnung der Zuschauer zu Jellyfin fehlt.');
    const {viewers} = await this.viewers.list();
    const users=await seerrAdapter(s).users();
    const rows=viewers.filter(v=>v.active).map(v=>{
      const link=normalize(links["spv_" + v.username]);
      const matches=users.filter(u=>link && normalize(u.jellyfinUserId)===link);
      const user=matches.length===1?matches[0]:null;
      const permissions=user?.permissions;
      // Fehlt nur das Seerr-Konto, legt StackPilot es beim Umschalten aus dem bestätigten
      // Jellyfin-Konto an (wie Seerr es bei der ersten Anmeldung selbst täte).
      const needsAccount=!!link && matches.length===0;
      const editable=needsAccount || (!!user && user.id!==1 && Number.isSafeInteger(permissions) && !(permissions & (2|16)));
      const reason = !link ? 'Noch keine bestätigte Jellyfin-Anmeldung. Zuerst einmal als Zuschauer anmelden.'
        : needsAccount ? null
        : matches.length > 1 ? 'Mehrere Seerr-Konten sind mit demselben Jellyfin-Konto verknüpft. Zuordnung in Seerr prüfen.'
        : !editable ? 'Dieses Seerr-Konto besitzt Verwaltungsrechte oder unbestätigte Rechte. Hier werden nur normale Zuschauerkonten geändert.' : null;
      return {username:v.username,user,editable,reason,needsAccount,link};
    });
    return {s,rows};
  }
  project(rows) {
    return {viewers:rows.map(({username,user,editable,reason,needsAccount})=>({username,editable,reason,needsAccount:!!needsAccount,
      userId:user?.id ?? null, permissions: user?.permissions ?? null,
      autoApprove:!!(user?.permissions & 128),
      movieAutoApprove:!!(user?.permissions & (128|256)),tvAutoApprove:!!(user?.permissions & (128|512)),
      // Anfragelimits (null = Seerr-Standard bzw. unbegrenzt)
      movieQuota: user && Number.isSafeInteger(user.movieQuotaLimit) && user.movieQuotaLimit > 0 ? { limit: user.movieQuotaLimit, days: user.movieQuotaDays ?? 7 } : null,
      tvQuota: user && Number.isSafeInteger(user.tvQuotaLimit) && user.tvQuotaLimit > 0 ? { limit: user.tvQuotaLimit, days: user.tvQuotaDays ?? 7 } : null,
    }))};
  }
  async list(){return this.project((await this.context()).rows);}
  async change(body){
    const split=body.enabled&&typeof body.enabled==='object'&&typeof body.enabled.movie==='boolean'&&typeof body.enabled.tv==='boolean';
    if(body.confirmation!=='OK'||(typeof body.enabled!=='boolean'&&!split))throw Error('Freigaberecht bestätigen.');
    return this.hub.mutate(['Seerr'],async()=>{
      const {s,rows}=await this.context();
      let row=rows.find(r=>r.username===body.username);
      if(row?.needsAccount){
        // Nur anlegen, wenn die Oberfläche denselben Zustand gesehen hat (noch kein Konto).
        if(body.userId!==null || body.previousPermissions!==null) throw Error('Kontozuordnung geändert. Neu laden.');
        const created=await seerrAdapter(s).importFromJellyfin(row.link);
        if(created.length!==1) throw Error('Seerr hat das Konto nicht eindeutig angelegt. Neu laden.');
        const u=created[0];
        if(u.id===1 || !Number.isSafeInteger(u.permissions) || (u.permissions & (2|16)))
          throw Error('Das neue Seerr-Konto hat unerwartete Rechte. In Seerr prüfen.');
        row={...row,user:u,needsAccount:false};
      } else if(!row?.editable || row.user.id!==positiveId(body.userId) || row.user.permissions!==body.previousPermissions)
        throw Error('Kontozuordnung oder Rechte geändert. Neu laden.');
      const seerr=seerrAdapter(s);
      const user=await seerr.user(row.user.id);
      if(user.id!==row.user.id || normalize(user.jellyfinUserId)!==normalize(row.user.jellyfinUserId) || user.permissions!==row.user.permissions)
        throw Error('Seerr-Konto wurde inzwischen geändert.');
      const permissions=requestPermissions(user.permissions,split?{movie:body.enabled.movie,tv:body.enabled.tv}:body.enabled);
      await seerr.setPermissions(user,permissions);
      return {ok:true};
    });
  }
  /** Anfragelimits je Person (Seerr: movieQuotaLimit/Days, tvQuotaLimit/Days; null = kein eigenes Limit). */
  async limits(body){
    if(body.confirmation!=='OK')throw Error('Limit mit OK bestätigen.');
    const movie=quota(body.movie??null), tv=quota(body.tv??null);
    return this.hub.mutate(['Seerr'],async()=>{
      const {s,rows}=await this.context();
      const row=rows.find(r=>r.username===body.username);
      if(!row?.user||!row.editable)throw Error(row?.reason||'Für diesen Zuschauer gibt es noch kein bearbeitbares Seerr-Konto.');
      const seerr=seerrAdapter(s);
      const saved=await seerr.setQuotas(row.user.id,{movieQuotaLimit:movie.limit,movieQuotaDays:movie.days,tvQuotaLimit:tv.limit,tvQuotaDays:tv.days});
      return {ok:true,movieQuota:movie.limit?movie:null,tvQuota:tv.limit?tv:null,saved:!!saved};
    });
  }
}
