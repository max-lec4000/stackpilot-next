// Qualität & Quellen → Profile bearbeiten (Phase 7 Paket 7.3): erlaubte Auflösungen, Remux,
// Upgrades bis zu einer Stufe und die Sprache je Qualitätsprofil in Radarr/Sonarr.
// Radarr kennt die Sprache direkt im Profil; Sonarr 4 nur über Custom Formats – dafür legt
// StackPilot eigene Formate „StackPilot · Sprache …“ an und verlangt sie per Mindestwertung.
// Interne StackPilot-Profile (Größenregeln, Limits) bleiben unberührt. Nach jedem Speichern
// wird das Profil zurückgelesen und verglichen.
import { internal } from "./quality-defaults.js";

const SERVICES = ["Radarr", "Sonarr"];
const TIERS = { sd: "SD (480p/576p)", hd720: "720p", hd1080: "1080p", uhd: "4K (2160p)" };
const LANGS = [["any", "Egal"], ["original", "Originalton"], ["German", "Deutsch"], ["English", "Englisch"]];
const LANG_SCORE = 1000;
const text = (v, n = 120) => (typeof v === "string" ? v.replace(/[\x00-\x1f\x7f]+/g, " ").trim().slice(0, n) : "");
const fail = (m) => Object.assign(Error(m), { userFacing: true });
const cfName = (key) => `StackPilot · Sprache ${LANGS.find(([k]) => k === key)[1]}`;

/** Stufe einer Qualität oder null (Unbekannt, CAM, BR-DISK, Raw-HD bleiben, wie sie sind). */
export function tierOf(q) {
  if (!q || /BR-DISK|Raw-HD/i.test(q.name || "")) return null;
  const r = Number(q.resolution);
  return r === 480 || r === 576 ? "sd" : r === 720 ? "hd720" : r === 1080 ? "hd1080" : r === 2160 ? "uhd" : null;
}
const remux = (q) => /remux/i.test(q?.name || "");
const qualities = (item) => (item.quality ? [item] : Array.isArray(item.items) ? item.items : []);
const itemId = (item) => (item.quality ? item.quality.id : item.id);
const itemName = (item) => text(item.quality ? item.quality.name : item.name, 40);

export function projectProfile(p, service, ours = {}) {
  const tiers = Object.fromEntries(Object.keys(TIERS).map((t) => [t, false]));
  let remuxOn = false;
  for (const item of p.items || []) for (const q of qualities(item)) {
    const t = tierOf(q.quality);
    if (!t || !q.allowed || (item.quality ? false : !item.allowed)) continue;
    if (remux(q.quality)) remuxOn = true; else tiers[t] = true;
  }
  // Alle Stufen mit Auflösung und Remux-Kennung: die Oberfläche filtert nach der aktuellen Auswahl
  const options = (p.items || []).map((i) => {
    const first = qualities(i).find((q) => tierOf(q.quality));
    const tier = first ? tierOf(first.quality) : null;
    return { id: itemId(i), name: itemName(i), tier, remux: first ? remux(first.quality) : false, allowed: i.allowed === true };
  }).filter((o) => o.tier || o.allowed);
  let language = "any", languageEditable = true, reason = null;
  if (service === "Radarr") {
    const id = p.language?.id;
    language = id === -1 || id === undefined ? "any" : id === -2 ? "original" : LANGS.find(([k]) => k === p.language?.name)?.[0] ?? `id:${id}`;
  } else {
    const min = Number(p.minFormatScore) || 0;
    const hit = (p.formatItems || []).find((f) => ours[f.format] && f.score === LANG_SCORE);
    if (![0, LANG_SCORE].includes(min) || (min === LANG_SCORE && !hit)) {
      languageEditable = false;
      reason = "Dieses Profil nutzt eine eigene Formatwertung – Sprache bitte in Sonarr ändern.";
    } else if (hit && min === LANG_SCORE) language = ours[hit.format];
  }
  return {
    id: p.id, name: text(p.name), tiers, remux: remuxOn, upgrades: p.upgradeAllowed === true,
    cutoff: p.cutoff, cutoffOptions: options, language, languageEditable, ...(reason ? { reason } : {}),
  };
}

