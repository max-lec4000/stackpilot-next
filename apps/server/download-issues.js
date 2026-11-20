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
  };
}

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
