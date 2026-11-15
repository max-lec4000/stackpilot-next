import { certificateFailure } from "./identity/certificate-issuer.js";
// Isolated Docker networks + synthetic IdP; real TLS verification, DNS alias and nginx.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  copyFile,
} from "node:fs/promises";
import { randomUUID, X509Certificate } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  certificateInfo,
  OidcBackchannel,
} from "./identity/oidc-backchannel.js";
import { localDocker } from "./retirement.js";
import { dockerInput } from "./docker-io.js";
import { catalog } from "./catalog.js";
const exec = promisify(execFile);
test(
  "Interner OIDC-Weg: echte TLS-Prüfung, begrenzte Routen, kein Hostport, idempotent und manipulationsfest",
  { timeout: 180000 },
  async () => {
    const root = await mkdtemp("/tmp/sp-backchannel-"),
      project = "sp-bc-" + randomUUID().slice(0, 8),
      media = project + "_media",
      ingress = project + "_ingress",
      hostname = "fixture.example.ts.net",
      backend = project + "-idp",
      client = project + "-jellyfin";
    const records = new Map();
    let helper;
    let certDenied = true;
    try {
      await mkdir(root + "/identity-secrets", { mode: 0o700 });
      await mkdir(root + "/cert", { mode: 0o700 });
      await exec("openssl", [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "30",
        "-subj",
        "/CN=Fixture CA",
        "-addext",
        "basicConstraints=critical,CA:TRUE",
        "-keyout",
        root + "/ca.key",
        "-out",
        root + "/ca.pem",
      ]);
      await exec("openssl", [
        "req",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-subj",
        "/CN=" + hostname,
        "-keyout",
        root + "/cert/key.pem",
        "-out",
        root + "/leaf.csr",
      ]);
      await writeFile(
        root + "/leaf.ext",
        `subjectAltName=DNS:${hostname}\nextendedKeyUsage=serverAuth\nkeyUsage=digitalSignature,keyEncipherment\nbasicConstraints=CA:FALSE\n`,
      );
      await exec("openssl", [
        "x509",
        "-req",
        "-in",
        root + "/leaf.csr",
        "-CA",
        root + "/ca.pem",
        "-CAkey",
        root + "/ca.key",
        "-CAcreateserial",
        "-days",
        "30",
        "-extfile",
        root + "/leaf.ext",
        "-out",
        root + "/cert/cert.pem",
      ]);
      await localDocker(["network", "create", media]);
      await localDocker(["network", "create", ingress]);
      await localDocker([
        "run",
        "-d",
        "--name",
        backend,
        "--network",
        ingress,
        "--user",
        `${process.getuid()}:${process.getgid()}`,
        catalog.services.ApiRelay.image,
        "node",
        "-e",
        `require('node:http').createServer((q,r)=>{r.setHeader('Content-Type','application/json');r.end(JSON.stringify({issuer:'https://${hostname}:8443/application/o/stackpilot-jellyfin/',host:q.headers.host,proto:q.headers['x-forwarded-proto']}));}).listen(8080,'0.0.0.0')`,
      ]);
      await localDocker([
        "run",
        "-d",
        "--name",
        client,
        "--network",
        media,
        "--user",
        `${process.getuid()}:${process.getgid()}`,
        "--mount",
        `type=bind,src=${root}/ca.pem,dst=/fixture-ca.pem,readonly`,
        catalog.services.ApiRelay.image,
        "node",
        "-e",
        "setInterval(()=>{},10000)",
      ]);
      const [container] = JSON.parse(await localDocker(["inspect", client]));
      const plan = {
        id: "p",
        rootId: "p",
        uid: process.getuid(),
        gid: process.getgid(),
      };
      const identityRecord = {
        id: "i",
        rootId: "p",
        project,
        input: { hostname, uid: plan.uid, gid: plan.gid },
      };
      const hub = {
        engine: {
          current: () => ({ plan }),
          store: { directory: root },
          vault: {
            get: (k) => records.get(k),
            set: (k, v) => records.set(k, structuredClone(v)),
          },
        },
      };
      const identity = {
        verify: async () => identityRecord,
        containers: async () => [
          {
            Name: "/" + backend,
            Config: { Labels: { "com.docker.compose.service": "gateway" } },
            State: { Running: true },
          },
        ],
      };
      helper = new OidcBackchannel(
        hub,
        identity,
        {
          context: async () => ({
            plan,
            identity: identityRecord,
            container,
            network: media,
          }),
        },
        {
          certificates: async (h, dir) => {
            assert.equal(h, hostname);
            if (certDenied) throw certificateFailure("permission");
            await copyFile(root + "/cert/cert.pem", dir + "/cert.pem");
            await copyFile(root + "/cert/key.pem", dir + "/key.pem");
          },
        },
      );
      await assert.rejects(
        helper.ensure(),
        (e) => e.repairFailure.code === "permission",
      );
      const pending = await helper.diagnostics();
      assert.equal(pending.configured, true);
      assert.equal(pending.stage, "certificate");
      assert.equal(pending.lastFailure.code, "permission");
      assert.equal(pending.installed, false);
      const pendingId = helper.current().id;
      certDenied = false;
      const first = await helper.ensure({ explicit: true });
      assert.equal(helper.current().id, pendingId);
      assert.equal((await helper.diagnostics()).lastFailure, null);
      assert.equal(first.verified, true);
      const before = helper.current();
      const idsBefore = await localDocker([
        "ps",
        "-q",
        "--filter",
        "label=io.stackpilot.backchannel=" + before.id,
      ]);
      const result = await dockerInput(
        ["exec", "-i", container.Id, "node", "--input-type=module"],
        `import https from 'node:https';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';const hostname='${hostname}';const read=(route,trust=true)=>new Promise((resolve,reject)=>{https.get({hostname,port:8443,path:route,ca:trust?readFileSync('/fixture-ca.pem'):undefined},r=>{let body='';r.on('data',v=>body+=v);r.on('end',()=>resolve({status:r.statusCode,body}));}).on('error',reject)});let good;for(let i=0;i<30;i++){try{good=await read('/application/o/stackpilot-jellyfin/.well-known/openid-configuration');break}catch{await new Promise(r=>setTimeout(r,100));}}assert.equal(good.status,200);const meta=JSON.parse(good.body);assert.equal(meta.proto,'https');assert.equal(meta.host,hostname+':8443');assert.equal((await read('/if/admin/')).status,404);await assert.rejects(read('/application/o/token/',false));console.log('TLS verified, untrusted certificate rejected, admin path blocked.');`,
      );
      assert.match(result, /TLS verified/);
      await helper.ensure();
      assert.equal(
        await localDocker([
          "ps",
          "-q",
          "--filter",
          "label=io.stackpilot.backchannel=" + before.id,
        ]),
        idsBefore,
      );
      const rotation = before.directory + "/issue-" + randomUUID();
      await mkdir(rotation, { mode: 0o700 });
      await exec("openssl", [
        "req",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-subj",
        "/CN=" + hostname,
        "-keyout",
        rotation + "/key.pem",
        "-out",
        root + "/renew.csr",
      ]);
      await exec("openssl", [
        "x509",
        "-req",
        "-in",
        root + "/renew.csr",
        "-CA",
        root + "/ca.pem",
        "-CAkey",
        root + "/ca.key",
        "-CAcreateserial",
        "-days",
        "30",
        "-extfile",
        root + "/leaf.ext",
        "-out",
        rotation + "/cert.pem",
      ]);
      const cert = await readFile(rotation + "/cert.pem"),
        key = await readFile(rotation + "/key.pem"),
        info = certificateInfo(cert, key, hostname);
      const interrupted = helper.current();
      interrupted.rotation = {
        ...info,
        source: rotation,
        previous: { ...interrupted.hashes },
      };
      helper.save(interrupted);
      await copyFile(
        rotation + "/cert.pem",
        before.directory + "/tls/cert.pem",
      );
      await helper.ensure();
      assert.equal(helper.current().rotation, null);
      assert.equal(helper.current().reloadPending, false);
      assert.equal(helper.current().hashes["tls/key.pem"], info.keyHash);
      const fingerprint = new X509Certificate(cert).fingerprint256;
      await dockerInput(
        ["exec", "-i", container.Id, "node", "--input-type=module"],
        `import https from 'node:https';import {readFileSync} from 'node:fs';import assert from 'node:assert/strict';let actual;for(let i=0;i<30;i++){actual=await new Promise((resolve,reject)=>https.get({hostname:'${hostname}',port:8443,path:'/application/o/token/',ca:readFileSync('/fixture-ca.pem')},r=>{const fp=r.socket.getPeerCertificate().fingerprint256;r.resume();r.on('end',()=>resolve(fp));}).on('error',reject));if(actual==='${fingerprint}')break;await new Promise(r=>setTimeout(r,100));}assert.equal(actual,'${fingerprint}');console.log('Rotated certificate loaded after interrupted key swap.');`,
      );
      let ownId = (
        await localDocker([
          "ps",
          "-q",
          "--no-trunc",
          "--filter",
          "label=io.stackpilot.backchannel=" + before.id,
        ])
      ).trim();
      await localDocker(["stop", ownId]);
      await assert.rejects(
        helper.ensure({ explicit: false }),
        (e) => e.repairFailure.code === "service-stopped",
      );
      assert.equal((await helper.diagnostics()).verified, false);
      assert.equal(
        (await localDocker(["ps", "-q", "--filter", "id=" + ownId])).trim(),
        "",
      );
      await helper.ensure({ explicit: true });
      assert.equal((await helper.inspect()).verified, true);
      await localDocker(["rm", "-f", ownId]);
      await assert.rejects(
        helper.ensure({ explicit: false }),
        (e) => e.repairFailure.code === "service-stopped",
      );
      await helper.ensure({ explicit: true });
      assert.equal((await helper.inspect()).verified, true);
      const originalDocker = helper.docker;
      helper.docker = async (args, options) => {
        const out = await originalDocker(args, options);
        if (args[0] === "inspect") {
          const rows = JSON.parse(out);
          for (const v of rows)
            if (v.Config.Labels["io.stackpilot.backchannel"] === before.id)
              v.HostConfig.Privileged = true;
          return JSON.stringify(rows);
        }
        return out;
      };
      await assert.rejects(
        helper.ensure({ explicit: true }),
        (e) => e.repairFailure.stage === "verification",
      );
      helper.docker = originalDocker;
      await writeFile(before.directory + "/nginx.conf", "manual change\n", {
        mode: 0o600,
      });
      await assert.rejects(
        helper.ensure(),
        (e) => e.repairFailure.code === "files",
      );
      console.log(
        "Realer interner HTTPS-Weg ohne Hostport und ohne abgeschaltete Zertifikatsprüfung bestanden.",
      );
    } finally {
      const record = helper?.current();
      if (record)
        await localDocker([
          "compose",
          "-f",
          record.directory + "/compose.json",
          "down",
        ]).catch(() => {});
      await localDocker(["rm", "-f", client, backend]).catch(() => {});
      await localDocker(["network", "rm", media, ingress]).catch(() => {});
      await rm(root, { recursive: true, force: true });
    }
  },
);
