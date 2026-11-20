// Downloads → Braucht Aufmerksamkeit (Phase 7.2a): hängende und blockierte Downloads aus den
// Warteschlangen von Radarr und Sonarr, mit verständlicher Ursache und geführter Aktion.
// Die ARR-App bleibt die Quelle: StackPilot liest die Warteschlange, führt eine Aktion aus und
// liest danach erneut.
import { createHash } from "node:crypto";
import { allArrQueue } from "./request-index.js";
import { importMessage } from "./import-status.js";

const SERVICES = ["Radarr", "Sonarr"];
const digest = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 32);
const text = (v, n = 200) => (typeof v === "string" ? v.replace(/[\x00-\x1f\x7f]+/g, " ").trim().slice(0, n) : "");
const pad = (n) => String(n).padStart(2, "0");

/** Ursache in Alltagssprache aus Status und Meldungen der ARR-App. */
export function causeOf(row, messages) {
  const all = messages.join(" ").toLowerCase();
  if (/stalled|no connections|keine verbindung/.test(all))
    return { cause: "Download hängt – keine Quellen", hint: "Ein anderer Treffer mit mehr Quellen hilft meist." };
  if (/sample/.test(all))
    return { cause: "Nur ein Beispielvideo", hint: "Der Treffer enthält nicht den ganzen Film bzw. die ganze Folge." };
  if (/\.rar|archive|packed|unpack/.test(all))
    return { cause: "Gepackte Dateien", hint: "Gepackte Downloads werden nicht entpackt – anderen Treffer suchen." };
  if (/not an upgrade|existing file|already exists|same quality/.test(all))
    return { cause: "Keine Verbesserung", hint: "Die vorhandene Datei ist gleich gut oder besser; der Download wird nicht gebraucht." };
  if (/no files found|no eligible|no video files|eligible for import/.test(all))
    return { cause: "Keine importierbaren Dateien", hint: "Im Download liegen keine passenden Videodateien." };
  if (/unable to parse|unknown (series|movie)|matched to (series|movie) by id|was not found|wrong (series|movie)|title mismatch/.test(all))
    return { cause: "Titel nicht eindeutig zugeordnet", hint: "Der Download passt nicht sicher zur Anfrage – anderen Treffer suchen." };
  if (/permission|access to the path|denied|read-only/.test(all))
    return { cause: "Keine Schreibrechte", hint: "Die ARR-App darf in den Medienordner nicht schreiben – Ordnerrechte prüfen (Diagnose)." };
  if (/disk|space/.test(all))
    return { cause: "Speicher voll", hint: "Platz schaffen (Speicher → Aufräumen), danach Import erneut prüfen." };
  if (row.trackedDownloadState === "importBlocked" || row.trackedDownloadState === "importPending")
    return { cause: "Import blockiert", hint: "Die ARR-App kann den fertigen Download nicht übernehmen." };
  if (row.trackedDownloadState === "failedPending" || row.trackedDownloadState === "failed" || row.status === "failed")
    return { cause: "Download fehlgeschlagen", hint: "Anderen Treffer suchen." };
  return { cause: "Warnung der ARR-App", hint: "Details ansehen; meist hilft ein anderer Treffer." };
}

export function isProblem(row) {
  return row.trackedDownloadStatus === "warning" || row.trackedDownloadStatus === "error" ||
    ["importBlocked", "failedPending", "failed"].includes(row.trackedDownloadState) || row.status === "failed";
}

