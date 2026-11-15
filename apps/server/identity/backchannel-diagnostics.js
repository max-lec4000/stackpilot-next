import { certificateFailure } from "./certificate-issuer.js";
export const repairStages = [
  "idle",
  "context",
  "files",
  "alias",
  "certificate",
  "certificate-validation",
  "configuration",
  "image",
  "container",
  "verification",
  "ready",
];
const messages = {
  context:
    "Verwalteter Stack und Identitätsdienst passen nicht eindeutig zusammen. Ausgangslage erneut prüfen.",
  files:
    "Private Dateien oder Rechte konnten nicht bestätigt werden. Manuelle Änderungen werden nicht überschrieben.",
  alias:
    "Die interne Anbieteradresse ist bereits belegt oder das verwaltete Netz nicht eindeutig bestätigt.",
  "certificate-validation":
    "Zertifikat, Schlüsselpaar, Hostname oder ausreichende Restgültigkeit sind nicht bestätigt.",
  configuration:
    "Verwaltete Konfigurationsdateien konnten nicht sicher geschrieben oder fortgesetzt werden.",
  image:
    "Das festgelegte Container-Image konnte nicht geladen werden. Docker-Zugriff und Registry-Verbindung prüfen.",
  container:
    "Der interne HTTPS-Dienst konnte nicht sicher gestartet werden. Vorhandene Rechte und Zuordnungen werden nicht gelockert.",
  verification:
    "Der interne HTTPS-Dienst ist noch nicht vollständig bestätigt.",
  "service-stopped":
    "Der interne HTTPS-Dienst ist gestoppt oder fehlt. Eine ausdrücklich bestätigte Reparatur kann ihn aus den geprüften eigenen Dateien wieder starten.",
};
export function safeRepairFailure(value) {
  if (!value) return null;
  const code = typeof value.code === "string" ? value.code : "unknown";
  const stage = repairStages.includes(value.stage) ? value.stage : "context";
  const cert = stage === "certificate" ? certificateFailure(code) : null;
  return {
    code:
      cert?.certificateFailureCode ||
      (Object.hasOwn(messages, code) ? code : "unknown"),
    stage,
    at:
      typeof value.at === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value.at) &&
      Number.isFinite(Date.parse(value.at))
        ? value.at
        : null,
    message:
      cert?.message ||
      messages[code] ||
      "Reparaturschritt nicht eindeutig bestätigt. Zustand erneut prüfen; keine automatische Sicherheitslockerung.",
    retryable: !["context", "files", "alias", "configuration"].includes(code),
  };
}
export function certificatePermissionPlan(uid) {
  if (!Number.isSafeInteger(uid) || uid < 1) return null;
  return {
    uid,
    method: "tailscale-certificate-only",
    editCommand: "sudo systemctl edit tailscaled",
    content: `[Service]\nEnvironment=TS_PERMIT_CERT_UID=${uid}\n`,
    restartCommand: "sudo systemctl restart tailscaled",
    message:
      "Einmalige lokale Administratorfreigabe ausschließlich für die Zertifikatsanforderung dieses Nutzers. Bestehende Einstellungen beibehalten. Ein anderer bereits gesetzter TS_PERMIT_CERT_UID muss zuerst geprüft werden. Der Neustart unterbricht Tailscale kurz; in einer lokalen oder LAN-Sitzung durchführen.",
  };
}
