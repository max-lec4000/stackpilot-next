import { execFileSync } from "node:child_process";
import path from "node:path";
import { replaceVaultState } from "../apps/server/vault-restore.js";

const state = "/var/lib/stackpilot";
try {
  const [mode, source, ...rest] = process.argv.slice(2);
  const relative = source && path.relative(state, path.resolve(source));
  const expected = mode === "apply"
    ? /^tresor-wiederherstellung-[a-zA-Z0-9]{6}\/wiederhergestellt$/
    : /^tresor-vor-uebernahme-[a-zA-Z0-9]{6}$/;
  if (!["apply", "undo"].includes(mode) || !source || rest.length || !expected.test(relative))
    throw Error("Den vollständigen Ordnerpfad aus StackPilot oder aus dem vorherigen Rückweg angeben.");
  if (process.getuid() === 0 ||
      execFileSync("systemctl", ["show", "-p", "ActiveState", "--value", "stackpilot.service"], { encoding:"utf8" }).trim() !== "inactive")
    throw Error("StackPilot muss gestoppt sein. Die Übernahme läuft als Dienstbenutzer.");
  const { rollback } = await replaceVaultState(state, path.join(state, relative), mode === "undo");
  console.log(rollback);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
