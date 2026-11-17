import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SharedFilmStandard, blockedProfile, blockedFormat } from './shared-film-standard.js';
const name='StackPilot · Größenprüfung ausstehend';
const format={id:4,name,includeCustomFormatWhenRenaming:false,specifications:[{implementation:'ReleaseTitleSpecification',required:true,negate:false,fields:[{name:'value',value:'(?!)'}]}]};
const profile={id:7,name,minFormatScore:1,upgradeAllowed:false,formatItems:[{format:4,score:1},{format:2,score:0}]};
test('gate accepts only impossible mandatory condition and uncompensated score',()=>{
  assert.ok(blockedFormat(format));assert.ok(blockedProfile(profile,4));
  assert.ok(!blockedFormat({...format,specifications:[{...format.specifications[0],negate:true}]}));
  assert.ok(!blockedProfile({...profile,formatItems:[{format:4,score:1},{format:2,score:1}]},4));
});
test('runtime gate assigns verified size before search and leaves missing runtime blocked',async()=>{
  const values=new Map(),calls=[];let failSearch=true;
  const plan={id:'p'}, key='shared-film-standard:p';
  values.set(key,{serverId:1,profileId:7,rate:2,capGiB:0});
  let movie={id:9,tmdbId:12,qualityProfileId:7,runtime:155,monitored:true,hasFile:false};
  const s={additional:{seerr:async()=>[{id:1,activeProfileId:7}]},arr:async(_,route,opts)=>{
    if(route==='/customformat')return [format];
    if(route==='/qualityprofile/7')return profile;
    if(route==='/movie')return [movie,{id:10,runtime:0,qualityProfileId:7,monitored:true}];
    if(route==='/movie/9'){if(opts){calls.push('assign');movie=opts.body;}return movie;}
    if(route==='/command'){calls.push('search');if(failSearch){failSearch=false;throw Error('temporary search failure');}return {};}
    throw Error(route);
  }};
  const hub={engine:{vault:{get:k=>values.get(k),set:(k,v)=>values.set(k,v)}},context:async()=>({plan,s}),mutate:async(_,f)=>f({plan,s}),requireVpn:async()=>{calls.push('vpn');}};
  const limits={config:()=>({rate:2}),ensureCap:async(_,__,cap)=>{assert.equal(cap,5.5);return {profileId:8,capGiB:cap};},verify:async()=>{calls.push('verify');}};
  const service=new SharedFilmStandard(hub,limits);await service.run();
  assert.deepEqual(calls,['verify','vpn','assign','search']);assert.equal(service.status.state,'blocked');
  assert.ok(values.get(key).handoffs[9]);
  await service.run();
  assert.equal(calls.filter(c=>c==='search').length,2);
  assert.deepEqual(values.get(key).handoffs,{});
  assert.match(service.status.message,/Laufzeit/);
});

test('interrupted standard write is restored when local setting stayed disabled',async()=>{
 const plan={id:'p'},values=new Map([['shared-film-standard:p',{serverId:1,profileId:7,previous:{id:2,name:'Old'},rate:2}]]);
 let server={id:1,isDefault:true,is4k:false,hostname:'radarr',port:7878,useSsl:false,activeProfileId:7};
 const s={arr:async()=>[],additional:{seerr:async(route,opts)=>{if(opts)server={...server,...opts.body,id:1};return [server];}}};
 const hub={engine:{vault:{get:k=>values.get(k),set:(k,v)=>values.set(k,v)}},context:async()=>({plan,s}),mutate:async(_,fn)=>fn({plan,s})};
 const shared=new SharedFilmStandard(hub,{config:()=>({rate:0})});
 await shared.run();assert.equal(shared.status.state,'off');assert.equal(server.activeProfileId,2);assert.equal(values.get('shared-film-standard:p'),null);
});
