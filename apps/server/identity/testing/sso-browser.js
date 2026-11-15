// Test realm only. HTTPS browser URLs are fulfilled using an isolated loopback gateway.

import { createHmac } from "node:crypto";
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
export async function verifyJellyfinSso(
  record,
  requestAsAdmin,
  jellyfinPort = 28096,
  expectedLibraryIds,
) {
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
    let issued, authPayload;
    // The browser's HTTPS requests are fulfilled from our loopback fixture.
    // No external network, no relaxed production TLS, no real Funnel involved.
    await context.route("**/*", async (route) => {
      const u = new URL(route.request().url());
      if (process.env.STACKPILOT_TEST_TRACE === "1")
        console.log("Fixture request", u.origin, u.pathname);
      if (u.origin === origin || u.origin === "https://" + hostname) {
        const localBase =
          u.origin === origin ? base : "http://127.0.0.1:" + jellyfinPort;
        let target = u.pathname + u.search,
          method = route.request().method(),
          body = route.request().postDataBuffer()?.toString();
        const headers = {
          ...(await route.request().allHeaders()),
          "accept-encoding": "identity",
          host: u.origin === origin ? hostname + ":8443" : hostname,
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
          response = await localIdentityRequest(localBase + target, {
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
            const next = new URL(response.headers.get("location"), u.origin);
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
          u.pathname === "/sso/OID/Auth/stackpilot" &&
          route.request().method() === "POST" &&
          response.status === 200
        ) {
          issued = JSON.parse(bytes);
          authPayload = route.request().postData();
        }
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
          const next = new URL(response.headers.get("location"), u.origin);
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
    await page.goto("https://" + hostname + "/sso/OID/start/stackpilot");
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
      const picker = page.getByRole("button", {
        name: "Traditional authenticator",
        exact: true,
      });
      await field.or(picker).first().waitFor({ state: "visible" });
      if (await picker.isVisible()) await picker.click();
      await field.waitFor({ state: "visible" });
      if (i > 0) await pause(31000 - (Date.now() % 30000));
      await field.fill(otp());
      const before = page.url();
      await page.locator('button[type="submit"]:visible').last().click();
      if (i === 0)
        await page.waitForURL((url) => url.href !== before, { timeout: 20000 });
    }
    await page.locator("ak-stage-consent").waitFor({ state: "visible" });
    await page.locator('button[type="submit"]:visible').last().click();
    for (let i = 0; i < 300 && !issued; i++) await pause(100);
    assert.ok(issued?.AccessToken, "SSO muss ein Jellyfin-Token ausstellen");
    assert.equal(issued.User.Name, "spv_fixture-mfa");
    assert.equal(issued.User.Policy.IsAdministrator, false);
    const baseJellyfin = "http://127.0.0.1:" + jellyfinPort;
    const viewerHeaders = {
      Host: hostname,
      Authorization:
        'MediaBrowser Client="Fixture SSO", Device="Browser", DeviceId="fixture-sso-browser", Version="1.0", Token="' +
        issued.AccessToken +
        '"',
    };
    const me = await localIdentityRequest(baseJellyfin + "/Users/Me", {
      headers: viewerHeaders,
    });
    assert.equal(me.status, 200);
    const user = await me.json();
    assert.equal(user.Policy.IsAdministrator, false);
    assert.equal(user.Policy.EnableAllFolders, false);
    if (expectedLibraryIds)
      assert.deepEqual(
        user.Policy.EnabledFolders.map((id) =>
          id.replaceAll("-", "").toLowerCase(),
        ).sort(),
        expectedLibraryIds
          .map((id) => id.replaceAll("-", "").toLowerCase())
          .sort(),
      );
    const escalate = await localIdentityRequest(
      baseJellyfin + "/Users/" + user.Id + "/Policy",
      {
        method: "POST",
        headers: { ...viewerHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ ...user.Policy, IsAdministrator: true }),
      },
    );
    await escalate.arrayBuffer();
    assert.equal(
      escalate.status,
      403,
      "Zuschauer dürfen sich keine Administratorrechte geben",
    );
    assert.equal(user.Policy.EnableContentDeletion, false);
    assert.equal(
      user.Policy.AuthenticationProviderId,
      "Jellyfin.Server.Implementations.Users.InvalidAuthProvider",
    );
    for (const pw of ["", "Fixture-Identity-Test-2026!"]) {
      const result = await localIdentityRequest(
        baseJellyfin + "/Users/AuthenticateByName",
        {
          method: "POST",
          headers: {
            Host: hostname,
            "Content-Type": "application/json",
            Authorization:
              'MediaBrowser Client="Fixture password test", Device="Fixture", DeviceId="fixture-direct", Version="1.0"',
          },
          body: JSON.stringify({ Username: "spv_fixture-mfa", Pw: pw }),
        },
      );
      await result.arrayBuffer();
      assert.ok(
        [401, 403].includes(result.status),
        "Direkte Passwortanmeldung darf MFA nicht umgehen",
      );
    }
    const replay = await localIdentityRequest(
      baseJellyfin + "/sso/OID/Auth/stackpilot",
      {
        method: "POST",
        headers: { Host: hostname, "Content-Type": "application/json" },
        body: authPayload,
      },
    );
    const replayText = await replay.text();
    assert.ok(replay.status >= 400);
    assert.equal(replayText.includes(issued.AccessToken), false);
    const init = await localIdentityRequest(
      baseJellyfin + "/QuickConnect/Initiate",
      {
        method: "POST",
        headers: {
          Host: hostname,
          Authorization:
            'MediaBrowser Client="Fixture TV", Device="TV", DeviceId="fixture-quick-connect-tv", Version="1.0"',
        },
      },
    );
    assert.equal(init.status, 200);
    const device = await init.json();
    assert.ok(device.Code && device.Secret);
    const approve = await localIdentityRequest(
      baseJellyfin +
        "/QuickConnect/Authorize?code=" +
        encodeURIComponent(device.Code),
      { method: "POST", headers: viewerHeaders },
    );
    await approve.arrayBuffer();
    assert.equal(approve.status, 200);
    const native = await localIdentityRequest(
      baseJellyfin + "/Users/AuthenticateWithQuickConnect",
      {
        method: "POST",
        headers: {
          Host: hostname,
          "Content-Type": "application/json",
          Authorization:
            'MediaBrowser Client="Fixture TV", Device="TV", DeviceId="fixture-quick-connect-tv", Version="1.0"',
        },
        body: JSON.stringify({ Secret: device.Secret }),
      },
    );
    assert.equal(native.status, 200);
    const nativeLogin = await native.json();
    assert.equal(nativeLogin.User.Id, user.Id);
    assert.ok(nativeLogin.AccessToken);
    await requestAsAdmin("/Devices?id=fixture-quick-connect-tv", {
      method: "DELETE",
    });
    const revoked = await localIdentityRequest(baseJellyfin + "/Users/Me", {
      headers: {
        Host: hostname,
        Authorization:
          'MediaBrowser Client="Fixture TV", Device="TV", DeviceId="fixture-quick-connect-tv", Version="1.0", Token="' +
          nativeLogin.AccessToken +
          '"',
      },
    });
    await revoked.arrayBuffer();
    assert.equal(revoked.status, 401);
    return {
      jellyfinSso: true,
      mfa: true,
      viewerWithoutAdmin: true,
      passwordBypassRejected: true,
      stateReplayRejected: true,
      quickConnect: true,
      deviceRevoke: true,
    };
  } catch (error) {
    if (page && process.env.STACKPILOT_TEST_TRACE === "1")
      await page
        .screenshot({
          path: "/tmp/stackpilot-sso-e2e-debug.png",
          fullPage: true,
        })
        .catch(() => {});
    throw error;
  } finally {
    if (browser) await browser.close();
  }
}
