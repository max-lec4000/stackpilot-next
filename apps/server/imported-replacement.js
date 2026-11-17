import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, constants } from 'node:fs';
import { copyFile, lstat, mkdir, realpath, statfs } from 'node:fs/promises';
import path from 'node:path';
import { positiveId } from './media-hub.js';
import { verifyCurrentQuality } from './quality-policy.js';
const fingerprint=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
async function checksum(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
function qualityIds(items){return items.flatMap(i=>i.items?.length?(i.allowed===false?[]:qualityIds(i.items)):i.allowed&&i.quality?[i.quality.id]:[]);}
export function replacementAllowed(release,target,profile,cap,episode){
  const existingOnly=release.rejections?.length>0 && release.rejections.every(r=>
    /^(Existing file (meets cutoff|on disk is of equal or higher)|Quality for existing file|Not an upgrade for existing|Upgrades are not allowed|Existing Custom Format Score)/i.test(r));
  return release.protocol==='torrent' && release.downloadAllowed===true &&
    (release.approved===true||existingOnly) && /^[a-f0-9]{40}$/i.test(release.infoHash||'') &&
    Number.isFinite(release.customFormatScore)&&release.customFormatScore>=profile.minFormatScore && qualityIds(profile.items).includes(release.quality?.quality?.id) &&
    Number.isFinite(release.size)&&release.size>0&&(!cap||release.size<=cap*1024**3)&&
    (episode ? release.fullSeason===false&&release.mappedEpisodeInfo?.length===1&&release.mappedEpisodeInfo[0].id===episode.id : release.movieId===target.item.id || release.mappedMovieId===target.item.id) &&
    typeof release.guid==='string'&&release.guid.length>0&&Number.isSafeInteger(release.indexerId)&&release.indexerId>0;
}
export class ImportedReplacement {
  constructor(hub,diagnostics){Object.assign(this,{hub,diagnostics});}
  async context(body){
    const {s,plan}=await this.hub.context(['Seerr']);
    const target=await this.diagnostics.target(s,positiveId(body.requestId));
    if(!target.item)throw Error('Medium ist nicht im verwalteten Dienst vorhanden.');
    await verifyCurrentQuality(this.hub,s,plan,target);
    let episode,file;
    if(target.kind==='movie')file=target.item.movieFile;
    else{
      episode=await s.arr('Sonarr',`/episode/${positiveId(body.episodeId)}`);
      if(episode.seriesId!==target.item.id||!episode.hasFile)throw Error('Eine vorhandene Folge dieser Serie auswählen.');
      file=await s.arr('Sonarr',`/episodefile/${positiveId(episode.episodeFileId)}`);
      const siblings=await s.arr('Sonarr',`/episode?seriesId=${target.item.id}`);
      if(siblings.filter(e=>e.episodeFileId===file.id).length!==1)throw Error('Mehrfolgendateien können nicht einzeln ausgetauscht werden.');
    }
    if(!file?.id)throw Error('Keine vorhandene Bibliotheksdatei bestätigt.');
    const containerPath=file.path||path.posix.join(target.item.path,file.relativePath||'');
    const prefix=target.kind==='movie'?'/data/media/movies/':'/data/media/tv/';
    if(!containerPath.startsWith(prefix)||path.posix.normalize(containerPath)!==containerPath)throw Error('Dateipfad außerhalb der verwalteten Bibliothek.');
    const host=path.join(plan.spec.path,containerPath.slice('/data/'.length));
    if(await realpath(host)!==host)throw Error('Verknüpfter Dateipfad nicht unterstützt.');
    const stat=await lstat(host);
    if(!stat.isFile()||stat.size!==file.size)throw Error('Datei wurde geändert.');
    const profile=await s.arr(target.service,`/qualityprofile/${target.item.qualityProfileId}`);
    const policy=this.hub.engine.vault.get(`quality-policy:${plan.rootId||plan.id}:${target.kind}:${target.mediaId}`);
    const automatic=target.kind==='movie'?this.hub.engine.vault.get(`film-size:${plan.rootId||plan.id}:${target.mediaId}`):null;
    const caps=[policy?.size?.capGiB,automatic?.rule?.cap].filter(v=>Number.isFinite(v)&&v>0);
    const cap=caps.length?Math.min(...caps):0;
    return {s,plan,target,episode,file,host,containerPath,profile,cap,identity:[stat.dev,stat.ino,stat.size,stat.mtimeMs]};
  }
  async preview(body){
    const c=await this.context(body);
    const route=c.episode?`/release?episodeId=${c.episode.id}`:`/release?movieId=${c.target.item.id}`;
    const releases=await c.s.arr(c.target.service,route);
    const results=releases.filter(r=>replacementAllowed(r,c.target,c.profile,c.cap,c.episode));
    const id=randomUUID(),record={id,planId:c.plan.id,rootId:c.plan.rootId||c.plan.id,requestId:body.requestId,episodeId:body.episodeId||null,fileId:c.file.id,identity:c.identity,profile:c.profile.id,profileProof:fingerprint(c.profile),cap:c.cap,expires:Date.now()+600000,
      candidates:results.map(r=>({guid:r.guid,indexerId:r.indexerId,title:String(r.title).slice(0,240),size:r.size,hash:r.infoHash.toLowerCase(),proof:fingerprint([r.title,r.size,r.quality,r.customFormatScore,r.infoHash])}))};
    this.hub.engine.vault.set('imported-replacement:'+id,record);
    return {id,candidates:record.candidates,previousSize:c.file.size,capGiB:c.cap,message:'Die bisherige Datei bleibt während des Downloads verfügbar. Vor dem Start wird eine geprüfte Sicherung erstellt. Radarr/Sonarr prüft und importiert den Ersatz. Die Sicherung bleibt für eine Wiederherstellung erhalten.'};
  }
  async start(body){
    if(body.confirmation!=='OK'||typeof body.previewId!=='string'||!/^[a-f0-9-]{36}$/.test(body.previewId))throw Error('Austausch bestätigen.');
    await this.hub.requireVpn();
    return this.hub.mutate(['Seerr'],async()=>{
      const key='imported-replacement:'+body.previewId,record=this.hub.engine.vault.get(key);
      if(!record||record.expires<Date.now()||record.started)throw Error('Vorschau abgelaufen oder Austausch bereits gestartet.');
      const listKey='imported-replacements:'+(this.hub.engine.current().plan.rootId||this.hub.engine.current().plan.id);
      if((this.hub.engine.vault.get(listKey)||[]).map(id=>this.hub.engine.vault.get('imported-replacement:'+id)).some(j=>j?.requestId===record.requestId&&j.episodeId===record.episodeId&&!['completed','restored'].includes(j.state)))throw Error('Ein Austausch für diese Datei ist bereits offen.');
      const candidate=record.candidates.find(r=>r.guid===body.guid&&r.indexerId===body.indexerId);
      if(!candidate)throw Error('Nur einen geprüften Treffer auswählen.');
      const c=await this.context(record);
      if(c.plan.id!==record.planId||c.file.id!==record.fileId||c.profile.id!==record.profile||fingerprint(c.profile)!==record.profileProof||fingerprint(c.identity)!==fingerprint(record.identity)||c.cap!==record.cap)throw Error('Datei oder Profil inzwischen geändert.');
      const releases=await c.s.arr(c.target.service,c.episode?`/release?episodeId=${c.episode.id}`:`/release?movieId=${c.target.item.id}`);
      const release=releases.find(r=>r.guid===candidate.guid&&r.indexerId===candidate.indexerId&&r.size===candidate.size);
      if(!release||fingerprint([release.title,release.size,release.quality,release.customFormatScore,release.infoHash])!==candidate.proof||!replacementAllowed(release,c.target,c.profile,c.cap,c.episode))throw Error('Ersatz erfüllt die Vorgaben nicht mehr.');
      const base=path.join(c.plan.spec.path,'.stackpilot-versions');
      await mkdir(base,{recursive:true,mode:0o700});
      if(await realpath(base)!==base)throw Error('Sicherungsordner ist verknüpft.');
      const disk=await statfs(base);
      if(disk.bavail*disk.bsize<c.file.size+candidate.size+1024**3)throw Error('Nicht genug Platz für Sicherung und Ersatzdownload.');
      const directory=path.join(base,record.id);await mkdir(directory,{mode:0o700});
      const backup=path.join(directory,path.basename(c.host));
      await copyFile(c.host,backup,constants.COPYFILE_EXCL);
      const originalHash=await checksum(c.host);
      const afterCopy=await lstat(c.host);
      if(fingerprint([afterCopy.dev,afterCopy.ino,afterCopy.size,afterCopy.mtimeMs])!==fingerprint(c.identity))throw Error('Original wurde während der Sicherung verändert. Kein Download gestartet.');
      if(originalHash!==await checksum(backup))throw Error('Sicherung stimmt nicht mit dem Original überein. Kein Download gestartet.');
      record.started=true;record.backup=backup;record.originalPath=c.host;record.originalHash=originalHash;record.service=c.target.service;record.itemId=c.target.item.id;record.mediaId=c.target.mediaId;record.hash=candidate.hash;record.containerPath=c.containerPath;record.oldQuality=c.file.quality;record.oldLanguages=c.file.languages;record.kind=c.target.kind;record.state='starting';
      this.hub.engine.vault.set(key,record);
      this.hub.engine.vault.set(listKey,[...new Set([...(this.hub.engine.vault.get(listKey)||[]),record.id])]);
      await c.s.arr(c.target.service,'/release',{method:'POST',body:{guid:candidate.guid,indexerId:candidate.indexerId}});
      record.state='requested';this.hub.engine.vault.set(key,record);
      return {ok:true,message:'Ersatz angefordert. Die bisherige Datei bleibt bis zum Import verfügbar; ihre geprüfte Sicherung bleibt erhalten.',backupPath:backup};
    });
  }
  async jobs(){
    const {plan}=await this.hub.context(['Seerr']);
    return {jobs:(this.hub.engine.vault.get('imported-replacements:'+(plan.rootId||plan.id))||[]).map(id=>this.hub.engine.vault.get('imported-replacement:'+id)).filter(Boolean).map(r=>({id:r.id,requestId:r.requestId,episodeId:r.episodeId,state:r.state,message:r.message||'',backupPath:r.backup}))};
  }
  async finish(id){
    return this.hub.mutate(['Seerr','qBittorrent'],async({s,plan})=>{
      const key='imported-replacement:'+id,r=this.hub.engine.vault.get(key);
      if(!r||r.rootId!==(plan.rootId||plan.id)||!['starting','requested','importing'].includes(r.state))return;
      const save=()=>this.hub.engine.vault.set(key,r);
      const target=await this.diagnostics.target(s,r.requestId);
      if(target.item?.id!==r.itemId||target.mediaId!==r.mediaId||target.item.qualityProfileId!==r.profile)throw Error('Zuordnung oder Profil des Austauschs geändert.');
      await verifyCurrentQuality(this.hub,s,plan,target);
      let file=target.item.movieFile;
      if(r.episodeId){const episode=await s.arr('Sonarr',`/episode/${r.episodeId}`);file=episode.episodeFileId?await s.arr('Sonarr',`/episodefile/${episode.episodeFileId}`):null;}
      if(file?.id && file.id!==r.fileId){
        const history=await s.arr(r.service,r.kind==='movie'?`/history/movie?movieId=${r.itemId}`:`/history?episodeId=${r.episodeId}&page=1&pageSize=100`);
        const entries=Array.isArray(history)?history:history.records;
        if(!entries?.some(h=>h.downloadId?.toLowerCase()===r.hash && /downloadFolderImported/i.test(h.eventType)))throw Error('Import kann dem ausgewählten Ersatz nicht eindeutig zugeordnet werden.');
        const profile=await s.arr(r.service,`/qualityprofile/${r.profile}`);
        if(!qualityIds(profile.items).includes(file.quality?.quality?.id)||(r.cap&&file.size>r.cap*1024**3))throw Error('Importierte Datei entspricht nicht dem Zielprofil. Sicherung bleibt erhalten.');
        r.state='completed';r.newFileId=file.id;r.message='Ersatzimport bestätigt. Die bisherige Version bleibt als Sicherung erhalten.';save();return;
      }
      const torrents=await s.qbit('/torrents/info');const torrent=torrents.find(t=>t.hash?.toLowerCase()===r.hash);
      if(!torrent||torrent.progress<1)return;
      const expected=r.kind==='movie'?'stackpilot-movies':'stackpilot-tv';
      if(torrent.category!==expected||!torrent.content_path?.startsWith('/data/downloads/complete/'))throw Error('Ersatzdownload nicht eindeutig zugeordnet.');
      if(r.state==='importing'){
        const command=await s.arr(r.service,`/command/${r.commandId}`);
        if(command.status==='failed')throw Error('Import fehlgeschlagen. Die bisherige Sicherung bleibt erhalten.');
        return;
      }
      const sourceHost=path.join(plan.spec.path,torrent.content_path.slice('/data/'.length));
      if(await realpath(sourceHost)!==sourceHost)throw Error('Downloadpfad ist verknüpft.');
      const sourceStat=await lstat(sourceHost);
      const folder=sourceStat.isFile()?path.posix.dirname(torrent.content_path):torrent.content_path;
      const candidates=await s.arr(r.service,`/manualimport?downloadId=${r.hash}&folder=${encodeURIComponent(folder)}&filterExistingFiles=false`);
      const matched=candidates.filter(f=>(sourceStat.isFile()?f.path===torrent.content_path:f.path?.startsWith(torrent.content_path+'/')) && (r.kind==='movie'?f.movie?.id===r.itemId:f.series?.id===r.itemId&&f.episodes?.length===1&&f.episodes[0].id===r.episodeId));
      if(matched.length!==1)throw Error('Ersatzdatei nicht eindeutig. Kein manueller Import.');
      const candidate=matched[0];
      const profile=await s.arr(r.service,`/qualityprofile/${r.profile}`);
      if(candidate.rejections?.some(r=>!/^Not an upgrade for existing|^Existing file (meets cutoff|on disk is of equal or higher)|^Quality for existing file|^Upgrades are not allowed/i.test(r.reason||r))||!qualityIds(profile.items).includes(candidate.quality?.quality?.id)||
          !Number.isFinite(candidate.customFormatScore)||candidate.customFormatScore<profile.minFormatScore||
          !Number.isFinite(candidate.size)||candidate.size<=0||(r.cap&&candidate.size>r.cap*1024**3)||
          !candidate.path?.startsWith('/data/downloads/complete/'))throw Error('Dienstprüfung lehnt Ersatzdatei ab. Kein Import.');
      if(await checksum(r.backup)!==r.originalHash)throw Error('Die bisherige Sicherung ist nicht bestätigt.');
      const result=await s.arr(r.service,'/command',{method:'POST',body:{name:'ManualImport',importMode:'copy',files:[{
        path:candidate.path,quality:candidate.quality,languages:candidate.languages,releaseGroup:candidate.releaseGroup,
        downloadId:r.hash,...(r.kind==='movie'?{movieId:r.itemId}:{seriesId:r.itemId,episodeIds:[r.episodeId]})
      }]}});
      r.commandId=positiveId(result.id);r.state='importing';save();
    });
  }
  async restore(body){
    if(body.confirmation!=='OK'||typeof body.id!=='string'||!/^[a-f0-9-]{36}$/.test(body.id))throw Error('Wiederherstellung bestätigen.');
    return this.hub.mutate(['Seerr'],async({s,plan})=>{
      const key='imported-replacement:'+body.id,r=this.hub.engine.vault.get(key);
      if(!r||r.rootId!==(plan.rootId||plan.id)||!['completed','starting','requested','importing'].includes(r.state))throw Error('Dieser Austausch kann nicht zurückgenommen werden.');
      const target=await this.diagnostics.target(s,r.requestId);
      if(target.item?.id!==r.itemId||target.mediaId!==r.mediaId)throw Error('Medienzuordnung geändert.');
      const current=r.episodeId?(await s.arr('Sonarr',`/episode/${r.episodeId}`)).episodeFileId:target.item.movieFile?.id;
      if(current && current!==r.newFileId && current!==r.fileId)throw Error('Die Bibliotheksdatei wurde seit dem Ersatz geändert. Keine automatische Rückkehr.');
      const commands=await s.arr(r.service,'/command');
      if(commands.some(c=>['queued','started'].includes(c.status)&&/import|scan/i.test(c.name||c.body?.name||'')))
        throw Error('Eine native Import- oder Dateiprüfung läuft. Danach erneut zurückkehren.');
      const base=path.join(plan.spec.path,'.stackpilot-versions',r.id);
      if(path.dirname(r.backup)!==base||await realpath(r.backup)!==r.backup||await checksum(r.backup)!==r.originalHash)throw Error('Sicherung nicht bestätigt.');
      if(r.hash){
        await s.qbit('/torrents/delete',{hashes:r.hash,deleteFiles:'false'});
        if((await s.qbit('/torrents/info')).some(t=>t.hash?.toLowerCase()===r.hash))throw Error('Ersatztransfer konnte noch nicht beendet werden.');
      }
      r.state='restoring';this.hub.engine.vault.set(key,r);
      const result=await s.arr(r.service,'/command',{method:'POST',body:{name:'ManualImport',importMode:'copy',files:[{
        path:'/data/.stackpilot-versions/'+r.id+'/'+path.basename(r.backup),quality:r.oldQuality,languages:r.oldLanguages,
        ...(r.kind==='movie'?{movieId:r.itemId}:{seriesId:r.itemId,episodeIds:[r.episodeId]})
      }]}});
      r.restoreCommandId=positiveId(result.id);this.hub.engine.vault.set(key,r);
      return {ok:true,message:'Rückkehr zur gesicherten Datei angefordert. Bestätigung folgt nach dem Import.'};
    });
  }
  async checkRestore(id){
    return this.hub.mutate(['Seerr'],async({s,plan})=>{
      const key='imported-replacement:'+id,r=this.hub.engine.vault.get(key);
      if(!r||r.rootId!==(plan.rootId||plan.id)||r.state!=='restoring'||!r.restoreCommandId)return;
      const command=await s.arr(r.service,`/command/${r.restoreCommandId}`);
      if(command.status==='failed')throw Error('Rückimport fehlgeschlagen; Sicherung bleibt erhalten.');
      if(command.status!=='completed')return;
      const target=await this.diagnostics.target(s,r.requestId);
      if(target.item?.id!==r.itemId||target.mediaId!==r.mediaId)throw Error('Medienzuordnung geändert.');
      const file=r.episodeId?await s.arr('Sonarr',`/episodefile/${positiveId((await s.arr('Sonarr',`/episode/${r.episodeId}`)).episodeFileId)}`):target.item.movieFile;
      const container=file.path||path.posix.join(target.item.path,file.relativePath||'');
      if(!container.startsWith('/data/media/')||path.posix.normalize(container)!==container)throw Error('Rückimportpfad nicht bestätigt.');
      const host=path.join(plan.spec.path,container.slice('/data/'.length));
      if(await realpath(host)!==host||await checksum(host)!==r.originalHash)throw Error('Rückimport stimmt noch nicht mit der Sicherung überein.');
      r.state='restored';r.message='Bisherige Datei mit Prüfsumme wiederhergestellt. Zielprofil bleibt unverändert.';this.hub.engine.vault.set(key,r);
    });
  }
  async run(){
    if(this.running)return;this.running=true;
    try{for(const job of (await this.jobs()).jobs.filter(j=>['starting','requested','importing','restoring'].includes(j.state))){
      try{if(job.state==='restoring')await this.checkRestore(job.id);else await this.finish(job.id);}catch(e){const key='imported-replacement:'+job.id,r=this.hub.engine.vault.get(key);if(r){r.message=e.message;this.hub.engine.vault.set(key,r);}}
    }}catch{}finally{this.running=false;}
  }
  startWorker(){this.timer=setInterval(()=>void this.run(),30000);this.timer.unref?.();}
  close(){clearInterval(this.timer);}

}
