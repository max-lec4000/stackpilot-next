import { open } from "node:fs/promises";
import { backupLimit } from "../apps/server/identity/backup-format.js";
import { verifyVaultBackup } from "../apps/server/vault-backup.js";

try {
  const [, , archive, destination] = process.argv;
  if (!archive || !destination || process.stdin.isTTY)
    throw Error("Archiv und neuen Zielordner angeben. Sicherungspassphrase über stdin eingeben.");
  let passphrase = "";
  for await (const chunk of process.stdin.setEncoding("utf8")) {
    passphrase += chunk;
    if (Buffer.byteLength(passphrase) > 1025) throw Error("Passphrase zu lang.");
  }
  const input = await open(archive, "r");
  try {
    const stat = await input.stat();
    if (!stat.isFile() || stat.size > backupLimit) throw Error("Ungültige Sicherungsdatei.");
    const count = await verifyVaultBackup(await input.readFile(), passphrase.replace(/\n$/, ""), destination);
    console.log(`Wiederherstellung geprüft. ${count} Tresoreinträge im neuen Zielordner bestätigt.`);
  } finally {
    await input.close();
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
