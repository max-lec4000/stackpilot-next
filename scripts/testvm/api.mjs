#!/usr/bin/env node
// Testhilfe für die Test-VM: ruft die StackPilot-API als der Test-Administrator auf
// (Zugang aus ~/.stackpilot-test/admin.json, siehe first-install.mjs).
//
//   node api.mjs /api/couchdeck
//   node api.mjs /api/couchdeck/action '{"action":"link"}'
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const base = "http://127.0.0.1:5173";
const [route, body] = process.argv.slice(2);
if (!route) {
  console.error("Aufruf: node api.mjs <route> [json]");
  process.exit(1);
}
const admin = JSON.parse(
  await readFile(path.join(os.homedir(), ".stackpilot-test/admin.json"), "utf8"),
);
const login = await fetch(base + "/api/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: base },
  body: JSON.stringify(admin),
});
if (!login.ok) throw Error("Anmeldung fehlgeschlagen: HTTP " + login.status);
const cookie = login.headers.get("set-cookie").split(";")[0];
const { token } = await (await fetch(base + "/api/session", { headers: { Cookie: cookie } })).json();
const response = await fetch(base + route, {
  method: body ? "POST" : "GET",
  headers: {
    Cookie: cookie,
    ...(body
      ? { "Content-Type": "application/json", Origin: base, "X-StackPilot-Token": token }
      : {}),
  },
  body,
});
console.log("HTTP", response.status);
console.log(JSON.stringify(await response.json().catch(() => null), null, 2));
