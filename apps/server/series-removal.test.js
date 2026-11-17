import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,unlink,link,readFile,rm } from 'node:fs/promises';
import { SeriesRemoval } from './series-removal.js';
async function fixture(){
  const root=await mkdtemp('/tmp/sp-series-removal-');await mkdir(root+'/media/tv/Fixture',{recursive:true});
  const host=root+'/media/tv/Fixture/Fixture.S01E01.mkv';await writeFile(host,'fixture');
  let episodes=[{id:1,episodeFileId:5,seasonNumber:1,episodeNumber:1,monitored:true}],item={id:3,tvdbId:9,path:'/data/media/tv/Fixture',title:'Fixture',monitored:true};
  const file={id:5,path:'/data/media/tv/Fixture/Fixture.S01E01.mkv',size:7};let keep=false;
  const s={arr:async(_,route,opts)=>{
    if(route==='/series/3'){if(opts)item=opts.body;return item;}
    if(route==='/episode?seriesId=3')return episodes;
    if(route==='/episodefile?seriesId=3')return [file];
    if(route==='/episode/monitor'){episodes=episodes.map(e=>({...e,monitored:opts.body.monitored}));return episodes;}
    if(route==='/episodefile/5'){if(!keep)await unlink(host);return {};}
    throw Error(route);
  }};
  const hub={context:async()=>({s,plan:{id:'plan',spec:{path:root,selected:['Sonarr']}}}),mutate:async(_,f)=>f(),library:{cache:new Map(),run:async()=>{}}};
  return {service:new SeriesRemoval(hub),host,root,cleanup:()=>rm(root,{recursive:true,force:true}),shared:()=>{episodes.push({...episodes[0],id:2,episodeNumber:2});},keep:()=>{keep=true;}};
}
test('series removal deletes confirmed library path while preserving hardlink source',async()=>{
  const f=await fixture();try{
    await link(f.host,f.root+'/source.mkv');const p=await f.service.preview({seriesId:3});assert.equal(p.files[0].links,2);
    const result=await f.service.execute({seriesId:3,review:p.review,stopMonitoring:true,confirmation:'OK'});
    assert.equal(result.ok,true);assert.equal(await readFile(f.root+'/source.mkv','utf8'),'fixture');
    await assert.rejects(readFile(f.host),{code:'ENOENT'});
  }finally{await f.cleanup();}
});
test('changed preview and shared episode files block destructive actions',async()=>{
  const f=await fixture();try{
    const p=await f.service.preview({seriesId:3});await writeFile(f.host,'changed-size');
    await assert.rejects(f.service.execute({seriesId:3,review:p.review,stopMonitoring:false,confirmation:'OK'}));
    await writeFile(f.host,'fixture');f.shared();await assert.rejects(f.service.preview({seriesId:3,episodeId:1}),/gemeinsame Datei/);
  }finally{await f.cleanup();}
});
test('native delete response is insufficient when the file still exists',async()=>{
  const f=await fixture();try{const p=await f.service.preview({seriesId:3});f.keep();assert.equal((await f.service.execute({seriesId:3,review:p.review,stopMonitoring:false,confirmation:'OK'})).ok,false);}finally{await f.cleanup();}
});
