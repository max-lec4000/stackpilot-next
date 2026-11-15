import path from "node:path";
import { lstat, realpath } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { validateIdentityInput } from "./config.js";
import { setupError } from "./setup-error.js";
const defaultExecute = promisify(execFile);
const messages = {
  permission:
    "Tailscale verweigert diesem lokalen Benutzer den Zertifikatsabruf. Eine gezielte lokale Freigabe für Zertifikate ist erforderlich; StackPilot führt kein sudo aus.",
  "file-permission":
    "Das private Zertifikatsverzeichnis oder die Ausgabedateien sind nicht sicher beschreibbar. Dateirechte, vorhandene Dateien und symbolische Links prüfen.",
  unsupported:
    "Die installierte Tailscale-Version unterstützt den benötigten Zertifikatsaufruf nicht. Tailscale-Version und Zertifikatsfunktion prüfen.",
  missing:
    "Das Tailscale-Programm wurde für den StackPilot-Prozess nicht gefunden. Installation und Dienstpfad prüfen.",
  "not-running":
    "Der lokale Tailscale-Dienst ist nicht erreichbar. Dienst und lokalen Socket prüfen.",
  "not-logged-in":
    "Tailscale benötigt eine Anmeldung oder erneute Gerätefreigabe. Den lokalen Tailscale-Status prüfen.",
  "https-disabled":
    "HTTPS-Zertifikate oder die angefragte Geräteadresse sind in Tailscale nicht freigegeben. HTTPS-Unterstützung und Geräteadresse im Tailnet prüfen.",
  "rate-limit":
    "Der Zertifikatsanbieter begrenzt momentan die Anforderungen. Später erneut versuchen; wiederholte Anfragen vermeiden.",
  timeout:
    "Die Zertifikatsanforderung hat das Zeitlimit überschritten. Tailscale- und Anbieter-Erreichbarkeit prüfen.",
  network:
    "Tailscale konnte den Zertifikatsdienst nicht sicher erreichen. Netzwerk, Namensauflösung und TLS-Vertrauen prüfen; die Zertifikatsprüfung bleibt eingeschaltet.",
  unknown:
    "Die Zertifikatsanforderung ist fehlgeschlagen. Die Ursache ist noch nicht eindeutig bestätigt; keine Berechtigung oder Sicherheitsregel wurde automatisch geändert.",
};
export function certificateFailure(code) {
  const safe = Object.hasOwn(messages, code) ? code : "unknown";
  return Object.assign(setupError(messages[safe]), {
    certificateFailureCode: safe,
    stage: "certificate",
  });
}
function failureText(error) {
  // Interpret locally only: messages and process output may contain paths or secrets.
  return `${error?.stderr || ""}\n${error?.stdout || ""}\n${error?.message || ""}`;
}
export function minValidityUnsupported(error) {
  return /(?:flag provided but not defined|unknown flag|unknown shorthand flag|unrecognized option|unsupported flag)\s*:?\s*['"]?--?min-validity(?=['"\s=:]|$)/i.test(
    failureText(error),
  );
}
export function classifyCertificateFailure(error) {
  if (error?.code === "ENOENT") return "missing";
  if (error?.killed || error?.code === "ETIMEDOUT" || error?.code === "ETIME")
    return "timeout";
  const text = failureText(error);
  if (
    minValidityUnsupported(error) ||
    /flag provided but not defined|unknown flag|unrecognized option|unknown command|is not a command/i.test(
      text,
    )
  )
    return "unsupported";
  if (
    /\b(?:open|write|mkdir|rename|chmod)[^\r\n]{0,300}(?:permission denied|operation not permitted|read-only file system)|read-only file system|\bE(?:ROFS|NOSPC)\b|no space left on device/i.test(
      text,
    )
  )
    return "file-permission";
  if (
    error?.code === "EACCES" ||
    /cert access denied|access denied|permission denied|requires? root|must be root|operator user|sudo tailscale/i.test(
      text,
    )
  )
    return "permission";
  if (
    /not logged in|needslogin|login required|not authenticated|authentication required/i.test(
      text,
    )
  )
    return "not-logged-in";
  if (
    /failed to connect to local tailscaled|tailscale(?:d)? is not running|unable to connect[^\r\n]*tailscaled|could not connect[^\r\n]*tailscaled|no such file or directory[^\r\n]*tailscaled\.sock/i.test(
      text,
    )
  )
    return "not-running";
  if (
    /https[^\r\n]*(?:not enabled|disabled|not configured)|(?:no|empty) cert(?:ificate)? domains|does not support[^\r\n]*https|not a valid cert domain|invalid domain/i.test(
      text,
    )
  )
    return "https-disabled";
  if (/rate.?limit|too many requests|\b429\b/i.test(text)) return "rate-limit";
  if (/deadline exceeded|timed out|timeout/i.test(text)) return "timeout";
  if (
    /no such host|EAI_AGAIN|ENETUNREACH|network is unreachable|connection refused|connection reset|failed to connect|certificate signed by unknown authority|x509:|TLS handshake/i.test(
      text,
    )
  )
    return "network";
  return "unknown";
}
async function validateOutputDirectory(directory) {
  try {
    if (
      typeof directory !== "string" ||
      !path.isAbsolute(directory) ||
      path.resolve(directory) !== directory ||
      (await realpath(directory)) !== directory
    )
      throw Error();
    const stat = await lstat(directory);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      stat.uid !== process.getuid() ||
      stat.mode & 0o077
    )
      throw Error();
    for (const filename of ["cert.pem", "key.pem"]) {
      try {
        await lstat(path.join(directory, filename));
        throw Error("exists");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  } catch {
    throw certificateFailure("file-permission");
  }
}
// Callers must validate the returned certificate/key and their remaining lifetime.
// Only an exact unsupported --min-validity flag gets one legacy retry. No TLS or permission fallback.
export async function issueCertificate(
  hostname,
  directory,
  { execute = defaultExecute } = {},
) {
  try {
    validateIdentityInput({ hostname, uid: 1, gid: 1 });
  } catch {
    throw certificateFailure("unknown");
  }
  await validateOutputDirectory(directory);
  const common = [
    "cert",
    `--cert-file=${path.join(directory, "cert.pem")}`,
    `--key-file=${path.join(directory, "key.pem")}`,
    hostname,
  ];
  const options = {
    timeout: 60000,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, LC_ALL: "C" },
  };
  try {
    await execute(
      "tailscale",
      [common[0], "--min-validity=336h", ...common.slice(1)],
      options,
    );
    return { legacyClient: false };
  } catch (error) {
    if (!minValidityUnsupported(error))
      throw certificateFailure(classifyCertificateFailure(error));
  }
  await validateOutputDirectory(directory);
  try {
    await execute("tailscale", common, options);
    return { legacyClient: true };
  } catch (error) {
    throw certificateFailure(classifyCertificateFailure(error));
  }
}
