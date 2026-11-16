/* Frontend-only regression scenarios. Every /api request is intercepted. */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require(
  process.env.STACKPILOT_PLAYWRIGHT_MODULE || "playwright",
);

const baseURL = process.env.STACKPILOT_TEST_URL || "http://stackpilot.localhost:5173";
const output = process.env.STACKPILOT_TEST_OUTPUT || "/tmp/stackpilot-ux-0.3.0";
const now = "2026-11-10T15:30:00.000Z";
const GiB = 1024 ** 3;
const sourcePoster =
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="#5a3c76"/><circle cx="100" cy="110" r="48" fill="#ecc4a2"/><path d="M20 270L100 160L180 270Z" fill="#a49ac6"/></svg>';

const torrent = (id, state, progress, name) => ({
  id,
  name,
  state,
  progress,
  size: 6 * GiB,
  downloaded: 6 * GiB * progress,
  downloadRate: state === "downloading" ? 3 * 1024 ** 2 : 0,
  uploadRate: state === "uploading" ? 128 * 1024 : 0,
  etaSeconds: state === "downloading" ? 720 : null,
});
const initialTorrents = [
  torrent("a".repeat(40), "downloading", 0.46, "Testfilm – aktiver Download"),
  torrent("b".repeat(40), "uploading", 1, "Testfilm – vollständig"),
  torrent("d".repeat(40), "queuedUP", 1, "Testfilm – Upload wartet"),
  torrent("e".repeat(40), "stalledUP", 1, "Testfilm – zum Teilen bereit"),
  torrent("c".repeat(40), "pausedDL", 0.23, "Testfilm – pausiert"),
  ...Array.from({ length: 22 }, (_, i) =>
    torrent(String(i + 1).padStart(40, "0"), "queuedDL", 0.05, "Warteschlange " + (i + 1)),
  ),
];
const media = Array.from({ length: 18 }, (_, i) => ({
  id: 100 + i,
  type: i === 1 ? "tv" : "movie",
  title: i === 1 ? "Testserie" : "Testfilm " + String(i + 1).padStart(2, "0"),
  year: "2026",
  overview: "Ausführliche Beschreibung nur in der Detailansicht. ".repeat(8),
  poster: "/fixture-" + i + ".jpg",
  status: i === 2 ? 5 : 1,
  requested: false,
}));
const initialRequests = [
  { id: 1, mediaId: 100, type: "movie", title: "Aktiver Medienwunsch", poster: "/active.jpg", state: "downloading", createdAt: now, seasons: [], progress: 0.46, tracking: "radarr", sizeBytes: 6 * GiB, downloadedBytes: 2.76 * GiB, jellyfinAvailable: false },
  { id: 2, mediaId: 102, type: "movie", title: "Verfügbarer Medienwunsch", poster: "/available.jpg", state: "available", createdAt: now, seasons: [], progress: 1, tracking: "radarr", sizeBytes: 6 * GiB, downloadedBytes: 6 * GiB, jellyfinAvailable: true },
  { id: 3, mediaId: 103, type: "movie", title: "Wartender Medienwunsch", poster: "/waiting.jpg", state: "waiting", createdAt: now, seasons: [], progress: null, tracking: "radarr", sizeBytes: null, downloadedBytes: null, jellyfinAvailable: false },
  { id: 4, mediaId: 101, type: "tv", title: "Serienwunsch", poster: "/series.jpg", state: "library-sync", createdAt: now, seasons: [1], progress: null, tracking: "sonarr", sizeBytes: 10 * GiB, downloadedBytes: 10 * GiB, jellyfinAvailable: false },
];
const services = ["Jellyfin", "qBittorrent", "Radarr", "Sonarr", "Prowlarr", "Bazarr"].map((name, i) => ({
  operationId: "operation-fixture",
  planId: "plan-fixture",
  name,
  slug: name.toLowerCase(),
  hostPort: i === 0 ? 8096 : 8000 + i,
  url: "http://127.0.0.1:" + (i === 0 ? 8096 : 8000 + i),
  state: i === 5 ? "exited" : "running",
  installationStatus: "completed",
  image: "fixture.invalid/private/image-" + i + "@sha256:" + "f".repeat(64),
  username: "managed-private-user",
}));

function fixture() {
  return {
    torrents: initialTorrents.map((t) => ({ ...t })),
    requests: initialRequests.map((r) => ({ ...r })),
    archived: [],
    seriesLimits: { episodeGiB: 0, packageGiB: 0 },
    requested: new Set(),
    consent: false,
    vpnState: "connected",
    failures: new Set(),
    empty: new Set(),
    mutations: [],
    unexpected: [],
    waitDownloads: null,
    waitCredentials: null,
    stackStatus: "completed",
    funnelBlocked: true,
    funnelActive: false,
    viewerSetup: false,
    viewer: { username: "constructor", active: true, mfa: true, profileId: null, passkeyPending: false },
    viewerProfiles: [],
  };
}

function vpn(f) {
  return {
    state: f.vpnState,
    reason: f.vpnState === "connected" ? "Geprüfter Testausgang; geschütztes VPN-Netz." : "VPN-Nachweis fehlt; Downloads gesperrt.",
    checkedAt: now,
    enforced: true,
  };
}
function activity(f) {
  return {
    configured: true,
    observedAt: now,
    installationStatus: "completed",
    vpn: vpn(f),
    jellyfin: {
      state: "ready",
      sessions: [
        { id: "playback-1", user: "Zuschauer", device: "Testgerät", title: "Testfilm läuft", series: "", state: "playing", progress: 0.4, transcode: false },
        { id: "playback-2", user: "Zuschauer", device: "Tablet", title: "", series: "", state: "idle", progress: null, transcode: false },
      ],
    },
    downloads: {
      state: "ready", torrents: f.torrents.slice(0, 3), count: f.torrents.length, queued: f.torrents.filter((t) => t.state === "queuedDL").length,
      downloadRate: 3 * 1024 ** 2, uploadRate: 128 * 1024,
    },
    arr: [{ service: "Radarr", state: "ready", queued: 1 }, { service: "Sonarr", state: "ready", queued: 0 }, { service: "Lidarr", state: "not-installed", queued: null }],
  };
}

