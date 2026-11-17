import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir,copyFile,readFile,rm,truncate,access} from 'node:fs/promises';
import {StateStore} from '../../apps/server/state.js';
import {Vault} from '../../apps/server/vault.js';
import {DeploymentEngine} from '../../apps/server/installer.js';
import {MediaHub} from '../../apps/server/media-hub.js';
import {RequestDiagnostics} from '../../apps/server/request-diagnostics.js';
import {SeriesRemoval} from '../../apps/server/series-removal.js';
import {ImportedReplacement} from '../../apps/server/imported-replacement.js';
if(os.hostname()!=='sp-test')throw Error('Nur in sp-test ausführen.');
const tv=process.env.TEST_EPISODE==='1';const service=tv?'Sonarr':'Radarr';
const store=new StateStore('/var/lib/stackpilot'),vault=new Vault(store),engine=new DeploymentEngine(store,vault);
const hub=new MediaHub(engine,{check:async()=>({state:'connected'})});
const {s,plan}=await hub.context([service,'Seerr','qBittorrent']);
assert.equal((await s.arr(service,tv?'/series':'/movie')).length,0,'Requires empty test ARR');
assert.equal((await s.arr(service,'/indexer')).length,0,'No external indexers allowed');
const bencode=v=>Buffer.isBuffer(v)?Buffer.concat([Buffer.from(v.length+':'),v]):typeof v==='string'?bencode(Buffer.from(v)):typeof v==='number'?Buffer.from('i'+v+'e'):Array.isArray(v)?Buffer.concat([Buffer.from('l'),...v.map(bencode),Buffer.from('e')]):Buffer.concat([Buffer.from('d'),...Object.keys(v).sort().flatMap(k=>[bencode(k),bencode(v[k])]),Buffer.from('e')]);
let movie,indexer,request,hash,episodeId;const fixturePort=9878,relay=await engine.relay(plan),jobsBefore=vault.get('imported-replacements:'+(plan.rootId||plan.id));
const oldServers=await s.additional.seerr('/settings/'+service.toLowerCase());
async function waitCommand(id){for(let i=0;i<90;i++){const c=await s.arr(service,'/command/'+id);if(c.status==='completed')return;if(c.status==='failed')throw Error('Native command failed');await new Promise(r=>setTimeout(r,1000));}throw Error('Native command timeout');}
try{
  const server=oldServers.find(v=>v.isDefault&&!v.is4k),profile=(await s.arr(service,'/qualityprofile')).find(v=>v.name==='HD-720p');assert.ok(profile);
  await s.additional.seerr('/settings/'+service.toLowerCase()+'/'+server.id,{method:'PUT',body:{...server,id:undefined,activeProfileId:profile.id,activeProfileName:profile.name,preventSearch:true}});
  const mediaId=tv?(await s.additional.seerr('/search?query=How%20to%20Get%20Away%20with%20Murder')).results.find(r=>r.mediaType==='tv'&&r.name==='How to Get Away with Murder').id:10378;
  const detail=await s.additional.seerr((tv?'/tv/':'/movie/')+mediaId);
  if(detail.mediaInfo?.id)await s.additional.seerr('/media/'+detail.mediaInfo.id,{method:'DELETE'});
  request=await s.additional.seerr('/request',{method:'POST',body:{mediaType:tv?'tv':'movie',mediaId,is4k:false,serverId:server.id,profileId:profile.id,...(tv?{seasons:[1]}:{})}});
  assert.ok(Number.isSafeInteger(request?.id),'Native request must have a concrete id: '+JSON.stringify(request));
  for(let i=0;i<60;i++){movie=(await s.arr(service,tv?'/series':'/movie')).find(m=>tv?m.tvdbId===detail.externalIds.tvdbId:m.tmdbId===mediaId);if(movie)break;await new Promise(r=>setTimeout(r,1000));}assert.ok(movie);
  if(tv){for(let i=0;i<60;i++){const e=(await s.arr(service,`/episode?seriesId=${movie.id}`)).find(e=>e.seasonNumber===1&&e.episodeNumber===1);if(e){episodeId=e.id;break;}await new Promise(r=>setTimeout(r,1000));}assert.ok(episodeId);}
  const title=movie.title.replace(/[^a-zA-Z0-9]+/g,'.')+(tv?'.S01E01':'.'+movie.year)+'.720p.WEB-DL';
  const folder=path.join(plan.spec.path,movie.path.slice('/data/'.length));await mkdir(folder,{recursive:true});
  for(const [color,name] of [['blue','old'],['red','new']]){
    const temp='/tmp/sp-replace-'+name+'.mkv';
    if(await access(temp).then(()=>true,()=>false))continue;
    execFileSync('docker',['exec','stackpilot-jellyfin-1','/usr/lib/jellyfin-ffmpeg/ffmpeg','-hide_banner','-loglevel','error','-f','lavfi','-i','color=c='+color+':s=1280x720:r=1','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t','1800','-c:v','libx264','-c:a','aac','-y',temp],{stdio:'pipe'});
    execFileSync('docker',['cp','stackpilot-jellyfin-1:'+temp,temp],{stdio:'pipe'});await truncate(temp,name==='old'?24*1024**2:20*1024**2);
  }
  if(tv){await truncate('/tmp/sp-replace-old.mkv',180*1024**2);await truncate('/tmp/sp-replace-new.mkv',150*1024**2);}
  const original=path.join(folder,title+'-OLD.mkv');await copyFile('/tmp/sp-replace-old.mkv',original);
  await waitCommand((await s.arr(service,'/command',{method:'POST',body:tv?{name:'RescanSeries',seriesId:movie.id}:{name:'RescanMovie',movieId:movie.id}})).id);
  movie=await s.arr(service,(tv?'/series/':'/movie/')+movie.id);assert.ok(tv?(await s.arr(service,'/episode/'+episodeId)).hasFile:movie.hasFile,'Initial synthetic media imported');
  const filename=title+'-SP'+randomUUID().slice(0,8)+'.mkv',data=await readFile('/tmp/sp-replace-new.mkv'),pieces=[];
  for(let offset=0;offset<data.length;offset+=262144)pieces.push(createHash('sha1').update(data.subarray(offset,offset+262144)).digest());
  const info={length:data.length,name:filename,'piece length':262144,pieces:Buffer.concat(pieces)},torrent=bencode({info});hash=createHash('sha1').update(bencode(info)).digest('hex');
  await mkdir(path.join(plan.spec.path,'downloads/complete/movies'),{recursive:true});await copyFile('/tmp/sp-replace-new.mkv',path.join(plan.spec.path,'downloads/complete/movies',filename));
  const caps='<?xml version="1.0"?><caps><server version="1.0" title="Fixture"/><limits max="100" default="100"/><searching><search available="yes" supportedParams="q"/><movie-search available="yes" supportedParams="q,imdbid,tmdbid"/><tv-search available="yes" supportedParams="q,season,ep,tvdbid"/></searching><categories><category id="2000" name="Movies"/><category id="5000" name="TV"/></categories></caps>';
  const rss=`<?xml version="1.0"?><rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel><title>Fixture</title><item><title>${filename.slice(0,-4)}</title><guid isPermaLink="false">${hash}</guid><link>http://api-relay:${fixturePort}/fixture.torrent</link><pubDate>${new Date().toUTCString()}</pubDate><size>${data.length}</size><category>${tv?5000:2000}</category><enclosure url="http://api-relay:${fixturePort}/fixture.torrent" length="${data.length}" type="application/x-bittorrent"/><torznab:attr name="category" value="${tv?5000:2000}"/><torznab:attr name="seeders" value="1"/><torznab:attr name="infohash" value="${hash}"/><torznab:attr name="imdb" value="${movie.imdbId?.replace('tt','')}"/></item></channel></rss>`;
  const code=`const http=require('http'),caps=${JSON.stringify(caps)},rss=${JSON.stringify(rss)},torrent=Buffer.from('${torrent.toString('base64')}','base64');const server=http.createServer((req,res)=>{if(req.url==='/stop'){res.end();server.close();return;}if(req.url==='/fixture.torrent'){res.end(torrent);return;}res.setHeader('Content-Type','application/xml');res.end(new URL(req.url,'http://localhost').searchParams.get('t')==='caps'?caps:rss);});server.listen(${fixturePort},'0.0.0.0');`;
  execFileSync('docker',['exec','-d',relay,'node','-e',code]);
  const schema=(await s.arr(service,'/indexer/schema')).find(v=>v.implementation==='Torznab');assert.ok(schema);
  indexer=await s.arr(service,'/indexer',{method:'POST',body:{...schema,name:'StackPilot replacement fixture',enableRss:false,enableAutomaticSearch:false,enableInteractiveSearch:true,fields:schema.fields.map(f=>({...f,value:f.name==='baseUrl'?`http://api-relay:${fixturePort}`:f.name==='apiPath'?'/api':f.name==='apiKey'?'fixture-test':f.name==='categories'?[tv?5000:2000]:f.value}))}});
  const replacement=new ImportedReplacement(hub,new RequestDiagnostics(hub));
  const preview=await replacement.preview({requestId:request.id,episodeId});
  if(!preview.candidates.length)console.log('RELEASE_DIAGNOSTIC',(await s.arr(service,(tv?'/release?episodeId='+episodeId:'/release?movieId='+movie.id))).map(r=>({approved:r.approved,rejections:r.rejections,downloadAllowed:r.downloadAllowed,movieId:r.movieId,mappedMovieId:r.mappedMovieId,quality:r.quality,score:r.customFormatScore,infoHash:r.infoHash})));
  assert.equal(preview.candidates.length,1,'One valid native replacement');
  const started=await replacement.start({previewId:preview.id,guid:preview.candidates[0].guid,indexerId:preview.candidates[0].indexerId,confirmation:'OK'});assert.ok(started.ok);
  assert.deepEqual(await readFile(started.backupPath),await readFile('/tmp/sp-replace-old.mkv'));
  const prefs=await s.qbit('/app/preferences');
  const active=(await s.qbit('/torrents/info')).find(t=>t.hash===hash);assert.ok(active);
  assert.ok(active.content_path.startsWith('/data/downloads/'));
  const payload=path.join(plan.spec.path,active.content_path.slice('/data/'.length))+(prefs.incomplete_files_ext?'.!qB':'');
  await mkdir(path.dirname(payload),{recursive:true});await copyFile('/tmp/sp-replace-new.mkv',payload);
  await s.qbit('/torrents/recheck',{hashes:hash});

  for(let i=0;i<120;i++){
    await replacement.run();const job=(await replacement.jobs()).jobs.find(j=>j.id===preview.id);
    if(job.state==='completed')break;
    if(i===10 && job.message?.includes('nicht eindeutig')){
      const t=(await s.qbit('/torrents/info')).find(t=>t.hash===hash);
      const found=await s.arr(service,`/manualimport?downloadId=${hash}&folder=${encodeURIComponent(path.posix.dirname(t.content_path))}&filterExistingFiles=false`);
      console.log('IMPORT_DIAGNOSTIC',JSON.stringify({torrent:{content:t.content_path,save:t.save_path,progress:t.progress},item:movie.id,episodeId,files:found.map(f=>({path:f.path,movie:f.movie?.id,series:f.series?.id,episodes:f.episodes?.map(e=>e.id),rejections:f.rejections}))}));
    }
    if(i===40)throw Error('Replacement did not finish: '+job.message);
    await new Promise(r=>setTimeout(r,1000));
  }
  assert.equal((await replacement.jobs()).jobs.find(j=>j.id===preview.id).state,'completed');
  console.log(service+'_NATIVE_REPLACEMENT_CONFIRMED');
  if(tv&&process.env.TEST_DELETE_WITH_SOURCE==='1'){
    const removal=new SeriesRemoval(hub),review=await removal.preview({seriesId:movie.id});
    assert.ok(review.downloads.some(d=>d.hash===hash&&!d.shared),'Native download history identifies full-series source');
    const result=await removal.execute({seriesId:movie.id,review:review.review,downloads:[hash],stopMonitoring:true,confirmation:'OK'});
    assert.ok(result.ok,result.message);assert.ok(!(await s.qbit('/torrents/info')).some(t=>t.hash===hash));
    assert.equal((await s.arr(service,`/episodefile?seriesId=${movie.id}`)).length,0);
    console.log('NATIVE_LIBRARY_AND_SELECTED_DOWNLOAD_DELETE_CONFIRMED');
  }
  await replacement.restore({id:preview.id,confirmation:'OK'});
  for(let i=0;i<90;i++){await replacement.run();if((await replacement.jobs()).jobs.find(j=>j.id===preview.id).state==='restored')break;await new Promise(r=>setTimeout(r,1000));}
  assert.equal((await replacement.jobs()).jobs.find(j=>j.id===preview.id).state,'restored');console.log(service+'_NATIVE_REPLACEMENT_ROLLBACK_CONFIRMED');
}catch(error){console.error('TEST_FAILURE',error.message);throw error;}finally{
  if(indexer)await s.arr(service,'/indexer/'+indexer.id,{method:'DELETE'});
  if(hash)await s.qbit('/torrents/delete',{hashes:hash,deleteFiles:'true'});
  if(movie)await s.arr(service,(tv?'/series/':'/movie/')+movie.id+'?deleteFiles=true&addImportExclusion=false',{method:'DELETE'});
  if(request?.id){await s.additional.seerr('/request/'+request.id,{method:'DELETE'});if(request.media?.id)await s.additional.seerr('/media/'+request.media.id+'/unknown',{method:'POST',body:{is4k:false}});}
  for(const server of oldServers)await s.additional.seerr('/settings/'+service.toLowerCase()+'/'+server.id,{method:'PUT',body:{...server,id:undefined}});
  execFileSync('docker',['exec',relay,'node','-e',`fetch('http://127.0.0.1:${fixturePort}/stop').catch(()=>{})`]);
  vault.set('imported-replacements:'+(plan.rootId||plan.id),jobsBefore);store.close();
}
