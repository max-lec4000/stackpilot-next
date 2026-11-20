// Speicher → Belegung und verwaiste Downloads (Phase 7.4a).
// Belegung: Laufwerke (statfs), Bibliotheksgrößen aus Radarr/Sonarr/Lidarr, Downloads aus
// qBittorrent, App-Daten per du (zwischengespeichert). Verwaist: fertige Downloads, deren
// Dateien keinen zweiten Link (Hardlink in die Bibliothek) haben und die nicht mehr in einer
// ARR-Warteschlange stehen – sie belegen Platz, ohne in Jellyfin zu erscheinen.
import { statfs, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { allArrQueue } from "./request-index.js";
import { qbitAdapter } from "./adapters/qbittorrent.js";

const execute = promisify(execFile);
const text = (v, n = 200) => (typeof v === "string" ? v.replace(/[\x00-\x1f\x7f]+/g, " ").trim().slice(0, n) : "");
const num = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : 0);
const list = (v) => (Array.isArray(v) ? v : []);
const DU_TTL = 10 * 60 * 1000;

/** Container-Pfad (/data/…) → Pfad am Server; nur innerhalb des Datenordners. */
export function hostPath(plan, containerPath) {
  if (typeof containerPath !== "string" || !containerPath.startsWith("/data/")) return null;
  const rel = path.posix.normalize(containerPath.slice("/data/".length));
  if (rel.startsWith("..") || path.posix.isAbsolute(rel)) return null;
  return path.join(plan.spec.path, rel);
}

/** Ist ein fertiger Download verwaist? links: Linkzahl je Datei (null = Datei fehlt). */
export function orphanVerdict({ progress, inQueue, links }) {
  if (progress < 1) return "incomplete";
  if (inQueue) return "importing";
  if (!links.length || links.some((n) => n === null)) return "unknown";
  return links.every((n) => n === 1) ? "orphan" : "library";
}

