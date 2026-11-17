import assert from 'node:assert/strict';
import os from 'node:os';
import { StateStore } from '../../apps/server/state.js';
import { Vault } from '../../apps/server/vault.js';
import { DeploymentEngine } from '../../apps/server/installer.js';
import { MediaHub } from '../../apps/server/media-hub.js';
import { SizeLimits } from '../../apps/server/size-limits.js';
import { SharedFilmStandard, blockedFormat, blockedProfile } from '../../apps/server/shared-film-standard.js';
if(os.hostname()!=='sp-test')throw Error('Nur in sp-test ausführen.');
const store=new StateStore('/var/lib/stackpilot'),vault=new Vault(store),engine=new DeploymentEngine(store,vault);
const hub=new MediaHub(engine,{check:async()=>({state:'connected'})}),limits=new SizeLimits(hub),shared=new SharedFilmStandard(hub,limits);hub.sizeLimits=limits;
const {s,plan}=await hub.context(['Radarr','Seerr']);
const servers=await s.additional.seerr('/settings/radarr'),previous=vault.get(shared.key(plan)), previousSetting=vault.get(limits.key(plan));
let request,movie;
try{
  await shared.configure(s,plan,{rate:2,capGiB:0});
  let state=vault.get(shared.key(plan));
  const format=(await s.arr('Radarr','/customformat')).find(blockedFormat);
  assert.ok(format);assert.ok(blockedProfile(await s.arr('Radarr',`/qualityprofile/${state.profileId}`),format.id));
  console.log('RATE_GATE_CONFIRMED');
  assert.equal((await s.arr('Radarr','/movie')).length,0,'Native request fixture requires empty Radarr');
  assert.equal((await s.arr('Radarr','/indexer')).length,0,'No external download sources in this test');
  vault.set(limits.key(plan),{rate:2});
  const detail=await s.additional.seerr('/movie/10378');
  if(detail.mediaInfo?.id)await s.additional.seerr('/media/'+detail.mediaInfo.id+'/unknown',{method:'POST',body:{is4k:false}});
  request=await s.additional.seerr('/request',{method:'POST',body:{mediaType:'movie',mediaId:10378,is4k:false}});
  for(let i=0;i<60;i++){movie=(await s.arr('Radarr','/movie')).find(m=>m.tmdbId===10378);if(movie)break;await new Promise(r=>setTimeout(r,1000));}
  assert.ok(movie);assert.equal(movie.qualityProfileId,state.profileId,'Direct automatically approved Seerr request starts behind the gate');
  await shared.run();assert.equal(shared.status.state,'ready',shared.status.message);
  const assigned=await s.arr('Radarr','/movie/'+movie.id);
  const bound=await limits.ensure(s,plan,movie.runtime,2);
  assert.equal(assigned.qualityProfileId,bound.profileId);await limits.verify(s,bound);
  console.log('DIRECT_SEERR_AUTO_APPROVAL_SIZE_CONFIRMED',bound.capGiB);

  await shared.configure(s,plan,{rate:0,capGiB:4});
  state=vault.get(shared.key(plan));
  const rule=await limits.ensureCap(s,plan,4);assert.equal(state.profileId,rule.profileId);await limits.verify(s,rule);
  console.log('FIXED_CAP_CONFIRMED');
  await shared.configure(s,plan,{rate:0,capGiB:0});
  assert.equal((await s.additional.seerr('/settings/radarr')).find(r=>r.isDefault&&!r.is4k).activeProfileId,servers.find(r=>r.isDefault&&!r.is4k).activeProfileId);
  console.log('RESTORE_CONFIRMED');
}finally{
  if(movie)await s.arr('Radarr','/movie/'+movie.id+'?deleteFiles=true&addImportExclusion=false',{method:'DELETE'});
  if(request){await s.additional.seerr('/request/'+request.id,{method:'DELETE'});if(request.media?.id)await s.additional.seerr('/media/'+request.media.id+'/unknown',{method:'POST',body:{is4k:false}});}
  vault.set(limits.key(plan),previousSetting);

  for(const server of servers)await s.additional.seerr('/settings/radarr/'+server.id,{method:'PUT',body:{...server,id:undefined}});
  vault.set(shared.key(plan),previous);store.close();
}
