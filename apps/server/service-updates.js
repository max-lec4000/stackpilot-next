// StackPilot selbst aktualisieren: neue Version auf GitHub erkennen und über die begrenzte
// Root-Hilfe installieren (deploy/root-helper.sh → stackpilot-update). Die Hilfe holt den
// Quellstand frisch von GitHub, prüft das Zustandsformat und führt install.sh aus; dabei
// startet StackPilot neu. Mediencontainer werden nicht angefasst.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const execute = promisify(execFile);
const checksum = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const updateRoot = fileURLToPath(new URL("../..", import.meta.url));
const statusFile = "/var/lib/stackpilot-update/status.json";
const sha = (value) => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);

async function readEnv(file) {
  try {
    return Object.fromEntries(
      (await readFile(file, "utf8"))
        .split("\n")
        .map((line) => line.match(/^([A-Z_]+)=(.*)$/))
        .filter(Boolean)
        .map((m) => [m[1], m[2]]),
    );
  } catch {
    return {};
  }
}

export class ServiceUpdates {
  constructor(state, options = {}) {
    this.state = state;
    this.directory = options.directory || updateRoot;
    this.envFile = options.envFile || "/etc/stackpilot/install.env";
    this.statusFile = options.statusFile || statusFile;
    this.run =
      options.run ||
      (async (binary, args) =>
        (await execute(binary, args, { timeout: 30000, maxBuffer: 1024 * 1024, encoding: "utf8" })).stdout);
  }
  async installed() {
    let version = null,
      commit = null;
    try {
      version = JSON.parse(await readFile(path.join(this.directory, "package.json"), "utf8")).version;
    } catch {}
    try {
      commit = (await readFile(path.join(this.directory, ".stackpilot-commit"), "utf8")).trim();
    } catch {}
    return { version, commit: sha(commit) ? commit : null };
  }
  async preview() {
    const env = await readEnv(this.envFile);
    const repo = env.STACKPILOT_REPO,
      branch = env.STACKPILOT_BRANCH || "main";
    const { version, commit } = await this.installed();
    const blockers = [];
    let target = null;
    if (!repo) blockers.push("Keine Update-Quelle hinterlegt. StackPilot einmal mit dem aktuellen install.sh einrichten.");
    else
      try {
        const out = await this.run("git", ["ls-remote", repo, "refs/heads/" + branch]);
        target = out.split(/\s+/)[0];
        if (!sha(target)) throw Error();
      } catch {
        blockers.push(
          "GitHub ist nicht erreichbar oder das Repository ist privat. Für private Repositories braucht der Server eine Zugangsberechtigung.",
        );
      }
    if (this.state.activeLease()) blockers.push("Ein Serverauftrag läuft. Vor dem Update dessen Abschluss abwarten.");
    let running = false;
    try {
      const out = await this.run("systemctl", ["show", "stackpilot-root@stackpilot-update.service", "-p", "ActiveState", "--value"]);
      running = ["activating", "active"].includes(out.trim());
    } catch {}
    if (running) blockers.push("Ein Update läuft bereits.");
    const current = !!target && target === commit;
    return {
      ready: blockers.length === 0 && !current,
      current,
      currentVersion: version + (commit ? " · " + commit.slice(0, 7) : ""),
      nextVersion: target ? target.slice(0, 7) : null,
      from: commit,
      target,
      blockers,
      review: checksum([commit, target, blockers]),
    };
  }
  async start(body) {
    if (body.confirmation !== "OK") throw Error("Update mit OK bestätigen.");
    const preview = await this.preview();
    if (!preview.ready || body.review !== preview.review)
      throw Error("Updatevorschau ist nicht mehr gültig. Zustand erneut prüfen.");
    try {
      await this.run("systemctl", ["reset-failed", "stackpilot-root@stackpilot-update.service"]).catch(() => {});
      await this.run("systemctl", ["start", "--no-block", "stackpilot-root@stackpilot-update.service"]);
    } catch {
      throw Error("Das Update wurde nicht angenommen. StackPilot einmal mit dem aktuellen install.sh einrichten.");
    }
    return { id: "stackpilot-update", state: "running", phase: "Neue Version wird geladen", target: preview.target };
  }
  /** Zustand des laufenden oder letzten Updates (schreibt die Root-Hilfe). */
  async job() {
    try {
      const value = JSON.parse(await readFile(this.statusFile, "utf8"));
      return {
        id: "stackpilot-update",
        state: String(value.state || "unknown"),
        phase: String(value.phase || ""),
        message: value.message ? String(value.message).slice(0, 400) : undefined,
        target: value.target ? String(value.target).slice(0, 40) : undefined,
      };
    } catch {
      return { id: "stackpilot-update", state: "running", phase: "Update wird vorbereitet" };
    }
  }
}
