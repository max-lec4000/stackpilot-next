import { compactProfile } from './quality-settings.js';
import { qualityPolicyKey } from './quality-policy.js';
import { sizeCap } from './size-limits.js';
const blockedName='StackPilot · Größenprüfung ausstehend';
export function blockedProfile(p, formatId) {
  return p?.name===blockedName && p.minFormatScore===1 && p.upgradeAllowed===false &&
    Array.isArray(p.formatItems) && p.formatItems.some(f=>f.format===formatId&&f.score===1) &&
    p.formatItems.every(f=>f.score===(f.format===formatId?1:0));
}
export function blockedFormat(f) {
  const spec=f?.specifications?.[0];
  return f?.name===blockedName && f.includeCustomFormatWhenRenaming===false && f.specifications.length===1 &&
    spec.implementation==='ReleaseTitleSpecification' && spec.required===true && spec.negate===false &&
    spec.fields?.length===1 && spec.fields[0].name==='value' && spec.fields[0].value==='(?!)';
}
export class SharedFilmStandard {
  constructor(hub,limits){Object.assign(this,{hub,limits});this.status={state:'checking',message:'Gemeinsamer Filmstandard wird geprüft.'};}
  key(plan){return `shared-film-standard:${plan.rootId||plan.id}`;}
  async configure(s,plan,setting){
    const vault=this.hub.engine.vault,key=this.key(plan);
    let stored=vault.get(key);
    const servers=await s.additional.seerr('/settings/radarr');
    const server=servers.find(r=>r.isDefault&&!r.is4k);
    if(!server||server.hostname!=='radarr'||Number(server.port)!==7878||server.useSsl||![undefined,'','/'].includes(server.baseUrl))
      throw Error('Der verwaltete Seerr-Radarr-Standard fehlt.');
    if(server.overrideRule?.length)throw Error('Seerr verwendet eigene Profilregeln. Diese zuerst prüfen; der gemeinsame Standard wurde nicht aktiviert.');
    if(stored && stored.serverId!==server.id)throw Error('Der Seerr-Standardserver wurde geändert.');
    if(stored?.rate && (!setting.rate || setting.capGiB)) {
      const movies=await s.arr('Radarr','/movie');
      if(movies.some(m=>m.qualityProfileId===stored.profileId&&!m.hasFile) || Object.keys(stored.handoffs||{}).length)
        throw Error('Es warten noch Filme auf die bisherige Laufzeitprüfung. Zuerst deren Laufzeit/Profil prüfen oder die Filme in Radarr entfernen, danach den Standard umstellen.');
    }
    if(!setting.rate&&!setting.capGiB){
      if(stored){
        if(![stored.profileId,stored.nextProfileId,stored.previous.id].includes(server.activeProfileId))throw Error('Seerr-Profil wurde extern geändert. Keine Überschreibung.');
        await s.additional.seerr(`/settings/radarr/${server.id}`,{method:'PUT',body:{...server,id:undefined,activeProfileId:stored.previous.id,activeProfileName:stored.previous.name}});
        if((await s.additional.seerr('/settings/radarr')).find(r=>r.id===server.id)?.activeProfileId!==stored.previous.id)throw Error('Rückkehr zum Seerr-Profil nicht bestätigt.');
        vault.set(key,null);
      }
      this.status={state:'off',message:'Kein gemeinsamer Größenstandard aktiv.'};
      return;
    }
    let profile;
    if(setting.capGiB){
      const rule=await this.limits.ensureCap(s,plan,setting.capGiB);
      await this.limits.verify(s,rule);
      profile=await s.arr('Radarr',`/qualityprofile/${rule.profileId}`);
    }else{
      let format=(await s.arr('Radarr','/customformat')).find(f=>f.name===blockedName);
      if(!format){
        const schema=(await s.arr('Radarr','/customformat/schema')).find(f=>f.implementation==='ReleaseTitleSpecification');
        if(!schema?.fields?.some(f=>f.name==='value'))throw Error('Radarr unterstützt die erwartete Sperrregel nicht.');
        format=await s.arr('Radarr','/customformat',{method:'POST',body:{name:blockedName,includeCustomFormatWhenRenaming:false,specifications:[{...schema,name:'Bis zur Größenprüfung gesperrt',required:true,negate:false,fields:schema.fields.map(f=>({...f,value:'(?!)'}))}]}});
      }
      if(!blockedFormat(format))throw Error('Die Sperrregel wurde verändert.');
      const profiles=await s.arr('Radarr','/qualityprofile');
      profile=profiles.find(p=>p.name===blockedName);
      if(profile&&!blockedProfile(profile,format.id))throw Error('Das Sperrprofil wurde verändert.');
      if(!profile){
        const schema=compactProfile(await s.arr('Radarr','/qualityprofile/schema'));
        profile=await s.arr('Radarr','/qualityprofile',{method:'POST',body:{...schema,name:blockedName,minFormatScore:1,cutoffFormatScore:1,formatItems:schema.formatItems.map(f=>({...f,score:f.format===format.id?1:0}))}});
      }
      if(!blockedProfile(await s.arr('Radarr',`/qualityprofile/${profile.id}`),format.id))throw Error('Radarr bestätigt das Sperrprofil nicht.');
    }
    if(stored && ![stored.profileId,stored.previous.id,stored.nextProfileId].includes(server.activeProfileId))throw Error('Seerr-Standard wurde extern geändert. Keine Überschreibung.');
    stored={...stored,serverId:server.id,previous:stored?.previous||{id:server.activeProfileId,name:server.activeProfileName},nextProfileId:profile.id,pending:true};
    vault.set(key,stored);
    await s.additional.seerr(`/settings/radarr/${server.id}`,{method:'PUT',body:{...server,id:undefined,activeProfileId:profile.id,activeProfileName:profile.name}});
    const confirmed=(await s.additional.seerr('/settings/radarr')).find(r=>r.id===server.id);
    if(confirmed?.activeProfileId!==profile.id)throw Error('Seerr hat den gemeinsamen Filmstandard nicht bestätigt. Erneut speichern.');
    vault.set(key,{...stored,profileId:profile.id,rate:setting.rate||0,capGiB:setting.capGiB||0,pending:false});
    this.status={state:'ready',message:'Gemeinsamer Seerr-Standard bestätigt. Bei Laufzeitregeln bleiben neue Filme bis zur Größenprüfung gesperrt.'};
  }
  async run(){
    if(this.running)return;
    this.running=true;
    try{
      const {plan}=await this.hub.context(['Seerr','Radarr']);
      const setting=this.limits.config(plan);
      if(!setting.rate&&!setting.capGiB&&!this.hub.engine.vault.get(this.key(plan))){this.status={state:'off',message:'Kein gemeinsamer Größenstandard aktiv.'};return;}
      await this.hub.mutate(['Seerr','Radarr'],async({s,plan})=>{
        const setting=this.limits.config(plan);
        if(!setting.rate&&!setting.capGiB){await this.configure(s,plan,setting);return;}
        let state=this.hub.engine.vault.get(this.key(plan));
        if(!state||state.pending||state.rate!==(setting.rate||0)||state.capGiB!==(setting.capGiB||0)){
          await this.configure(s,plan,setting);state=this.hub.engine.vault.get(this.key(plan));
        }
        const server=(await s.additional.seerr('/settings/radarr')).find(r=>r.id===state.serverId);
        if(server?.activeProfileId!==state.profileId || server.overrideRule?.length)throw Error('Seerr verwendet einen abweichenden Standard. Medienprofile erneut speichern.');
        if(setting.capGiB){await this.limits.verify(s,await this.limits.ensureCap(s,plan,setting.capGiB));return;}
        const format=(await s.arr('Radarr','/customformat')).find(f=>f.name===blockedName);
        if(!blockedFormat(format)||!blockedProfile(await s.arr('Radarr',`/qualityprofile/${state.profileId}`),format.id))throw Error('Das Radarr-Sperrprofil wurde geändert.');
        const movies=await s.arr('Radarr','/movie');
        const waiting=movies.filter(m=>m.qualityProfileId===state.profileId||state.handoffs?.[m.id]);
        const blocked=[];
        for(const movie of waiting){
          if(!movie.monitored||movie.hasFile){
            if(state.handoffs?.[movie.id]){delete state.handoffs[movie.id];this.hub.engine.vault.set(this.key(plan),state);}
            continue;
          }
          if(!(Number(movie.runtime)>0)){blocked.push(movie.title);continue;}
          const rule=await this.limits.ensureCap(s,plan,sizeCap(Number(movie.runtime),setting.rate));
          await this.limits.verify(s,rule);
          await this.hub.requireVpn();
          const fresh=await s.arr('Radarr',`/movie/${movie.id}`);
          const handoff=state.handoffs?.[movie.id];
          if(fresh.tmdbId!==movie.tmdbId||fresh.hasFile||!fresh.monitored)continue;
          if(handoff && (handoff.tmdbId!==fresh.tmdbId||handoff.profileId!==rule.profileId))throw Error('Eine ausstehende Filmsuche hat geänderte Vorgaben. Filmprofil prüfen.');
          if(fresh.qualityProfileId!==state.profileId&&fresh.qualityProfileId!==handoff?.profileId)throw Error('Filmprofil während Größenprüfung geändert. Keine Suche gestartet.');
          state.handoffs={...state.handoffs,[movie.id]:{tmdbId:movie.tmdbId,profileId:rule.profileId}};
          this.hub.engine.vault.set(this.key(plan),state);
          await s.arr('Radarr',`/movie/${movie.id}`,{method:'PUT',body:{...fresh,qualityProfileId:rule.profileId}});
          const confirmed=await s.arr('Radarr',`/movie/${movie.id}`);
          if(confirmed.qualityProfileId!==rule.profileId)throw Error('Radarr bestätigt die Größenregel nicht.');
          this.hub.engine.vault.set(qualityPolicyKey(plan,'movie',movie.tmdbId),{profileId:rule.profileId,serverId:state.serverId,compact:true,size:{...rule,rate:setting.rate}});
          await s.arr('Radarr','/command',{method:'POST',body:{name:'MoviesSearch',movieIds:[movie.id]}});
          delete state.handoffs[movie.id];this.hub.engine.vault.set(this.key(plan),state);
        }
        if(blocked.length)throw Error(`${blocked.length} Film(e) warten auf eine bestätigte Laufzeit. Bis dahin bleiben Downloads gesperrt.`);
      });
      this.status=setting.rate||setting.capGiB?{state:'ready',message:'Gemeinsamer Standard für neue Standardanfragen aus Seerr, Streamyfin, Couchdeck und StackPilot bestätigt.'}:{state:'off',message:'Kein gemeinsamer Größenstandard aktiv.'};
    }catch(e){this.status={state:'blocked',message:e.message};}finally{this.running=false;}
  }
  close(){clearInterval(this.timer);}
  start(){this.timer=setInterval(()=>void this.run(),30000);this.timer.unref?.();void this.run();}
}
