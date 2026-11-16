import { catalog } from "./catalog.js";

const day = 24 * 60 * 60 * 1000;
const digest = /^sha256:[a-f0-9]{64}$/;
const registry = {
  "docker.io": { origin: "https://registry-1.docker.io", token: "https://auth.docker.io/token", service: "registry.docker.io" },
  "ghcr.io": { origin: "https://ghcr.io", token: "https://ghcr.io/token", service: "ghcr.io" },
};
const manifestTypes = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.docker.distribution.manifest.v2+json",
];

async function registryDigests(source) {
  const match = /^(docker\.io|ghcr\.io)\/([a-z0-9._/-]+):([a-zA-Z0-9._-]+)$/.exec(source);
  if (!match) throw Error("Unbekannte Image-Quelle.");
  const [, host, repository, tag] = match;
  const { origin, token, service } = registry[host];
  const options = { redirect: "error", signal: AbortSignal.timeout(15000) };
  const url = new URL(token);
  url.search = new URLSearchParams({ service, scope: `repository:${repository}:pull` });
  const auth = await fetch(url, options);
  if (!auth.ok) throw Error("Registry-Anmeldung fehlgeschlagen.");
  const { token: bearer } = await auth.json();
  if (typeof bearer !== "string" || !bearer) throw Error("Registry-Token fehlt.");
  const response = await fetch(`${origin}/v2/${repository}/manifests/${tag}`, {
    ...options, headers: { Authorization: `Bearer ${bearer}`, Accept: manifestTypes.join(", ") },
  });
  const current = response.headers.get("docker-content-digest");
  if (!response.ok || !digest.test(current)) {
    await response.body?.cancel();
    throw Error("Image-Manifest konnte nicht bestätigt werden.");
  }
  const manifest = await response.json();
  // Plans can pin the complete index or a single platform manifest.
  return [current, ...(manifest.manifests || []).map((entry) => entry.digest)].filter((value) => digest.test(value));
}

export class AppUpdates {
  constructor(engine, lookup = registryDigests) {
    this.engine = engine;
    this.lookup = lookup;
    this.db = engine.store.db;
    this.db.exec("CREATE TABLE IF NOT EXISTS app_update_checks (source TEXT PRIMARY KEY, attempted INTEGER NOT NULL, digests TEXT)");
    this.claim = this.db.prepare(`
      INSERT INTO app_update_checks (source, attempted) VALUES (?, ?)
      ON CONFLICT(source) DO UPDATE SET attempted = excluded.attempted
      WHERE app_update_checks.attempted <= excluded.attempted - ${day}
    `);
    this.save = this.db.prepare("UPDATE app_update_checks SET digests = ? WHERE source = ? AND attempted = ?");
    this.get = this.db.prepare("SELECT digests FROM app_update_checks WHERE source = ?");
  }
  available(name, image) {
    const source = catalog.services[name]?.source;
    if (!source || !image) return false;
    const [repository, installed] = image.split("@");
    if (repository !== source.slice(0, source.lastIndexOf(":")) || !digest.test(installed)) return false;
    const cached = this.get.get(source)?.digests;
    return Boolean(cached && !JSON.parse(cached).includes(installed));
  }
  async check() {
    const current = this.engine.current();
    if (current?.job.status !== "completed") return;
    const now = Date.now();
    const sources = new Set(current.plan.spec.selected.map((name) => catalog.services[name]?.source).filter(Boolean));
    await Promise.allSettled([...sources].map(async (source) => {
      if (!this.claim.run(source, now).changes) return;
      const digests = await this.lookup(source);
      this.save.run(JSON.stringify(digests), source, now);
    }));
  }
  start() {
    const tick = () => void this.check().catch(() => {});
    tick();
    this.timer = setInterval(tick, 5 * 60 * 1000);
    this.timer.unref?.();
  }
  close() { clearInterval(this.timer); }
}
