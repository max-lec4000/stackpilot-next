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
 assert.equal(rows[1].editable,true);assert.equal(rows[1].needsAccount,true);assert.equal(rows[1].reason,null);
 assert.equal(rows[2].editable,false);assert.match(rows[2].reason,/Verwaltungsrechte/);
 assert.equal(rows[3].editable,false);assert.match(rows[3].reason,/Jellyfin-Anmeldung/);
 users.push({id:5,jellyfinUserId:'aabb',permissions:32});
 const ambiguous=(await service.list()).viewers[0];assert.equal(ambiguous.editable,false);assert.match(ambiguous.reason,/Mehrere/);
});

test('fehlendes Seerr-Konto wird beim Umschalten aus dem verknüpften Jellyfin-Konto angelegt',async()=>{
  const users=[{id:3,jellyfinUserId:'aabb',permissions:32}];
  const writes=[];
  const s={additional:{seerr:async(route,options)=>{
    if(route==='/user/import-from-jellyfin'){writes.push(['import',options.body]);users.push({id:7,jellyfinUserId:'EE-FF',permissions:32,username:'spv_flo'});return [];}
    if(route.startsWith('/user?'))return {results:structuredClone(users)};
    const id=Number(route.split('/')[2]);const u=users.find(x=>x.id===id);
    if(options?.method==='PUT'){writes.push(['put',id,options.body]);Object.assign(u,options.body);}
    return structuredClone(u);
  }}};
  const service=new ViewerRequests({context:async()=>({s}),mutate:async(_,f)=>f()},
    {context:async()=>({request:async()=>({stackpilot:{CanonicalLinks:{spv_flo:'ee-ff'}}})})},
    {list:async()=>({viewers:[{username:'flo',active:true}]})});
  // Oberfläche muss den Zustand „kein Konto“ gesehen haben
  await assert.rejects(service.change({confirmation:'OK',username:'flo',enabled:true,userId:7,previousPermissions:32}));
  assert.equal(writes.length,0);
  await service.change({confirmation:'OK',username:'flo',enabled:true,userId:null,previousPermissions:null});
  assert.deepEqual(writes[0],['import',{jellyfinUserIds:['eeff']}]);
  assert.deepEqual(writes[1],['put',7,{username:'spv_flo',permissions:160}]);
  const row=(await service.list()).viewers[0];
  assert.equal(row.needsAccount,false);assert.equal(row.autoApprove,true);
});

test('angelegtes Konto mit Verwaltungsrechten wird nicht verändert',async()=>{
  const users=[];
  const s={additional:{seerr:async(route)=>{
    if(route==='/user/import-from-jellyfin'){users.push({id:8,jellyfinUserId:'eeff',permissions:2});return [];}
    return {results:structuredClone(users)};
  }}};
  const service=new ViewerRequests({context:async()=>({s}),mutate:async(_,f)=>f()},
    {context:async()=>({request:async()=>({stackpilot:{CanonicalLinks:{spv_flo:'eeff'}}})})},
    {list:async()=>({viewers:[{username:'flo',active:true}]})});
  await assert.rejects(service.change({confirmation:'OK',username:'flo',enabled:true,userId:null,previousPermissions:null}),/unerwartete Rechte/);
});

test('Freigabe getrennt für Filme und Serien',()=>{
  const before=32|16384;
  assert.equal(requestPermissions(before,{movie:true,tv:false}),before|256);
  assert.equal(requestPermissions(before|128,{movie:false,tv:true}),before|512);
  assert.equal(requestPermissions(before|256,{movie:true,tv:true}),before|128);
  assert.equal(requestPermissions(before|128,{movie:false,tv:false}),before);
});
test('Anfragelimits: prüfen, setzen, zurücklesen, nur bearbeitbare Konten',async()=>{
  const main={username:'spv_familie',locale:'de',movieQuotaLimit:null,movieQuotaDays:null,tvQuotaLimit:null,tvQuotaDays:null};
  const posts=[];
  const s={additional:{seerr:async(route,options)=>{
    assert.equal(route,'/user/3/settings/main');
    if(options?.method==='POST'){posts.push(options.body);Object.assign(main,options.body);return null;}
    return structuredClone(main);
  }}};
  const service=new ViewerRequests({mutate:async(_,f)=>f()});
  service.context=async()=>({s,rows:[{username:'familie',user:{id:3},editable:true},{username:'chef',user:{id:1},editable:false,reason:'Verwaltungsrechte'}]});
  await assert.rejects(service.limits({username:'familie',movie:{limit:5,days:7}}),/mit OK/);
  await assert.rejects(service.limits({username:'familie',movie:{limit:0,days:7},confirmation:'OK'}),/1–100/);
  await assert.rejects(service.limits({username:'chef',movie:{limit:5,days:7},confirmation:'OK'}),/Verwaltungsrechte/);
  const r=await service.limits({username:'familie',movie:{limit:5,days:7},tv:null,confirmation:'OK'});
  assert.deepEqual(r.movieQuota,{limit:5,days:7});assert.equal(r.tvQuota,null);
  assert.equal(posts[0].locale,'de','übrige Kontoeinstellungen bleiben');
  assert.deepEqual([main.movieQuotaLimit,main.movieQuotaDays,main.tvQuotaLimit,main.tvQuotaDays],[5,7,null,null]);
});