/** Ein Warteschlangeneintrag als Problem (ohne interne IDs, Adressen oder Schlüssel). */
export function issueOf(row, service, plan, secrets = []) {
  const messages = [
    ...(row.statusMessages || []).flatMap((m) => [m?.title, ...(Array.isArray(m?.messages) ? m.messages : [])]),
    row.errorMessage,
  ].filter((v) => typeof v === "string" && v.trim()).slice(0, 8).map((v) => text(importMessage(v, secrets), 300));
  const episode = row.episode && Number.isSafeInteger(row.episode.seasonNumber) && Number.isSafeInteger(row.episode.episodeNumber)
    ? ` · S${pad(row.episode.seasonNumber)}E${pad(row.episode.episodeNumber)}` : "";
  const size = Number(row.size), left = Number(row.sizeleft);
  return {
    id: digest([plan.id, service, row.id, row.downloadId]),
    service,
    kind: service === "Radarr" ? "movie" : "tv",
    title: (text(service === "Radarr" ? row.movie?.title : row.series?.title) || text(row.title) || "Unbekannter Download") + episode,
    release: text(row.title, 240),
    ...causeOf(row, messages),
    messages,
    progress: size > 0 && left >= 0 ? Math.max(0, Math.min(1, 1 - left / size)) : null,
    size: size > 0 ? size : null,
    // Fertig geladen und einem Film bzw. einer Serie zugeordnet: Dateien lassen sich von Hand importieren
    importable: (left === 0 || ["importPending", "importBlocked", "importFailed"].includes(row.trackedDownloadState)) &&
      typeof row.downloadId === "string" && Number.isSafeInteger(service === "Radarr" ? row.movie?.id ?? row.movieId : row.series?.id ?? row.seriesId),
  };
}
const fileToken = (p) => createHash("sha256").update(String(p)).digest("hex").slice(0, 16);
const SxE = (e) => `S${pad(e.seasonNumber)}E${pad(e.episodeNumber)}`;

