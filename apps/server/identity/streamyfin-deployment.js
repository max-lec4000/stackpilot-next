import { createHash } from "node:crypto";
import { lstat, mkdtemp, open, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { releases } from "./config.js";
import { localIdentityRequest } from "./local-request.js";
import { setupError } from "./setup-error.js";
import { streamyfinSeerrVersion } from "./streamyfin-version.js";

const configName = "nginx.conf";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const withConfig = (record, checksum) => ({
  ...record, files: { ...record.files, [configName]: checksum },
});

async function currentConfig(record) {
  const directory = await lstat(record.directory);
  if (!directory.isDirectory() || directory.uid !== record.uid || (directory.mode & 0o022) ||
      await realpath(record.directory) !== record.directory)
    throw setupError("Das Gateway-Verzeichnis ist nicht sicher verwaltet.");
  const file = path.join(record.directory, configName);
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== record.uid || (stat.mode & 0o022))
    throw setupError("Die Gateway-Datei ist nicht sicher verwaltet.");
  return readFile(file, "utf8");
}

async function writeConfig(record, candidate, before) {
  const directory = await mkdtemp(path.join(record.directory, ".streamyfin-"));
  const file = path.join(directory, configName);
  try {
    await writeFile(file, candidate, { mode: 0o600, flag: "wx", flush: true });
    await before(file);
    await rename(file, path.join(record.directory, configName));
    const parent = await open(record.directory, "r");
    try { await parent.sync(); } finally { await parent.close(); }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export class StreamyfinDeployment {
  constructor(protection, port) {
    this.protection = protection;
    this.port = port;
  }
  requireLease(owner) {
    if (!this.protection.hub.engine.store.owns(owner))
      throw setupError("Auftragssperre verloren. Rückkehr zum bisherigen Gateway erneut anstoßen.");
  }
  async requirePrivate() {
    const live = await this.protection.identity.remote.inspect();
    if (!live.tailscaleRunning || !live.serveKnown || !live.serve?.exclusive || live.serve.public !== false)
      throw setupError("Streamyfin zuerst über die bestätigte private Tailscale-Freigabe prüfen.");
  }
  async testConfig(record, file) {
    await this.protection.docker(["run", "--rm", "--pull", "never", "--network", record.network,
      "--user", `${record.uid}:${record.gid}`, "--read-only", "--cap-drop=ALL",
      "--security-opt=no-new-privileges:true", "--pids-limit=128", "--memory=128m",
      "--tmpfs", "/tmp:rw,noexec,nosuid,size=32m",
      "--mount", `type=bind,source=${file},target=/etc/nginx/nginx.conf,readonly`,
      "--entrypoint", "nginx", releases.gateway.image, "-t"], { timeout: 45000 });
  }
  async recreate(record, owner) {
    this.requireLease(owner);
    await this.protection.docker(["compose", "-f", path.join(record.directory, "compose.json"),
      "up", "-d", "--no-deps", "--force-recreate", "--no-build", "--pull", "never", "gateway"],
      { timeout: 120000 });
    this.requireLease(owner);
    await this.protection.verifyContainer(record);
    await this.protection.probe(record);
  }
  async probeSeerr(record, version) {
    const request = (route) => localIdentityRequest(
      `http://127.0.0.1:${this.port}/seerr/api/v1${route}`,
      { headers: { Host: record.hostname } },
    );
    const response = await request("/status");
    if (version) {
      if (response.status !== 200 || streamyfinSeerrVersion((await response.json()).version).version !== version)
        throw setupError("Das Gateway hat die freigegebene Seerr-Version nicht bestätigt.");
      for (const [route, allowed] of [["/settings/main", [404]], ["/auth/me", [401, 403]]]) {
        const result = await request(route);
        await result.arrayBuffer();
        if (!allowed.includes(result.status))
          throw setupError("Die Seerr-Zugriffssperren konnten nicht bestätigt werden.");
      }
    } else {
      await response.arrayBuffer();
      if (![401, 403, 404].includes(response.status))
        throw setupError("Der bisherige Gateway-Stand sperrt die Seerr-Route nicht.");
    }
  }
  async activate(context) {
    const { plan, leaseOwner: owner } = context;
    const { config, release, record } = await this.protection.streamyfinCandidate(context);
    if (record.streamyfin?.phase === "active") {
      await this.probeSeerr(record, release.version);
      return { active: true, version: release.version, privateOnly: true };
    }
    if (record.streamyfin)
      throw setupError("Das Streamyfin-Gateway benötigt eine Rückkehr.");
    this.requireLease(owner);
    const original = await currentConfig(record);
    const originalHash = hash(original), candidateHash = hash(config);
    if (originalHash !== record.files[configName] || originalHash === candidateHash)
      throw setupError("Die bisherige Gateway-Datei konnte nicht eindeutig bestätigt werden.");
    await this.probeSeerr(record);
    let pending;
    try {
      await writeConfig(record, config, async (file) => {
        await this.testConfig(record, file);
        await this.requirePrivate();
        await this.protection.checkStreamyfinRelease(context, release);
        this.requireLease(owner);
        await this.protection.verifyContainer(record);
        this.requireLease(owner);
        const change = { ...record, owner, streamyfin: { phase: "applying",
          version: release.version, original, originalHash, candidateHash } };
        this.protection.save(plan, change);
        pending = change;
      });
      const applied = withConfig(pending, candidateHash);
      await this.recreate(applied, owner);
      await this.probeSeerr(applied, release.version);
      await this.requirePrivate();
      await this.protection.checkStreamyfinRelease(context, release);
      this.requireLease(owner);
      this.protection.save(plan, { ...applied,
        streamyfin: { ...applied.streamyfin, phase: "active" } });
      return { active: true, version: release.version, privateOnly: true };
    } catch (error) {
      if (!pending) throw error;
      try { await this.restore(context, pending); }
      catch { throw setupError("Übernahme und automatische Rückkehr konnten nicht bestätigt werden. Rückkehr erneut anstoßen."); }
      throw setupError("Übernahme fehlgeschlagen. Die bisherige Gateway-Konfiguration wurde wiederhergestellt.");
    }
  }
  async restore({ plan, leaseOwner: owner }, record) {
    const change = record?.streamyfin;
    if (!change || hash(change.original) !== change.originalHash)
      throw setupError("Keine bestätigte frühere Gateway-Konfiguration vorhanden.");
    this.requireLease(owner);
    const currentHash = hash(await currentConfig(record));
    if (![change.originalHash, change.candidateHash].includes(currentHash))
      throw setupError("Die Gateway-Datei wurde außerhalb des Auftrags geändert.");
    await this.protection.verifyContainer(withConfig(record, currentHash), false, { allowMissingGateway: true });
    this.requireLease(owner);
    const recovering = { ...record, owner, streamyfin: { ...change, phase: "rolling-back" } };
    this.protection.save(plan, recovering);
    if (currentHash !== change.originalHash)
      await writeConfig(record, change.original, async () => this.requireLease(owner));
    const restored = withConfig(recovering, change.originalHash);
    await this.recreate(restored, owner);
    await this.probeSeerr(restored);
    this.requireLease(owner);
    const { streamyfin, ...previous } = restored;
    this.protection.save(plan, previous);
    return { active: false, restored: true };
  }
}
