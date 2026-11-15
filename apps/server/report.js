import { open, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { inventory } from "./inventory.js";
export function makeReport(value) {
  return {
    schemaVersion: 1,
    kind: "stackpilot-server-report",
    createdAt: new Date().toISOString(),
    privacy: {
      contains: [
        "Gerätename",
        "lokale IP-Adressen und Ports",
        "Dateisystempfade",
        "Hardwaremodelle",
        "Container- und Dienstnamen",
      ],
      excluded: [
        "Passwörter",
        "API-Schlüssel",
        "Umgebungsvariablen",
        "Konfigurationsdatei-Inhalte",
        "MAC-Adressen",
        "Datenträger-Seriennummern",
      ],
      sharing:
        "Vor dem Teilen ansehen. Kein automatischer Upload nach GitHub oder zu anderen Diensten.",
    },
    inventory: value,
  };
}
export async function collectReport() {
  return makeReport(await inventory());
}
export async function writeReport(filename, report) {
  const destination = path.resolve(filename);
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  const parent = await realpath(path.dirname(destination));
  const resolved = path.join(parent, path.basename(destination));
  const handle = await open(resolved, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(report, null, 2) + "\n");
  } finally {
    await handle.close();
  }
  return resolved;
}