async function mockAPI(page, f) {
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const endpoint = url.pathname;
    const method = req.method();
    const body = method === "GET" ? null : req.postDataJSON();
    if (method !== "GET") f.mutations.push({ endpoint, body });
    if (endpoint === "/api/media/poster") {
      await route.fulfill({ contentType: "image/svg+xml", body: sourcePoster });
      return;
    }
    if (f.failures.has(endpoint)) {
      await route.fulfill({ status: 503, json: { error: "Testdienst ist gerade nicht erreichbar." } });
      return;
    }
    let json;
    switch (endpoint) {
      case "/api/couchdeck": json = { installed: true, state: "running", version: "0.2.0", outdated: true, controllable: true, linked: { user: "wohnzimmer", seerr: true }, helper: { available: true, running: null, failed: null } }; break;
      case "/api/remote-setup": json = { status: f.viewerSetup ? "completed" : "idle", running: false, steps: [], error: null, result: null }; break;
      case "/api/viewers/action":
      case "/api/viewers":
        if (body) f.viewer.passkeyPending = body.action === "add-passkey";
        json = { viewers: [f.viewer], addPasskeyReady: true, loginImproved: true, passwordChoice: true, recoveryEnabled: true };
        break;
      case "/api/viewer-profiles":
        if (body?.action === "create") f.viewerProfiles.push({ id: "series", name: body.name, folders: body.folders });
        if (body?.action === "assign") f.viewer.profileId = body.profileId;
        json = { ready: true, pending: null, profiles: f.viewerProfiles, libraries: [{ id: "series-folder", name: "Serien", available: true }] };
        break;
      case "/api/notifications": json = { results: [], unread: 0, checkedAt: now, error: null }; break;
      case "/api/auth/status": json = { configured: true, authenticated: true, username: "fixture" }; break;
      case "/api/session": json = { token: "fixture-csrf" }; break;
      case "/api/identity": json = { host: "testserver", release: "Ubuntu 24.04", username: "fixture" }; break;
      case "/api/inventory": json = { observedAt: now, host: "testserver", release: "Ubuntu 24.04", cpuCount: 4, memoryBytes: 8 * GiB, docker: { available: true, version: "test", reason: null }, compose: { available: true, version: "test", reason: null }, containerScanComplete: true, containers: [], mounts: [], listening: [], issues: [], limitations: [] }; break;
      case "/api/catalog": json = { services: Object.fromEntries(services.map((s) => [s.name, { installable: true }])) }; break;
      case "/api/stack": json = f.stackStatus === null ? {} : { status: f.stackStatus, spec: { selected: services.map((s) => s.name), quality: "1080p", path: "/data", username: "fixture", language: "Deutsch", vpn: true } }; break;
      case "/api/operations": json = { operations: [] }; break;
      case "/api/sources": json = { schemas: [], sources: [], connections: [], issues: [], note: "Keine Quellen in diesem Test eingerichtet." }; break;
      case "/api/media/size-settings": json = { rate: 3, rates: [1, 2, 3, 4, 6, 8], scope: "Größenstandard für neue Filme." }; break;
      case "/api/safety": json = { operations: [] }; break;
      case "/api/audit": json = { page: 1, pages: 1, total: 0, events: [] }; break;
      case "/api/container-maintenance": json = { services: [{ name: "Seerr", from: "ghcr.io/example@sha256:0123456789abcdef",
        to: "ghcr.io/example@sha256:123456789abcdef0", review: "fixture-maintenance", update: true, rollback: false, phase: null }] }; break;
      case "/api/vault-backup":
        if (method === "GET") json = { local: true };
        else {
          assert.equal(body.passphrase, "fixture-local-backup-phrase");
          await route.fulfill({ contentType: "application/octet-stream", body: "fixture-encrypted-vault" });
          return;
        }
        break;
      case "/api/managed": json = { services: f.empty.has(endpoint) ? [] : services }; break;
      case "/api/operations/overview":
        json = {
          observedAt: now, phase: "operation",
          tasks: [{ id: "notice-fixture", state: "attention", title: "Ein Dienst ist gestoppt", reason: "Bazarr läuft gerade nicht.", action: "Anwendungen prüfen", target: "applications" }],
          storage: { state: "healthy", freeBytes: 120 * GiB, totalBytes: 500 * GiB },
          applications: services.map((s) => ({ name: s.name, state: s.state })),
        };
        break;
      case "/api/activity": json = activity(f); break;
      case "/api/downloads/list": {
        if (f.waitDownloads) await f.waitDownloads;
        let list = f.empty.has(endpoint) ? [] : f.torrents;
        const filter = url.searchParams.get("filter") || "all";
        if (filter === "completed") list = list.filter((t) => t.progress >= 1);
        if (filter === "active") list = list.filter((t) => t.progress < 1 && !/paused|stopped/.test(t.state));
        if (filter === "paused") list = list.filter((t) => /paused|stopped/.test(t.state));
        const pageNumber = Number(url.searchParams.get("page") || 1);
        const needle = (url.searchParams.get("query") || "").trim().toLowerCase();
        if (needle) list = list.filter((torrent) => torrent.name.toLowerCase().includes(needle));
        json = { configured: true, total: needle ? list.length : null, torrents: list.slice((pageNumber - 1) * 8, pageNumber * 8), hasMore: pageNumber * 8 < list.length, vpn: vpn(f), downloadRate: 3 * 1024 ** 2, uploadRate: 128 * 1024 };
        break;
      }
      case "/api/downloads/action":
        assert.equal(method, "POST");
        assert.ok(["pause", "resume", "remove"].includes(body.action));
        if (body.action === "remove") assert.equal(body.confirmation, "OK");
        if (body.action === "pause") f.torrents = f.torrents.map((t) => t.id === body.hash ? { ...t, state: "pausedDL" } : t);
        if (body.action === "resume") f.torrents = f.torrents.map((t) => t.id === body.hash ? { ...t, state: "downloading" } : t);
        if (body.action === "remove") f.torrents = f.torrents.filter((t) => t.id !== body.hash);
        json = { complete: true };
        break;
      case "/api/downloads/resume": json = { complete: true }; break;
      case "/api/credentials/reveal":
        if (f.waitCredentials) await f.waitCredentials;
        json = { username: "managed-private-user", password: "FIXTURE-SECRET" };
        break;
      case "/api/credentials/rotate-sonarr":
      case "/api/credentials/rotate-radarr":
        json = { ok: true };
        break;
      case "/api/media/search":
        json = { results: f.empty.has(endpoint) ? [] : media.map((m) => ({ ...m, requested: f.requested.has(m.id) })), totalPages: 2 };
        break;
      case "/api/media/detail": {
        const item = media.find((m) => m.id === Number(url.searchParams.get("id")));
        json = { ...item, requested: f.requested.has(item.id), runtime: 120, sizeDefaultRate: 3, seasons: item.type === "tv" ? [{ number: 1, name: "Staffel 1", episodes: 8, requested: false, available: false }, { number: 2, name: "Staffel 2", episodes: 10, requested: false, available: false }, { number: 3, name: "Staffel 3", episodes: 6, requested: true, available: false }] : [] };
        break;
      }
      case "/api/media/request": f.requested.add(body.id); json = {}; break;
      case "/api/media/episode-seasons": json = { seasons: [1], limits: f.seriesLimits }; break;
      case "/api/media/series-limits":
        assert.equal(body.requestId, 4);
        assert.equal(body.confirmation, "OK");
        f.seriesLimits = { episodeGiB: body.episodeGiB, packageGiB: body.packageGiB,
          ...(body.automatic ? { automatic: true, previousProfile: "Testprofil" } : {}) };
        json = { limits: f.seriesLimits };
        break;
      case "/api/media/requests": {
        let list = f.empty.has(endpoint) ? [] : f.requests;
        const filter = url.searchParams.get("filter");
        const kind = url.searchParams.get("type");
        if (filter === "completed") list = list.filter((r) => r.state === "available");
        if (filter === "active") list = list.filter((r) => r.state !== "available");
        if (filter === "failed") list = [];
        if (kind !== "all" && kind) list = list.filter((r) => r.type === kind);
        json = { results: list, unavailable: [], total: list.length, page: 1, pages: 1, pageSize: 10 };
        break;
      }
      case "/api/media/request-action": json = { requestId: Number(url.searchParams.get("requestId")), review: "review-fixture", title: "Medienwunsch", canCancel: true, blockers: [], message: "Download und Überwachung werden für diese Anfrage beendet." }; break;
      case "/api/media/request/cancel":
        assert.equal(body.confirmation, "OK");
        f.requests = f.requests.filter((r) => r.id !== body.requestId);
        json = {};
        break;
      case "/api/media/request/archive":
        if (body.restore) {
          f.archived = f.archived.filter((r) => r.id !== body.requestId);
          f.requests.push(initialRequests.find((r) => r.id === body.requestId));
        } else {
          const item = f.requests.find((r) => r.id === body.requestId);
          if (item) f.archived.push({ ...item, cancelled: false, updatedAt: now });
          f.requests = f.requests.filter((r) => r.id !== body.requestId);
        }
        json = {};
        break;
      case "/api/media/archive": json = { results: f.archived, page: 1, pages: 1, total: f.archived.length }; break;
      case "/api/media/quality": json = method === "GET" ? { runtime: 120, sizePolicy: null, service: "Radarr", kind: "movie", currentProfileId: 1, defaultProfileId: 1, hasFile: false, canSetDefault: true, canCreateCompact: true, profiles: [{ id: 1, name: "HD-1080p", allowed: ["Bluray-1080p", "Remux-1080p"] }, { id: 2, name: "1080p ohne Remux", allowed: ["Bluray-1080p"] }], ...f.quality } : { message: "Qualität gespeichert.", currentProfileId: 2 }; break;
      case "/api/media/movie-removal/preview": json = { id: "removal-fixture", chosen: [], started: false, title: "Verfügbarer Medienwunsch", size: 6 * GiB, hasFile: true, message: "Die importierte Datei wird entfernt.", downloadWarning: null, downloads: [] }; break;
      case "/api/media/movie-removal/execute":
        assert.equal(body.confirmation, "OK");
        json = { complete: true, message: "Testdatei entfernt." };
        break;
      case "/api/media/library/refresh": json = { message: "Bibliotheksabgleich gestartet." }; break;
      case "/api/remote-access/journey": {
        const ids = ["server", "identity", "accounts", "protection", "sso", "https", "access", "public"];
        json = { observedAt: now, evidence: "saved-configuration", publicReady: false, nextSuggested: "server", steps: ids.map((id) => ({ id, status: "unknown", configured: false, resumable: false, missingPrerequisites: [], message: "Gespeicherter Stand ersetzt keinen Gerätetest." })) };
        break;
      }
      case "/api/remote-access": json = { checkedAt: now, hostname: "testserver.example.ts.net", serverAddresses: ["100.90.1.8"], target: "http://127.0.0.1:8096", tailscaleRunning: true, publicReady: false, checks: [{ name: "Tailscale", state: "ok", message: "Server online." }] }; break;
      case "/api/remote-access/funnel": json = {
        ready: !f.funnelBlocked, review: "fixture-review", active: f.funnelActive,
        complete: f.funnelActive, canDisable: f.funnelActive,
        blockers: f.funnelBlocked ? ["MFA-Prüfung noch offen."] : [],
        routes: [{name: "Jellyfin", url: "https://testserver.example.ts.net"}],
      }; break;
      case "/api/remote-access/funnel/enable":
      case "/api/remote-access/funnel/disable":
        assert.equal(body.confirmation, "OK");
        assert.equal(body.password, "FIXTURE-ONLY");
        if (endpoint.endsWith("/enable")) {
          assert.equal(body.review, "fixture-review");
          for (const key of ["browserMfa", "quickConnect", "playback", "revocation", "recovery"])
            assert.equal(body.acceptance[key], true);
        }
        f.funnelActive = endpoint.endsWith("/enable");
        json = {ok: true, message: "Teständerung bestätigt."}; break;
      case "/api/remote-access/identity": json = { prepared: false }; break;
      case "/api/remote-access/backups": json = {backups: [], maintenance: {needsResume: false}}; break;
      case "/api/remote-access/protection": json = { prepared: false, running: false }; break;
      case "/api/remote-access/private-serve": json = { review: "fixture", ready: false, routesReady: false, routes: [], message: "Privater Stand.", connection: { ready: false, checks: [] } }; break;
      case "/api/remote-access/sso": json = { review: "fixture", canApply: true, configured: false, version: "12.4.0", hostname: "testserver.example.ts.net", libraries: [{ id: "a".repeat(32), name: "Filme" }], blockers: [], message: "Privates Profil." }; break;
      case "/api/development/status": json = { enabled: f.consent, consented: f.consent, policyEnabled: true }; break;
      default:
        f.unexpected.push(method + " " + endpoint);
        await route.fulfill({ status: 501, json: { error: "Nicht definierte Test-API: " + endpoint } });
        return;
    }
    await route.fulfill({ json });
  });
}

