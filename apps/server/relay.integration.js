// Isolated local fixture, no network access or published ports.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { localDocker } from "./retirement.js";
import { relayRequest } from "./docker-io.js";
import { catalog } from "./catalog.js";
test(
  "API-Brücke liest große Prowlarr-Kataloge, begrenzt andere Antworten und unterstützt leere HTTP-204-Antworten",
  { timeout: 60000 },
  async () => {
    let id;
    try {
      const program = `const http=require('node:http');const body=JSON.stringify([{name:'Large catalog',protocol:'torrent',fields:[],helpText:'x'.repeat(3500000)}]);http.createServer((req,res)=>{if(req.url==='/empty'){res.writeHead(204);return res.end();}if(req.url.includes('oversized')){res.writeHead(200);return res.end('x'.repeat(17000000));}res.setHeader('content-type','application/json');res.end(body);}).listen(9696,'0.0.0.0');`;
      id = (
        await localDocker([
          "run",
          "-d",
          "--name",
          "sp-relay-" + randomUUID(),
          "--network=none",
          "--add-host=prowlarr:127.0.0.1",
          catalog.services.ApiRelay.image,
          "node",
          "-e",
          program,
        ])
      ).trim();
      const get = (route) =>
        relayRequest(id, {
          url: "http://prowlarr:9696" + route,
          method: "GET",
          headers: {},
        });
      for (let n = 0; n < 20; n++) {
        try {
          const r = await get("/empty");
          if (r.status === 204) break;
        } catch {}
        await new Promise((r) => setTimeout(r, 100));
      }
      const schema = await get("/api/v1/indexer/schema");
      assert.equal(schema.status, 200);
      assert.equal(JSON.parse(schema.body)[0].name, "Large catalog");
      assert.ok(schema.body.length > 3000000);
      const regular = await get("/api/v1/indexer");
      assert.equal(regular.status, 598);
      assert.equal(regular.error, "ResponseTooLarge");
      assert.equal(regular.body, "");
      const oversized = await get("/api/v1/indexer/schema?oversized=1");
      assert.equal(oversized.status, 598);
      const empty = await get("/empty");
      assert.equal(empty.status, 204);
      assert.equal(empty.body, "");
      // Same schema path with oversized data still remains bounded.
      const post = await relayRequest(id, {
        url: "http://prowlarr:9696/api/v1/indexer/schema",
        method: "POST",
        headers: {},
      });
      assert.equal(post.status, 598);
    } finally {
      if (id) {
        await localDocker(["stop", "--time", "1", id]);
        await localDocker(["rm", id]);
      }
    }
  },
);
