#!/usr/bin/env node
// Notfall: Gesamtsicherung (.spstack) in einen NEUEN, leeren Ordner entpacken – auch ohne
// laufendes StackPilot. Überschreibt nie etwas. Das Sicherungspasswort wird abgefragt.
//
//   /opt/stackpilot/node/bin/node /opt/stackpilot/app/deploy/stack-restore.mjs <archiv.spstack> <neuer-zielordner>
//
// Danach liegen im Zielordner: state/ (StackPilot-Zustand inkl. Tresor-Schlüssel und
// stackpilot-datenbank-exporte/streamystats.sql) und appdata/ (Einstellungen und Datenbanken
// der Apps). Wie daraus ein Stack wird: docs/ablaeufe.md → „Gesamtsicherung wiederherstellen“.
import { restoreStackArchive } from "../apps/server/stack-archive.js";
import readline from "node:readline";

const [archive, destination] = process.argv.slice(2);
if (!archive || !destination) {
  console.error("Aufruf: stack-restore.mjs <archiv.spstack> <neuer-zielordner>");
  process.exit(64);
}
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
if (process.stdin.isTTY) rl._writeToOutput = (s) => { if (!s.startsWith("Sicherungspasswort")) rl.output.write("*"); else rl.output.write(s); };
const passphrase = await new Promise((resolve) => rl.question("Sicherungspasswort: ", (v) => { rl.close(); resolve(v.trim()); }));
if (process.stdin.isTTY) process.stdout.write("\n");
try {
  const r = await restoreStackArchive({ archive, destination, passphrase });
  console.log(`Entpackt und geprüft: ${r.entries} Einträge, ${Math.round(r.totalBytes / 1e6)} MB nach ${destination}`);
  console.log(`Gesichert am ${r.manifest.createdAt}; übersprungen: ${r.manifest.skippedCount || 0}; Datenbank-Exporte: ${(r.manifest.stackpilot?.databaseExports || []).join(", ") || "keine"}`);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
