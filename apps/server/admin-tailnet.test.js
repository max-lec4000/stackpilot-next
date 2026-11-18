import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AdminTailnet,adminGrant} from './admin-tailnet.js';
const run=async(_,args)=>({ok:true,output:JSON.stringify(args[0]==='status'?{BackendState:'Running',Self:{Online:true,DNSName:'fixture.test.ts.net.',TailscaleIPs:['100.80.0.2']}}:{ShieldsUp:false})});
test('administration grant opens exactly TCP 5173 for individual peers',()=>{
 assert.deepEqual(adminGrant('100.80.0.1','100.80.0.2'),{src:['100.80.0.1'],dst:['100.80.0.2'],ip:['tcp:5173']});
 for(const source of ['*','100.80.0.0/24','100.80.0.2','192.168.1.1'])assert.throws(()=>adminGrant(source,'100.80.0.2'));
});
test('local and LAN tests never claim remote tailnet reachability',async()=>{
 const service=new AdminTailnet(run,'0.0.0.0');
 for(const source of ['127.0.0.1','192.168.1.8','100.80.0.2'])assert.equal((await service.inspect(source)).reachedViaTailnet,false);
 const remote=await service.inspect('::ffff:100.80.0.1');assert.equal(remote.reachedViaTailnet,true);assert.equal(remote.ipUrl,'http://100.80.0.2:5173');
 assert.equal((await new AdminTailnet(run,'127.0.0.1').inspect('127.0.0.1')).url,null);
});