export class DownloadIssues {
  constructor(hub) {
    this.hub = hub;
  }
  services(plan) {
    return SERVICES.filter((n) => plan.spec.selected.includes(n));
  }
  secrets(s, plan) {
    const out = [];
    if (typeof s.credentials === "function")
      for (const name of plan.spec.selected) {
        try {
          const c = s.credentials(name);
          out.push(c.password, c.apiKey);
        } catch {}
      }
    return out;
  }
  async rows(s, plan) {
    const rows = [], unavailable = [];
    await Promise.all(this.services(plan).map(async (service) => {
      try {
        rows.push(...(await allArrQueue(s, service)).map((row) => ({ row, service })));
      } catch {
        unavailable.push(service);
      }
    }));
    return { rows, unavailable };
  }
  async list() {
    const current = this.hub.engine.current();
    if (current?.job.status !== "completed") return { issues: [], unavailable: [] };
    const names = this.services(current.plan);
    if (!names.length) return { issues: [], unavailable: [] };
    const { s, plan } = await this.hub.context(names);
    const { rows, unavailable } = await this.rows(s, plan);
    const secrets = this.secrets(s, plan);
    const issues = rows.filter(({ row }) => isProblem(row)).map(({ row, service }) => issueOf(row, service, plan, secrets));
    return { checkedAt: new Date().toISOString(), issues: issues.slice(0, 50), total: issues.length, unavailable };
  }
  /**
   * retry   – ARR prüft fertige Downloads erneut (harmlos, ohne OK)
   * replace – Download entfernen, Treffer sperren, automatisch Ersatz suchen (OK + VPN)
   */
  async act(body) {
    if (!["retry", "replace"].includes(body.action)) throw Error("Unbekannte Aktion.");
    const current = this.hub.engine.current();
    if (current?.job.status !== "completed") throw Error("Kein eingerichteter Stack.");
    const names = this.services(current.plan);
    if (!names.length) throw Error("Weder Radarr noch Sonarr sind eingerichtet.");
    if (body.action === "retry") {
      const { s } = await this.hub.context(names);
      for (const service of names) await s.arr(service, "/command", { method: "POST", body: { name: "RefreshMonitoredDownloads" } });
      return { ok: true, message: "Radarr und Sonarr prüfen die fertigen Downloads erneut. Das dauert meist unter einer Minute." };
    }
    if (body.confirmation !== "OK") throw Error("Anderen Treffer suchen mit OK bestätigen.");
    if (!/^[a-f0-9]{32}$/.test(body.id || "")) throw Error("Ungültige Auswahl.");
    await this.hub.requireVpn();
    return this.hub.mutate(names, async ({ s, plan }) => {
      const { rows } = await this.rows(s, plan);
      const hit = rows.find(({ row, service }) => digest([plan.id, service, row.id, row.downloadId]) === body.id);
      if (!hit) throw Error("Der Download steht nicht mehr in der Warteschlange. Neu laden.");
      if (!isProblem(hit.row)) throw Error("Der Download läuft wieder normal. Neu laden.");
      if (!Number.isSafeInteger(hit.row.id)) throw Error("Ungültiger Warteschlangeneintrag.");
      // removeFromClient: Torrent samt Daten in qBittorrent entfernen (bereits Importiertes bleibt
      // als eigene Datei bzw. Hardlink erhalten); blocklist + skipRedownload=false: Treffer
      // sperren und automatisch nach Ersatz suchen.
      await s.arr(hit.service, `/queue/${hit.row.id}?removeFromClient=true&blocklist=true&skipRedownload=false`, { method: "DELETE" });
      const after = await allArrQueue(s, hit.service);
      if (after.some((row) => row.id === hit.row.id))
        throw Error("Die ARR-App hat das Entfernen noch nicht bestätigt. Gleich erneut laden.");
      return { ok: true, message: `„${issueOf(hit.row, hit.service, plan).title}“: Treffer gesperrt, ${hit.service} sucht automatisch nach Ersatz.` };
    });
  }
  ready() {
    const current = this.hub.engine.current();
    if (current?.job.status !== "completed") throw Error("Kein eingerichteter Stack.");
    const names = this.services(current.plan);
    if (!names.length) throw Error("Weder Radarr noch Sonarr sind eingerichtet.");
    return names;
  }
  async findIssue(s, plan, id) {
    if (!/^[a-f0-9]{32}$/.test(id || "")) throw Error("Ungültige Auswahl.");
    const { rows } = await this.rows(s, plan);
    const hit = rows.find(({ row, service }) => digest([plan.id, service, row.id, row.downloadId]) === id);
    if (!hit) throw Error("Der Download steht nicht mehr in der Warteschlange. Neu laden.");
    const issue = issueOf(hit.row, hit.service, plan);
    if (!issue.importable) throw Error("Dieser Download lässt sich (noch) nicht von Hand importieren.");
    return { ...hit, issue, targetId: hit.service === "Radarr" ? hit.row.movie?.id ?? hit.row.movieId : hit.row.series?.id ?? hit.row.seriesId };
  }
  async candidates(s, hit) {
    const list = await s.arr(hit.service, `/manualimport?downloadId=${encodeURIComponent(hit.row.downloadId)}&filterExistingFiles=false`);
    if (!Array.isArray(list)) throw Error("Importvorschau nicht lesbar.");
    return list.filter((f) => typeof f.path === "string" && f.path.startsWith("/data/")).slice(0, 100);
  }
  /** Dateien im Download mit Vorschlag und Ablehnungsgründen; bei Serien die Folgen zur Auswahl. */
  async importPreview(id) {
    const { s, plan } = await this.hub.context(this.ready());
    const hit = await this.findIssue(s, plan, id);
    const files = await this.candidates(s, hit);
    let episodes = null;
    if (hit.service === "Sonarr") {
      const all = await s.arr("Sonarr", `/episode?seriesId=${hit.targetId}`);
      episodes = (Array.isArray(all) ? all : []).filter((e) => Number.isSafeInteger(e.id)).slice(0, 3000)
        .sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber)
        .map((e) => ({ id: e.id, label: `${SxE(e)} – ${text(e.title, 80)}`, hasFile: !!e.hasFile }));
    }
    return {
      kind: hit.issue.kind, title: hit.issue.title,
      files: files.map((f) => ({
        token: fileToken(f.path), name: text(f.relativePath || f.name || f.path.split("/").pop(), 200), size: Number(f.size) || null,
        quality: text(f.quality?.quality?.name, 40) || null,
        rejections: (Array.isArray(f.rejections) ? f.rejections : []).map((r) => text(r.reason || r, 200)).slice(0, 6),
        suggestedEpisodeIds: Array.isArray(f.episodes) ? f.episodes.map((e) => e.id).filter(Number.isSafeInteger) : [],
        suggestion: hit.service === "Radarr" ? (f.movie?.title ? text(f.movie.title, 120) : null)
          : Array.isArray(f.episodes) && f.episodes.length ? f.episodes.map(SxE).join(", ") : null,
      })),
      episodes,
    };
  }
  /** Ausgewählte Dateien dem Film bzw. den gewählten Folgen zuordnen und importieren. */
  async importApply(body) {
    if (body.confirmation !== "OK") throw Error("Import mit OK bestätigen.");
    const chosen = Array.isArray(body.files) ? body.files.slice(0, 50) : [];
    if (!chosen.length) throw Error("Mindestens eine Datei auswählen.");
    return this.hub.mutate(this.ready(), async ({ s, plan }) => {
      const hit = await this.findIssue(s, plan, body.id);
      const files = await this.candidates(s, hit);
      let episodeIds = null;
      if (hit.service === "Sonarr") {
        const all = await s.arr("Sonarr", `/episode?seriesId=${hit.targetId}`);
        episodeIds = new Set((Array.isArray(all) ? all : []).map((e) => e.id));
      }
      const commandFiles = chosen.map((c) => {
        const f = files.find((x) => fileToken(x.path) === c.token);
        if (!f) throw Error("Eine gewählte Datei ist nicht mehr im Download. Neu laden.");
        const base = { path: f.path, quality: f.quality, languages: f.languages, releaseGroup: f.releaseGroup, downloadId: hit.row.downloadId };
        if (hit.service === "Radarr") return { ...base, movieId: hit.targetId };
        const ids = Array.isArray(c.episodeIds) ? [...new Set(c.episodeIds)] : [];
        if (!ids.length || ids.length > 10 || !ids.every((x) => episodeIds.has(x))) throw Error("Für jede Datei eine Folge dieser Serie wählen.");
        return { ...base, seriesId: hit.targetId, episodeIds: ids };
      });
      const cmd = await s.arr(hit.service, "/command", { method: "POST", body: { name: "ManualImport", importMode: "auto", files: commandFiles } });
      if (!Number.isSafeInteger(cmd?.id)) throw Error("Import wurde nicht angenommen.");
      for (let i = 0; i < 60; i++) {
        const st = await s.arr(hit.service, `/command/${cmd.id}`);
        if (st?.status === "completed") return { ok: true, message: `${commandFiles.length} ${commandFiles.length === 1 ? "Datei" : "Dateien"} für „${hit.issue.title}“ importiert.` };
        if (["failed", "aborted", "cancelled"].includes(st?.status)) throw Error(`${hit.service} meldet: Import fehlgeschlagen${st.message ? ` (${text(st.message, 160)})` : ""}.`);
        await new Promise((r) => setTimeout(r, this.pollMs ?? 1500));
      }
      return { ok: true, message: `Import angestoßen; ${hit.service} arbeitet noch daran.` };
    });
  }
  /** Zuordnung Download-Hash → Titel für die Downloadliste (Fehler werden ignoriert). */
  async titles(s, plan) {
    const map = new Map();
    for (const service of this.services(plan)) {
      try {
        const rows = await this.hub.readCache.read(`queue:${plan.id}:${service}`, () => allArrQueue(s, service));
        for (const row of rows) {
          if (typeof row.downloadId !== "string") continue;
          const issue = issueOf(row, service, plan);
          map.set(row.downloadId.toLowerCase(), { title: issue.title, kind: issue.kind, problem: isProblem(row) });
        }
      } catch {}
    }
    return map;
  }
}
