import { readFile } from "node:fs/promises";
import { dockerInput } from "../docker-io.js";
import { validateIdentityInput } from "./config.js";
import { parseIdentityStatus } from "./security-status.js";
import { setupError } from "./setup-error.js";
export class IdentitySettings {
  constructor(identity, input = dockerInput) {
    this.identity = identity;
    this.input = input;
  }
  async security() {
    const r = await this.identity.verify();
    const rows = await this.identity.containers(r, true);
    const workers = rows.filter(
      (v) =>
        v.Config.Labels["com.docker.compose.service"] === "worker" &&
        v.State.Running,
    );
    if (workers.length !== 1)
      throw setupError("Authentik-Worker nicht eindeutig bereit.");
    const output = await this.input(
      [
        "exec",
        "-i",
        workers[0].Id,
        "ak",
        "shell",
        "-c",
        "exec(__import__('sys').stdin.read())",
      ],
      await readFile(new URL("./security-status.py", import.meta.url), "utf8"),
      { timeout: 60000 },
    );
    return parseIdentityStatus(output);
  }
  async inspect(apply = false) {
    const r = await this.identity.verify();
    const hostname = validateIdentityInput(r.input).hostname;
    const rows = await this.identity.containers(r, true);
    const workers = rows.filter(
      (v) =>
        v.Config.Labels["com.docker.compose.service"] === "worker" &&
        v.State.Running,
    );
    if (workers.length !== 1)
      throw setupError("Verwalteter Authentik-Worker nicht eindeutig bereit.");
    const program = await readFile(
      new URL("./settings.py", import.meta.url),
      "utf8",
    );
    // ak's shell program is fixed; request and source are encoded as data over stdin.
    const wrapper = `import io,json,sys\nv=json.loads(sys.stdin.read())\nsys.stdin=io.StringIO(json.dumps(v["request"]))\nexec(v["program"])`;
    const out = await this.input(
      ["exec", "-i", workers[0].Id, "ak", "shell", "-c", wrapper],
      JSON.stringify({
        program,
        request: { expected: `https://${hostname}:8443`, apply },
      }),
      { timeout: 60000 },
    );
    const lines = out
      .split(/\n/)
      .filter((v) => v.startsWith("STACKPILOT_SETTINGS="));
    if (lines.length !== 1)
      throw setupError(
        "Authentik-Systemeinstellungen nicht eindeutig bestätigt.",
      );
    const v = JSON.parse(lines[0].slice("STACKPILOT_SETTINGS=".length));
    if (
      typeof v.supported !== "boolean" ||
      typeof v.changed !== "boolean" ||
      !["unsupported", "expected", "missing", "different"].includes(
        v.baseUrl,
      ) ||
      !["initials", "other", "unknown"].includes(v.avatars)
    )
      throw setupError("Authentik-Systemeinstellungen unvollständig.");
    return {
      supported: v.supported,
      baseUrl: v.baseUrl,
      avatars: v.avatars,
      changed: v.changed,
    };
  }
}
