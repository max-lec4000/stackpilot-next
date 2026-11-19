// App-Adapter für Authentik: führt ein festes StackPilot-Python-Programm im verwalteten
// Authentik-Worker aus (`ak shell`). Programm und Anfrage gehen als Daten über stdin, die
// Antwort ist eine Zeile mit festem Kennwort und JSON.
import { readFile } from "node:fs/promises";
import { setupError } from "../identity/setup-error.js";

// ak's Shell-Programm ist fest; Anfrage und Quelltext kommen als Daten über stdin.
const wrapper = `import io,json,sys\nv=json.loads(sys.stdin.read())\nsys.stdin=io.StringIO(json.dumps(v["request"]))\nexec(v["program"])`;

/**
 * @param identity   IdentityPreparation (liefert die Container des Datensatzes)
 * @param record     bestätigter Identitäts-Datensatz
 * @param input      dockerInput
 * @param script     URL des Python-Programms
 * @param marker     Kennwort der Ergebniszeile, z. B. "STACKPILOT_VIEWERS="
 * @param tolerateExit  true: Programm beendet sich mit SystemExit, Ergebnis steht in der Fehlerausgabe
 */
export async function runAuthentikScript({ identity, record, input, script, request, marker, notReady, unconfirmed, tolerateExit = false, timeout = 60000 }) {
  const rows = await identity.containers(record, true);
  const workers = rows.filter((v) => v.Config.Labels["com.docker.compose.service"] === "worker" && v.State.Running);
  if (workers.length !== 1) throw setupError(notReady);
  const program = await readFile(script, "utf8");
  let out;
  try {
    out = await input(["exec", "-i", workers[0].Id, "ak", "shell", "-c", wrapper], JSON.stringify({ program, request }), { timeout });
  } catch (e) {
    if (!tolerateExit) throw e;
    out = `${e.stdout || ""}\n${e.stderr || ""}\n${e.message || ""}`;
  }
  const lines = out.split(/\n/).filter((v) => (tolerateExit ? v.includes(marker) : v.startsWith(marker)));
  if (tolerateExit ? !lines.length : lines.length !== 1) throw setupError(unconfirmed);
  return JSON.parse(lines[0].slice(lines[0].indexOf(marker) + marker.length));
}