export class StorageOverview {
  constructor(hub, options = {}) {
    this.hub = hub;
    this.stat = options.stat || stat;
    this.statfs = options.statfs || statfs;
    // du meldet einen Fehler, wenn es Ordner anderer Container-Benutzer nicht lesen darf, liefert
    // aber trotzdem eine Summe – die zählt dann als Mindestwert.
    this.du = options.du || (async (dir) => {
      const parse = (out) => { const n = Number(String(out || "").split(/\s/)[0]); return Number.isFinite(n) && n > 0 ? n : null; };
      try {
        return { bytes: parse((await execute("du", ["-sb", "--", dir], { timeout: 60000 })).stdout), partial: false };
      } catch (e) {
        const bytes = parse(e.stdout);
        if (bytes === null) throw e;
        return { bytes, partial: true };
      }
    });
    this.duCache = new Map();
  }
  plan() {
    const current = this.hub.engine.current();
    if (current?.job.status !== "completed") throw Object.assign(Error("Kein eingerichteter Stack."), { userFacing: true });
    return current.plan;
  }
  async disks(plan) {
    const out = [], seen = new Set();
    for (const [label, dir] of [["Medien und Downloads", plan.spec.path], ["App-Daten", plan.appdata || plan.spec.path + "-appdata"], ["System", "/"]]) {
      try {
        const [fs, st] = await Promise.all([this.statfs(dir), this.stat(dir)]);
        if (seen.has(st.dev)) { out.find((d) => d.dev === st.dev).labels.push(label); continue; }
        seen.add(st.dev);
        out.push({ dev: st.dev, labels: [label], total: fs.blocks * fs.bsize, free: fs.bavail * fs.bsize });
      } catch {}
    }
    return out.map(({ dev, ...d }) => ({ ...d, used: d.total - d.free }));
  }
  async appdataSize(plan) {
    const dir = plan.appdata || plan.spec.path + "-appdata";
    const hit = this.duCache.get(dir);
    if (hit && Date.now() - hit.at < DU_TTL) return hit.value;
    const value = await this.du(dir).catch(() => null);
    this.duCache.set(dir, { at: Date.now(), value });
    return value;
  }
  async library(s, plan) {
    const sel = (n) => plan.spec.selected.includes(n);
    const tasks = {
      movies: sel("Radarr") && (async () => {
        const rows = list(await s.arr("Radarr", "/movie"));
        return { bytes: rows.reduce((a, m) => a + num(m.sizeOnDisk ?? m.statistics?.sizeOnDisk), 0), items: rows.filter((m) => m.hasFile).length };
      }),
      series: sel("Sonarr") && (async () => {
        const rows = list(await s.arr("Sonarr", "/series"));
        return { bytes: rows.reduce((a, x) => a + num(x.statistics?.sizeOnDisk), 0), items: rows.reduce((a, x) => a + num(x.statistics?.episodeFileCount), 0) };
      }),
      music: sel("Lidarr") && (async () => {
        const rows = list(await s.arr("Lidarr", "/artist"));
        return { bytes: rows.reduce((a, x) => a + num(x.statistics?.sizeOnDisk), 0), items: rows.reduce((a, x) => a + num(x.statistics?.trackFileCount), 0) };
      }),
    };
    const out = {};
    await Promise.all(Object.entries(tasks).map(async ([k, fn]) => {
      if (!fn) return;
      try { out[k] = await fn(); } catch { out[k] = null; }
    }));
    return out;
  }
  async linkCounts(plan, s, torrent) {
    const files = list(await s.qbit(`/torrents/files?hash=${torrent.hash}`)).slice(0, 60);
    const base = hostPath(plan, torrent.save_path);
    if (!base) return [null];
    return Promise.all(files.map(async (f) => {
      const p = path.join(base, String(f.name || ""));
      if (!p.startsWith(base + path.sep)) return null;
      try { return (await this.stat(p)).nlink; } catch { return null; }
    }));
  }
  async downloads(s, plan) {
    if (!plan.spec.selected.includes("qBittorrent")) return null;
    const torrents = list(await s.qbit("/torrents/info")).slice(0, 500);
    const queued = new Set();
    for (const service of ["Radarr", "Sonarr", "Lidarr"].filter((n) => plan.spec.selected.includes(n))) {
      try { for (const row of await allArrQueue(s, service)) if (typeof row.downloadId === "string") queued.add(row.downloadId.toLowerCase()); } catch {}
    }
    const orphans = [];
    let checked = 0;
    for (const t of torrents) {
      if (num(t.progress) < 1 || checked >= 200) continue;
      checked++;
      const verdict = orphanVerdict({ progress: num(t.progress), inQueue: queued.has(String(t.hash).toLowerCase()), links: await this.linkCounts(plan, s, t).catch(() => [null]) });
      if (verdict === "orphan")
        orphans.push({ hash: text(t.hash, 64), name: text(t.name), size: num(t.size), category: text(t.category, 60),
          ratio: Math.round(num(t.ratio) * 100) / 100, seeding: /UP$/.test(String(t.state)) && !/^(paused|stopped)/.test(String(t.state)),
          completedAt: num(t.completion_on) ? new Date(num(t.completion_on) * 1000).toISOString() : null });
    }
    return {
      total: torrents.reduce((a, t) => a + num(t.size), 0),
      complete: torrents.filter((t) => num(t.progress) >= 1).length,
      incomplete: torrents.filter((t) => num(t.progress) < 1).length,
      orphans: orphans.sort((a, b) => b.size - a.size).slice(0, 50),
      orphanBytes: orphans.reduce((a, o) => a + o.size, 0),
    };
  }
  async read() {
    const plan = this.plan();
    const names = ["Radarr", "Sonarr", "Lidarr", "qBittorrent"].filter((n) => plan.spec.selected.includes(n));
    const { s } = names.length ? await this.hub.context(names) : { s: null };
    const [disks, library, downloads, appdata] = await Promise.all([
      this.disks(plan), s ? this.library(s, plan) : {}, s ? this.downloads(s, plan).catch(() => null) : null, this.appdataSize(plan),
    ]);
    return { checkedAt: new Date().toISOString(), disks, library, downloads, appdata };
  }
  /** Verwaisten Download samt Dateien löschen – erst nach erneuter Prüfung. */
  async removeOrphan(body) {
    if (body.confirmation !== "OK") throw Error("Löschen mit OK bestätigen.");
    const hash = String(body.hash || "");
    if (!/^[a-f0-9]{40,64}$/i.test(hash)) throw Error("Ungültiger Download.");
    return this.hub.mutate(["qBittorrent"], async ({ s, plan }) => {
      const torrent = list(await s.qbit(`/torrents/info?hashes=${hash}`))[0];
      if (!torrent) throw Error("Download nicht mehr vorhanden.");
      let inQueue = false;
      for (const service of ["Radarr", "Sonarr", "Lidarr"].filter((n) => plan.spec.selected.includes(n)))
        inQueue ||= (await allArrQueue(s, service)).some((r) => String(r.downloadId).toLowerCase() === hash.toLowerCase());
      const verdict = orphanVerdict({ progress: num(torrent.progress), inQueue, links: await this.linkCounts(plan, s, torrent) });
      if (verdict !== "orphan") throw Error("Der Download ist nicht (mehr) verwaist – nichts gelöscht. Neu laden.");
      await qbitAdapter(s).remove(hash, true);
      return { ok: true, freed: num(torrent.size), name: text(torrent.name) };
    });
  }
}
