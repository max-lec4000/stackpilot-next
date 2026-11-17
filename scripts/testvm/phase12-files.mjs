import assert from 'node:assert/strict';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { mkdir, copyFile, link, readFile, rm, truncate } from 'node:fs/promises';
import path from 'node:path';
import {StateStore} from '../../apps/server/state.js';
import {Vault} from '../../apps/server/vault.js';
import {DeploymentEngine} from '../../apps/server/installer.js';
import {MediaHub} from '../../apps/server/media-hub.js';
import {SeriesRemoval} from '../../apps/server/series-removal.js';
if(os.hostname()!=='sp-test')throw Error('Nur in sp-test ausführen.');
const store=new StateStore('/var/lib/stackpilot'),vault=new Vault(store),engine=new DeploymentEngine(store,vault);
const hub=new MediaHub(engine,{check:async()=>({state:'connected'})});
const {s,plan}=await hub.context(['Sonarr']);
const fixtures=await s.arr('Sonarr','/series');
assert.equal(fixtures.length,0,'Native fixture requires an empty test Sonarr.');
let series;
const synthetic='/tmp/sp-phase12-fixture.mkv';
try{
  execFileSync('docker',['exec','stackpilot-jellyfin-1','/usr/lib/jellyfin-ffmpeg/ffmpeg','-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=1280x720:r=1','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t','1800','-c:a','aac','-c:v','libx264','-pix_fmt','yuv420p','-y',synthetic],{stdio:'pipe'});
  execFileSync('docker',['cp','stackpilot-jellyfin-1:'+synthetic,synthetic],{stdio:'pipe'});
  const lookup=(await s.arr('Sonarr','/series/lookup?term=tvdb:281620'))[0];
  assert.ok(lookup?.tvdbId);
  const profile=(await s.arr('Sonarr','/qualityprofile')).find(p=>p.name==='HD-1080p')||(await s.arr('Sonarr','/qualityprofile'))[0];
  series=await s.arr('Sonarr','/series',{method:'POST',body:{...lookup,qualityProfileId:profile.id,rootFolderPath:'/data/media/tv',monitored:false,seasonFolder:true,addOptions:{searchForMissingEpisodes:false,searchForCutoffUnmetEpisodes:false}}});
  let episodes=[];
  for(let i=0;i<30;i++){episodes=await s.arr('Sonarr',`/episode?seriesId=${series.id}`);if(episodes.some(e=>e.seasonNumber===1&&e.episodeNumber===1))break;await new Promise(r=>setTimeout(r,1000));}
  const folder=path.join(plan.spec.path,series.path.slice('/data/'.length),'Season 01');await mkdir(folder,{recursive:true});
  const original=path.join(folder,series.title.replace(/[^a-zA-Z0-9]+/g,'.')+'.S01E01.720p.WEB-DL.mkv');await copyFile(synthetic,original);await truncate(original,20*1024**2);
  const source=path.join(plan.spec.path,'downloads','complete','sp-phase12-source.mkv');await rm(source,{force:true});await link(original,source);
  const command=await s.arr('Sonarr','/command',{method:'POST',body:{name:'RescanSeries',seriesId:series.id}});
  for(let i=0;i<60;i++){const status=await s.arr('Sonarr',`/command/${command.id}`);if(status.status==='completed')break;if(status.status==='failed')throw Error('Rescan failed');await new Promise(r=>setTimeout(r,1000));}
  const files=await s.arr('Sonarr',`/episodefile?seriesId=${series.id}`);assert.equal(files.length,1);
  const removal=new SeriesRemoval(hub),preview=await removal.preview({seriesId:series.id});assert.equal(preview.files.length,1);assert.equal(preview.files[0].links,2);
  const result=await removal.execute({seriesId:series.id,review:preview.review,stopMonitoring:true,confirmation:'OK'});assert.equal(result.ok,true,result.message);
  assert.equal((await s.arr('Sonarr',`/episodefile?seriesId=${series.id}`)).length,0);
  await assert.rejects(readFile(original),{code:'ENOENT'});assert.ok((await readFile(source)).length>0);await rm(source);
  console.log('NATIVE_SERIES_DELETE_AND_HARDLINK_SOURCE_CONFIRMED');
}finally{
  if(series)await s.arr('Sonarr',`/series/${series.id}?deleteFiles=true`,{method:'DELETE'});
  await rm(synthetic,{force:true});store.close();
}
