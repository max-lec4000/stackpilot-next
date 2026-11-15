#!/usr/bin/env node
// Testhilfe für die Test-VM: erzeugt für den bestehenden Stack einen neuen Plan mit
// derselben Auswahl (z. B. für eine Umstellung wie die Netztrennung), bestätigt ihn und
// wartet auf das Ende. Gibt Blocker, Warnungen und den Verlauf aus.
//   node replan.mjs
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const base = "http://127.0.0.1:5173";
const admin = JSON.parse(await readFile(path.join(os.homedir(), ".stackpilot-test/admin.json"), "utf8"));
const login = await fetch(base + "/api/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: base },
  body: JSON.stringify(admin),
});
const cookie = login.headers.get("set-cookie").split(";")[0];
const { token } = await (await fetch(base + "/api/session", { headers: { Cookie: cookie } })).json();
async function call(route, body) {
  const r = await fetch(base + route, {
    method: body ? "POST" : "GET",
    headers: { Cookie: cookie, ...(body ? { "Content-Type": "application/json", Origin: base, "X-StackPilot-Token": token } : {}) },
    body: body && JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw Error(route + ": " + (data.error || r.status));
  return data;
}
const stack = await call("/api/stack");
const plan = await call("/api/deployment/plan", { ...stack.spec, vpnProfileId: stack.vpnProfileId });
console.log(`Plan ${plan.id.slice(0, 8)}: ausführbar=${plan.executable} netzUmstellung=${plan.networkUpgrade}`);
for (const b of plan.blockers) console.log("  Blocker:", b);
for (const w of plan.warnings.filter((w) => w.includes("Netze"))) console.log("  Hinweis:", w);
if (!plan.executable) process.exit(2);
const op = await call("/api/deployment/confirm", { planId: plan.id, confirmation: "OK" });
let last = "";
for (;;) {
  await new Promise((r) => setTimeout(r, 4000));
  const o = (await call("/api/operations")).operations.find((x) => x.id === op.id);
  const cur = o.steps.find((s) => s.status !== "completed");
  const line = `${o.steps.filter((s) => s.status === "completed").length}/${o.steps.length} ${cur?.label || "fertig"} [${o.status}]`;
  if (line !== last) console.log(line);
  last = line;
  if (o.status === "completed") break;
  if (["failed", "paused"].includes(o.status)) {
    console.log("Fehler:", o.error);
    process.exit(3);
  }
}
