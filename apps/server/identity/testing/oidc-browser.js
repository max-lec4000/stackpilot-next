// Test realm only. HTTPS browser URLs are fulfilled using an isolated loopback gateway.

import {
  createHmac,
  randomBytes,
  createHash,
  createPublicKey,
  verify,
} from "node:crypto";
import assert from "node:assert/strict";
import { localIdentityRequest } from "../local-request.js";
function otp() {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = createHmac("sha1", Buffer.from("a1".repeat(20), "hex"))
    .update(b)
    .digest();
  return String((h.readUInt32BE(h[19] & 15) & 0x7fffffff) % 1000000).padStart(
    6,
    "0",
  );
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
export async function verifyOidcBrowser(record, clientSecret) {
  assert.equal(record.stackPlanId, "fixture");
  assert.equal(record.input.hostname, "identity.example.ts.net");
  const hostname = record.input.hostname,
    origin = "https://" + hostname + ":8443",
    callback = "https://" + hostname + "/sso/OID/redirect/stackpilot",
    base = "http://127.0.0.1:" + record.input.gatewayPort;
  const { chromium } = await import(
    process.env.STACKPILOT_PLAYWRIGHT_MODULE || "playwright"
  );
  let browser, page;
  try {
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      args: ["--no-sandbox"],
    });
    const context = await browser.newContext({ locale: "en-US" });
    let redirected;
    // The browser's HTTPS requests are fulfilled from our loopback fixture.
    // No external network, no relaxed production TLS, no real Funnel involved.
    await context.route("**/*", async (route) => {
      const u = new URL(route.request().url());
      if (process.env.STACKPILOT_TEST_TRACE === "1")
        console.log("Fixture request", u.origin, u.pathname);
      if (u.origin === origin) {
        let target = u.pathname + u.search,
          method = route.request().method(),
          body = route.request().postDataBuffer()?.toString();
        const headers = {
          ...(await route.request().allHeaders()),
          "accept-encoding": "identity",
          host: hostname + ":8443",
        };
        const cookies = new Map(
          (headers.cookie || "")
            .split(";")
            .filter(Boolean)
            .map((v) => {
              const i = v.indexOf("=");
              return [v.slice(0, i).trim(), v.slice(i + 1)];
            }),
        );
        const received = [];
        let response;
        for (let i = 0; i < 8; i++) {
          headers.cookie = [...cookies].map(([k, v]) => k + "=" + v).join("; ");
          delete headers["content-length"];
          response = await localIdentityRequest(base + target, {
            method,
            headers,
            body,
          });
          for (const c of response.headers.getSetCookie()) {
            received.push(c);
            const first = c.split(";")[0],
              at = first.indexOf("=");
            cookies.set(first.slice(0, at), first.slice(at + 1));
          }
          if (
            u.pathname.startsWith("/api/v3/flows/executor/") &&
            [301, 302, 303].includes(response.status) &&
            response.headers.get("location")
          ) {
            const next = new URL(response.headers.get("location"), origin);
            assert.equal(next.origin, origin);
            assert.ok(next.pathname.startsWith("/api/v3/flows/executor/"));
            target = next.pathname + next.search;
            method = "GET";
            body = undefined;
            continue;
          }
          break;
        }
        const outputHeaders = Object.fromEntries(response.headers);
        if (received.length) outputHeaders["set-cookie"] = received.join("\n");
        const bytes = Buffer.from(await response.arrayBuffer());
        if (
          process.env.STACKPILOT_TEST_TRACE === "1" &&
          u.pathname.startsWith("/api/v3/flows/")
        ) {
          try {
            console.log(
              "Fixture challenge",
              method,
              response.status,
              JSON.parse(bytes).component,
            );
          } catch {
            console.log("Fixture response", response.status);
          }
        }
        if (
          [301, 302, 303, 307, 308].includes(response.status) &&
          response.headers.get("location")
        ) {
          const next = new URL(response.headers.get("location"), origin);
          delete outputHeaders["content-length"];
          delete outputHeaders["content-encoding"];
          delete outputHeaders.location;
          return route.fulfill({
            status: 200,
            headers: outputHeaders,
            contentType: "text/html",
            body:
              "<script>location.replace(" +
              JSON.stringify(next.href) +
              ")</script>",
          });
        }
        return route.fulfill({
          status: response.status,
          headers: outputHeaders,
          body: bytes,
        });
      }
      if (
        u.origin === "https://" + hostname &&
        u.pathname === "/sso/OID/redirect/stackpilot"
      ) {
        redirected = u;
        return route.fulfill({
          contentType: "text/html",
          body: "<p>Fixture callback received</p>",
        });
      }
      return route.abort();
    });
    page = await context.newPage();
    page.on("requestfailed", (r) => {
      if (process.env.STACKPILOT_TEST_TRACE === "1") {
        const u = new URL(r.url());
        console.log(
          "Fixture request failed",
          u.origin,
          u.pathname,
          r.failure()?.errorText,
        );
      }
    });
    const state = randomBytes(24).toString("base64url"),
      nonce = randomBytes(24).toString("base64url"),
      verifier = randomBytes(32).toString("base64url");
    const query = new URLSearchParams({
      client_id: "stackpilot-jellyfin",
      redirect_uri: callback,
      response_type: "code",
      scope: "openid profile",
      state,
      nonce,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    });
    await page.goto(origin + "/application/o/authorize/?" + query);
    await page.locator('input[name="uidField"]').fill("fixture-mfa");
    await page.locator('button[type="submit"]:visible').last().click();
    const passwordField = page.locator(
      'ak-stage-password input[name="password"]',
    );
    await passwordField.waitFor({ state: "visible" });
    await page.locator("ak-stage-password").evaluate(async (element) => {
      await element.updateComplete;
    });
    await pause(300);
    await passwordField.fill("Fixture-Identity-Test-2026!");
    assert.equal(
      await passwordField.inputValue(),
      "Fixture-Identity-Test-2026!",
    );
    await page.locator('ak-stage-password button[type="submit"]').click();
    for (let i = 0; i < 2; i++) {
      const field = page.locator('input[name="code"]');
      await field.waitFor({ state: "visible" });
      await pause(31000 - (Date.now() % 30000));
      await field.fill(otp());
      const before = page.url();
      await page.locator('button[type="submit"]:visible').last().click();
      if (i === 0)
        await page.waitForURL((url) => url.href !== before, { timeout: 20000 });
    }
    await page.locator("ak-stage-consent").waitFor({ state: "visible" });
    await page.locator('button[type="submit"]:visible').last().click();
    await page.waitForURL(
      (url) => url.pathname === "/sso/OID/redirect/stackpilot",
      { timeout: 20000 },
    );
    assert.ok(redirected);
    assert.equal(redirected.searchParams.get("state"), state);
    const code = redirected.searchParams.get("code");
    assert.ok(code);
    const exchange = async (proof = verifier) =>
      localIdentityRequest(base + "/application/o/token/", {
        method: "POST",
        headers: {
          Host: hostname,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: "stackpilot-jellyfin",
          client_secret: clientSecret,
          redirect_uri: callback,
          code,
          code_verifier: proof,
        }),
      });
    const wrongProof = await exchange(randomBytes(32).toString("base64url"));
    const wrongBody = await wrongProof.json();
    assert.ok(wrongProof.status >= 400);
    assert.equal(wrongBody.access_token, undefined);
    const response = await exchange();
    assert.equal(response.status, 200);
    const tokens = await response.json();
    assert.ok(tokens.id_token);
    assert.equal(tokens.refresh_token, undefined);
    const [header, payload, signature] = tokens.id_token.split(".");
    const claims = JSON.parse(Buffer.from(payload, "base64url")),
      meta = JSON.parse(Buffer.from(header, "base64url"));
    assert.equal(meta.alg, "RS256");
    const jwks = await (
      await localIdentityRequest(
        base + "/application/o/stackpilot-jellyfin/jwks/",
        { headers: { Host: hostname } },
      )
    ).json();
    const jwk = jwks.keys.find((k) => k.kid === meta.kid);
    assert.ok(jwk);
    assert.ok(
      verify(
        "RSA-SHA256",
        Buffer.from(header + "." + payload),
        createPublicKey({ key: jwk, format: "jwk" }),
        Buffer.from(signature, "base64url"),
      ),
    );
    assert.equal(claims.nonce, nonce);
    assert.equal(claims.aud, "stackpilot-jellyfin");
    assert.equal(claims.iss, origin + "/application/o/stackpilot-jellyfin/");
    assert.equal(claims.preferred_username, "spv_fixture-mfa");
    assert.deepEqual(claims.groups, ["stackpilot-viewers"]);
    assert.ok(claims.exp - claims.iat <= 300);
    const replay = await exchange();
    await replay.arrayBuffer();
    assert.ok(replay.status >= 400);
    return {
      browserMfa: true,
      signedIdToken: true,
      nonce: true,
      pkce: true,
      codeReplayRejected: true,
    };
  } catch (error) {
    if (page && process.env.STACKPILOT_TEST_TRACE === "1")
      await page
        .screenshot({ path: "/tmp/stackpilot-oidc-debug.png", fullPage: true })
        .catch(() => {});
    throw error;
  } finally {
    if (browser) await browser.close();
  }
}
