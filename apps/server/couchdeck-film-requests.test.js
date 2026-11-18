import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCappedCouchdeckRequest} from './couchdeck-film-requests.js';
function fixture({auto=false,workerRights=8224,quota=false}={}){
 const owner='a'.repeat(32),rule={profileId:6,serverId:0,capGiB:2},plan={id:'p'};
 const worker={id:7,email:'fixture@requests.invalid',userType:2,permissions:workerRights};
 const viewer={id:9,jellyfinUserId:owner,permissions:auto?160:32};
 const values=new Map([['couchdeck-requester:p',{id:7,email:worker.email,ready:true}]]),calls=[];
 let request;
 const s={request:async(_,route,options)=>{
  if(route==='/api/v1/auth/me')return worker;
  assert.equal(route,'/api/v1/request');assert.equal(options.headers['X-Api-User'],'7');
  assert.equal(options.body.userId,undefined);calls.push('create-pending');
  request={id:11,status:1,requestedBy:worker,profileId:6,serverId:0,is4k:false,media:{tmdbId:42,mediaType:'movie'}};return structuredClone(request);
 },additional:{seerr:async(route,opts)=>{
  if(route==='/user/7')return worker;if(route==='/user/9')return viewer;
  if(route==='/settings/main')return {apiKey:'fixture-key'.repeat(4)};
  if(route==='/request/11/approve'){calls.push('approve');request.status=2;return request;}
  if(route==='/request/11'){if(opts){if(quota)throw Error('quota exceeded');assert.equal(request.status,1);request.requestedBy=viewer;calls.push('assign-viewer');}return structuredClone(request);}
  throw Error(route);
 }}};
 const hub={engine:{vault:{get:k=>values.get(k),set:(k,v)=>values.set(k,structuredClone(v))}},sizeLimits:{verify:async()=>calls.push('verify')}};
 return {run:()=>createCappedCouchdeckRequest(hub,s,plan,{owner,userId:9,capGiB:2},42,rule,{}),calls,values,viewer};
}
test('capped viewer request remains pending without giving viewer advanced rights',async()=>{
 const f=fixture();const r=await f.run();assert.equal(r.status,1);assert.equal(r.requestedBy.id,9);assert.equal(f.viewer.permissions,32);
 assert.deepEqual(f.calls,['verify','create-pending','assign-viewer']);
});
test('automatic approval only follows confirmed capped request and ownership',async()=>{
 const f=fixture({auto:true});assert.equal((await f.run()).status,2);
 assert.deepEqual(f.calls,['verify','create-pending','assign-viewer','verify','approve']);
});
test('quota and changed worker permissions block approval',async()=>{
 for(const options of [{quota:true},{workerRights:2}]){const f=fixture(options);await assert.rejects(f.run());assert.ok(!f.calls.includes('approve'));}
});
test('a different Jellyfin owner cannot submit a capped request',async()=>{
 const f=fixture();f.viewer.jellyfinUserId='different-owner';
 await assert.rejects(f.run(),/Anfragerecht/);assert.deepEqual(f.calls,[]);
});
