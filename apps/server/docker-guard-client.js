// Docker-Wächter aus Sicht von StackPilot (siehe apps/docker-guard/README.md):
// - meldet die Datenordner der eingerichteten Stacks (der Wächter prüft sie selbst),
// - liest den Zustand des Wächters für die Oberfläche,
// - kann ihn über die Root-Hilfe nur verschärfen (Sperren). Lockern geht nur mit sudo.
import http from "node:http";
import { writeFileSync, renameSync } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DOCKER_HOST } from "./docker-io.js";

const execute = promisify(execFile);
export const ROOTS_FILE = "docker-guard-roots.json";
const ENFORCE_UNIT = "stackpilot-root@docker-guard-enforce.service";

/** Datenordner aller Einrichtungsaufträge (Daten- und Konfigurationsordner). */
export function guardRoots(store) {
  const rows = store.db
    .prepare("SELECT p.data FROM plans p JOIN operations o ON o.plan_id = p.id WHERE json_extract(o.data,'$.kind')='deployment' AND json_extract(o.data,'$.status')!='cancelled'")
    .all();
  const roots = new Set();
  for (const { data } of rows) {
    const plan = JSON.parse(data);
    const base = typeof plan.spec?.path === "string" ? plan.spec.path.replace(/\/+$/, "") : "";
    if (!base.startsWith("/")) continue;
    roots.add(base);
    roots.add(typeof plan.appdata === "string" ? plan.appdata.replace(/\/+$/, "") : base + "-appdata");
  }
  return [...roots].sort();
}

/** Meldung für den Wächter schreiben (nur wenn StackPilot über ihn läuft). */
export function writeGuardRoots(store) {
  if (!process.env.STACKPILOT_DOCKER_HOST) return null;
  const roots = guardRoots(store);
  const file = path.join(store.directory, ROOTS_FILE);
  writeFileSync(file + ".tmp", JSON.stringify({ roots, updatedAt: new Date().toISOString() }) + "\n", { mode: 0o600 });
  renameSync(file + ".tmp", file);
  return roots;
}

function askGuard(socketPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ socketPath, path: "/_stackpilot/guard", timeout: 3000 }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { text += c; if (text.length > 200000) req.destroy(); });
      res.on("end", () => { try { resolve(JSON.parse(text)); } catch (e) { reject(e); } });
    });
    req.on("timeout", () => req.destroy(Error("Zeitüberschreitung")));
    req.on("error", reject);
  });
}

export class DockerGuardStatus {
  constructor(store, options = {}) {
    this.store = store;
    this.socket = options.socket ?? (process.env.STACKPILOT_DOCKER_HOST ? DOCKER_HOST.slice("unix://".length) : null);
    this.ask = options.ask || askGuard;
    this.run = options.run || (async (bin, args) => (await execute(bin, args, { timeout: 15000, encoding: "utf8" })).stdout);
  }
  async status() {
    if (!this.socket) return { mode: "off" };
    let guard;
    try {
      guard = await this.ask(this.socket);
    } catch {
      return { mode: "unreachable" };
    }
    if (!guard?.guard) return { mode: "unreachable" };
    const s = (v, n = 300) => String(v ?? "").slice(0, n);
    return {
      mode: guard.mode === "enforce" ? "enforce" : "observe",
      since: s(guard.since, 40),
      allowed: Number(guard.allowed) || 0,
      denied: Number(guard.denied) || 0,
      recent: (Array.isArray(guard.recent) ? guard.recent : []).slice(0, 30).map((r) => ({
        at: s(r.at, 40), method: s(r.method, 10), path: s(r.path, 200),
        reasons: (Array.isArray(r.reasons) ? r.reasons : []).slice(0, 10).map((x) => s(x, 200)), blocked: r.blocked === true,
      })),
      roots: (Array.isArray(guard.roots) ? guard.roots : []).slice(0, 60).map((x) => s(x)),
      rejectedRoots: (Array.isArray(guard.rejectedRoots) ? guard.rejectedRoots : []).slice(0, 60)
        .map((r) => ({ path: s(r.path), problem: s(r.problem, 80) })),
    };
  }
  /** Nur verschärfen: Root-Hilfe stellt auf Sperren um und startet StackPilot neu. */
  async enforce() {
    const current = await this.status();
    if (current.mode !== "observe") throw Object.assign(Error("Der Wächter läuft nicht im Beobachtungsmodus."), { userFacing: true });
    if (this.store.activeLease()) throw Object.assign(Error("Ein Serverauftrag läuft. Vor dem Umstellen dessen Abschluss abwarten."), { userFacing: true });
    try {
      await this.run("systemctl", ["reset-failed", ENFORCE_UNIT]).catch(() => {});
      await this.run("systemctl", ["start", "--no-block", ENFORCE_UNIT]);
    } catch {
      throw Object.assign(Error("Das Umstellen wurde nicht angenommen. StackPilot zuerst aktualisieren."), { userFacing: true });
    }
    return { started: true };
  }
}
