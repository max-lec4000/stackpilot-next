#!/usr/bin/env node
// Testlauf in der Test-VM: fährt eine komplette Erstinstallation über die HTTP-API,
// so wie es die Oberfläche tut. Nur für Wegwerf-Maschinen gedacht.
//
//   node first-install.mjs <mullvad.conf> [datenpfad]
//
// Die Test-Zugangsdaten des Administrators entstehen zufällig und liegen danach nur in
// ~/.stackpilot-test/admin.json (Rechte 600).
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";

const base = "http://127.0.0.1:5173";
const [vpnFile, dataPath = path.join(os.homedir(), "stackpilot-data")] = process.argv.slice(2);
if (!vpnFile) {
  console.error("Aufruf: node first-install.mjs <mullvad.conf> [datenpfad]");
  process.exit(1);
}
const dir = path.join(os.homedir(), ".stackpilot-test");
await mkdir(dir, { recursive: true, mode: 0o700 });
const adminFile = path.join(dir, "admin.json");
let admin;
try {
  admin = JSON.parse(await readFile(adminFile, "utf8"));
} catch {
  admin = { username: "admin", password: randomBytes(18).toString("base64url") };
  await writeFile(adminFile, JSON.stringify(admin), { mode: 0o600 });
}

let cookie = "";
let token = "";
async function call(route, body) {
  const response = await fetch(base + route, {
    method: body ? "POST" : "GET",
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body
        ? { "Content-Type": "application/json", Origin: base, "X-StackPilot-Token": token }
        : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = response.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) throw Error(`${route}: HTTP ${response.status} ${data?.error || text}`);
  return data;
}

const status = await call("/api/auth/status");
if (!status.configured) {
  const code = (
    await readFile(
      path.join(process.env.STACKPILOT_STATE_DIR || "/var/lib/stackpilot", "bootstrap-token"),
      "utf8",
    )
  ).trim();
  await call("/api/auth/setup", { ...admin, code });
  console.log("Administrator angelegt.");
} else {
  await call("/api/auth/login", admin);
  console.log("Angemeldet.");
}
token = (await call("/api/session")).token;

const stack = await call("/api/stack");
let operationId = stack
  ? (await call("/api/operations")).operations.find((o) => o.planId === stack.planId)?.id
  : null;
if (!operationId) {
  const vpn = await call("/api/vpn/import", { config: await readFile(vpnFile, "utf8") });
  const vpnProfileId = vpn.id || vpn.profileId;
  console.log("VPN-Profil importiert.");
  const plan = await call("/api/deployment/plan", {
    selected: [
      "Jellyfin", "Streamystats", "Sonarr", "Radarr", "Lidarr",
      "Prowlarr", "Bazarr", "Seerr", "qBittorrent",
    ],
    path: dataPath,
    username: "admin",
    language: "Deutsch",
    quality: "1080p · ausgewogen",
    vpn: true,
    vpnProfileId,
    couchdeck: process.env.COUCHDECK !== "0",
    couchdeckYoutube: false,
    adopt: process.env.ADOPT === "1",
    remote: process.env.REMOTE === "1",
    viewer: process.env.VIEWER || "",
  });
  console.log(`Plan ${plan.id}: bind=${plan.bind} ausführbar=${plan.executable}`);
  for (const blocker of plan.blockers || []) console.log("  Blocker:", blocker);
  if (plan.adoptedData) console.log("  Übernimmt vorhandenen Medienordner, frühere Marke:", plan.adoptedFrom);
  if (!plan.executable) process.exit(2);
  const op = await call("/api/deployment/confirm", { planId: plan.id, confirmation: "OK" });
  operationId = op.id;
  console.log("Auftrag gestartet:", operationId);
} else {
  console.log("Vorhandener Auftrag:", operationId, stack.status);
  if (["failed", "paused"].includes(stack.status)) {
    await call("/api/deployment/resume", { operationId });
    console.log("Fortgesetzt.");
  }
}

let last = "";
for (;;) {
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const list = await call("/api/operations");
  const op = (list.operations || list).find((o) => o.id === operationId);
  if (!op) continue;
  const current = op.steps.find((s) => s.status !== "completed");
  const line = `${op.steps.filter((s) => s.status === "completed").length}/${op.steps.length} ${current?.label || "fertig"} [${op.status}]`;
  if (line !== last) console.log(line);
  last = line;
  if (op.status === "completed") {
    for (const check of op.checks || []) console.log("  geprüft:", check.service || JSON.stringify(check).slice(0, 80));
    break;
  }
  if (["failed", "paused", "cancelled"].includes(op.status)) {
    console.log("Fehler:", op.error);
    process.exit(3);
  }
}
