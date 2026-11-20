// Speicher (Phase 7 Paket 7.4): Papierkorb für Radarr/Sonarr (gelöschte Dateien landen erst in
// <Daten>/papierkorb/…, nach N Tagen weg), doppelte Fassungen in der Bibliothek (gleicher Titel
// mehrfach oder mehrere Dateien zu einem Titel) und Aufbewahrungs-Vorschläge (lange nicht
// gesehene Filme). Löschen nur für Dateien, die Radarr/Sonarr nicht verwalten, mit OK.
import { lstat, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { hostPath } from "./storage-overview.js";

const text = (v, n = 160) => (typeof v === "string" ? v.replace(/[\x00-\x1f\x7f]+/g, " ").trim().slice(0, n) : "");
const fail = (m) => Object.assign(Error(m), { userFacing: true });
const list = (v) => (Array.isArray(v) ? v : []);
const token = (p) => createHash("sha256").update(String(p)).digest("hex").slice(0, 16);
const pad = (n) => String(n).padStart(2, "0");
export const BIN = { Radarr: "/data/papierkorb/filme", Sonarr: "/data/papierkorb/serien" };
export const BIN_DAYS = [7, 14, 30, 60, 90];
export const KEEP_DAYS = [90, 180, 365, 730];
const DAY = 86400000;

/** Doppelte Fassungen aus Jellyfin-Einträgen (Filme bzw. Folgen) bilden. */
export function duplicateGroups(items, kind) {
  const groups = new Map();
  for (const i of list(items)) {
    const key = kind === "movie"
      ? (i.ProviderIds?.Tmdb ? `tmdb:${i.ProviderIds.Tmdb}` : i.ProviderIds?.Imdb ? `imdb:${i.ProviderIds.Imdb}` : `id:${i.Id}`)
      : Number.isSafeInteger(i.ParentIndexNumber) && Number.isSafeInteger(i.IndexNumber) ? `${i.SeriesId}:${i.ParentIndexNumber}:${i.IndexNumber}` : `id:${i.Id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  }
  const out = [];
  for (const members of groups.values()) {
    const versions = [];
    for (const i of members) for (const m of list(i.MediaSources).length ? i.MediaSources : [{ Path: i.Path, Size: null }])
      if (typeof m.Path === "string" && m.Path.startsWith("/data/media/") && !versions.some((v) => v.path === m.Path))
        versions.push({ path: m.Path, size: Number(m.Size) || null, itemId: i.Id });
    if (versions.length < 2) continue;
    const first = members[0];
    out.push({
      title: kind === "movie" ? `${text(first.Name)}${first.ProductionYear ? ` (${first.ProductionYear})` : ""}`
        : `${text(first.SeriesName)} · S${pad(first.ParentIndexNumber)}E${pad(first.IndexNumber)}`,
      kind, versions,
    });
  }
  return out;
}

export class LibraryCare {
  constructor(hub, options = {}) {
    this.hub = hub;
    this.fs = { lstat, mkdir, readdir, rm, ...options.fs };
    this.now = options.now || (() => Date.now());
  }
  plan() {
    const current = this.hub.engine.current();
    if (current?.job.status !== "completed") throw fail("Kein eingerichteter Stack.");
    return current.plan;
  }
  arrs(plan) {
    return ["Radarr", "Sonarr"].filter((n) => plan.spec.selected.includes(n));
  }
  async binSize(dir) {
    let bytes = 0, files = 0;
    const walk = async (d, depth) => {
      if (depth > 6 || files > 20000) return;
      for (const e of await this.fs.readdir(d, { withFileTypes: true }).catch(() => [])) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) await walk(p, depth + 1);
        else if (e.isFile()) { files++; bytes += (await this.fs.lstat(p).catch(() => ({ size: 0 }))).size; }
      }
    };
    await walk(dir, 0);
    return { bytes, files };
  }

  // ---- Papierkorb ----
  async recycleBin() {
    const plan = this.plan();
    const names = this.arrs(plan);
    if (!names.length) return { services: [] };
    const { s } = await this.hub.context(names);
    const services = await Promise.all(names.map(async (service) => {
      try {
        const cfg = await s.arr(service, "/config/mediamanagement");
        const current = text(cfg.recycleBin, 300);
        const ours = current.replace(/\/+$/, "") === BIN[service];
        const usage = ours ? await this.binSize(hostPath(plan, BIN[service])) : null;
        return { service, enabled: !!current, ours, foreign: current && !ours ? current : null,
          days: Number(cfg.recycleBinCleanupDays) || 0, usage, choices: BIN_DAYS };
      } catch {
        return { service, error: `${service} nicht erreichbar.` };
      }
    }));
    return { services };
  }
  /** body: { service, enabled, days, confirmation } */
  async setRecycleBin(body) {
    if (body.confirmation !== "OK") throw fail("Papierkorb-Einstellung mit OK bestätigen.");
    const plan = this.plan();
    if (!this.arrs(plan).includes(body.service)) throw fail("Radarr oder Sonarr wählen.");
    if (typeof body.enabled !== "boolean") throw fail("Ungültige Angabe.");
    const days = Number(body.days);
    if (body.enabled && !BIN_DAYS.includes(days)) throw fail("Ungültige Aufbewahrungsdauer.");
    return this.hub.mutate([body.service], async ({ s }) => {
      const cfg = await s.arr(body.service, "/config/mediamanagement");
      if (!cfg || typeof cfg !== "object") throw Error("Einstellungen nicht lesbar.");
      if (body.enabled) await this.fs.mkdir(hostPath(plan, BIN[body.service]), { recursive: true, mode: 0o750 });
      const next = { ...cfg, recycleBin: body.enabled ? BIN[body.service] : "", ...(body.enabled ? { recycleBinCleanupDays: days } : {}) };
      await s.arr(body.service, `/config/mediamanagement${cfg.id ? `/${cfg.id}` : ""}`, { method: "PUT", body: next });
      const after = await s.arr(body.service, "/config/mediamanagement");
      if ((after.recycleBin || "") !== next.recycleBin || (body.enabled && Number(after.recycleBinCleanupDays) !== days))
        throw Error(`${body.service} hat die Einstellung nicht übernommen.`);
      return { ok: true, message: body.enabled
        ? `${body.service}: Gelöschtes landet ${days} Tage im Papierkorb.` : `${body.service}: Papierkorb aus – Gelöschtes ist sofort weg.` };
    });
  }
  /** Papierkorb leeren (nur der von StackPilot angelegte Ordner). */
  async emptyRecycleBin(body) {
    if (body.confirmation !== "OK") throw fail("Leeren mit OK bestätigen.");
    const plan = this.plan();
    if (!this.arrs(plan).includes(body.service)) throw fail("Radarr oder Sonarr wählen.");
    const dir = hostPath(plan, BIN[body.service]);
    const st = await this.fs.lstat(dir).catch(() => null);
    if (!st?.isDirectory() || st.isSymbolicLink()) throw fail("Der Papierkorb ist leer oder kein normaler Ordner.");
    const before = await this.binSize(dir);
    for (const e of await this.fs.readdir(dir)) await this.fs.rm(path.join(dir, e), { recursive: true, force: true });
    return { ok: true, message: `Papierkorb von ${body.service} geleert (${before.files} Dateien).` };
  }

  // ---- Doppelte Fassungen ----
  async managedPaths(s, plan, groups) {
    const managed = new Set();
    if (plan.spec.selected.includes("Radarr") && groups.some((g) => g.kind === "movie"))
      for (const m of list(await s.arr("Radarr", "/movie"))) if (m.movieFile?.path) managed.add(m.movieFile.path);
    if (plan.spec.selected.includes("Sonarr") && groups.some((g) => g.kind === "tv")) {
      const series = list(await s.arr("Sonarr", "/series"));
      const wanted = new Set();
      for (const g of groups.filter((x) => x.kind === "tv"))
        for (const v of g.versions) { const hit = series.find((x) => x.path && v.path.startsWith(x.path + "/")); if (hit) wanted.add(hit.id); }
      for (const id of [...wanted].slice(0, 50))
        for (const f of list(await s.arr("Sonarr", `/episodefile?seriesId=${id}`))) if (f.path) managed.add(f.path);
    }
    return managed;
  }
  async findDuplicates(s, plan) {
    const j = (r) => this.hub.library.request(s, plan, r);
    const [movies, episodes] = await Promise.all([
      j("/Items?Recursive=true&IncludeItemTypes=Movie&Fields=ProviderIds,Path,MediaSources&Limit=10000").catch(() => null),
      j("/Items?Recursive=true&IncludeItemTypes=Episode&Fields=Path,MediaSources&Limit=30000").catch(() => null),
    ]);
    if (!movies && !episodes) throw Error("Jellyfin-Bibliothek nicht lesbar.");
    // Jellyfin meldet gerade gelöschte Dateien noch eine Weile – nur vorhandene zählen
    const groups = [];
    for (const g of [...duplicateGroups(movies?.Items, "movie"), ...duplicateGroups(episodes?.Items, "tv")].slice(0, 300)) {
      const versions = [];
      for (const v of g.versions) {
        const host = hostPath(plan, v.path);
        if (host && (await this.fs.lstat(host).catch(() => null))?.isFile()) versions.push(v);
      }
      if (versions.length > 1) groups.push({ ...g, versions });
    }
    const managed = await this.managedPaths(s, plan, groups);
    return groups.map((g) => ({ ...g, versions: g.versions.map((v) => ({ ...v, token: token(v.path), managed: managed.has(v.path) })) }));
  }
  async duplicates() {
    const plan = this.plan();
    if (!plan.spec.selected.includes("Jellyfin")) return { groups: [] };
    const names = ["Jellyfin", ...this.arrs(plan)];
    const { s } = await this.hub.context(names);
    const groups = await this.findDuplicates(s, plan);
    return {
      checkedAt: new Date(this.now()).toISOString(), total: groups.length,
      groups: groups.slice(0, 100).map((g) => ({ title: g.title, kind: g.kind, versions: g.versions.map((v) => ({
        token: v.token, file: text(v.path.slice("/data/media/".length), 300), size: v.size, managed: v.managed })) })),
    };
  }
  /** Eine nicht verwaltete Fassung löschen. body: { token, confirmation } */
  async removeDuplicate(body) {
    if (body.confirmation !== "OK") throw fail("Löschen mit OK bestätigen.");
    if (!/^[a-f0-9]{16}$/.test(body.token || "")) throw fail("Ungültige Auswahl.");
    const plan = this.plan();
    const names = ["Jellyfin", ...this.arrs(plan)];
    return this.hub.mutate(names, async ({ s }) => {
      const groups = await this.findDuplicates(s, plan);
      const group = groups.find((g) => g.versions.some((v) => v.token === body.token));
      const v = group?.versions.find((x) => x.token === body.token);
      if (!v) throw fail("Diese Fassung gibt es nicht mehr. Neu laden.");
      if (v.managed) throw fail(`Diese Datei verwaltet ${group.kind === "movie" ? "Radarr" : "Sonarr"} – sie bleibt. Bei Bedarf dort austauschen.`);
      if (!group.versions.some((x) => x.token !== v.token)) throw fail("Es bliebe keine Fassung übrig.");
      const host = hostPath(plan, v.path);
      if (!host || !host.startsWith(path.join(plan.spec.path, "media") + path.sep)) throw fail("Datei liegt außerhalb der Bibliothek.");
      const st = await this.fs.lstat(host).catch(() => null);
      if (!st?.isFile() || st.isSymbolicLink()) throw fail("Keine normale Datei – wird nicht gelöscht.");
      if (v.size && st.size !== v.size) throw fail("Die Datei hat sich geändert. Neu laden.");
      await this.fs.rm(host);
      await this.hub.library.request(s, plan, "/Library/Media/Updated", { method: "POST", body: { Updates: [{ Path: v.path, UpdateType: "Deleted" }] } }).catch(() => {});
      return { ok: true, message: `Zusätzliche Fassung von „${group.title}“ gelöscht.` };
    });
  }

  // ---- Aufbewahrung ----
  /** Filme, die länger als `days` niemand angesehen hat (und mindestens so lange da sind). */
  async retention(rawDays) {
    const plan = this.plan();
    if (!plan.spec.selected.includes("Jellyfin")) return { candidates: [] };
    const days = Number(rawDays) || 180;
    if (!KEEP_DAYS.includes(days)) throw fail("Ungültiger Zeitraum.");
    const { s } = await this.hub.context(["Jellyfin"]);
    const j = (r) => this.hub.library.request(s, plan, r);
    const users = list(await j("/Users")).filter((u) => !u.Policy?.IsDisabled && /^[a-f0-9-]{32,36}$/i.test(u.Id || "")).slice(0, 50);
    const movies = new Map();
    for (const u of users) {
      const r = await j(`/Users/${u.Id.replaceAll("-", "")}/Items?Recursive=true&IncludeItemTypes=Movie&Fields=DateCreated,MediaSources&Limit=10000`);
      for (const i of list(r?.Items)) {
        const m = movies.get(i.Id) || { title: `${text(i.Name)}${i.ProductionYear ? ` (${i.ProductionYear})` : ""}`, added: Date.parse(i.DateCreated) || null,
          size: list(i.MediaSources).reduce((a, x) => a + (Number(x.Size) || 0), 0) || null, last: null, viewers: 0 };
        const played = i.UserData?.LastPlayedDate ? Date.parse(i.UserData.LastPlayedDate) : null;
        if (i.UserData?.Played || played) m.viewers++;
        if (played && (!m.last || played > m.last)) m.last = played;
        movies.set(i.Id, m);
      }
    }
    const limit = this.now() - days * DAY;
    const candidates = [...movies.values()].filter((m) => m.added && m.added < limit && (!m.last || m.last < limit))
      .sort((a, b) => (b.size || 0) - (a.size || 0));
    return {
      days, choices: KEEP_DAYS, total: candidates.length, bytes: candidates.reduce((a, m) => a + (m.size || 0), 0),
      candidates: candidates.slice(0, 50).map((m) => ({ title: m.title, size: m.size, viewers: m.viewers,
        lastPlayed: m.last ? new Date(m.last).toISOString() : null, added: new Date(m.added).toISOString() })),
    };
  }
}
