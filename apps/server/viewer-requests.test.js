import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestPermissions, ViewerRequests } from './viewer-requests.js';
test('automatic approval preserves other rights and revokes every automatic bit',()=>{
  const before=32|16384|4194304;
  assert.equal(requestPermissions(before,true),before|128);
  assert.equal(requestPermissions(before|128|256|512|32768|65536|131072,false),before);
  for(const value of [2,16,34,-1,NaN,1.5])assert.throws(()=>requestPermissions(value,true));
});
test('viewer permission writes require the same linked user and previous permissions',async()=>{
  const user={id:4,jellyfinUserId:'abc',permissions:32,username:'viewer'};
  const writes=[];
  const s={additional:{seerr:async(route,options)=>{
    if(options){writes.push(options);Object.assign(user,options.body);}
    return structuredClone(user);
  }}};
  const service=new ViewerRequests({mutate:async(_,f)=>f()});
  service.context=async()=>({s,rows:[{username:'viewer',user:structuredClone(user),editable:true}]});
  await assert.rejects(service.change({confirmation:'OK',username:'viewer',enabled:true,userId:5,previousPermissions:32}));
  assert.equal(writes.length,0);
  await service.change({confirmation:'OK',username:'viewer',enabled:true,userId:4,previousPermissions:32});
  assert.deepEqual(writes[0].body,{username:'viewer',permissions:160});
});
test('viewer mapping uses managed spv account and distinguishes missing Seerr account',async()=>{
 const users=[{id:3,jellyfinUserId:'aabb',permissions:32},{id:4,jellyfinUserId:'ccdd',permissions:2}];
 const service=new ViewerRequests({context:async()=>({s:{additional:{seerr:async()=>({results:users})}}})},
  {context:async()=>({request:async()=>({stackpilot:{CanonicalLinks:{spv_max:'aa-bb',spv_flo:'eeff',spv_admin:'ccdd'}}})})},
  {list:async()=>({viewers:['max','flo','admin','new'].map(username=>({username,active:true}))})});
 const rows=(await service.list()).viewers;
 assert.equal(rows[0].editable,true);assert.equal(rows[0].userId,3);
 assert.equal(rows[1].editable,false);assert.match(rows[1].reason,/Seerr-Konto/);
 assert.equal(rows[2].editable,false);assert.match(rows[2].reason,/Verwaltungsrechte/);
 assert.equal(rows[3].editable,false);assert.match(rows[3].reason,/Jellyfin-Anmeldung/);
 users.push({id:5,jellyfinUserId:'aabb',permissions:32});
 const ambiguous=(await service.list()).viewers[0];assert.equal(ambiguous.editable,false);assert.match(ambiguous.reason,/Mehrere/);
});
