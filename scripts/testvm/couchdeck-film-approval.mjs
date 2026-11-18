import assert from 'node:assert/strict';
import os from 'node:os';
import {StateStore} from '../../apps/server/state.js';
import {Vault} from '../../apps/server/vault.js';
import {DeploymentEngine} from '../../apps/server/installer.js';
import {MediaHub} from '../../apps/server/media-hub.js';
import {SizeLimits} from '../../apps/server/size-limits.js';
import {RequestDiagnostics} from '../../apps/server/request-diagnostics.js';
import {RequestLifecycle} from '../../apps/server/request-lifecycle.js';
import {createCappedCouchdeckRequest,couchdeckFilmKey} from '../../apps/server/couchdeck-film-requests.js';
assert.equal(os.hostname(),'sp-test');
const store=new StateStore('/var/lib/stackpilot'),vault=new Vault(store),engine=new DeploymentEngine(store,vault);
const hub=new MediaHub(engine,{check:async()=>({state:'connected'})});
hub.sizeLimits=new SizeLimits(hub);
const {s,plan}=await hub.context(['Radarr','Seerr']);
assert.equal((await s.arr('Radarr','/indexer')).length,0,'No external downloads');
assert.equal((await s.arr('Radarr','/movie')).length,0,'Empty fixture Radarr required');
const viewer=(await s.additional.seerr('/user?take=100')).results.find(u=>u.jellyfinUserId&&u.id!==1&&!(u.permissions&2));
assert.ok(viewer,'Existing test viewer required');
const id=10378, key=couchdeckFilmKey(plan,id),previous=vault.get(key);
let request;
try{
 await s.additional.seerr('/user/'+viewer.id,{method:'PUT',body:{permissions:32}});
 let detail=await s.additional.seerr('/movie/'+id);
 if(detail.mediaInfo?.id)await s.additional.seerr('/media/'+detail.mediaInfo.id,{method:'DELETE'});
 detail=await s.additional.seerr('/movie/'+id);
 vault.set(key,null);
 const rule={...await hub.sizeLimits.ensureCap(s,plan,2),serverId:(await s.additional.seerr('/settings/radarr')).find(v=>v.isDefault&&!v.is4k).id},actor={owner:viewer.jellyfinUserId,userId:viewer.id,capGiB:2};
 const original=s.request.bind(s);let lost=false;
 s.request=async(name,route,options)=>{const r=await original(name,route,options);if(route==='/api/v1/request'&&options?.method==='POST'&&!lost){lost=true;console.log('NATIVE_PREPARED_SHAPE',JSON.stringify({profileId:r.profileId,serverId:r.serverId,status:r.status,media:r.media&&{tmdbId:r.media.tmdbId,mediaType:r.media.mediaType},expectedProfile:rule.profileId,expectedServer:rule.serverId}));throw Error('simulated lost response');}return r;};
 await assert.rejects(createCappedCouchdeckRequest(hub,s,plan,actor,id,rule,detail),/lost response/);
 s.request=original;
 request=await createCappedCouchdeckRequest(hub,s,plan,actor,id,rule,await s.additional.seerr('/movie/'+id));
 assert.equal(request.status,1);assert.equal(request.requestedBy.id,viewer.id);assert.equal(request.profileId,rule.profileId);
 assert.equal((await s.arr('Radarr','/movie')).length,0,'Pending request must not reach Radarr');
 assert.equal((await s.additional.seerr('/user/'+viewer.id)).permissions,32);
 console.log('PENDING_CAP_OWNER_QUOTA_SAFE_RETRY_CONFIRMED');
 hub.guard.checkedPlanId=plan.id;
 const retried=await hub.request({type:'movie',id},actor);
 assert.equal(retried.status,1);assert.equal(retried.id,request.id);assert.equal(retried.warning,null);
 console.log('COUCHDECK_FULL_HUB_PENDING_FLOW_CONFIRMED');
 const standard=hub.sizeLimits.config.bind(hub.sizeLimits);hub.sizeLimits.config=()=>({rate:0,capGiB:10});
 const lifecycle=new RequestLifecycle(hub,new RequestDiagnostics(hub));hub.requireVpn=async()=>{};
 const result=await lifecycle.approve({requestId:request.id,confirmation:'OK'});
 assert.ok([2,5].includes(result.status));
 assert.equal((await s.additional.seerr('/request/'+request.id)).profileId,rule.profileId);
 hub.sizeLimits.config=standard;
 console.log('STACKPILOT_APPROVAL_PRESERVES_COUCHDECK_CAP_CONFIRMED');
 async function removeMovie(){
  for(let i=0;i<30;i++){
   const movie=(await s.arr('Radarr','/movie')).find(m=>m.tmdbId===id);
   if(movie){await s.arr('Radarr','/movie/'+movie.id+'?deleteFiles=true&addImportExclusion=false',{method:'DELETE'});return;}
   await new Promise(r=>setTimeout(r,1000));
  }
  throw Error('Approved movie was not added');
 }
 await removeMovie();
 const oldId=request.id;
 await s.additional.seerr('/media/'+request.media.id,{method:'DELETE'});
 await s.additional.seerr('/user/'+viewer.id,{method:'PUT',body:{permissions:160}});
 request=await createCappedCouchdeckRequest(hub,s,plan,actor,id,rule,await s.additional.seerr('/movie/'+id));
 assert.equal(request.status,2);assert.notEqual(request.id,oldId);assert.equal(request.profileId,rule.profileId);
 await removeMovie();
 console.log('AUTOMATIC_CAPPED_REQUEST_AND_NEW_REQUEST_AFTER_DELETE_CONFIRMED');

}finally{
 for(const movie of await s.arr('Radarr','/movie'))if(movie.tmdbId===id)await s.arr('Radarr','/movie/'+movie.id+'?deleteFiles=true&addImportExclusion=false',{method:'DELETE'});
 const detail=await s.additional.seerr('/movie/'+id);if(detail.mediaInfo?.id)await s.additional.seerr('/media/'+detail.mediaInfo.id,{method:'DELETE'});
 await s.additional.seerr('/user/'+viewer.id,{method:'PUT',body:{permissions:viewer.permissions}});
 vault.set(key,previous);store.close();
}
