import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RequestLifecycle } from './request-lifecycle.js';
function fixture({rate=2,capGiB=0,status=1,admin=true,failProfile=false}={}) {
  let request={id:7,status,media:{tmdbId:42,mediaType:'movie'},requestedBy:{id:3},createdAt:'2026-01-01'};
  const calls=[];
  const s={additional:{seerr:async(route,options)=>{
    calls.push([route,options]);
    if(route==='/auth/me')return {permissions:admin?2:32};
    if(route==='/movie/42?language=de')return {runtime:120};
    if(route==='/request/7/approve'){request.status=2;return request;}
    if(route==='/request/7'){
      if(options&&!failProfile)request={...request,...options.body};
      return structuredClone(request);
    }
    throw Error(route);
  }}};
  const hub={engine:{vault:{set(){}}},requireVpn:async()=>{calls.push(['vpn']);},mutate:async(_,f)=>f({s,plan:{id:'p'}}),sizeLimits:{
    config:()=>({rate,capGiB}),forRequest:async(...args)=>{calls.push(['rule',args.slice(2)]);return {serverId:1,profileId:10};},verify:async()=>{calls.push(['verified']);}
  }};
  const lifecycle=new RequestLifecycle(hub,{target:async()=>({kind:'movie',mediaId:42,request:structuredClone(request)})});
  return {lifecycle,calls};
}
test('approval verifies configured size before Seerr can start searching',async()=>{
  const f=fixture();assert.equal((await f.lifecycle.approve({requestId:7,confirmation:'OK'})).status,2);
  const names=f.calls.map(c=>c[0]);assert.ok(names.indexOf('verified')<names.indexOf('/request/7/approve'));
});
test('fixed cap is forwarded to approval profile preparation',async()=>{
  const f=fixture({rate:0,capGiB:4});await f.lifecycle.approve({requestId:7,confirmation:'OK'});
  assert.deepEqual(f.calls.find(c=>c[0]==='rule')[1],[{runtime:120},0,4]);
});
test('unconfirmed profile blocks approval',async()=>{
  const f=fixture({failProfile:true});await assert.rejects(f.lifecycle.approve({requestId:7,confirmation:'OK'}),/Keine Freigabe/);
  assert.ok(!f.calls.some(c=>c[0]==='/request/7/approve'));
});
test('approval requires confirmation, pending request and Seerr admin',async()=>{
  for(const options of [{status:2},{admin:false}]){
    const f=fixture(options);await assert.rejects(f.lifecycle.approve({requestId:7,confirmation:'OK'}));
    assert.ok(!f.calls.some(c=>c[0]==='/request/7/approve'));
  }
  await assert.rejects(fixture().lifecycle.approve({requestId:7}));
});
