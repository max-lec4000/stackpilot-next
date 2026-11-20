import { AdminTailnet } from "./admin-tailnet.js";
import { ImportedReplacement } from "./imported-replacement.js";
import { SeriesRemoval } from "./series-removal.js";
import { SharedFilmStandard } from "./shared-film-standard.js";
import { ViewerRequests } from "./viewer-requests.js";
import { ViewerRatings } from "./viewer-ratings.js";
import { DownloadIssues } from "./download-issues.js";
import { DownloadSettings } from "./download-settings.js";
import { Subtitles } from "./subtitles.js";
import { SourceHealth } from "./source-health.js";
import { QualityDefaults } from "./quality-defaults.js";
import { StorageOverview } from "./storage-overview.js";
import { LibraryOverview } from "./library-overview.js";
import { storageRoutes } from "./domains/storage/storage.routes.js";
import { hostAllowed, isPlainLoopback } from "./access.js";
import { YouTubeVpnRelay } from "./youtube-vpn.js";
import { RouteRegistry, isRawResponse, rawOf } from "./routes.js";
import { remoteRoutes } from "./domains/access/remote.routes.js";
import { safetyRoutes } from "./domains/access/safety.routes.js";
import { downloadRoutes } from "./domains/downloads/downloads.routes.js";
import { qualityRoutes } from "./domains/quality/quality.routes.js";
import { requestRoutes } from "./domains/requests/requests.routes.js";
import { libraryRoutes } from "./domains/library/library.routes.js";
import { peopleRoutes } from "./domains/people/people.routes.js";
import { couchdeckRoutes } from "./domains/couchdeck/couchdeck.routes.js";
import { setupRoutes } from "./domains/system/setup.routes.js";
import { systemRoutes } from "./domains/system/system.routes.js";
import { updateRoutes } from "./domains/system/updates.routes.js";
import { vpnRoutes } from "./domains/access/vpn.routes.js";
import { viewerRequestRoutes } from "./domains/requests/viewer-requests.routes.js";
import { Couchdeck } from "./couchdeck.js";
import { RemoteSetup } from "./remote-setup.js";
import { ViewerProfiles } from "./identity/viewer-profiles.js";
import { Viewers } from "./identity/viewers.js";
import { RemoteJourney } from "./remote-journey.js";
import { Notifications } from "./notifications.js";
import { ServiceUpdates } from "./service-updates.js";
import { DockerGuardStatus, writeGuardRoots } from "./docker-guard-client.js";
import { dockerGuardRoutes } from "./domains/system/docker-guard.routes.js";
import { AppUpdates } from "./app-updates.js";
import { ContainerMaintenance } from "./container-maintenance.js";
import { JellyfinMaintenance } from "./identity/jellyfin-maintenance.js";
import { vaultRestoreBodyLimit } from "./vault-backup.js";
import { OidcBackchannel } from "./identity/oidc-backchannel.js";
import {
  developmentReport,
  developmentUploadStatus,
  publishDevelopmentReport,
} from "./development-report.js";
import { writeReport } from "./report.js";
import { ConnectionCheck } from "./identity/connection-check.js";
import { IdentitySettings } from "./identity/settings.js";
import { Operations } from "./operations.js";
import { AuditLog } from "./audit.js";
import { SizeLimits } from "./size-limits.js";
import { RequestRecords } from "./request-records.js";
import { RequestLifecycle } from "./request-lifecycle.js";
import { SsoConnection } from "./identity/sso-connection.js";
import { JellyfinProtection } from "./identity/jellyfin-protection.js";
import { PrivateServe } from "./identity/private-serve.js";
import { PublicFunnel } from "./identity/public-funnel.js";
import { IdentityBackups } from "./identity/backups.js";
import { RemoteSecurity } from "./remote-security.js";
import { IdentityPreparation } from "./identity/preparation.js";
import { RemoteAccess } from "./remote-access.js";
import { MovieRemoval } from "./movie-removal.js";
import { QualitySettings } from "./quality-settings.js";
import { RequestDiagnostics } from "./request-diagnostics.js";
import { MediaHub } from "./media-hub.js";
import { Sources } from "./sources.js";
import { SafetyCheck } from "./safety-check.js";
import { DownloadGuard } from "./download-guard.js";
import { ActivityMonitor } from "./activity.js";
import { VpnSwitch } from "./vpn-switch.js";
import { DeploymentEngine } from "./installer.js";
import path from "node:path";
import { Auth, sessionCookie } from "./auth.js";
import { Vault } from "./vault.js";
import { StateStore } from "./state.js";
import { RetirementEngine } from "./retirement.js";
import { inventory } from "./inventory.js";
export function inventoryMiddleware(options = {}) {
  let pending = null;
  const state = options.store || new StateStore(options.stateDirectory);
  const audit = new AuditLog(state);
  let engine = new RetirementEngine(state);
  let auth = new Auth(state);
  let deployment;
  const installer = () =>
    (deployment ??= new DeploymentEngine(
      executor().store,
      new Vault(executor().store),
    ));
  const authenticator = () => (auth ??= new Auth(executor().store));

  const executor = () =>
    (engine ??= new RetirementEngine(new StateStore(options.stateDirectory)));
  const guard = new DownloadGuard(installer());
  if (options.background !== false) guard.start();
  const activity = new ActivityMonitor(installer(), guard);
  const hub = new MediaHub(installer(), guard);
  const downloadIssues = new DownloadIssues(hub);
  hub.downloadIssues = downloadIssues;
  const downloadSettings = new DownloadSettings(hub);
  if (options.background !== false) hub.library.start();
  const sources = new Sources(hub);
  const couchdeck = options.couchdeck || new Couchdeck(hub);
  installer().couchdeck = couchdeck;
  // YouTube-Ausweg für Couchdeck über den VPN-Tunnel (nur lokal, nur mit Schlüssel)
  const youtubeVpn = options.youtubeVpn || new YouTubeVpnRelay(hub, { linkDir: couchdeck.linkDir });
  // Fester Port: nicht aus Tests heraus starten (node --test setzt NODE_TEST_CONTEXT)
  if (options.background !== false && !process.env.NODE_TEST_CONTEXT) youtubeVpn.start();
  const vpnSwitch = new VpnSwitch(hub, { tunnel: youtubeVpn.tunnel });
  const completedPlan = () => {
    const current = installer().current();
    return current?.job.status === "completed" ? current.plan : null;
  };
  const operations = new Operations(hub, activity);
  const serviceUpdates = new ServiceUpdates(state);
  const dockerGuard = new DockerGuardStatus(state);
  operations.downloadIssues = downloadIssues;
  operations.dockerGuard = dockerGuard;
  operations.sourceHealth = new SourceHealth(hub);
  // Docker-Wächter: Datenordner der Stacks melden (nur wenn StackPilot über ihn läuft)
  try { writeGuardRoots(state); } catch (e) { console.error("Docker-Wächter: Datenordner nicht gemeldet:", e.message); }
  const appUpdates = new AppUpdates(installer());
  if (options.background !== false) appUpdates.start();
  const notifications = new Notifications(state, operations, hub);
  if (options.background !== false) notifications.start();
  const remoteAccess = new RemoteAccess(hub);
  const identity = new IdentityPreparation(hub, remoteAccess);
  const identityBackups = new IdentityBackups(identity);
  const ssoConnection = new SsoConnection(hub, identity);
  const jellyfinProtection = new JellyfinProtection(hub, identity);
  const connectionCheck = new ConnectionCheck(jellyfinProtection);
  const containerMaintenance = new ContainerMaintenance(hub, {
    jellyfin: new JellyfinMaintenance(jellyfinProtection, ssoConnection, connectionCheck),
  });
  const oidcBackchannel = new OidcBackchannel(
    hub,
    identity,
    jellyfinProtection,
  );
  if (options.background !== false) oidcBackchannel.start();
  const identitySettings = new IdentitySettings(identity);
  const collectDevelopmentReport = () =>
    developmentReport({
      engine: installer(),
      hub,
      remote: remoteAccess,
      sso: ssoConnection,
      protection: jellyfinProtection,
      connection: connectionCheck,
      settings: identitySettings,
      serve: privateServe,
      backchannel: oidcBackchannel,
    });
  const privateServe = new PrivateServe(
    hub,
    identity,
    jellyfinProtection,
    ssoConnection,
    undefined,
    undefined,
    connectionCheck,
    identitySettings,
    oidcBackchannel,
  );
  const adminTailnet = new AdminTailnet();
  const viewers = new Viewers(identity);
  const viewerRequests = new ViewerRequests(hub, ssoConnection, viewers);
  const viewerProfiles = new ViewerProfiles(hub, ssoConnection, viewers);
  const viewerRatings = new ViewerRatings(hub, ssoConnection, viewers);
  const remoteSetup = new RemoteSetup(hub, {
    identity,
    protection: jellyfinProtection,
    sso: ssoConnection,
    serve: privateServe,
    viewers,
  });
  // Im Assistenten gewählt: nach der Installation ohne weiteren Klick weitermachen.
  installer().onCompleted = (plan) => {
    if (plan.spec.remote) void remoteSetup.start({ viewer: plan.spec.viewer }).catch(() => {});
  };
  const journey = new RemoteJourney(
    hub,
    identity,
    jellyfinProtection,
    ssoConnection,
  );
  const uploadDevelopmentReport = async () => {
    if (!(await developmentUploadStatus(state)).enabled)
      return { enabled: false };
    const report = await collectDevelopmentReport();
    await writeReport(
      path.join(
        state.directory,
        "development-reports",
        `diagnose-${report.createdAt.replace(/[:.]/g, "-")}.json`,
      ),
      report,
    );
    return publishDevelopmentReport(report, { store: state });
  };
  const remoteSecurity = new RemoteSecurity(
    hub,
    remoteAccess,
    identity,
    identityBackups,
    jellyfinProtection,
  );
  remoteSetup.security = remoteSecurity;
  const seriesRemoval = new SeriesRemoval(hub);
  const sizeLimits = new SizeLimits(hub);
  sizeLimits.shared = new SharedFilmStandard(hub, sizeLimits);
  if (options.background !== false) sizeLimits.shared.start();
  const publicFunnel = new PublicFunnel(hub, identity, jellyfinProtection,
    ssoConnection, connectionCheck, identitySettings, remoteSecurity, identityBackups);
  if (options.background !== false) publicFunnel.start();
  hub.sizeLimits = sizeLimits;
  const records = new RequestRecords(state);
  hub.records = records;
  const requestDiagnostics = new RequestDiagnostics(hub);
  const importedReplacement = new ImportedReplacement(hub, requestDiagnostics);
  if (options.background !== false) importedReplacement.startWorker();
  const requestLifecycle = new RequestLifecycle(
    hub,
    requestDiagnostics,
    records,
  );
  const movieRemoval = new MovieRemoval(hub, requestDiagnostics);
  const qualitySettings = new QualitySettings(hub, requestDiagnostics);
  const safety = new SafetyCheck(installer(), guard);
  let draining = false;
  // Routen-Verzeichnis (Phase 7.0a): umgezogene Bereiche mit deklarierter Schutzstufe.
  // Alles andere läuft noch über die Bedingungskette unten.
  const routes = new RouteRegistry()
    .add(updateRoutes({ serviceUpdates, containerMaintenance, couchdeck }))
    .add(dockerGuardRoutes({ dockerGuard }))
    .add(storageRoutes({ storageOverview: new StorageOverview(hub) }))
    .add(vpnRoutes({ vault: () => installer().vault, youtubeVpn, vpnSwitch, completedPlan }))
    .add(viewerRequestRoutes({ viewerRequests }))
    .add(remoteRoutes({
      connectionCheck, journey, remoteAccess, privateServe, jellyfinProtection, publicFunnel,
      ssoConnection, identity, identityBackups, remoteSecurity, adminTailnet,
      developmentUploadStatus, uploadDevelopmentReport, state,
    }))
    .add(safetyRoutes({ safety }))
    .add(downloadRoutes({ hub, guard, downloadIssues, downloadSettings }))
    .add(qualityRoutes({ sources, sizeLimits, subtitles: new Subtitles(hub), sourceHealth: operations.sourceHealth, qualityDefaults: new QualityDefaults(hub) }))
    .add(requestRoutes({ hub, records, requestDiagnostics, requestLifecycle, qualitySettings }))
    .add(libraryRoutes({ hub, installer, importedReplacement, seriesRemoval, movieRemoval, libraryOverview: new LibraryOverview(hub) }))
    .add(peopleRoutes({ viewers, viewerProfiles, viewerRatings, remoteSetup }))
    .add(couchdeckRoutes({ couchdeck }))
    .add(setupRoutes({ installer, executor }))
    .add(systemRoutes({
      hub, state, installer, executor, operations, audit, activity, notifications, appUpdates, couchdeck,
      // Ein laufender Inventarlauf wird von gleichzeitigen Anfragen mitbenutzt
      inventorySnapshot: () => (pending ??= inventory().finally(() => { pending = null; })),
      collectDevelopmentReport, developmentUploadStatus, uploadDevelopmentReport,
    }));
  const middleware = async (req, res, next) => {
    if (!req.url?.startsWith("/api/") && isPlainLoopback(req.headers.host)) {
      res.writeHead(302, {
        Location: `http://stackpilot.localhost:${req.headers.host.split(":").at(-1)}${new URL(req.url, "http://localhost").pathname}${new URL(req.url, "http://localhost").search}`,
      });
      return res.end();
    }
    if (!req.url?.startsWith("/api/")) return next();
    if (draining) {
      res.writeHead(503, { "Content-Type": "application/json" });
      return res.end(
        JSON.stringify({
          error:
            "StackPilot wird beendet. Auftrag bleibt gespeichert; nach dem Neustart Zustand prüfen.",
        }),
      );
    }
    const host = req.headers.host;
    const remoteAddress = req.socket?.remoteAddress;
    // Nur über die eigene Adresse dieses Servers; fremde Hostnamen (DNS-Rebinding) nicht.
    if (!hostAllowed(host, { bind: options.bind })) {
      res.writeHead(403);
      return res.end("Zugriff nur über die Adresse dieses Servers.");
    }
    if (
      (req.headers.origin && req.headers.origin !== `http://${host}`) ||
      req.headers["sec-fetch-site"] === "cross-site"
    ) {
      res.writeHead(403);
      return res.end("Fremder Ursprung abgewiesen.");
    }
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    const url = new URL(req.url, `http://${host}`);
    const vaultBackupLocal = ["127.0.0.1", "::ffff:127.0.0.1", "::1"].includes(remoteAddress) &&
      /^(?:localhost|127\.0\.0\.1|stackpilot\.localhost|\[::1\]):\d+$/.test(host);
    if (url.pathname === "/api/couchdeck/media") {
      if (!["127.0.0.1", "::ffff:127.0.0.1"].includes(remoteAddress) ||
          !isPlainLoopback(host) || req.headers.origin || req.method !== "POST" ||
          !req.headers["content-type"]?.startsWith("application/json")) {
        res.writeHead(403);
        return res.end(JSON.stringify({ error: "Nur für das lokale Couchdeck verfügbar." }));
      }
      const owner = await Promise.resolve().then(() => couchdeck.mediaOwner(req.headers["x-couchdeck-token"])).catch(() => null);
      if (!owner) {
        res.writeHead(401);
        return res.end(JSON.stringify({ error: "Wohnzimmer-Konto konnte nicht bestätigt werden." }));
      }
      try {
        let text = "";
        for await (const chunk of req) {
          text += chunk;
          if (Buffer.byteLength(text) > 8192) throw Error("Anfrage zu groß.");
        }
        const body = JSON.parse(text);
        const { requestId, season, episodeId, fileId } = body;
        let result;
        if (body.action === "storage") {
          const current = installer().current();
          if (!current || current.job.status !== "completed") throw Error("Der Stack ist noch nicht eingerichtet.");
          result = await operations.storageSummary(current.plan);
        } else if (body.action === "episodes") result = await requestDiagnostics.episodes(requestId, season, owner);
        else if (body.action === "request-cancel")
          result = await requestDiagnostics.cancelOwnRequest({ requestId, confirmation: body.confirmation, expected: body.expected }, owner);
        else if (body.action === "search" && episodeId !== undefined)
          result = await requestDiagnostics.search({ requestId, season, episodeId, capGiB: body.capGiB }, owner);
        else if (body.action === "search-season" && season !== undefined)
          result = await requestDiagnostics.search({ requestId, season, capGiB: body.capGiB }, owner);
        else if (body.action === "film-request") {
          if (!Number.isFinite(body.capGiB) || body.capGiB < 0.5 ||
              body.capGiB > 200 || !Number.isInteger(body.capGiB * 2))
            throw Error("Ungültige Film-Größenobergrenze.");
          result = await hub.request({ type: "movie", id: body.mediaId }, {
            owner, userId: Number(body.userId), capGiB: body.capGiB,
          });
        } else if (body.action === "season-transfer")
          result = await requestDiagnostics.seasonTransferPreview({ requestId, season, remove: body.remove === true }, owner);
        else if (body.action === "season-pause")
          result = await requestDiagnostics.pauseSeasonTransfer({ requestId, season, review: body.review, confirmation: body.confirmation }, owner);
        else if (body.action === "season-remove")
          result = await requestDiagnostics.pauseSeasonTransfer({ requestId, season, review: body.review, confirmation: body.confirmation }, owner, true);
        else if (body.action === "delete")
          result = await requestDiagnostics.deleteEpisodeFile({ requestId, season, episodeId, fileId, confirmation: body.confirmation }, owner);
        else throw Error("Unbekannte Couchdeck-Aktion.");
        return res.end(JSON.stringify(result));
      } catch (error) {
        res.writeHead(400);
        return res.end(JSON.stringify({ error: error.message }));
      }
    }
    let manager, session;
    try {
      manager = authenticator();
      session = manager.current(req.headers.cookie);
    } catch {
      res.writeHead(500);
      return res.end(
        JSON.stringify({
          error:
            "Lokaler Zustand ist nicht zugänglich. Berechtigungen und Schlüsseldateien prüfen.",
        }),
      );
    }
    const publicRoute = [
      "/api/auth/status",
      "/api/auth/setup",
      "/api/auth/login",
    ].includes(url.pathname);
    if (!publicRoute && !session) {
      res.writeHead(401);
      return res.end(JSON.stringify({ error: "Bitte anmelden." }));
    }
    if (!["GET", "POST"].includes(req.method)) {
      res.writeHead(405);
      return res.end(JSON.stringify({ error: "Methode nicht erlaubt." }));
    }
    if (
      req.method === "POST" &&
      (req.headers.origin !== `http://${host}` ||
        !req.headers["content-type"]?.startsWith("application/json") ||
        (!publicRoute && req.headers["x-stackpilot-token"] !== session.csrf))
    ) {
      res.writeHead(403);
      return res.end(
        JSON.stringify({ error: "Lokale Sitzung oder Bestätigung fehlt." }),
      );
    }
    let auditId = null;
    try {
      const url = new URL(req.url, `http://${host}`);
      let result;
      const getRoute = req.method === "GET" ? routes.find("GET", url.pathname) : null;
      if (getRoute) {
        result = await routes.run(getRoute, { url, session, manager, remoteAddress, host, local: vaultBackupLocal });
        if (isRawResponse(result)) {
          const raw = rawOf(result);
          for (const [k, v] of Object.entries(raw.headers)) res.setHeader(k, v);
          return res.end(raw.bytes);
        }
      } else if (url.pathname === "/api/auth/status" && req.method === "GET") {
        result = {
          configured: manager.configured(),
          authenticated: !!session,
          username: session?.username,
        };
      } else if (url.pathname === "/api/session" && req.method === "GET") {
        result = { token: session.csrf };
      } else if (req.method === "POST") {
        const vaultRestore = url.pathname === "/api/vault-backup/restore";
        if (vaultRestore && !vaultBackupLocal)
          throw Error("Öffne StackPilot am Server oder über einen SSH-Tunnel.");
        const limit = vaultRestore ? vaultRestoreBodyLimit : 8192;
        const chunks = [];
        let length = 0;
        for await (const chunk of req) {
          length += chunk.length;
          if (length > limit) throw Error("Anfrage zu groß.");
          chunks.push(chunk);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        if (
          url.pathname === "/api/auth/setup" ||
          url.pathname === "/api/auth/login"
        ) {
          const created = url.pathname.endsWith("/setup")
            ? await manager.setup(body.username, body.password, body.code)
            : await manager.login(body.username, body.password, remoteAddress);
          res.setHeader("Set-Cookie", sessionCookie(created.token));
          return res.end(JSON.stringify({ ok: true }));
        }
        if (url.pathname === "/api/auth/logout") {
          manager.logout(session);
          res.setHeader(
            "Set-Cookie",
            "stackpilot_session=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0",
          );
          return res.end(JSON.stringify({ ok: true }));
        }
        auditId = audit.begin(url.pathname, session.username);
        const e = executor();
        if (
          url.pathname.startsWith("/api/retirement/") &&
          body.operationId &&
          e.store.operation(body.operationId)?.kind !== "retirement"
        )
          throw new Error(
            "Dieser Auftrag gehört zur Neuinstallation, nicht zur Altstack-Ablösung.",
          );
        if (
          url.pathname.startsWith("/api/deployment/") &&
          body.operationId &&
          e.store.operation(body.operationId)?.kind !== "deployment"
        )
          throw Error("Dieser Auftrag gehört nicht zur Installation.");
        const postRoute = routes.find("POST", url.pathname);
        if (postRoute) {
          result = await routes.run(postRoute, { url, body, session, manager, remoteAddress, host, local: vaultBackupLocal });
          if (isRawResponse(result)) {
            const raw = rawOf(result);
            try { audit.finish(auditId, true); } catch {}
            for (const [k, v] of Object.entries(raw.headers)) res.setHeader(k, v);
            return res.end(raw.bytes);
          }
        }
        else {
          res.writeHead(404);
          return res.end(JSON.stringify({ error: "Unbekannte Aktion." }));
        }
      } else {
        res.writeHead(404);
        return res.end(JSON.stringify({ error: "Unbekannte Schnittstelle." }));
      }
      if (req.method === "POST") {
        activity.cached = null;
        operations.cache.clear();
        try {
          audit.finish(auditId, true);
        } catch {
          if (result && typeof result === "object")
            result.auditWarning =
              "Aktion ausgeführt, aber der Änderungsverlauf konnte nicht abgeschlossen werden.";
        }
      }
      res.end(JSON.stringify(result));
    } catch (e) {
      try {
        audit.finish(auditId, false);
      } catch {}
      res.writeHead(400);
      res.end(
        JSON.stringify({
          error:
            e.userFacing === true ||
            req.method === "POST" ||
            e.message === "Pfad ist nicht zugänglich." ||
            e.message.startsWith("Ungültiger") ||
            e.message.startsWith("Pfad ") ||
            e.message.startsWith("Kein ")
              ? e.message
              : "Prüfung konnte nicht abgeschlossen werden.",
        }),
      );
    }
  };
  middleware.developmentReport = collectDevelopmentReport;
  middleware.closeReportContext = () => {
    if (options.background !== false)
      throw Error("Nur eigenständigen Berichtkontext schließen.");
    state.close();
  };
  middleware.shutdown = async (timeoutMs = 240000) => {
    draining = true;
    appUpdates.close();
    notifications.close();
    publicFunnel.close();
    oidcBackchannel.close();
    guard.close();
    sizeLimits.shared.close();
    importedReplacement.close();
    hub.library.close();
    for (const op of state.operations())
      if (["running", "queued"].includes(op.status))
        (op.kind === "deployment" ? installer() : executor()).pause(op.id);
    const end = Date.now() + timeoutMs;
    while (state.activeLease() && Date.now() < end)
      await new Promise((resolve) => setTimeout(resolve, 200));
    return { idle: !state.activeLease() };
  };
  return middleware;
}
