#!/usr/bin/env node
// Testhilfe für die Test-VM: spielt die komplette Zuschauer-Anmeldung ohne Browser durch –
// Jellyfin → Authentik (Passwort, zweiten Faktor einrichten) → Freigabe → zurück zu Jellyfin –
// und prüft, dass Jellyfin danach das Zuschauerkonto kennt. Gibt keine Zugangsdaten aus.
//   node oidc-login.mjs <benutzername>
// Mit TEST_SEERR_QUICK_CONNECT=1 zusätzlich eine Seerr-Zuschauersitzung prüfen.
import { readFile } from "node:fs/promises";
import { createHmac, randomBytes } from "node:crypto";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const name = process.argv[2];
const sp = "http://127.0.0.1:5173";
const admin = JSON.parse(await readFile(path.join(os.homedir(), ".stackpilot-test/admin.json"), "utf8"));
const spLogin = await fetch(sp + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: sp }, body: JSON.stringify(admin) });
const spCookie = spLogin.headers.get("set-cookie").split(";")[0];
const { token } = await (await fetch(sp + "/api/session", { headers: { Cookie: spCookie } })).json();
const api = async (route, body) =>
  (await fetch(sp + route, { method: body ? "POST" : "GET", headers: { Cookie: spCookie, ...(body ? { "Content-Type": "application/json", Origin: sp, "X-StackPilot-Token": token } : {}) }, body: body && JSON.stringify(body) })).json();
const reset = await api("/api/viewers/action", { action: "reset", name });
if (!reset.invitation) throw Error("Zurücksetzen fehlgeschlagen: " + JSON.stringify(reset));
const host = new URL(reset.invitation.loginUrl).hostname;

