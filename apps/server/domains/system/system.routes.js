// System: Katalog und Stack-Zustand, Server-Inventar und Bericht, Speicherpfade, Aufträge,
// Änderungsverlauf, Aktivität, Hinweise, verwaltete Apps, Zugangsschlüssel erneuern/anzeigen,
// Tresor-Sicherung und Entwicklungsbericht.
import { readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { needsNetworkUpgrade } from "../../installer.js";
import { catalog } from "../../catalog.js";
import { managedServices, revealCredentials, checkManaged } from "../../managed.js";
import { rotateArrKey } from "../../arr-key.js";
import { rotateSeerrKey } from "../../seerr-key.js";
import { rotateCouchdeckToken, rotateSeerrJellyfinToken, rotateStreamystatsJellyfinToken } from "../../jellyfin-service-tokens.js";
import { rotateBazarrKey } from "../../bazarr-key.js";
import { createVaultBackup, stageVaultRestore } from "../../vault-backup.js";
import { setReportConsent } from "../../dev-report-consent.js";
import { makeReport } from "../../report.js";
import { inspectPath } from "../../inventory.js";
import { rawResponse } from "../../routes.js";

const q = (url, name) => url.searchParams.get(name);
// Schlüsselwechsel je Dienst (feste Liste, keine Muster)
const ROTATIONS = ["bazarr", "lidarr", "sonarr", "radarr", "prowlarr", "seerr", "jellyfin-couchdeck", "jellyfin-seerr", "jellyfin-streamystats"];

export function systemRoutes(d) {
  const {
    hub, state, installer, executor, operations, audit, activity, notifications, appUpdates, couchdeck,
    inventorySnapshot, collectDevelopmentReport, developmentUploadStatus, uploadDevelopmentReport,
  } = d;
  const get = (p, handler) => ({ method: "GET", path: p, guard: "session", handler });
  const post = (p, guard, handler, confirm) => ({ method: "POST", path: p, guard, handler, ...(confirm ? { confirm } : {}) });
  const rotate = (slug) => post(`/api/credentials/rotate-${slug}`, "password", ({ body }) => {
    const service = slug.startsWith("jellyfin-") ? "Jellyfin" : slug[0].toUpperCase() + slug.slice(1);
    const required = slug === "jellyfin-seerr" ? [service, "Seerr"]
      : slug === "jellyfin-streamystats" ? [service, "Streamystats"] : [service];
    return hub.mutate(required, ({ plan, s }) => {
      if (body.planId !== plan.id) throw Error("Der Stack hat sich geändert. Bitte öffne die Anwendung erneut.");
      if (slug === "seerr") return rotateSeerrKey(s, installer(), couchdeck);
      if (slug === "jellyfin-couchdeck") return rotateCouchdeckToken(s, couchdeck);
      if (slug === "jellyfin-seerr") return rotateSeerrJellyfinToken(s);
      if (slug === "jellyfin-streamystats") return rotateStreamystatsJellyfinToken(s, installer());
      return service === "Bazarr" ? rotateBazarrKey(s) : rotateArrKey(s, installer().docker, service);
    });
  }, "Schlüsselwechsel zuerst bestätigen.");
  return [
    get("/api/catalog", () => catalog),
    get("/api/stack", () => {
      const current = installer().current();
      return current ? {
        planId: current.plan.id,
        status: current.job.status,
        spec: current.plan.spec,
        networkUpgrade: current.job.status === "completed" && needsNetworkUpgrade(current.plan),
        vpnProfileId: current.plan.vpnProfileId || null,
      } : null;
    }),
    get("/api/identity", async ({ session }) => {
      const release = await readFile("/etc/os-release", "utf8").catch(() => "");
      return {
        username: session.username,
        suggestedDataPath: path.join(os.homedir(), "stackpilot-data"),
        host: os.hostname(),
        release: release.match(/^PRETTY_NAME="?([^"\n]+)/m)?.[1] || os.type(),
      };
    }),
    get("/api/inventory", () => inventorySnapshot()),
    get("/api/report", async () => makeReport(await inventorySnapshot())),
    get("/api/storage", ({ url }) => inspectPath(q(url, "path"))),
    get("/api/operations", () => ({ operations: executor().list() })),
    get("/api/operations/overview", ({ url }) => operations.inspect(q(url, "force") === "1")),
    get("/api/audit", ({ url }) => audit.list(q(url, "page") || 1)),
    get("/api/activity", () => activity.get()),
    get("/api/notifications", () => notifications.list()),
    post("/api/notifications/read", "session", ({ body }) => notifications.mark(body.ids)),
    get("/api/managed", ({ host }) => managedServices(installer(), host, appUpdates)),
    post("/api/managed/check", "session", ({ body }) => checkManaged(installer(), body.operationId)),
    ...ROTATIONS.map(rotate),
    // revealCredentials prüft das Passwort zusätzlich selbst
    post("/api/credentials/reveal", "password", ({ body, manager, remoteAddress }) => revealCredentials(installer(), body, manager, remoteAddress)),
    get("/api/vault-backup", ({ local }) => ({ local })),
    post("/api/vault-backup", "password", async ({ body, local }) => {
      if (!local) throw Error("Öffne StackPilot am Server oder über einen SSH-Tunnel.");
      if (body.password === body.passphrase) throw Error("Verwende eine eigene Sicherungspassphrase.");
      const bytes = await hub.mutate([], () => createVaultBackup(state, installer().vault, body.passphrase));
      return rawResponse(bytes, {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="stackpilot-tresor-${new Date().toISOString().slice(0, 10)}.spvault"`,
      });
    }),
    // Nur lokal (prüft die Middleware vor dem Einlesen der großen Anfrage)
    post("/api/vault-backup/restore", "password", ({ body }) => hub.mutate([], () => stageVaultRestore(state, body.archive, body.passphrase))),
    get("/api/development/report", () => collectDevelopmentReport()),
    get("/api/development/status", () => developmentUploadStatus(state)),
    post("/api/development/consent", "session", async ({ body }) => {
      if (body.enabled && !(await developmentUploadStatus(state)).policyEnabled)
        throw Error("Die Entwicklungspolicy gibt keinen Upload frei.");
      setReportConsent(state, body.enabled);
      return developmentUploadStatus(state);
    }),
    post("/api/development/report/publish", "session", async () => {
      if (!(await developmentUploadStatus(state)).enabled) throw Error("Entwicklungsupload ist deaktiviert.");
      return uploadDevelopmentReport();
    }),
  ];
}
