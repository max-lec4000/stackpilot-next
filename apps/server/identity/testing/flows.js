import { localIdentityRequest } from "../local-request.js";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
function token() {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = createHmac("sha1", Buffer.from("a1".repeat(20), "hex"))
    .update(b)
    .digest();
  const offset = h[19] & 15;
  return String((h.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(
    6,
    "0",
  );
}
function client(base, host) {
  const jar = new Map();
  let challenge;
  async function request(path, body) {
    const headers = {
      Accept: "application/json",
      Host: host,
      Origin: "http://" + host,
      Referer: "http://" + host + "/if/flow/stackpilot-authentication/",
      Cookie: [...jar].map(([k, v]) => k + "=" + v).join("; "),
    };
    for (const [k, v] of jar) if (/csrf/i.test(k)) headers["X-CSRFToken"] = v;
    if (body) headers["Content-Type"] = "application/json";
    const r = await localIdentityRequest(base + path, {
      headers,
      method: body ? "POST" : "GET",
      body: body ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
    for (const c of r.headers.getSetCookie()) {
      const part = c.split(";")[0],
        index = part.indexOf("=");
      jar.set(part.slice(0, index), part.slice(index + 1));
    }
    const text = await r.text();
    if (r.status === 302 && r.headers.get("location")) {
      const u = new URL(r.headers.get("location"), "http://" + host);
      assert.ok(u.pathname.startsWith("/api/v3/flows/executor/"));
      return request(u.pathname + u.search);
    }
    try {
      challenge = JSON.parse(text);
    } catch {
      challenge = null;
    }
    if (path.startsWith("/api/v3/flows/executor/")) {
      assert.equal(r.status, 200);
    }
    return challenge;
  }
  return {
    cookies: () => [...jar].map(([k, v]) => k + "=" + v).join("; "),
    async whoami(cookie) {
      const response = await localIdentityRequest(
        base + "/api/v3/core/users/me/",
        {
          headers: {
            Host: host,
            Cookie: cookie || [...jar].map(([k, v]) => k + "=" + v).join("; "),
          },
        },
      );
      const text = await response.text();
      return { status: response.status, body: JSON.parse(text) };
    },
    async logout() {
      await request("/if/flow/stackpilot-invalidation/");
      return request("/api/v3/flows/executor/stackpilot-invalidation/");
    },
    async start() {
      await request("/if/flow/stackpilot-authentication/");
      return request("/api/v3/flows/executor/stackpilot-authentication/");
    },
    async solve(fields) {
      return request("/api/v3/flows/executor/stackpilot-authentication/", {
        component: challenge.component,
        ...fields,
      });
    },
  };
}
export async function verifyMfaFlows(base, host) {
  for (const name of ["fixture-no-mfa", "fixture-mfa"]) {
    const c = client(base, host);
    let r = await c.start();
    r = await c.solve({ uid_field: name });
    r = await c.solve({ password: "Fixture-Identity-Test-2026!" });
    if (name === "fixture-no-mfa") {
      assert.match(r.component, /denied/);
    } else {
      assert.match(r.component, /authenticator-validate/);
      r = await c.solve({ code: "000000" });
      assert.match(r.component, /authenticator-validate/);
      await new Promise((r) => setTimeout(r, 1200));
      r = await c.solve({ code: token() });
      assert.match(r.component, /redirect/);
      const before = await c.whoami();
      assert.equal(before.status, 200);
      assert.equal(before.body.user.username, "fixture-mfa");
      const oldCookie = c.cookies();
      await c.logout();
      const after = await c.whoami();
      assert.ok([401, 403].includes(after.status));
      const replay = await c.whoami(oldCookie);
      assert.ok(
        [401, 403].includes(replay.status),
        "Logout muss auch die alte Sitzung serverseitig ungültig machen",
      );
    }
  }
}
