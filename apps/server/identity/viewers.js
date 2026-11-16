// Zuschauer: Konten in Authentik anlegen, auflisten, zurücksetzen und entfernen.
// "Einladen" heißt: Name eintippen, StackPilot erzeugt das Konto mit einem zufälligen
// Startpasswort. Die Person öffnet den Link, meldet sich an und richtet dabei selbst ihren
// zweiten Faktor ein. Das Startpasswort wird genau einmal angezeigt und nirgends gespeichert.
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dockerInput } from "../docker-io.js";
import { setupError } from "./setup-error.js";
import { passkeyEnrollment } from "./viewer-passkey-enrollment.js";
import { viewerRecovery } from "./viewer-recovery.js";
import { viewerMfa, viewerPasskey } from "./viewer-mfa.js";
import { viewerPassword, viewerPasswordUpgrade } from "./viewer-password.js";

const wrapper = `import io,json,sys\nv=json.loads(sys.stdin.read())\nsys.stdin=io.StringIO(json.dumps(v["request"]))\nexec(v["program"])`;
export const viewerName = /^[a-z][a-z0-9_-]{2,31}$/;
const messages = {
  exists: "Diesen Benutzernamen gibt es in Authentik schon.",
  missing: "Diesen Zuschauer gibt es nicht.",
  invalid: "Benutzername: 3–32 Zeichen, Kleinbuchstaben, Ziffern, - und _, beginnend mit einem Buchstaben.",
  action: "Unbekannte Aktion.",
  recovery: "Die Authentik-Stufen weichen von der geprüften StackPilot-Anmeldung ab. Die Wiederherstellungsstufe wurde nicht geändert.",
  passkey: "Die Passkey-Einrichtung braucht ein aktives Zuschauerkonto mit bestätigtem zweiten Faktor und die aktualisierte Zuschauer-Anmeldung.",
  "library-pending": "Zuerst die offene Profilzuweisung für dieses Konto abschließen.",
  library: "Die verwaltete Zuschauer-Bibliotheksfreigabe konnte nicht bestätigt werden.",
  login: "Die Authentik-Stufen weichen von der geprüften StackPilot-Anmeldung ab. Prüfe zuerst die Zuschauer-Anmeldung.",
};

export class Viewers {
  constructor(identity, input = dockerInput) {
    this.identity = identity;
    this.input = input;
  }
  async call(request) {
    const record = await this.identity.verify();
    if (record.status !== "local-ready")
      throw setupError("Authentik ist noch nicht eingerichtet.");
    const rows = await this.identity.containers(record, true);
    const workers = rows.filter(
      (v) => v.Config.Labels["com.docker.compose.service"] === "worker" && v.State.Running,
    );
    if (workers.length !== 1) throw setupError("Authentik-Worker nicht eindeutig bereit.");
    const program = await readFile(new URL("./viewers.py", import.meta.url), "utf8");
    let out;
    try {
      out = await this.input(
        ["exec", "-i", workers[0].Id, "ak", "shell", "-c", wrapper],
        JSON.stringify({ program, request: { ...request, viewerRecovery, viewerMfa, viewerPasskey, viewerPassword, passkeyEnrollment,
          ...(request.action === "improve-login" ? { passwordUpgrade: viewerPasswordUpgrade() } : {}) } }),
        { timeout: 60000 },
      );
    } catch (e) {
      // SystemExit mit Ergebniszeile landet in der Fehlerausgabe.
      out = `${e.stdout || ""}\n${e.stderr || ""}\n${e.message || ""}`;
    }
    const line = out.split(/\n/).find((v) => v.includes("STACKPILOT_VIEWERS="));
    if (!line) throw setupError("Authentik hat die Zuschauerliste nicht bestätigt.");
    const result = JSON.parse(line.slice(line.indexOf("STACKPILOT_VIEWERS=") + 19));
    if (result.error) throw setupError(messages[result.error] || "Aktion fehlgeschlagen.");
    return { record, result };
  }
  project(result) {
    return (result.viewers || []).map((v) => ({
      username: String(v.username),
      name: String(v.name || v.username),
      active: v.active === true,
      mfa: v.mfa === true,
      hasPasskey: v.hasPasskey === true,
      passkeyPending: v.passkeyPending === true,
      profileId: typeof v.profileId === "string" ? v.profileId : null,
      lastLogin: typeof v.lastLogin === "string" ? v.lastLogin : null,
    }));
  }
  loginUrl(record) {
    return `https://${record.input.hostname}/sso/OID/start/stackpilot`;
  }
  async list() {
    const { record, result } = await this.call({ action: "list" });
    return this.viewerList(record, result);
  }
  viewerList(record, result) {
    return { loginUrl: this.loginUrl(record), viewers: this.project(result), recoveryEnabled: result.recoveryEnabled === true,
      loginImproved: result.loginImproved === true, passwordChoice: result.passwordChoice === true,
      addPasskeyReady: result.addPasskeyReady === true };
  }
  async updateLogin(action) {
    return this.identity.hub.mutate(["Jellyfin"], async () => {
      const { record, result } = await this.call({ action });
      return this.viewerList(record, result);
    });
  }
  normalize(name) {
    const username = String(name || "").trim().toLowerCase();
    if (!viewerName.test(username)) throw setupError(messages.invalid);
    return username;
  }
  async withPassword(action, name, displayName) {
    const username = this.normalize(name);
    const password = randomBytes(15).toString("base64url");
    const { record, result } = await this.call({
      action,
      username,
      password,
      displayName: typeof displayName === "string" ? displayName.trim().slice(0, 80) : "",
    });
    return {
      // Einmalige Anzeige: Link, Benutzername und Startpasswort für genau diese Person.
      invitation: { username, password, loginUrl: this.loginUrl(record) },
      ...this.viewerList(record, result),
    };
  }
  invite(name, displayName) {
    return this.withPassword("invite", name, displayName);
  }
  reset(name) {
    return this.withPassword("reset", name);
  }
  async passkey(action, name) {
    return this.identity.hub.mutate(["Jellyfin"], async () => {
      const { record, result } = await this.call({ action, username: this.normalize(name) });
      return this.viewerList(record, result);
    });
  }
  async remove(name) {
    const { record, result } = await this.call({ action: "remove", username: this.normalize(name) });
    return this.viewerList(record, result);
  }
}
