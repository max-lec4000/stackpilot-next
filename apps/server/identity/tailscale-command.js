import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);
// Only the category leaves a failed command; never pass stderr, URLs or auth links to the UI.
export async function tailscaleCommand(binary, args) {
  if (binary !== "tailscale") throw Error("Nur Tailscale-Befehle erlaubt.");
  try {
    const { stdout } = await execute(binary, args, {
      timeout: 15000,
      maxBuffer: 2 * 1024 * 1024,
      encoding: "utf8",
      env: { ...process.env, LC_ALL: "C" },
    });
    return { ok: true, output: stdout };
  } catch (e) {
    const text = `${e.stderr || ""} ${e.message || ""}`;
    return {
      ok: false,
      failureCode:
        /access denied|permission denied|not permitted|requires root|sudo tailscale|operator/i.test(
          text,
        )
          ? "permission"
          : e.code === "ENOENT"
            ? "missing"
            : e.killed
              ? "timeout"
              : "unknown",
    };
  }
}
