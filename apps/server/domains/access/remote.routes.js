// System → Zugriff & Netzwerk: Tailnet, privates HTTPS, Schutz-Gateway, SSO/Authentik,
// Sicherungen, Administratoren, Geräte, Funnel und Streamyfin. Alles, was öffentlichen oder
// privaten Zugang verändert, verlangt das Administratorpasswort.
import { adminGrant } from "../../admin-tailnet.js";
import { fileResponse } from "../../routes.js";

export function remoteRoutes(d) {
  const {
    connectionCheck, journey, remoteAccess, privateServe, jellyfinProtection, publicFunnel,
    ssoConnection, identity, identityBackups, remoteSecurity, adminTailnet,
    developmentUploadStatus, uploadDevelopmentReport, state,
  } = d;
  const get = (path, handler) => ({ method: "GET", path, guard: "session", handler });
  const post = (path, guard, handler, confirm) => ({ method: "POST", path, guard, handler, ...(confirm ? { confirm } : {}) });
  return [
    get("/api/remote-access/connection", () => connectionCheck.inspect()),
    get("/api/remote-access/journey", () => journey.snapshot()),
    get("/api/remote-access", () => remoteAccess.inspect()),
    get("/api/remote-access/private-serve", () => privateServe.preview()),
    get("/api/remote-access/streamyfin", () => jellyfinProtection.streamyfinPreview()),
    get("/api/remote-access/funnel", () => publicFunnel.preview()),
    get("/api/remote-access/protection", () => jellyfinProtection.summary()),
    get("/api/remote-access/protection/preview", async () => ({
      ...(await jellyfinProtection.preview()),
      verified: (await jellyfinProtection.status()).verified,
    })),
    get("/api/remote-access/sso", () => ssoConnection.plan()),
    get("/api/remote-access/identity", () => identity.summary()),
    get("/api/remote-access/backups", () => ({ backups: identityBackups.list(), maintenance: identityBackups.maintenance() })),
    get("/api/remote-access/admins", () => remoteSecurity.admins()),
    get("/api/remote-access/devices", () => remoteSecurity.devices()),
    get("/api/admin-tailnet", ({ remoteAddress }) => adminTailnet.inspect(remoteAddress)),

    post("/api/remote-access/private-serve/apply", "password", async ({ body }) => {
      let result;
      try {
        result = await privateServe.apply(body);
      } catch (e) {
        try { await uploadDevelopmentReport(); } catch {}
        throw e;
      }
      if ((await developmentUploadStatus(state)).enabled) {
        try {
          result.developmentReport = await uploadDevelopmentReport();
        } catch {
          result.developmentReportWarning =
            "Einrichtung geprüft; Entwicklungsbericht konnte nicht auf GitHub übertragen werden. Lokale Git-Berechtigung prüfen oder Bericht herunterladen.";
        }
      }
      return result;
    }),
    post("/api/remote-access/streamyfin/activate", "password", () => jellyfinProtection.activateStreamyfin(), "Gateway-Änderung mit OK bestätigen."),
    post("/api/remote-access/streamyfin/rollback", "password", () => jellyfinProtection.rollbackStreamyfin(), "Gateway-Änderung mit OK bestätigen."),
    post("/api/remote-access/streamyfin/prepare", "password", async () => {
      const { ready, version, minimumVersion } = await jellyfinProtection.prepareStreamyfin();
      return { ready, version, minimumVersion };
    }, "Vorbereitung mit OK bestätigen."),
    post("/api/remote-access/protection/start", "password", ({ body }) => jellyfinProtection.start(body)),
    post("/api/remote-access/sso/apply", "password", ({ body }) => ssoConnection.apply(body)),
    post("/api/remote-access/backup/create", "password", ({ body }) => identityBackups.create(body)),
    post("/api/remote-access/backup/resume", "password", ({ body }) => identityBackups.resume(body)),
    post("/api/remote-access/backup/test", "password", ({ body }) => identityBackups.verifyRestore(body)),
    post("/api/remote-access/backup/download", "password", async ({ body }) =>
      fileResponse(await identityBackups.bytes(body.id), `stackpilot-identity-${body.id}.spbackup`)),
    post("/api/remote-access/admins/protect", "password", ({ body }) => remoteSecurity.protectAdmins(body)),
    // Gerät abmelden: mit OK (vorher Passwort). Trifft nur Nicht-Administratoren, die Person
    // kann sich jederzeit neu anmelden.
    post("/api/remote-access/devices/revoke", "ok", ({ body }) => remoteSecurity.revoke(body), "Gerät abmelden mit OK bestätigen."),
    post("/api/remote-access/funnel/enable", "password", ({ body }) => publicFunnel.apply(body)),
    post("/api/remote-access/funnel/disable", "password", ({ body }) => publicFunnel.disable(body)),
    post("/api/remote-access/funnel-plan", "session", () => remoteSecurity.funnelPlan()),
    post("/api/remote-access/identity/prepare", "session", () => identity.prepare()),
    post("/api/remote-access/identity/check", "session", () => identity.inspectSecurity()),
    post("/api/remote-access/identity/start", "session", ({ body }) => identity.start(body)),
    post("/api/remote-access/identity/credentials", "password", () => identity.credentials()),
    post("/api/admin-tailnet/grant", "session", async ({ body, remoteAddress }) => {
      const access = await adminTailnet.inspect(remoteAddress);
      if (!access.addresses.includes(body.target)) throw Error("Nur eine bestätigte eigene Tailnet-Adresse verwenden.");
      return { grant: adminGrant(body.sources, body.target) };
    }),
  ];
}
