#!/usr/bin/env node
// Testhilfe für die Test-VM: setzt einen Zuschauer zurück und geht den öffentlichen
// Anmeldeablauf bis zur Frage nach dem zweiten Faktor – ohne Browser. Gibt nur die Namen
// der Ablaufschritte aus, keine Zugangsdaten.
//   node viewer-login.mjs <benutzername>
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createHmac } from "node:crypto";
const name = process.argv[2];
const sp = "http://127.0.0.1:5173";
const admin = JSON.parse(await readFile(path.join(os.homedir(), ".stackpilot-test/admin.json"), "utf8"));
const login = await fetch(sp + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: sp }, body: JSON.stringify(admin) });
const cookie = login.headers.get("set-cookie").split(";")[0];
const { token } = await (await fetch(sp + "/api/session", { headers: { Cookie: cookie } })).json();
const reset = await (await fetch(sp + "/api/viewers/action", { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json", Origin: sp, "X-StackPilot-Token": token }, body: JSON.stringify({ action: "reset", name, confirmation: "OK" }) })).json();
if (!reset.invitation) throw Error("Zurücksetzen fehlgeschlagen: " + JSON.stringify(reset));
const host = new URL(reset.invitation.loginUrl).hostname;
console.log("Zuschauer:", reset.viewers.map((v) => `${v.username} mfa=${v.mfa}`).join(", "));

// Öffentliche Login-Grenze (Gateway 19080), wie sie über HTTPS 8443 erreichbar ist
const gateway = "http://127.0.0.1:19080";
const jar = new Map();
function send(body) {
  // node:http statt fetch: fetch lässt keinen eigenen Host-Header zu.
  return new Promise((resolve, reject) => {
    const text = body ? JSON.stringify(body) : null;
    const request = http.request(
      `${gateway}/api/v3/flows/executor/stackpilot-authentication/?query=`,
      {
        method: body ? "POST" : "GET",
        headers: {
          Host: host,
          Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
          ...(text ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) } : {}),
        },
      },
      (response) => {
        let data = "";
        response.on("data", (chunk) => (data += chunk));
        response.on("end", () => resolve({ status: response.statusCode, cookies: response.headers["set-cookie"] || [], data }));
      },
    );
    request.on("error", reject);
    request.end(text || undefined);
  });
}
async function flow(body) {
  const response = await send(body);
  for (const line of response.cookies) {
    const [pair] = line.split(";");
    jar.set(pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1));
  }
  if (response.status >= 300 && response.status < 400) return flow();
  let data = {};
  try { data = JSON.parse(response.data); } catch {}
  console.log("  →", response.status, data.component || response.data.slice(0, 160), data.response_errors ? JSON.stringify(data.response_errors).slice(0, 200) : "", data.error_message || "", data.device_challenges ? `geräte=${data.device_challenges.length}` : "", data.configuration_stages ? `einrichtung=${data.configuration_stages.map((s) => s.name).join("|")}` : "");
  return data;
}
let step = await flow();
step = await flow({ component: "ak-stage-identification", uid_field: name });
step = await flow({ component: "ak-stage-password", password: reset.invitation.password });
console.log("Nach dem Passwort:", step.component);
function totp(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const mac = createHmac("sha1", key).update(counter).digest();
  const offset = mac.at(-1) & 15;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1e6).padStart(6, "0");
}
if (step.component === "ak-stage-authenticator-totp") {
  const secret = new URL(step.config_url).searchParams.get("secret");
  step = await flow({ component: "ak-stage-authenticator-totp", code: totp(secret) });
  console.log("Nach dem Einrichten:", step.component, step.to ? "(weiter)" : "");
}
if (step.component === "ak-stage-authenticator-validate") console.log("Zweiter Faktor wird abgefragt – Konto hat bereits einen.");

