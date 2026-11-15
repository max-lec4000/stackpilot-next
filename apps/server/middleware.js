import { hostAllowed, isPlainLoopback } from "./access.js";
import { Couchdeck } from "./couchdeck.js";
import { RemoteSetup } from "./remote-setup.js";
import { Viewers } from "./identity/viewers.js";
import { RemoteJourney } from "./remote-journey.js";
import { Notifications } from "./notifications.js";
import { globalSearch } from "./global-search.js";
import { musicInventory, withMusicTrack } from "./music-library.js";
import { inspectMusicTags } from "./music-tags.js";
import { ServiceUpdates } from "./service-updates.js";
import { setReportConsent } from "./dev-report-consent.js";
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
import { importVpn } from "./vpn.js";
import { DeploymentEngine, needsNetworkUpgrade } from "./installer.js";
import { catalog } from "./catalog.js";
import { managedServices, revealCredentials, checkManaged } from "./managed.js";
import path from "node:path";
import { Auth, sessionCookie } from "./auth.js";
import { Vault } from "./vault.js";
import { StateStore } from "./state.js";
import { RetirementEngine } from "./retirement.js";
import os from "node:os";
import { readFile } from "node:fs/promises";
import { makeReport } from "./report.js";
import { inventory, inspectPath } from "./inventory.js";
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
  if (options.background !== false) hub.library.start();
  const sources = new Sources(hub);
  const couchdeck = options.couchdeck || new Couchdeck(hub);
  installer().couchdeck = couchdeck;
  const operations = new Operations(hub, activity);
  const serviceUpdates = new ServiceUpdates(state);
  const notifications = new Notifications(state, operations, hub);
  if (options.background !== false) notifications.start();
  const remoteAccess = new RemoteAccess(hub);
  const identity = new IdentityPreparation(hub, remoteAccess);
  const identityBackups = new IdentityBackups(identity);
  const ssoConnection = new SsoConnection(hub, identity);
  const jellyfinProtection = new JellyfinProtection(hub, identity);
  const connectionCheck = new ConnectionCheck(jellyfinProtection);
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
  const viewers = new Viewers(identity);
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
  const sizeLimits = new SizeLimits(hub);
  const publicFunnel = new PublicFunnel(hub, identity, jellyfinProtection,
    ssoConnection, connectionCheck, identitySettings, remoteSecurity, identityBackups);
  if (options.background !== false) publicFunnel.start();
  hub.sizeLimits = sizeLimits;
  const records = new RequestRecords(state);
  hub.records = records;
  const requestDiagnostics = new RequestDiagnostics(hub);
  const requestLifecycle = new RequestLifecycle(
    hub,
    requestDiagnostics,
    records,
  );
  const movieRemoval = new MovieRemoval(hub, requestDiagnostics);
  const qualitySettings = new QualitySettings(hub, requestDiagnostics);
  const safety = new SafetyCheck(installer(), guard);
  let draining = false;
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
      if (url.pathname === "/api/updates/job" && req.method === "GET") {
        result = await serviceUpdates.job();
      } else if (url.pathname === "/api/music/tags" && req.method === "GET") {
        const current = installer().current();
        if (!current || current.job.status !== "completed") throw Object.assign(Error("Zuerst die Einrichtung abschließen."), { userFacing: true });
        result = await withMusicTrack(current.plan.spec.path, url.searchParams.get("path"), async (file, before) => {
          const report = await inspectMusicTags(file, before), after = await file.stat();
          if (after.size !== before.size || after.mtimeMs !== before.mtimeMs)
            return { state: "unconfirmed", fields: {}, embeddedCover: null, message: "Datei wurde während der Prüfung geändert. Erneut prüfen." };
          return report;
        });
      } else if (url.pathname === "/api/music" && req.method === "GET") {
        const current = installer().current();
        if (!current || current.job.status !== "completed") throw Object.assign(Error("Zuerst die Einrichtung abschließen."), { userFacing: true });
        result = await musicInventory(current.plan.spec.path);
      } else if (url.pathname === "/api/search" && req.method === "GET") {
        result = await globalSearch(url.searchParams.get("query"), hub);
      } else if (url.pathname === "/api/notifications" && req.method === "GET") {
        result = notifications.list();
      } else if (url.pathname === "/api/development/report" && req.method === "GET") {
        result = await collectDevelopmentReport();
      } else if (
        url.pathname === "/api/development/status" &&
        req.method === "GET"
      ) {
        result = await developmentUploadStatus(state);
      } else if (
        url.pathname === "/api/remote-access/connection" &&
        req.method === "GET"
      ) {
        result = await connectionCheck.inspect();
      } else if (
        url.pathname === "/api/remote-access/journey" &&
        req.method === "GET"
      ) {
        result = journey.snapshot();
      } else if (url.pathname === "/api/auth/status" && req.method === "GET") {
        result = {
          configured: manager.configured(),
          authenticated: !!session,
          username: session?.username,
        };
      } else if (url.pathname === "/api/session" && req.method === "GET") {
        result = { token: session.csrf };
      } else if (url.pathname === "/api/catalog" && req.method === "GET") {
        result = catalog;
      } else if (url.pathname === "/api/stack" && req.method === "GET") {
        const current = installer().current();
        result = current
          ? {
              planId: current.plan.id,
              status: current.job.status,
              spec: current.plan.spec,
              networkUpgrade: current.job.status === "completed" && needsNetworkUpgrade(current.plan),
              vpnProfileId: current.plan.vpnProfileId || null,
            }
          : null;
      } else if (url.pathname === "/api/media/search" && req.method === "GET") {
        result = await hub.search(
          url.searchParams.get("q"),
          url.searchParams.get("page") || 1,
        );
      } else if (
        url.pathname === "/api/media/quality" &&
        req.method === "GET"
      ) {
        result = await qualitySettings.read(url.searchParams.get("requestId"));
      } else if (url.pathname === "/api/media/detail" && req.method === "GET") {
        result = await hub.detail(
          url.searchParams.get("type"),
          url.searchParams.get("id"),
        );
      } else if (
        url.pathname === "/api/media/requests" &&
        req.method === "GET"
      ) {
        result = await hub.requests({
          force: url.searchParams.get("force") === "1",
          page: url.searchParams.get("page") || 1,
          filter: url.searchParams.get("filter") || "all",
          type: url.searchParams.get("type") || "all",
        });
      } else if (
        url.pathname === "/api/media/diagnosis" &&
        req.method === "GET"
      ) {
        result = await requestDiagnostics.inspect(
          url.searchParams.get("requestId"),
        );
      } else if (
        url.pathname === "/api/sources/detail" &&
        req.method === "GET"
      ) {
        result = await sources.detail(url.searchParams.get("id"));
      } else if (url.pathname === "/api/sources" && req.method === "GET") {
        result = await sources.list();
      } else if (url.pathname === "/api/safety" && req.method === "GET") {
        result = { operations: safety.list() };
      } else if (url.pathname === "/api/media/poster" && req.method === "GET") {
        const poster = url.searchParams.get("path") || "";
        if (!/^\/[a-zA-Z0-9_-]+\.(jpg|png)$/.test(poster))
          throw Error("Ungültiges Cover.");
        const response = await fetch(
          "https://image.tmdb.org/t/p/w342" + poster,
          { redirect: "error", signal: AbortSignal.timeout(8000) },
        );
        if (
          !response.ok ||
          !/^image\/(jpeg|png|webp)$/.test(
            response.headers.get("content-type") || "",
          ) ||
          Number(response.headers.get("content-length")) > 2097152
        )
          throw Error("Cover nicht erreichbar.");
        const chunks = [];
        let size = 0;
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > 2097152) throw Error("Cover zu groß.");
          chunks.push(chunk);
        }
        res.setHeader("Content-Type", response.headers.get("content-type"));
        return res.end(Buffer.concat(chunks));
      } else if (
        url.pathname === "/api/media/size-settings" &&
        req.method === "GET"
      ) {
        result = await sizeLimits.settings();
      } else if (
        url.pathname === "/api/operations/overview" &&
        req.method === "GET"
      ) {
        result = await operations.inspect(
          url.searchParams.get("force") === "1",
        );
      } else if (url.pathname === "/api/audit" && req.method === "GET") {
        result = audit.list(url.searchParams.get("page") || 1);
      } else if (url.pathname === "/api/activity" && req.method === "GET") {
        result = await activity.get();
      } else if (
        url.pathname === "/api/downloads/status" &&
        req.method === "GET"
      ) {
        result = await guard.check();
      } else if (
        url.pathname === "/api/downloads/list" &&
        req.method === "GET"
      ) {
        result = await hub.downloads({
          page: url.searchParams.get("page") || 1,
          filter: url.searchParams.get("filter") || "all",
          query: url.searchParams.get("query") || "",
        });
      } else if (
        url.pathname === "/api/remote-access" &&
        req.method === "GET"
      ) {
        result = await remoteAccess.inspect();
      } else if (
        url.pathname === "/api/remote-access/private-serve" &&
        req.method === "GET"
      ) {
        result = await privateServe.preview();
      } else if (url.pathname === "/api/remote-access/funnel" && req.method === "GET") {
        result = await publicFunnel.preview();
      } else if (
        url.pathname === "/api/remote-access/protection" &&
        req.method === "GET"
      ) {
        result = jellyfinProtection.summary();
      } else if (
        url.pathname === "/api/remote-access/protection/preview" &&
        req.method === "GET"
      ) {
        result = {
          ...(await jellyfinProtection.preview()),
          verified: (await jellyfinProtection.status()).verified,
        };
      } else if (
        url.pathname === "/api/remote-access/sso" &&
        req.method === "GET"
      ) {
        result = await ssoConnection.plan();
      } else if (
        url.pathname === "/api/remote-access/identity" &&
        req.method === "GET"
      ) {
        result = identity.summary();
      } else if (
        url.pathname === "/api/remote-access/backups" &&
        req.method === "GET"
      ) {
        result = {
          backups: identityBackups.list(),
          maintenance: identityBackups.maintenance(),
        };
      } else if (
        url.pathname === "/api/remote-access/admins" &&
        req.method === "GET"
      ) {
        result = await remoteSecurity.admins();
      } else if (
        url.pathname === "/api/remote-access/devices" &&
        req.method === "GET"
      ) {
        result = await remoteSecurity.devices();
      } else if (
        url.pathname === "/api/media/archive" &&
        req.method === "GET"
      ) {
        const { plan } = await hub.context(["Seerr"]);
        result = records.history(plan, {
          page: url.searchParams.get("page") || 1,
          type: url.searchParams.get("type") || "all",
        });
      } else if (
        url.pathname === "/api/media/request-action" &&
        req.method === "GET"
      ) {
        result = await requestLifecycle.preview(
          url.searchParams.get("requestId"),
        );
      } else if (url.pathname === "/api/managed" && req.method === "GET") {
        result = await managedServices(installer(), host);
      } else if (url.pathname === "/api/viewers" && req.method === "GET") {
        result = await viewers.list();
      } else if (url.pathname === "/api/remote-setup" && req.method === "GET") {
        result = remoteSetup.summary();
      } else if (url.pathname === "/api/couchdeck" && req.method === "GET") {
        result = await couchdeck.status();
      } else if (url.pathname === "/api/operations" && req.method === "GET") {
        result = { operations: executor().list() };
      } else if (req.method === "POST") {
        let text = "";
        for await (const chunk of req) {
          text += chunk;
          if (Buffer.byteLength(text) > 8192)
            throw new Error("Anfrage zu groß.");
        }
        const body = JSON.parse(text || "{}");
        if (
          url.pathname === "/api/auth/setup" ||
          url.pathname === "/api/auth/login"
        ) {
          const created = url.pathname.endsWith("/setup")
            ? await manager.setup(body.username, body.password, body.code)
            : await manager.login(body.username, body.password);
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
        if (url.pathname === "/api/updates/preview") {
          result = await serviceUpdates.preview();
        } else if (url.pathname === "/api/updates/start") {
          await authenticator().reauthenticate(body.password);
          result = await serviceUpdates.start(body);
        } else if (url.pathname === "/api/notifications/read") {
          result = notifications.mark(body.ids);
        } else if (url.pathname === "/api/development/consent") {
          if (
            body.enabled &&
            !(await developmentUploadStatus(state)).policyEnabled
          )
            throw Error("Die Entwicklungspolicy gibt keinen Upload frei.");
          setReportConsent(state, body.enabled);
          result = await developmentUploadStatus(state);
        } else if (url.pathname === "/api/development/report/publish") {
          if (!(await developmentUploadStatus(state)).enabled)
            throw Error("Entwicklungsupload ist deaktiviert.");
          result = await uploadDevelopmentReport();
        } else if (url.pathname === "/api/remote-access/private-serve/apply") {
          await authenticator().reauthenticate(body.password);
          try {
            result = await privateServe.apply(body);
          } catch (e) {
            try {
              await uploadDevelopmentReport();
            } catch {}
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
        } else if (url.pathname === "/api/remote-access/protection/start") {
          await authenticator().reauthenticate(body.password);
          result = await jellyfinProtection.start(body);
        } else if (url.pathname === "/api/remote-access/sso/apply") {
          if (!(await authenticator().reauthenticate(body.password)))
            throw Error("Administratorpasswort stimmt nicht.");
          result = await ssoConnection.apply(body);
        } else if (
          [
            "/api/remote-access/backup/create",
            "/api/remote-access/backup/resume",
            "/api/remote-access/backup/test",
            "/api/remote-access/backup/download",
            "/api/remote-access/admins/protect",
            "/api/remote-access/devices/revoke",
          ].includes(url.pathname)
        ) {
          if (!(await authenticator().reauthenticate(body.password)))
            throw Error("Administratorpasswort stimmt nicht.");
          if (url.pathname.endsWith("/create"))
            result = await identityBackups.create(body);
          else if (url.pathname.endsWith("/resume"))
            result = await identityBackups.resume(body);
          else if (url.pathname.endsWith("/test"))
            result = await identityBackups.verifyRestore(body);
          else if (url.pathname.endsWith("/protect"))
            result = await remoteSecurity.protectAdmins(body);
          else if (url.pathname.endsWith("/revoke"))
            result = await remoteSecurity.revoke(body);
          else {
            const bytes = await identityBackups.bytes(body.id);
            res.setHeader("Content-Type", "application/octet-stream");
            res.setHeader(
              "Content-Disposition",
              `attachment; filename="stackpilot-identity-${body.id}.spbackup"`,
            );
            return res.end(bytes);
          }
        } else if (["/api/remote-access/funnel/enable", "/api/remote-access/funnel/disable"].includes(url.pathname)) {
          await authenticator().reauthenticate(body.password);
          result = url.pathname.endsWith("/enable")
            ? await publicFunnel.apply(body) : await publicFunnel.disable(body);
        } else if (url.pathname === "/api/remote-access/funnel-plan")
          result = await remoteSecurity.funnelPlan();
        else if (url.pathname === "/api/remote-access/identity/prepare")
          result = await identity.prepare();
        else if (url.pathname === "/api/remote-access/identity/check")
          result = await identity.inspectSecurity();
        else if (url.pathname === "/api/remote-access/identity/start")
          result = await identity.start(body);
        else if (url.pathname === "/api/remote-access/identity/credentials") {
          if (!(await authenticator().reauthenticate(body.password)))
            throw Error("Administratorpasswort stimmt nicht.");
          result = identity.credentials();
        } else if (url.pathname === "/api/media/movie-removal/preview")
          result = await movieRemoval.preview(body.requestId);
        else if (url.pathname === "/api/media/movie-removal/execute")
          result = await movieRemoval.execute(body);
        else if (url.pathname === "/api/media/request/archive")
          result = await requestLifecycle.archive(body);
        else if (url.pathname === "/api/media/request/cancel")
          result = await requestLifecycle.cancel(body);
        else if (url.pathname === "/api/media/request")
          result = await hub.request(body);
        else if (url.pathname === "/api/media/library/refresh")
          result = await hub.library.run(true);
        else if (url.pathname === "/api/media/size-settings")
          result = await sizeLimits.save(body);
        else if (url.pathname === "/api/media/quality")
          result = await qualitySettings.apply(body);
        else if (url.pathname === "/api/media/research")
          result = await requestDiagnostics.search(body);
        else if (url.pathname === "/api/media/releases")
          result = await requestDiagnostics.inspect(body.requestId, true);
        else if (url.pathname === "/api/downloads/action")
          result = await hub.downloadAction(body);
        else if (url.pathname === "/api/sources/test")
          result = await sources.test(body);
        else if (url.pathname === "/api/sources/save")
          result = await sources.save(body);
        else if (url.pathname === "/api/sources/action")
          result = await sources.action(body);
        else if (url.pathname === "/api/safety/start")
          result = await safety.start(body);
        else if (url.pathname === "/api/downloads/resume")
          result = await guard.resume();
        else if (url.pathname === "/api/vpn/import")
          result = importVpn(installer().vault, body.config);
        else if (url.pathname === "/api/deployment/plan")
          result = await installer().createPlan(body);
        else if (url.pathname === "/api/deployment/confirm")
          result = await installer().confirm(body.planId, body.confirmation);
        else if (url.pathname === "/api/deployment/pause")
          result = installer().pause(body.operationId);
        else if (url.pathname === "/api/deployment/resume")
          result = await installer().resume(body.operationId);
        else if (url.pathname === "/api/deployment/end")
          result = installer().end(body.operationId, body.confirmation);
        else if (url.pathname === "/api/credentials/reveal")
          result = await revealCredentials(installer(), body, manager);
        else if (url.pathname === "/api/viewers/action") {
          if (body.action === "invite") result = await viewers.invite(body.name, body.displayName);
          else if (body.action === "reset") result = await viewers.reset(body.name);
          else if (body.action === "remove") result = await viewers.remove(body.name);
          else throw new Error("Unbekannte Zuschauer-Aktion.");
        } else if (url.pathname === "/api/remote-setup/start")
          result = await remoteSetup.start({ viewer: typeof body.viewer === "string" ? body.viewer : "" });
        else if (url.pathname === "/api/remote-setup/acknowledge")
          result = remoteSetup.acknowledge();
        else if (url.pathname === "/api/couchdeck/action") {
          const actions = {
            start: () => couchdeck.start(),
            stop: () => couchdeck.stop(),
            link: () => couchdeck.link(),
            install: () => couchdeck.install(false),
            "install-youtube": () => couchdeck.install(true),
            remove: () => couchdeck.remove(),
          };
          if (!Object.hasOwn(actions, body.action))
            throw new Error("Unbekannte Couchdeck-Aktion.");
          result = await actions[body.action]();
        } else if (url.pathname === "/api/managed/check")
          result = await checkManaged(installer(), body.operationId);
        else if (url.pathname === "/api/retirement/plan")
          result = await e.createPlan(body.project);
        else if (url.pathname === "/api/retirement/confirm")
          result = await e.confirm(
            body.planId,
            body.confirmation,
            body.autostartAcknowledged,
          );
        else if (url.pathname === "/api/retirement/pause")
          result = e.pause(body.operationId);
        else if (url.pathname === "/api/retirement/end")
          result = e.end(body.operationId, body.confirmation);
        else if (url.pathname === "/api/retirement/resume")
          result = await e.resume(body.operationId);
        else {
          res.writeHead(404);
          return res.end(JSON.stringify({ error: "Unbekannte Aktion." }));
        }
      } else if (url.pathname === "/api/identity") {
        const release = await readFile("/etc/os-release", "utf8").catch(
          () => "",
        );
        result = {
          username: session.username,
          suggestedDataPath: path.join(os.homedir(), "stackpilot-data"),
          host: os.hostname(),
          release: release.match(/^PRETTY_NAME="?([^"\n]+)/m)?.[1] || os.type(),
        };
      } else if (
        url.pathname === "/api/inventory" ||
        url.pathname === "/api/report"
      ) {
        pending ??= inventory().finally(() => {
          pending = null;
        });
        result = await pending;
        if (url.pathname === "/api/report") result = makeReport(result);
      } else if (url.pathname === "/api/storage") {
        result = await inspectPath(url.searchParams.get("path"));
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
    notifications.close();
    publicFunnel.close();
    oidcBackchannel.close();
    guard.close();
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
