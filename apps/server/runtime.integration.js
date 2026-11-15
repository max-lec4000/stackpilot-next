// Production HTTP server in a disposable cached Node container; no Docker socket.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { localDocker } from "./retirement.js";
import { dockerInput } from "./docker-io.js";
import { catalog } from "./catalog.js";
test(
  "Produktionsserver: Anmeldung, privater Betriebsstand, redigierter Verlauf und geordnetes SIGTERM",
  { timeout: 90000 },
  async () => {
    const dir = await mkdtemp("/tmp/sp-runtime-"),
      name = "sp-runtime-" + randomUUID().slice(0, 8);
    try {
      await localDocker(
        [
          "run",
          "-d",
          "--pull",
          "never",
          "--name",
          name,
          "--user",
          `${process.getuid()}:${process.getgid()}`,
          "--read-only",
          "--cap-drop",
          "ALL",
          "--security-opt",
          "no-new-privileges:true",
          "--tmpfs",
          "/tmp:rw,noexec,nosuid,size=32m",
          "--mount",
          `type=bind,src=${process.cwd()},dst=/app,readonly`,
          "--mount",
          `type=bind,src=${dir},dst=/state`,
          "--workdir",
          "/app",
          "-e",
          "STACKPILOT_STATE_DIR=/state",
          "-e",
          "NO_PROXY=localhost,127.0.0.1,stackpilot.localhost",
          "-e",
          "HTTP_PROXY=",
          "-e",
          "HTTPS_PROXY=",
          catalog.services.ApiRelay.image,
          "node",
          "apps/server/start.js",
        ],
        { timeout: 30000 },
      );
      const [container] = JSON.parse(await localDocker(["inspect", name]));
      const result = await dockerInput(
        ["exec", "-i", container.Id, "node", "--input-type=module"],
        `import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {localIdentityRequest as request} from '/app/apps/server/identity/local-request.js';const base='http://127.0.0.1:5173',host='stackpilot.localhost:5173';for(let n=0;n<100;n++){try{const r=await request(base+'/api/auth/status',{headers:{Host:host}});if(r.ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 const home=await request(base+'/',{headers:{Host:host}});assert.equal(home.status,200);assert.match(home.headers.get('content-security-policy'),/frame-ancestors 'none'/);
 const unauth=await request(base+'/api/audit',{headers:{Host:host}});assert.equal(unauth.status,401);const privateReport=await request(base+'/api/development/report',{headers:{Host:host}});assert.equal(privateReport.status,401);
 const token=(await readFile('/state/bootstrap-token','utf8')).trim();const setup=await request(base+'/api/auth/setup',{method:'POST',headers:{Host:host,Origin:'http://'+host,'Content-Type':'application/json'},body:JSON.stringify({username:'fixture-admin',password:'Fixture-password-1234!',code:token})});assert.equal(setup.status,200);const cookie=setup.headers.get('set-cookie').split(';')[0],headers={Host:host,Cookie:cookie};const status=await request(base+'/api/session',{headers});const session=await status.json();
 const initialDev=await request(base+'/api/development/status',{headers});assert.equal((await initialDev.json()).enabled,false);const journey=await request(base+'/api/remote-access/journey',{headers});assert.equal(journey.status,200);const saved=await journey.json();assert.equal(saved.evidence,'saved-configuration');assert.equal(saved.publicReady,false);const overview=await request(base+'/api/operations/overview',{headers});assert.equal(overview.status,200);assert.equal((await overview.json()).phase,'setup');
 const diagnostics=await request(base+'/api/development/report',{headers});assert.equal(diagnostics.status,200);const safe=await diagnostics.json();assert.equal(safe.schemaVersion,2);assert.equal(safe.configuration.connection.state,'unconfirmed');assert.ok(!JSON.stringify(safe).includes(token));
 const fail=await request(base+'/api/media/request/cancel',{method:'POST',headers:{...headers,Origin:'http://'+host,'Content-Type':'application/json','X-StackPilot-Token':session.token},body:JSON.stringify({requestId:7,confirmation:'OK',secret:'must-not-be-logged'})});assert.equal(fail.status,400);const audit=await request(base+'/api/audit',{headers});const text=await audit.text();assert.ok(!text.includes('must-not-be-logged'));assert.equal(JSON.parse(text).events[0].status,'failed');console.log('HTTP, Authentifizierung, Betriebsstand und redigierter Verlauf geprüft.');`,
        { timeout: 30000 },
      );
      assert.match(result, /geprüft/);
      await localDocker(["stop", "--time", "10", name], { timeout: 20000 });
      const [stopped] = JSON.parse(await localDocker(["inspect", name]));
      assert.equal(stopped.State.ExitCode, 0);
      console.log(
        "Produktionsstart und SIGTERM ohne aktive Aufträge bestanden.",
      );
    } finally {
      await localDocker(["rm", "-f", name]).catch(() => {});
      await rm(dir, { recursive: true, force: true });
    }
  },
);