// Die beiden HTTPS-Adressen enden lokal an den Gateways (so wie Tailscale Serve sie weiterreicht).
const upstream = { [`https://${host}`]: 19096, [`https://${host}:8443`]: 19080 };
const jars = {};
function request(url, { method = "GET", body, headers = {} } = {}) {
  const u = new URL(url);
  const port = upstream[u.origin];
  if (!port) throw Error("Unerwartete Adresse: " + u.origin);
  const jar = (jars[u.origin] ||= new Map());
  const text = body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: u.pathname + u.search, method,
        headers: { Host: u.host.replace(/:443$/, ""), Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
          ...(text ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) } : {}),
          ...(text ? { Referer: u.origin + "/", Origin: u.origin } : {}),
          ...(jar.has("authentik_csrf") ? { "X-authentik-CSRF": jar.get("authentik_csrf") } : {}), ...headers } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          for (const line of res.headers["set-cookie"] || []) {
            const pair = line.split(";")[0];
            jar.set(pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1));
          }
          resolve({ status: res.statusCode, location: res.headers.location ? new URL(res.headers.location, url).href : null, data });
        });
      },
    );
    req.on("error", reject);
    req.end(text || undefined);
  });
}
/** Folgt Weiterleitungen, bis eine Seite kommt; gibt die letzte Antwort samt Adresse zurück. */
async function follow(url) {
  for (let i = 0; i < 12; i++) {
    const r = await request(url);
    if (r.status >= 300 && r.status < 400 && r.location) { url = r.location; continue; }
    return { ...r, url };
  }
  throw Error("Zu viele Weiterleitungen");
}
function totp(secret, shift = 0) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + shift));
  const mac = createHmac("sha1", key).update(counter).digest();
  const offset = mac.at(-1) & 15;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1e6).padStart(6, "0");
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let secret = null, lastCodeWindow = -1, codePrompts = 0;
async function freshCode() {
  // Derselbe Code wird nicht zweimal angenommen – wie ein Mensch auf den nächsten warten.
  while (Math.floor(Date.now() / 30000) === lastCodeWindow) await sleep(1000);
  lastCodeWindow = Math.floor(Date.now() / 30000);
  return totp(secret);
}
/** Arbeitet einen Authentik-Ablauf ab und liefert die Zieladresse der abschließenden Weiterleitung. */
async function runFlow(pageUrl) {
  const u = new URL(pageUrl);
  const slug = u.pathname.match(/\/if\/flow\/([^/]+)\//)?.[1];
  if (!slug) throw Error("Keine Ablaufseite: " + u.pathname);
  const executor = `${u.origin}/api/v3/flows/executor/${slug}/?query=${encodeURIComponent(u.search.slice(1))}`;
  let r = await request(executor);
  for (let i = 0; i < 12; i++) {
    if (r.status >= 300 && r.status < 400) { r = await request(executor); continue; }
    let c;
    try { c = JSON.parse(r.data); } catch { throw Error(`Keine JSON-Antwort (HTTP ${r.status}): ` + r.data.replace(/\s+/g, " ").slice(0, 300)); }
    console.log(`  [${slug.replace("stackpilot-", "")}] ${c.component}${c.response_errors ? " FEHLER " + JSON.stringify(c.response_errors).slice(0, 160) : ""}`);
    let answer;
    if (c.component === "xak-flow-redirect") return new URL(c.to, u.origin).href;
    else if (c.component === "ak-stage-identification") answer = { uid_field: name };
    else if (c.component === "ak-stage-password") answer = { password: reset.invitation.password };
    else if (c.component === "ak-stage-authenticator-totp") {
      secret = new URL(c.config_url).searchParams.get("secret");
      lastCodeWindow = Math.floor(Date.now() / 30000);
      answer = { code: totp(secret) };
    } else if (c.component === "ak-stage-authenticator-validate" && c.configuration_stages?.length) {
      const totpSetup = c.configuration_stages.find((stage) => stage.meta_model_name.endsWith(".authenticatortotpstage"));
      if (!totpSetup) throw Error("TOTP-Einrichtung fehlt.");
      answer = { selected_stage: totpSetup.pk };
    } else if (c.component === "ak-stage-authenticator-validate") {
      codePrompts++;
      answer = { code: await freshCode() };
    } else if (c.component === "ak-stage-prompt") {
      const password = randomBytes(24).toString("base64url");
      answer = { password, password_repeat: password };
    } else if (c.component === "ak-stage-authenticator-static") {
      if (!Array.isArray(c.codes) || !c.codes.length)
        throw Error("Keine Wiederherstellungscodes erhalten.");
      answer = {};
    } else if (c.component === "ak-stage-consent") answer = { token: c.token };
    else throw Error("Unerwarteter Schritt: " + c.component + " " + (c.error_message || ""));
    r = await request(executor, { method: "POST", body: { component: c.component, ...answer } });
  }
  throw Error("Ablauf endet nicht");
}

const started = Date.now();
let page = await follow(`https://${host}/sso/OID/start/stackpilot`);
for (let i = 0; i < 4 && new URL(page.url).pathname.startsWith("/if/flow/"); i++) page = await follow(await runFlow(page.url));
console.log("Zurück bei:", new URL(page.url).origin + new URL(page.url).pathname, "HTTP", page.status);
console.log(`Codes nach dem Einrichten abgefragt: ${codePrompts} · Dauer ${Math.round((Date.now() - started) / 1000)} s`);
// Jellyfins Antwortseite meldet den Browser per Skript an; das stellen wir nach.
const state = page.data.match(/var data = '([^']+)'/)?.[1] || page.data.match(/data:\s*["']([^"']+)["']/)?.[1];
if (!state) {
  const at = page.data.indexOf("OID/Auth");
  console.log("Anmeldedaten nicht gefunden. Umgebung:", page.data.slice(Math.max(0, at - 700), at + 200).replace(/[A-Za-z0-9_-]{40,}/g, "…"));
  process.exit(2);
}
const auth = await request(`https://${host}/sso/OID/Auth/stackpilot`, {
  method: "POST",
  body: { deviceId: "stackpilot-testvm", deviceName: "Testlauf", appName: "Jellyfin Web", appVersion: "12.4.0", data: state },
});
let session = null;
try { session = JSON.parse(auth.data); } catch {}
console.log("Jellyfin-Anmeldung: HTTP", auth.status, "| Benutzer:", session?.User?.Name, "| Admin:", session?.User?.Policy?.IsAdministrator, "| Passwortanbieter gesperrt:", /InvalidAuthProvider/.test(session?.User?.Policy?.AuthenticationProviderId || ""));
if (session?.AccessToken) {
  const views = await request(`https://${host}/UserViews?userId=${session.User.Id}`, { headers: { Authorization: `MediaBrowser Client="Jellyfin Web", Device="Testlauf", DeviceId="stackpilot-testvm", Version="12.4.0", Token="${session.AccessToken}"` } });
  console.log("Bibliotheken über das Schutz-Gateway: HTTP", views.status, JSON.parse(views.data).Items?.map((v) => v.Name).join(", "));
}

if (process.env.TEST_SEERR_QUICK_CONNECT === "1") {
  if (!session?.AccessToken || !session.User?.Id)
    throw Error("Für den Seerr-Test fehlt die Jellyfin-Zuschauersitzung.");
  const { services } = await api("/api/managed");
  const seerrPort = services.find((service) =>
    service.name === "Seerr" && service.state === "running"
  )?.hostPort;
  if (!Number.isInteger(seerrPort))
    throw Error("Für den Quick-Connect-Test muss Seerr laufen.");
  const seerrBase = `http://127.0.0.1:${seerrPort}/api/v1`;

  async function seerrCall(route, options = {}, expected = [200]) {
    const response = await fetch(seerrBase + route, {
      ...options,
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (!expected.includes(response.status))
      throw Error(`Seerr ${route}: HTTP ${response.status}`);
    return response;
  }

  const prime = await seerrCall("/status");
  const primedCookies = new Map();
  function collectCookies(response) {
    for (const line of response.headers.getSetCookie()) {
      const pair = line.split(";")[0];
      const separator = pair.indexOf("=");
      if (separator > 0) primedCookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
  }
  function seerrHeaders() {
    return {
      "Content-Type": "application/json",
      Cookie: [...primedCookies].map(([key, value]) => `${key}=${value}`).join("; "),
      ...(primedCookies.has("XSRF-TOKEN")
        ? { "XSRF-TOKEN": decodeURIComponent(primedCookies.get("XSRF-TOKEN")) }
        : {}),
    };
  }
  collectCookies(prime);
  await prime.body?.cancel();
  const initiate = await seerrCall("/auth/jellyfin/quickconnect/initiate", {
    method: "POST", headers: seerrHeaders(),
  });
  collectCookies(initiate);
  const { code, secret: seerrSecret } = await initiate.json();
  if (!/^\d{6}$/.test(code) || typeof seerrSecret !== "string" || !seerrSecret)
    throw Error("Seerr liefert keinen gültigen Quick-Connect-Code.");
  const approved = await request(
    `https://${host}/QuickConnect/Authorize?code=${encodeURIComponent(code)}`,
    {
      method: "POST",
      headers: { Authorization: `MediaBrowser Client="Jellyfin Web", Device="Testlauf", DeviceId="stackpilot-testvm", Version="12.4.0", Token="${session.AccessToken}"` },
    },
  );
  if (approved.status !== 200)
    throw Error("Jellyfin Quick-Connect-Freigabe: HTTP " + approved.status);
  const authenticated = await seerrCall("/auth/jellyfin/quickconnect/authenticate", {
    method: "POST",
    headers: seerrHeaders(),
    body: JSON.stringify({ secret: seerrSecret }),
  });
  collectCookies(authenticated);
  await authenticated.body?.cancel();
  const me = await (await seerrCall("/auth/me", { headers: seerrHeaders() })).json();
  if (me.jellyfinUserId !== session.User.Id || (me.permissions & 3) !== 0)
    throw Error("Das Seerr-Konto entspricht nicht dem Jellyfin-Zuschauer.");
  const admin = await seerrCall("/settings/main", { headers: seerrHeaders() }, [401, 403]);
  await admin.body?.cancel();
  console.log("Seerr Quick Connect: Zuschauerkonto bestätigt, Admin-Einstellungen abgewiesen");
}