async function navigate(page, title) {
  await page.getByRole("navigation", { name: "Hauptnavigation" }).getByRole("link", { name: title, exact: true }).click();
}
async function onlyRow(page, title) {
  const row = page.getByRole("article", { name: title, exact: true });
  await row.waitFor();
  return row;
}
async function noPageOverflow(page, context) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Horizontal page overflow: " + context);
}
async function screenshot(page, name) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(output, name + ".png") });
}
async function post(page, endpoint, interact) {
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === endpoint),
    interact(),
  ]);
}

async function run() {
  await fs.mkdir(output, { recursive: true });
  await fs.rm(path.join(output, "failure.png"), { force: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.clock.install({ time: new Date(now) });
  const f = fixture();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.setDefaultTimeout(7000);
  await mockAPI(page, f);
  try {
    await page.goto(baseURL);
    await page.getByRole("navigation", { name: "Hauptnavigation" }).waitFor();
    await page.locator(".dashboard").waitFor();
    assert.match(await page.locator(".dashboard").innerText(), /120/);
    assert.match(await page.locator(".dashboard").innerText(), /VPN/);
    assert.equal(f.mutations.length, 0, "Loading dashboard must not mutate services");
    await screenshot(page, "dashboard-dark-desktop");

    // Application rows do not reveal private login/image information by default.
    await navigate(page, "Anwendungen");
    await page.locator(".service-list-row").filter({ hasText: "Jellyfin" }).waitFor();
    const couchdeckRow = page.locator(".services-list > .service-list-row").filter({ hasText: "Couchdeck" });
    await couchdeckRow.getByText("Läuft", { exact: true }).waitFor();
    await page.getByLabel("App suchen", { exact: true }).fill("Couchdeck");
    assert.equal(await page.locator(".service-list-row").count(), 1);
    await couchdeckRow.getByRole("button", { name: "Details zu Couchdeck" }).click();
    const couchdeckDetails = page.getByRole("dialog", { name: "Couchdeck" });
    await couchdeckDetails.getByRole("button", { name: "Couchdeck schließen" }).waitFor();
    await couchdeckDetails.getByRole("button", { name: "Auf neue Version aktualisieren" }).waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await couchdeckRow.getByRole("button").evaluate((element) => element === document.activeElement), true);
    await page.getByLabel("App suchen", { exact: true }).fill("");
    assert.equal(await page.getByText("managed-private-user", { exact: true }).count(), 0);
    assert.equal(await page.getByText(services[0].image, { exact: true }).count(), 0);
    // Component-specific selectors below are kept stable by the view's accessible names.
    const appRow = page.locator(".service-list-row").filter({ hasText: "Jellyfin" });
    await appRow.getByRole("button", { name: /Details/ }).click();
    const appDialog = page.getByRole("dialog");
    await appDialog.waitFor();
    assert.match(await appDialog.innerText(), /Jellyfin/);
    await appDialog.getByRole("button", { name: /Zugang geschützt anzeigen/ }).click();
    assert.equal(f.mutations.length, 0, "Opening app details and login form must not reveal credentials");
    const credentialDialog = page.getByRole("dialog");
    await credentialDialog.getByLabel("Administratorpasswort", { exact: true }).fill("fixture-password");
    await post(page, "/api/credentials/reveal", () => credentialDialog.getByRole("button", { name: "Zugang anzeigen", exact: true }).click());
    await credentialDialog.getByText("FIXTURE-SECRET", { exact: true }).waitFor();
    assert.equal(f.mutations.filter((m) => m.endpoint === "/api/credentials/reveal").length, 1);
    await page.keyboard.press("Escape");
    assert.equal(await page.getByText("FIXTURE-SECRET", { exact: true }).count(), 0);
    assert.equal(await appRow.getByRole("button", { name: /Details/ }).evaluate((element) => element === document.activeElement), true, "Escape restores app detail trigger");
    await page.getByLabel("App suchen", { exact: true }).fill("Jellyfin");
    assert.equal(await page.locator(".service-list-row").count(), 1);
    await page.getByLabel("App suchen", { exact: true }).fill("");
    await page.locator(".services-toolbar").getByRole("combobox").selectOption("other");
    assert.equal(await page.locator(".service-list-row").count(), 1);
    await page.locator(".services-toolbar").getByRole("combobox").selectOption("all");
    // A late response after closing a password panel must never resurrect secrets.
    await appRow.getByRole("button", { name: /Details/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Zugang geschützt anzeigen", exact: true }).click();
    await page.getByRole("dialog").getByLabel("Administratorpasswort", { exact: true }).fill("fixture-password");
    let releaseCredentials;
    f.waitCredentials = new Promise((resolve) => { releaseCredentials = resolve; });
    const lateReply = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/credentials/reveal");
    await Promise.all([
      page.waitForRequest((request) => new URL(request.url()).pathname === "/api/credentials/reveal"),
      page.getByRole("dialog").getByRole("button", { name: "Zugang anzeigen", exact: true }).click(),
    ]);
    await page.keyboard.press("Escape");
    releaseCredentials();
    await lateReply;
    f.waitCredentials = null;
    assert.equal(await page.getByText("FIXTURE-SECRET", { exact: true }).count(), 0);

    for (const service of ["Sonarr", "Radarr"]) {
      await page.getByRole("button", { name: "Details zu " + service, exact: true }).click();
      const details = page.getByRole("dialog");
      await details.getByText(service + "-API-Schlüssel erneuern", { exact: true }).click();
      const button = details.getByRole("button", { name: "API-Schlüssel erneuern", exact: true });
      assert(await button.isDisabled());
      const password = details.getByLabel("StackPilot-Administratorpasswort", { exact: true });
      await password.fill("fixture-password");
      await post(page, "/api/credentials/rotate-" + service.toLowerCase(), () => button.click());
      assert.deepEqual(f.mutations.at(-1).body, { planId: "plan-fixture", password: "fixture-password", confirmation: "OK" });
      await details.getByRole("status").filter({ hasText: service + " akzeptiert den neuen Schlüssel" }).waitFor();
      assert.equal(await password.inputValue(), "");
      await page.keyboard.press("Escape");
    }

    // Download actions depend on the actual state. Completed rows have no bar.
    await navigate(page, "Downloads");
    await page.locator(".downloads-view").waitFor();
    await page.getByLabel("Downloadfilter", { exact: true }).selectOption("completed");
    const completed = await onlyRow(page, "Testfilm – vollständig");
    await completed.getByText("Lädt hoch", { exact: true }).waitFor();
    await (await onlyRow(page, "Testfilm – Upload wartet")).getByText("Upload in Warteschlange", { exact: true }).waitFor();
    await (await onlyRow(page, "Testfilm – zum Teilen bereit")).getByText("Bereit zum Teilen", { exact: true }).waitFor();
    assert.equal(await completed.getByRole("progressbar").count(), 0);
    assert.equal(await completed.getByRole("button", { name: "Geschützt fortsetzen", exact: true }).count(), 0);
    await completed.getByText("Weitere Aktionen", { exact: true }).click();
    let before = f.mutations.length;
    page.once("dialog", (dialog) => dialog.dismiss());
    await completed.getByRole("button", { name: "Entfernen · Dateien behalten", exact: true }).click();
    assert.equal(f.mutations.length, before, "Dismissing removal must not post");
    page.once("dialog", (dialog) => dialog.accept());
    await post(page, "/api/downloads/action", () => completed.getByRole("button", { name: "Entfernen · Dateien behalten", exact: true }).click());
    await page.waitForFunction(() => !document.querySelector('[aria-label="Testfilm – vollständig"]'));
    assert.equal(f.mutations.at(-1).body.deleteFiles, false);
    await page.getByLabel("Downloadfilter", { exact: true }).selectOption("paused");
    const paused = await onlyRow(page, "Testfilm – pausiert");
    assert.equal(await paused.getByRole("button", { name: "Pausieren", exact: true }).count(), 0);
    await post(page, "/api/downloads/action", () => paused.getByRole("button", { name: "Geschützt fortsetzen", exact: true }).click());
    assert.equal(f.mutations.at(-1).body.action, "resume");
    await page.getByLabel("Downloadfilter", { exact: true }).selectOption("all");
    await page.getByLabel("Alle Downloads durchsuchen", { exact: true }).fill("aktiver Download");
    const active = await onlyRow(page, "Testfilm – aktiver Download");
    await post(page, "/api/downloads/action", () => active.getByRole("button", { name: "Pausieren", exact: true }).click());
    assert.equal(f.mutations.at(-1).body.action, "pause");
    await active.getByText("Weitere Aktionen", { exact: true }).click();
    before = f.mutations.length;
    page.once("dialog", (dialog) => dialog.dismiss());
    await active.getByRole("button", { name: "Download-Dateien löschen", exact: true }).click();
    assert.equal(f.mutations.length, before);
    await page.getByLabel("Alle Downloads durchsuchen", { exact: true }).fill("");
    const downloadPages = page.getByRole("navigation", { name: "Downloadseiten", exact: true });
    await downloadPages.getByRole("button", { name: "Weiter →", exact: true }).click();
    await downloadPages.getByText("Seite 2", { exact: true }).waitFor();
    assert.ok(await page.locator(".download-row").count() <= 8);
    await downloadPages.getByRole("button", { name: "← Zurück", exact: true }).click();
    await downloadPages.getByText("Seite 1", { exact: true }).waitFor();
    await screenshot(page, "downloads-dark-desktop");

    // Poster discovery is bounded and descriptions remain in the detail view.
    await navigate(page, "Medien entdecken");
    await page.getByPlaceholder("Film oder Serie suchen …").fill("Test");
    await page.getByRole("button", { name: "Suchen", exact: true }).click();
    await page.locator(".media-card").first().waitFor();
    assert.equal(await page.locator(".media-card").count(), 12);
    assert.equal(await page.locator(".media-card").first().getByText(/Ausführliche Beschreibung/).count(), 0);
    const firstMedia = page.locator(".media-card").filter({ hasText: "Testfilm 01" });
    await firstMedia.getByRole("button", { name: "Details zu Testfilm 01", exact: true }).focus();
    await page.keyboard.press("Enter");
    let mediaDialog = page.getByRole("dialog", { name: "Testfilm 01", exact: true });
    await mediaDialog.waitFor();
    await mediaDialog.getByLabel("Qualität und Größe für diese Anfrage").selectOption("3");
    await mediaDialog.getByRole("button", { name: "Jetzt anfragen", exact: true }).click();
    await mediaDialog.waitFor({ state: "hidden" });
    await page.getByRole("status").filter({ hasText: /Anfrage angelegt/ }).waitFor();
    assert.equal(f.mutations.at(-1).endpoint, "/api/media/request");
    assert.equal(f.mutations.at(-1).body.sizeGiBPerHour, 3);
    const tvMedia = page.locator(".media-card").filter({ hasText: "Testserie" });
    await tvMedia.getByRole("button", { name: "Details zu Testserie", exact: true }).click();
    mediaDialog = page.getByRole("dialog", { name: "Testserie", exact: true });
    await mediaDialog.getByLabel(/Staffel 1/).check();
    await mediaDialog.getByRole("button", { name: "Jetzt anfragen", exact: true }).click();
    await mediaDialog.waitFor({ state: "hidden" });
    assert.deepEqual(f.mutations.at(-1).body.seasons, [1]);
    await screenshot(page, "discovery-dark-desktop");

    // Request status and actions remain reachable, with direct navigation links.
    await navigate(page, "Meine Anfragen");
    await page.getByRole("button", { name: "Details zu Aktiver Medienwunsch", exact: true }).click();
    await page.getByRole("dialog", { name: "Aktiver Medienwunsch", exact: true }).waitFor();
    f.requests = f.requests.filter((request) => request.id !== 1);
    await page.clock.fastForward(31000);
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    f.requests.push({ ...initialRequests[0] });
    await page.clock.fastForward(31000);
    await page.getByText("Aktiver Medienwunsch", { exact: true }).waitFor();
    assert.equal(await page.getByRole("dialog").count(), 0, "A request returning after refresh must not reopen its old panel");
    await page.getByRole("button", { name: "Details zu Aktiver Medienwunsch", exact: true }).click();
    await page.getByRole("dialog", { name: "Aktiver Medienwunsch", exact: true }).waitFor();
    f.failures.add("/api/media/requests");
    await page.clock.fastForward(31000);
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page.getByRole("alert").waitFor();
    f.failures.delete("/api/media/requests");
    await page.clock.fastForward(31000);
    await page.getByText("Aktiver Medienwunsch", { exact: true }).waitFor();
    assert.equal(await page.getByRole("dialog").count(), 0, "Recovering from a failed refresh must not reopen the old panel");
    await page.getByText("Aktiver Medienwunsch", { exact: true }).waitFor();
    const availableRequest = page.locator(".request-compact").filter({ hasText: "Verfügbarer Medienwunsch" });
    assert.equal(await availableRequest.getByRole("progressbar").count(), 0);
    const jellyfin = availableRequest.getByRole("link", { name: /Jellyfin/ });
    assert.equal(await jellyfin.getAttribute("href"), new URL(services[0].url).href);
    const activeRequest = page.locator(".request-compact").filter({ hasText: "Aktiver Medienwunsch" });
    await activeRequest.getByRole("button", { name: /Downloads/ }).click();
    assert.match(page.url(), /#\/downloads/);
    await navigate(page, "Meine Anfragen");
    await page.getByRole("button", { name: "Details zu Serienwunsch", exact: true }).click();
    const seriesDialog = page.getByRole("dialog", { name: "Serienwunsch" });
    await seriesDialog.getByText("Größenlimits für diese Serie", { exact: true }).click();
    const automatic = seriesDialog.getByRole("checkbox", { name: "Auch automatische Downloads in Sonarr begrenzen" });
    assert.equal(await automatic.isChecked(), false);
    await seriesDialog.getByLabel("Folgenrelease (GiB)").fill("2");
    await seriesDialog.getByLabel("Je Staffelpaket (GiB)").fill("10");
    await automatic.check();
    const saveLimits = () => seriesDialog.getByRole("button", { name: "Größenlimits speichern", exact: true }).click();
    await post(page, "/api/media/series-limits", saveLimits);
    assert.deepEqual(f.mutations.at(-1).body, { requestId: 4, automatic: true, episodeGiB: 2, packageGiB: 10, confirmation: "OK" });
    await seriesDialog.getByText(/Für die Rückkehr zu „Testprofil“/).waitFor();
    await automatic.uncheck();
    await post(page, "/api/media/series-limits", saveLimits);
    await seriesDialog.getByText(/Bisheriges Sonarr-Profil wieder aktiv/).waitFor();
    assert.deepEqual(f.seriesLimits, { episodeGiB: 2, packageGiB: 10 });
    await page.keyboard.press("Escape");
    const waitingRequest = page.locator(".request-compact").filter({ hasText: "Wartender Medienwunsch" });
    await waitingRequest.getByRole("button", { name: "Details zu Wartender Medienwunsch", exact: true }).click();
    f.quality = { runtime: 155, sizePolicy: { rate: 2, capGiB: 5.5 }, fileSize: 6 * GiB, hasFile: true };
    await page.getByRole("button", { name: "Qualität ändern", exact: true }).click();
    await page.getByLabel("Neues Qualitätsprofil", { exact: true }).waitFor();
    await page.getByText(/Aktive Größenregel: 2 GiB\/h · höchstens 5,5 GiB/).waitFor();
    await page.getByText(/6 GiB\) überschreitet die Grenze/).waitFor();
    await page.getByLabel("Größenregel für diesen Film", { exact: true }).selectOption("3");
    await page.getByText(/6 GiB\) liegt innerhalb der Grenze von 8 GiB/).waitFor();
    await page.getByRole("button", { name: "Qualität schließen", exact: true }).click();
    f.quality.sizePolicy = { capGiB: 7 };
    await page.getByRole("button", { name: "Qualität ändern", exact: true }).click();
    await page.getByText(/Aktive Größenregel: höchstens 7 GiB/).waitFor();
    await page.getByRole("button", { name: "Qualität schließen", exact: true }).click();
    delete f.quality;
    await page.getByRole("button", { name: "Anfrage abbrechen …", exact: true }).click();
    before = f.mutations.length;
    await page.getByRole("button", { name: "OK – Anfrage abbrechen", exact: true }).waitFor();
    assert.equal(f.mutations.length, before, "Preview alone must not cancel");
    await post(page, "/api/media/request/cancel", () => page.getByRole("button", { name: "OK – Anfrage abbrechen", exact: true }).click());
    assert.equal(f.mutations.at(-1).body.confirmation, "OK");
    await page.keyboard.press("Escape");
    const removable = page.locator(".request-compact").filter({ hasText: "Verfügbarer Medienwunsch" });
    await removable.getByRole("button", { name: "Details zu Verfügbarer Medienwunsch", exact: true }).click();
    await page.getByRole("button", { name: "Film löschen", exact: true }).click();
    const deleteButton = page.getByRole("button", { name: "Film und ausgewählte Dateien löschen", exact: true });
    await deleteButton.waitFor();
    assert.equal(await deleteButton.isDisabled(), true);
    await page.getByLabel("Löschung bestätigen", { exact: true }).fill("OK");
    assert.equal(await deleteButton.isEnabled(), true);
    // The destructive endpoint stays untouched; test guard reachability only.
    assert.equal(f.mutations.filter((m) => m.endpoint === "/api/media/movie-removal/execute").length, 0);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Details zu Aktiver Medienwunsch", exact: true }).click();
    await post(page, "/api/media/request/archive", () => page.getByRole("button", { name: "Archivieren", exact: true }).click());
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Archiv", exact: true }).click();
    await page.getByRole("heading", { name: "Archivierte und abgebrochene Anfragen", exact: true }).waitFor();
    await page.getByRole("heading", { name: "Aktiver Medienwunsch", exact: true }).waitFor();
    await post(page, "/api/media/request/archive", () => page.getByRole("button", { name: "Zurück zu den Anfragen", exact: true }).click());
    assert.equal(f.mutations.at(-1).body.restore, true);

    // Administration opens its landing page, then an addressable subpage.
    await navigate(page, "Verwaltung");
    await page.getByRole("heading", { name: "Was möchtest du erledigen?", exact: true }).waitFor();
    assert.equal(await page.locator(".administration-panel").count(), 0);
    before = f.mutations.length;
    await page.getByRole("button", { name: /Externer Zugriff/ }).click();
    assert.match(page.url(), /#\/verwaltung\/remote/);
    const remoteSetup = page.getByRole("button", { name: "In einem Schritt einrichten", exact: true });
    await remoteSetup.waitFor();
    assert.equal(f.mutations.length, before, "Navigation must not set up or publish services");
    await page.getByRole("button", {name: "Freigabe und Voraussetzungen prüfen", exact: true}).click();
    await page.getByText("MFA-Prüfung noch offen.", {exact: true}).waitFor();
    assert.equal(await page.getByRole("button", {name: "Jellyfin und Anmeldung öffentlich freigeben", exact: true}).count(), 0);
    f.funnelBlocked = false;
    await page.getByRole("button", {name: "Freigabe und Voraussetzungen prüfen", exact: true}).click();
    const publish = page.getByRole("button", {name: "Jellyfin und Anmeldung öffentlich freigeben", exact: true});
    await publish.waitFor();
    assert.equal(await publish.isDisabled(), true);
    await page.getByLabel("StackPilot-Passwort", {exact: true}).fill("FIXTURE-ONLY");
    for (const checkbox of await page.getByRole("checkbox").all()) await checkbox.check();
    await post(page, "/api/remote-access/funnel/enable", () => publish.click());
    await page.getByText("Beide öffentlichen Routen sind in Tailscale aktiv.", {exact: false}).waitFor();
    await screenshot(page, "funnel-public-desktop");
    await page.setViewportSize({width: 390, height: 844});
    await screenshot(page, "funnel-public-mobile");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.setViewportSize({width: 1440, height: 1000});
    await page.getByLabel("StackPilot-Passwort", {exact: true}).fill("FIXTURE-ONLY");
    await page.getByLabel("Änderung des öffentlichen Zugriffs bestätigen").check();
    await post(page, "/api/remote-access/funnel/disable", () => page.getByRole("button", {name: "Öffentlichen Zugriff abschalten · privat behalten", exact: true}).click());
    await page.getByText("Keine öffentliche Funnel-Freigabe aktiv.", {exact: false}).waitFor();
    await page.goBack();
    await page.getByRole("heading", { name: "Was möchtest du erledigen?", exact: true }).waitFor();
    await page.goForward();
    await remoteSetup.waitFor();

    // Deep links survive reload and don't remount all configuration areas.
    await page.reload();
    await remoteSetup.waitFor();
    assert.equal(await page.locator(".administration-panel").count(), 1);
    await navigate(page, "Verwaltung");
    assert.equal(await page.locator(".administration-panel").count(), 0);
    const areas = [
      ["sources", "Quellen"], ["profiles", "Medienprofile"],
      ["connections", "Verbindungen"], ["safety", "VPN & Ausfallsperre"],
      ["backups", "Sicherungen & Updates"], ["diagnosis", "Diagnose"],
      ["history", "Auftragsverlauf"], ["audit", "Änderungsverlauf"],
      ["about", "Über StackPilot"],
    ];
    before = f.mutations.length;
    for (const [id, title] of areas) {
      await page.locator(".admin-area").getByText(title, { exact: true }).click();
      await page.locator(".admin-section-head").getByRole("heading", { name: title, exact: true }).waitFor();
      assert.match(page.url(), new RegExp("#/verwaltung/" + id + "$"));
      assert.equal(await page.locator(".administration-panel").count(), 1);
      if (id === "profiles") {
        await page.getByRole("button", { name: "Medienprofile laden", exact: true }).click();
        await page.getByLabel("Größenstandard", { exact: true }).waitFor();
      }
      await navigate(page, "Verwaltung");
      await page.getByRole("heading", { name: "Was möchtest du erledigen?", exact: true }).waitFor();
      assert.equal(await page.locator(".administration-panel").count(), 0);
    }
    assert.equal(f.mutations.length, before);

    await page.locator(".admin-area").getByText("Sicherungen & Updates", { exact: true }).click();
    await page.getByText("Container-Updates und Rückkehr", { exact: true }).click();
    await page.getByRole("button", { name: "Update vorbereiten", exact: true }).click();
    await page.getByRole("button", { name: "Update bestätigen", exact: true }).waitFor();
    await page.getByRole("button", { name: "Abbrechen", exact: true }).click();
    assert.equal(f.mutations.length, before);
    await page.locator("summary").getByText("StackPilot-Tresor sichern", { exact: true }).click();
    await page.getByLabel("StackPilot-Administratorpasswort", { exact: true }).fill("fixture-password");
    await page.getByLabel("Sicherungspassphrase (mindestens 16 Zeichen)").fill("fixture-local-backup-phrase");
    await page.getByLabel("Sicherungspassphrase wiederholen").fill("fixture-local-backup-phrase");
    const [vaultFile] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Verschlüsselte Tresor-Sicherung laden" }).click(),
    ]);
    assert.match(vaultFile.suggestedFilename(), /\.spvault$/);
    await navigate(page, "Verwaltung");

    // Direct wizard links resume unfinished real jobs; fresh stacks start at Server.
    for (const status of [null, "running"]) {
      const wizard = await context.newPage();
      const wf = fixture();
      wf.stackStatus = status;
      await mockAPI(wizard, wf);
      await wizard.goto(baseURL.replace(/\/$/, "") + "/#/einrichten");
      const stageNav = wizard.locator(".stages");
      await stageNav.waitFor();
      await wizard.waitForFunction((expected) => {
        const active = document.querySelector(".stages [aria-current=step]");
        return active && active.textContent.includes(expected);
      }, status === null ? "Server" : "Einrichtung");
      assert.equal(wf.mutations.length, 0);
      assert.deepEqual(wf.unexpected, []);
      await wizard.close();
    }

    // Theme toggle persists through reload; layout uses the actual user control.
    await page.getByRole("button", { name: "Light Mode aktivieren", exact: true }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
    await page.reload();
    await page.getByRole("navigation", { name: "Hauptnavigation" }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");
    assert.equal(await page.evaluate(() => localStorage.getItem("stackpilot-theme")), "light");

    // Responsive layout and fixed account/sidebar measured on both themes.
    for (const theme of ["dark", "light"]) {
      if (await page.evaluate(() => document.documentElement.dataset.theme) !== theme)
        await page.getByRole("button", { name: theme === "dark" ? "Dark Mode aktivieren" : "Light Mode aktivieren", exact: true }).click();
      await page.waitForFunction((value) => document.documentElement.dataset.theme === value, theme);
      for (const width of [1440, 1024, 768, 390]) {
        await page.setViewportSize({ width, height: 950 });
        for (const view of ["Übersicht", "Anwendungen", "Downloads", "Medien entdecken", "Meine Anfragen", "Verwaltung"]) {
          await navigate(page, view);
          if (view === "Übersicht") await page.locator(".dashboard-metric").first().waitFor();
          if (view === "Anwendungen") await page.locator(".service-list-row").first().waitFor();
          if (view === "Downloads") await page.locator(".download-row").first().waitFor();
          if (view === "Meine Anfragen") await page.locator(".request-compact").first().waitFor();
          if (view === "Verwaltung") await page.getByRole("heading", { name: "Was möchtest du erledigen?", exact: true }).waitFor();
          if (view === "Medien entdecken") {
            await page.getByPlaceholder("Film oder Serie suchen …").fill("Test");
            await page.getByRole("button", { name: "Suchen", exact: true }).click();
            await page.locator(".media-card").first().waitFor();
          }
          await noPageOverflow(page, theme + " " + width + " " + view);
        }
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      await navigate(page, "Übersicht");
      await screenshot(page, "dashboard-" + theme + "-desktop");
      await page.setViewportSize({ width: 1440, height: 650 });
      await navigate(page, "Downloads");
      await page.locator(".download-row").first().waitFor();
      const beforeAccount = await page.locator(".account-bar").boundingBox();
      const beforeSidebar = await page.locator(".layout > aside").boundingBox();
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      assert.ok(await page.evaluate(() => window.scrollY > 0), "Fixed chrome must be checked on a scrollable page");
      const afterAccount = await page.locator(".account-bar").boundingBox();
      const afterSidebar = await page.locator(".layout > aside").boundingBox();
      assert.equal(Math.round(beforeAccount.y), Math.round(afterAccount.y), "Account bar must remain fixed");
      assert.equal(Math.round(beforeSidebar.y), Math.round(afterSidebar.y), "Desktop sidebar must remain fixed");
      await page.setViewportSize({ width: 390, height: 844 });
      await navigate(page, "Downloads");
      await screenshot(page, "downloads-" + theme + "-mobile");
    }

    // Compact error/empty/loading states use server evidence, not invented data.
    await page.setViewportSize({ width: 1440, height: 1000 });
    let releaseDownloads;
    f.waitDownloads = new Promise((resolve) => { releaseDownloads = resolve; });
    await navigate(page, "Übersicht");
    await navigate(page, "Downloads");
    await page.getByRole("status").filter({ hasText: "Downloads werden geladen …" }).waitFor();
    assert.equal(await page.locator(".download-row").count(), 0);
    releaseDownloads();
    f.waitDownloads = null;
    await page.locator(".download-row").first().waitFor();
    f.failures.add("/api/downloads/list");
    await navigate(page, "Übersicht");
    await navigate(page, "Downloads");
    await page.getByRole("alert").waitFor();
    assert.equal(await page.locator(".download-row").count(), 0);
    f.failures.delete("/api/downloads/list");
    f.empty.add("/api/downloads/list");
    await page.getByRole("button", { name: "Erneut versuchen", exact: true }).click();
    await page.getByText(/Warteschlange ist leer/).waitFor();
    f.empty.delete("/api/downloads/list");
    f.vpnState = "blocked";
    await navigate(page, "Übersicht");
    await navigate(page, "Downloads");
    await page.getByLabel("Downloadfilter", { exact: true }).selectOption("paused");
    const protectedRow = await onlyRow(page, "Testfilm – aktiver Download");
    assert.equal(await protectedRow.getByRole("button", { name: "Geschützt fortsetzen", exact: true }).isDisabled(), true);
    f.viewerSetup = true;
    await page.goto(baseURL + "/#/verwaltung/remote");
    await page.getByText("Zuschauerprofile", { exact: true }).click();
    await page.getByLabel("Profilname").fill("Nur Serien");
    await page.getByRole("checkbox", { name: "Serien", exact: true }).check();
    await post(page, "/api/viewer-profiles", () => page.getByRole("button", { name: "Profil erstellen" }).click());
    const profileSelect = page.getByRole("combobox", { name: "constructor" });
    assert.equal(await profileSelect.inputValue(), "");
    await profileSelect.selectOption("series");
    await post(page, "/api/viewer-profiles", () => page.getByRole("button", { name: "Profil zuweisen" }).click());
    await page.getByText("Zuschauerprofil gespeichert.", { exact: false }).waitFor();
    assert.equal(f.viewer.profileId, "series");
    await post(page, "/api/viewers/action", () => page.getByRole("button", { name: "Passkey hinzufügen" }).click());
    assert.equal(f.viewer.passkeyPending, true);
    await post(page, "/api/viewers/action", () => page.getByRole("button", { name: "Passkey-Einrichtung abbrechen" }).click());
    await page.getByRole("button", { name: "Passkey hinzufügen" }).waitFor();
    assert.equal(f.viewer.passkeyPending, false);

    assert.equal(f.mutations.filter((m) => m.endpoint.includes("funnel/")).length, 2);
    assert.equal(f.mutations.filter((m) => m.endpoint.includes("private-serve/apply")).length, 0);
    assert.deepEqual(f.unexpected, [], "All frontend API requests must have explicit fixtures");
    assert.deepEqual(errors, [], "No unhandled browser errors");
    console.log("UI/UX regression scenarios passed. Screenshots: " + output);
  } catch (error) {
    await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true }).catch(() => {});
    console.error("Unexpected test APIs:", f.unexpected);
    console.error("Browser errors:", errors);
    throw error;
  } finally {
    await context.close();
    await browser.close();
  }
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
