import { reportConsent } from "./dev-report-consent.js";
import { safeRepairFailure } from "./identity/backchannel-diagnostics.js";
import { inventory } from "./inventory.js";
import { makeReport } from "./report.js";
import { readFile, mkdtemp, rm, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
const root = fileURLToPath(new URL("../../", import.meta.url));
export const repositoryUrl = "https://github.com/max-lec4000/stackpilot.git";
export async function developmentPolicy(directory = root) {
  try {
    const filename = path.join(directory, "dev-private/report-policy.json"),
      stat = await lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2048)
      return false;
    const p = JSON.parse(await readFile(filename, "utf8"));
    return (
      p.enabled === true &&
      p.repository === repositoryUrl &&
      p.branch === "main"
    );
  } catch {
    return false;
  }
}
export async function developmentUploadStatus(
  store,
  { directory = root } = {},
) {
  const policyEnabled = await developmentPolicy(directory);
  const consented = reportConsent(store);
  return {
    enabled: policyEnabled && consented,
    policyEnabled,
    consented,
    repository: repositoryUrl,
    branch: "main",
  };
}
const bool = (v) => (typeof v === "boolean" ? v : null);
// Only known typed fields: never merge arbitrary service responses, environment, logs or vault records.
export async function developmentReport(
  {
    engine,
    remote,
    sso,
    protection,
    connection,
    settings,
    serve,
    hub,
    backchannel,
  },
  collect = inventory,
) {
  const report = makeReport(await collect());
  report.schemaVersion = 2;
  try {
    report.appVersion = JSON.parse(
      await readFile(new URL("../../package.json", import.meta.url), "utf8"),
    ).version;
  } catch {
    report.appVersion = "unknown";
  }
  report.kind = "stackpilot-development-report";
  report.privacy.sharing =
    "Entwicklungsbericht für das autorisierte private Repository. Netzwerkadressen und Pfade sind enthalten; keine Geheimnisse oder vollständigen Konfigurationsdateien.";
  const sections = {};
  const read = async (name, fn, project) => {
    try {
      sections[name] = { state: "read", value: project(await fn()) };
    } catch {
      sections[name] = { state: "unconfirmed" };
    }
  };
  await read(
    "stack",
    async () => engine.current(),
    (c) =>
      c
        ? {
            planId: c.plan.id,
            selected: c.plan.spec.selected,
            mediaPath: c.plan.spec.path,
            appdataPath: c.plan.appdata,
            vpnRequested: c.plan.spec.vpn,
            ports: c.plan.ports,
            status: c.job.status,
            steps: c.job.steps.map((s) => ({
              id: s.id,
              status: s.status,
              attempts: s.attempts,
            })),
          }
        : null,
  );
  await read(
    "remote",
    () => remote.inspect(),
    (r) => ({
      hostname: r.hostname,
      serverAddresses: r.serverAddresses,
      incomingAllowed: bool(r.incomingAllowed),
      tailscaleRunning: bool(r.tailscaleRunning),
      serveKnown: bool(r.serveKnown),
      serve: r.serve
        ? {
            exclusive: bool(r.serve.exclusive),
            routes: r.serve.routes,
            public: bool(r.serve.public),
          }
        : null,
      jellyfin: r.jellyfin
        ? {
            version: r.jellyfin.version,
            quickConnect: bool(r.jellyfin.quickConnect),
            remoteAccess: bool(r.jellyfin.remoteAccess),
            remoteAdmins: r.jellyfin.remoteAdmins,
            viewers: r.jellyfin.viewers,
          }
        : null,
    }),
  );
  await read(
    "sso",
    () => sso.plan(),
    (r) => ({
      configured: r.configured,
      canApply: r.canApply,
      resuming: r.resuming,
      version: r.version,
      libraryCount: r.libraries.length,
      blockerCount: r.blockers.length,
      passwordLogin: r.passwordLogin,
    }),
  );
  await read(
    "protection",
    () => protection.status(),
    (r) => ({ verified: bool(r.verified) }),
  );
  await read(
    "authentikSettings",
    () => settings.inspect(),
    (r) => ({
      supported: bool(r.supported),
      baseUrl: ["expected", "missing", "different", "unsupported"].includes(
        r.baseUrl,
      )
        ? r.baseUrl
        : "unknown",
      avatars: r.avatars,
      changed: bool(r.changed),
    }),
  );
  await read(
    "connection",
    () => connection.inspect(),
    (r) => ({
      checkedAt: r.checkedAt,
      ready: r.ready,
      publicReady: false,
      hostname: r.hostname,
      checks: r.checks,
      network: r.network,
    }),
  );
  if (settings.security)
    await read(
      "authentikSecurity",
      () => settings.security(),
      (r) => ({
        admins: r.admins,
        viewers: r.viewers,
        mfaRequired: r.mfaRequired,
        logoutConfigured: r.logoutConfigured,
      }),
    );
  if (serve)
    await read(
      "privateRoutes",
      () => serve.config(),
      (config) => {
        const rows = [];
        for (const [hostname, v] of Object.entries(config.Web || {})) {
          for (const [route, h] of Object.entries(v.Handlers || {})) {
            const match = /^http:\/\/127\.0\.0\.1:(8096|19096|19080)$/.exec(
              h.Proxy || "",
            );
            rows.push({
              hostname,
              rootPath: route === "/",
              target: match ? h.Proxy : "other",
              public: config.AllowFunnel?.[hostname] === true,
            });
          }
        }
        return { routes: rows.slice(0, 20), truncated: rows.length > 20 };
      },
    );
  if (hub) {
    try {
      const { configurationReport } = await import("./configuration-report.js");
      sections.applications = {
        state: "read",
        value: await configurationReport(hub),
      };
    } catch {
      sections.applications = { state: "unconfirmed" };
    }
  }
  if (backchannel)
    await read(
      "oidcBackchannel",
      () =>
        backchannel.diagnostics
          ? backchannel.diagnostics()
          : backchannel.inspect(),
      (r) => ({
        configured: r.configured,
        installed: r.installed,
        verified: r.verified,
        status: r.status,
        stage: r.stage,
        lastFailure: safeRepairFailure(r.lastFailure),
        localPermissionUid: r.localPermission?.uid,
        legacyCertificateClient: r.legacyCertificateClient,
        expiresAt: r.expiresAt,
        renewalNeeded: r.renewalNeeded,
        renewalUnconfirmed: r.renewalUnconfirmed,
        publicReady: false,
      }),
    );
  report.configuration = sections;
  report.limits = [
    "Unbestätigte Abschnitte gelten nicht als erfolgreich.",
    "Kein vollständiger Konfigurationsdump, keine Passwörter, Tokens, MFA-Schlüssel, Kontolisten, Medienlisten oder Rohlogs.",
    "Keine Bestätigung persönlicher Geräte, Wiederherstellung oder öffentlicher Sicherheit.",
  ];
  return report;
}
// Separate index + commit-tree: never stage/commit the user's working tree or existing index.
export async function publishDevelopmentReport(
  report,
  { directory = root, policy = developmentPolicy, run, store } = {},
) {
  if (!(await policy(directory)))
    throw Error(
      "Entwicklungsupload ist deaktiviert. dev-private/report-policy.json prüfen.",
    );
  if (!reportConsent(store))
    throw Error(
      "Entwicklungsupload ist auf dieser Installation nicht freigegeben. Bericht bleibt lokal; Upload erst nach ausdrücklicher Auswahl aktivieren.",
    );
  if (
    report?.kind !== "stackpilot-development-report" ||
    report.schemaVersion !== 2
  )
    throw Error(
      "Nur der neu erzeugte bereinigte Entwicklungsbericht darf hochgeladen werden.",
    );
  const temporary = await mkdtemp(
    path.join(tmpdir(), "stackpilot-report-index-"),
  );
  const env = {
    ...process.env,
    GIT_INDEX_FILE: path.join(temporary, "index"),
    GIT_TERMINAL_PROMPT: "0",
  };
  const git =
    run ||
    ((args, input) =>
      new Promise((resolve, reject) => {
        const child = spawn("git", args, {
          cwd: directory,
          env,
          stdio: ["pipe", "pipe", "pipe"],
        });
        let output = "",
          tooLarge = false;
        const timer = setTimeout(() => {
          tooLarge = true;
          child.kill("SIGTERM");
        }, 30000);
        child.stdout.on("data", (v) => {
          output += v;
          if (output.length > 2e6) {
            tooLarge = true;
            child.kill("SIGTERM");
          }
        });
        child.stderr.resume();
        child.stdin.on("error", () => {});
        child.on("error", () => {
          clearTimeout(timer);
          reject(Error("Git konnte nicht gestartet werden."));
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          code || tooLarge
            ? reject(
                Error(
                  "GitHub-Upload fehlgeschlagen. Lokale Git-Berechtigung, Netzwerk und zwischenzeitliche Änderungen prüfen. Es wurden keine fremden Dateien committet.",
                ),
              )
            : resolve(output.trim());
        });
        child.stdin.end(input);
      }));
  try {
    const urls = await git(["remote", "get-url", "--all", "origin"]);
    const pushUrls = await git([
      "remote",
      "get-url",
      "--push",
      "--all",
      "origin",
    ]);
    if (urls !== repositoryUrl || pushUrls !== repositoryUrl)
      throw Error("Upload nur zum festgelegten StackPilot-Repository erlaubt.");
    await git(["fetch", "--no-tags", "origin", "refs/heads/main"]);
    const parent = await git(["rev-parse", "FETCH_HEAD"]);
    if (!/^[a-f0-9]{40,64}$/.test(parent))
      throw Error("Git-Ziel nicht eindeutig bestätigt.");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `dev-private/reports/stackpilot-diagnose-${stamp}.json`;
    const blob = await git(
      ["hash-object", "-w", "--stdin"],
      JSON.stringify(report, null, 2) + "\n",
    );
    await git(["read-tree", parent]);
    await git([
      "update-index",
      "--add",
      "--cacheinfo",
      `100644,${blob},${filename}`,
    ]);
    const tree = await git(["write-tree"]);
    const commit = await git(
      [
        "-c",
        "user.name=StackPilot Development",
        "-c",
        "user.email=stackpilot@localhost",
        "commit-tree",
        tree,
        "-p",
        parent,
      ],
      "Add sanitized development diagnostics\n",
    );
    // Fast-forward only. A concurrent change is rejected; never force-push report history.
    await git(["push", "origin", `${commit}:refs/heads/main`]);
    return {
      ok: true,
      file: filename,
      commit,
      url: `https://github.com/max-lec4000/stackpilot/blob/${commit}/${filename}`,
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