/** Neue Items: erlaubte Stufen und Remux setzen, unbekannte Qualitäten unverändert. */
export function applyTiers(items, tiers, remuxOn) {
  return items.map((item) => {
    if (item.quality) {
      const t = tierOf(item.quality);
      return t ? { ...item, allowed: !!tiers[t] && (!remux(item.quality) || remuxOn) } : item;
    }
    const inner = (item.items || []).map((q) => {
      const t = tierOf(q.quality);
      return t ? { ...q, allowed: !!tiers[t] && (!remux(q.quality) || remuxOn) } : q;
    });
    const managed = (item.items || []).some((q) => tierOf(q.quality));
    return { ...item, items: inner, allowed: managed ? inner.some((q) => q.allowed) : item.allowed };
  });
}

export class QualityProfiles {
  constructor(hub) {
    this.hub = hub;
  }
  services() {
    const current = this.hub.engine.current();
    if (current?.job.status !== "completed") throw fail("Kein eingerichteter Stack.");
    const names = SERVICES.filter((n) => current.plan.spec.selected.includes(n));
    if (!names.length) throw fail("Weder Radarr noch Sonarr sind eingerichtet.");
    return names;
  }
  /** Formate „StackPilot · Sprache …“ in Sonarr: id → Sprachschlüssel. */
  static async ours(s) {
    const list = await s.arr("Sonarr", "/customformat");
    const map = {};
    for (const [key] of LANGS.slice(1)) {
      const f = (Array.isArray(list) ? list : []).find((c) => c.name === cfName(key));
      if (f) map[f.id] = key;
    }
    return map;
  }
  async read() {
    const names = this.services();
    const { s } = await this.hub.context(names);
    const services = await Promise.all(names.map(async (service) => {
      try {
        const profiles = await s.arr(service, "/qualityprofile");
        const ours = service === "Sonarr" ? await QualityProfiles.ours(s) : {};
        return {
          service, kind: service === "Radarr" ? "movie" : "tv",
          profiles: (Array.isArray(profiles) ? profiles : []).filter((p) => !internal(p)).map((p) => projectProfile(p, service, ours)),
        };
      } catch {
        return { service, kind: service === "Radarr" ? "movie" : "tv", error: `${service} nicht erreichbar.` };
      }
    }));
    return { tiers: TIERS, languages: LANGS.map(([key, label]) => ({ key, label })), services };
  }
  async languageId(s, service, key) {
    if (key === "original") return -2;
    const list = await s.arr(service, "/language");
    const hit = (Array.isArray(list) ? list : []).find((l) => l.name === key);
    if (!hit) throw fail(`${service} kennt die Sprache nicht.`);
    return hit.id;
  }
  /** Sonarr: eigenes Sprachformat sicherstellen (wird automatisch allen Profilen mit 0 Punkten zugeordnet). */
  async ensureFormat(s, key) {
    const ours = await QualityProfiles.ours(s);
    const found = Object.entries(ours).find(([, k]) => k === key);
    if (found) return Number(found[0]);
    const created = await s.arr("Sonarr", "/customformat", { method: "POST", body: {
      name: cfName(key), includeCustomFormatWhenRenaming: false,
      specifications: [{ name: "Sprache", implementation: "LanguageSpecification", negate: false, required: true,
        fields: [{ name: "value", value: await this.languageId(s, "Sonarr", key) }, { name: "exceptLanguage", value: false }] }],
    } });
    if (!Number.isSafeInteger(created?.id)) throw Error("Sonarr hat das Sprachformat nicht angelegt.");
    return created.id;
  }
  /** body: { service, profileId, tiers, remux, upgrades, cutoff?, language, confirmation } */
  async change(body) {
    if (body.confirmation !== "OK") throw fail("Profiländerung mit OK bestätigen.");
    const names = this.services();
    const service = body.service;
    if (!names.includes(service)) throw fail("Radarr oder Sonarr wählen.");
    const profileId = Number(body.profileId);
    if (!Number.isSafeInteger(profileId) || profileId < 1) throw fail("Ungültiges Profil.");
    const tiers = body.tiers;
    if (!tiers || typeof tiers !== "object" || Object.keys(TIERS).some((t) => typeof tiers[t] !== "boolean") || Object.keys(tiers).length !== 4)
      throw fail("Ungültige Auflösungen.");
    if (!Object.values(tiers).some(Boolean)) throw fail("Mindestens eine Auflösung erlauben.");
    for (const k of ["remux", "upgrades"]) if (typeof body[k] !== "boolean") throw fail("Ungültige Angabe.");
    if (!LANGS.some(([k]) => k === body.language) && !/^id:-?\d+$/.test(body.language || "")) throw fail("Ungültige Sprache.");
    return this.hub.mutate([service], async ({ s }) => {
      const before = await s.arr(service, `/qualityprofile/${profileId}`);
      if (before?.id !== profileId || internal(before)) throw fail("Dieses Profil kann hier nicht bearbeitet werden.");
      const oursBefore = service === "Sonarr" ? await QualityProfiles.ours(s) : {};
      const current = projectProfile(before, service, oursBefore);
      const items = applyTiers(before.items, tiers, body.remux);
      const options = items.filter((i) => i.allowed).map(itemId);
      if (!options.length) throw fail("Mit dieser Auswahl bleibt keine Qualität übrig.");
      const wanted = body.cutoff === undefined || body.cutoff === null ? before.cutoff : Number(body.cutoff);
      const cutoff = options.includes(wanted) ? wanted : options.at(-1);
      const next = { ...before, items, upgradeAllowed: body.upgrades, cutoff };
      const languageChanged = body.language !== current.language;
      if (languageChanged && !LANGS.some(([k]) => k === body.language)) throw fail("Ungültige Sprache.");
      let expectLanguage = current.language;
      if (languageChanged) {
        if (service === "Radarr") {
          const id = body.language === "any" ? -1 : await this.languageId(s, "Radarr", body.language);
          const list = await s.arr("Radarr", "/language");
          const lang = (Array.isArray(list) ? list : []).find((l) => l.id === id);
          next.language = { id, name: lang?.name ?? (id === -1 ? "Any" : "Original") };
        } else {
          if (!current.languageEditable) throw fail(current.reason);
          const formatId = body.language === "any" ? null : await this.ensureFormat(s, body.language);
          // Profil nach dem Anlegen neu lesen: Sonarr ergänzt das neue Format in formatItems
          const fresh = formatId ? await s.arr("Sonarr", `/qualityprofile/${profileId}`) : before;
          const ours = await QualityProfiles.ours(s);
          next.formatItems = (fresh.formatItems || []).map((f) => (ours[f.format] ? { ...f, score: f.format === formatId ? LANG_SCORE : 0 } : f));
          if (formatId && !next.formatItems.some((f) => f.format === formatId))
            next.formatItems.push({ format: formatId, name: cfName(body.language), score: LANG_SCORE });
          next.minFormatScore = formatId ? LANG_SCORE : 0;
        }
        expectLanguage = body.language;
      }
      await s.arr(service, `/qualityprofile/${profileId}`, { method: "PUT", body: next });
      const after = projectProfile(await s.arr(service, `/qualityprofile/${profileId}`), service,
        service === "Sonarr" ? await QualityProfiles.ours(s) : {});
      const expected = projectProfile(next, service);
      if (Object.keys(TIERS).some((t) => after.tiers[t] !== expected.tiers[t]) || after.remux !== expected.remux ||
          after.upgrades !== body.upgrades || after.cutoff !== cutoff || after.language !== expectLanguage)
        throw Error(`${service} hat die Änderung nicht vollständig übernommen. Neu laden.`);
      return after;
    });
  }
}
