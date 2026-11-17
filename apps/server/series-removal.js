import { createHash } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { positiveId } from './media-hub.js';
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export class SeriesRemoval {
  constructor(hub){this.hub=hub;}
  async list(){
    const {s}=await this.hub.context(['Sonarr']);
    const series=await s.arr('Sonarr','/series');
    return {series:series.map(v=>({id:v.id,title:v.title,files:v.statistics?.episodeFileCount||0,monitored:v.monitored}))};
  }
  async inspect(body){
    const {s,plan}=await this.hub.context(['Sonarr']);
    const id=positiveId(body.seriesId);
    const item=await s.arr('Sonarr',`/series/${id}`);
    if(item.id!==id||!item.path?.startsWith('/data/media/tv/')||path.posix.normalize(item.path)!==item.path)throw Error('Serienpfad ist nicht eindeutig in der verwalteten Bibliothek.');
    const all=await s.arr('Sonarr',`/episode?seriesId=${id}`);
    const files=await s.arr('Sonarr',`/episodefile?seriesId=${id}`);
    const season=body.season==null?null:positiveId(body.season);
    const episodeId=body.episodeId==null?null:positiveId(body.episodeId);
    const episodes=all.filter(e=>(season===null||e.seasonNumber===season)&&(episodeId===null||e.id===episodeId));
    if(!episodes.length)throw Error('Keine passenden Folgen gefunden.');
    const ids=new Set(episodes.map(e=>e.episodeFileId).filter(Boolean));
    const selected=files.filter(f=>ids.has(f.id));
    if(selected.length!==ids.size)throw Error('Dateizuordnung unvollständig.');
    const result=[];
    for(const f of selected){
      if(all.some(e=>e.episodeFileId===f.id&&!episodes.some(v=>v.id===e.id)))throw Error('Eine gemeinsame Datei enthält weitere Folgen. Wähle auch diese Folgen oder die ganze Staffel.');
      if(!f.path?.startsWith(item.path+'/')||path.posix.normalize(f.path)!==f.path)throw Error('Dateipfad außerhalb der Serie.');
      const host=path.join(plan.spec.path,f.path.slice('/data/'.length));
      if(await realpath(host)!==host)throw Error('Verknüpfter Medienpfad wird nicht automatisch gelöscht.');
      const stat=await lstat(host);
      if(!stat.isFile()||stat.size!==f.size)throw Error('Datei wurde geändert. Neu prüfen.');
      result.push({id:f.id,path:f.path,size:f.size,links:stat.nlink,identity:[stat.dev,stat.ino,stat.size,stat.mtimeMs],host});
    }
    const torrents=plan.spec.selected.includes('qBittorrent')?await s.qbit('/torrents/info'):[];
    // Source torrents are deliberately displayed separately. A name is not proof of ownership.
    const possible=torrents.filter(t=>t.category==='stackpilot-tv'&&String(t.name).toLowerCase().includes(item.title.toLowerCase())).map(t=>({name:t.name,size:t.size}));
    const downloads=[];
    let downloadWarning=null;
    if(torrents.length){
      try{
        const history=[];
        for(let page=1;page<=20;page++){
          const data=await s.arr('Sonarr',`/history?page=${page}&pageSize=250&sortKey=date&sortDirection=descending`);
          if(!Array.isArray(data.records)||!Number.isSafeInteger(data.totalRecords)||data.totalRecords>5000)throw Error('history');
          history.push(...data.records);
          if(history.length>=data.totalRecords)break;
        }
        for(const torrent of torrents){
          const hash=String(torrent.hash||'').toLowerCase();
          if(!/^[a-f0-9]{40}$/.test(hash)||torrent.category!=='stackpilot-tv'||!torrent.save_path?.startsWith('/data/downloads/'))continue;
          const matches=history.filter(h=>h.downloadId?.toLowerCase()===hash);
          if(!matches.some(h=>h.seriesId===id&&episodes.some(e=>e.id===h.episodeId)))continue;
          const shared=matches.some(h=>h.seriesId!==id||!episodes.some(e=>e.id===h.episodeId));
          const contents=await s.qbit('/torrents/files?hash='+hash);
          if(!Array.isArray(contents)||contents.some(f=>typeof f.name!=='string'||path.posix.isAbsolute(f.name)||f.name.split('/').includes('..')))throw Error('contents');
          downloads.push({hash,name:torrent.name,size:torrent.size,shared,files:contents.map(f=>({name:f.name,size:f.size})),fingerprint:digest([hash,torrent.name,torrent.size,torrent.save_path,torrent.content_path,torrent.added_on,contents.map(f=>[f.name,f.size])])});
        }
      }catch{downloadWarning='Download-Zuordnungen konnten nicht vollständig geprüft werden. Downloads werden nicht automatisch gelöscht.';downloads.length=0;}
    }
    const review=digest([plan.id,item.id,item.tvdbId,item.path,episodes.map(e=>[e.id,e.episodeFileId,e.monitored]),result,downloads]);
    return {s,plan,item,episodes,files:result,possible,downloads,downloadWarning,review,season,episodeId};
  }
  async preview(body){
    const c=await this.inspect(body);
    return {review:c.review,title:c.item.title,files:c.files.map(({id,path,size,links})=>({id,path,size,links})),
      possibleDownloads:c.possible,downloads:c.downloads.map(({fingerprint,...v})=>v),downloadWarning:c.downloadWarning,episodes:c.episodes.map(e=>({id:e.id,season:e.seasonNumber,number:e.episodeNumber})),
      message:'Diese Bibliotheksdateien werden gelöscht. Nur ausdrücklich angekreuzte Downloads werden mit ihrem gesamten angezeigten Inhalt entfernt. Gemeinsame Staffelpakete sind bei einer Teilauswahl gesperrt. Ähnlich benannte Downloads sind nur Hinweise.'};
  }
  async execute(body){
    if(body.confirmation!=='OK'||typeof body.stopMonitoring!=='boolean')throw Error('Dateilöschung und Überwachung ausdrücklich bestätigen.');
    return this.hub.mutate(['Sonarr'],async()=>{
      const c=await this.inspect(body);
      if(!Array.isArray(body.downloads||[])||(body.downloads||[]).some(hash=>!c.downloads.some(d=>d.hash===hash&&!d.shared)))throw Error('Nur eindeutig zugeordnete Downloads auswählen.');
      if(c.review!==body.review)throw Error('Dateien oder Überwachung wurden geändert. Neue Vorschau öffnen.');
      if(body.stopMonitoring){
        await c.s.arr('Sonarr','/episode/monitor',{method:'PUT',body:{episodeIds:c.episodes.map(e=>e.id),monitored:false}});
        if(c.season===null&&c.episodeId===null){
          await c.s.arr('Sonarr',`/series/${c.item.id}`,{method:'PUT',body:{...c.item,monitored:false}});
          if((await c.s.arr('Sonarr',`/series/${c.item.id}`)).monitored!==false)throw Error('Sonarr bestätigt das Ende der Serienüberwachung nicht.');
        }
        if(c.season!==null&&c.episodeId===null){
          const seasons=c.item.seasons.map(v=>v.seasonNumber===c.season?{...v,monitored:false}:v);
          await c.s.arr('Sonarr',`/series/${c.item.id}`,{method:'PUT',body:{...c.item,seasons}});
          if((await c.s.arr('Sonarr',`/series/${c.item.id}`)).seasons.find(v=>v.seasonNumber===c.season)?.monitored!==false)throw Error('Sonarr bestätigt das Ende der Staffelüberwachung nicht.');
        }
        const checked=await c.s.arr('Sonarr',`/episode?seriesId=${c.item.id}`);
        if(c.episodes.some(e=>checked.find(v=>v.id===e.id)?.monitored!==false))throw Error('Sonarr bestätigt das Ende der Folgenüberwachung nicht.');
      }
      const removed=[];
      try{
        for(const f of c.files){
          const stat=await lstat(f.host);
          if(await realpath(f.host)!==f.host||digest([stat.dev,stat.ino,stat.size,stat.mtimeMs])!==digest(f.identity))throw Error('Datei inzwischen geändert.');
          await c.s.arr('Sonarr',`/episodefile/${f.id}`,{method:'DELETE'});
          const remains=await lstat(f.host).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;});
          if(remains)throw Error('Bibliotheksdatei weiterhin vorhanden.');
          removed.push(f.id);
        }
      }catch{
        return {ok:false,message:`${removed.length} Dateien entfernt. Löschung nicht vollständig bestätigt. Neue Vorschau öffnen; verbleibende Dateien werden erneut geprüft.`};
      }
      for(const hash of body.downloads||[]){
        await c.s.qbit('/torrents/delete',{hashes:hash,deleteFiles:'true'});
        if((await c.s.qbit('/torrents/info')).some(t=>t.hash?.toLowerCase()===hash))
          return {ok:false,message:'Bibliotheksdateien entfernt, Download-Löschung noch nicht bestätigt. Neue Vorschau öffnen.'};
      }
      const remaining=await c.s.arr('Sonarr',`/episode?seriesId=${c.item.id}`);
      if(remaining.some(e=>c.episodes.some(v=>v.id===e.id)&&e.hasFile))return {ok:false,message:'Mindestens eine Folge wurde während der Löschung erneut importiert. Neue Vorschau öffnen.'};
      this.hub.library.cache.clear();
      return {ok:true,message:`${removed.length} Bibliotheksdateien entfernt. Jellyfin und Seerr werden abgeglichen. Nicht ausgewählte Downloadkopien und ein möglicher Sonarr-Papierkorb bleiben erhalten.`};
    }).then(async result=>{await this.hub.library.run(true).catch(()=>{});return result;});
  }
}
