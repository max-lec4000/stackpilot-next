// Verwaltete Verbindungen abgleichen (Phase 7, Nachzug zu 7.5): Nach einer Container-Rückkehr
// oder einer Wiederherstellung können Apps einen älteren Datenstand haben – und damit alte
// Schlüssel anderer Apps (z. B. Seerr mit einem längst erneuerten Sonarr-Schlüssel). Dieser
// Abgleich schreibt in die von StackPilot verwalteten Verbindungen wieder die Schlüssel aus dem
// Tresor und testet jede Verbindung:
//   Seerr  → Sonarr/Radarr       (Einstellungen „StackPilot <App>“)
//   Bazarr → Sonarr/Radarr       (Abschnitte sonarr/radarr)
//   Prowlarr → Sonarr/Radarr/Lidarr (Anwendungen „StackPilot <App>“)
//   Sonarr/Radarr/Lidarr → Prowlarr (synchronisierte Quellen http://prowlarr:9696/<n>)
// Nicht eindeutig verwaltete Verbindungen werden nur gemeldet, nie verändert.
import { catalog } from "./catalog.js";

const masked = (v) => typeof v === "string" && /^\*+$/.test(v);
const keyOf = (s, name) => { try { const k = s.credentials(name)?.apiKey; return /^[a-f0-9]{32}$/i.test(k || "") ? k : null; } catch { return null; } };
const url = (slug, port) => [`http://${slug}:${port}`, `http://${slug}:${port}/`];

export async function reconcileKeys(s) {
  const selected = (n) => !!s?.plan?.spec?.selected?.includes(n);
  const out = { checked: 0, repaired: [], problems: [] };
  const note = (label, fn) => fn().catch((e) => { out.problems.push(`${label}: ${String(e?.message || e).slice(0, 160)}`); });
  const targets = ["Sonarr", "Radarr", "Lidarr"].filter(selected);

  for (const name of targets) {
    const key = keyOf(s, name);
    if (!key) continue;
    const { slug, port } = catalog.services[name];

    if (name !== "Lidarr" && selected("Seerr")) await note(`Seerr → ${name}`, async () => {
      const route = "/settings/" + slug;
      const rows = (await s.additional.seerr(route)).filter((r) => r.name === "StackPilot " + name);
      if (!rows.length) return;
      const [row] = rows;
      if (rows.length !== 1 || row.hostname !== slug || Number(row.port) !== port || row.useSsl !== false || !Number.isSafeInteger(row.id))
        throw Error("Verbindung nicht eindeutig verwaltet – unverändert.");
      out.checked++;
      if (row.apiKey !== key) {
        const { id, ...settings } = row;
        await s.additional.seerr(`${route}/${id}`, { method: "PUT", body: { ...settings, apiKey: key } });
        const again = (await s.additional.seerr(route)).find((r) => r.id === id);
        if (again?.apiKey !== key) throw Error("Neuer Schlüssel nicht gespeichert.");
        out.repaired.push(`Seerr → ${name}`);
      }
      await s.additional.seerr(route + "/test", { method: "POST", body: { ...row, apiKey: key } })
        .catch(() => { throw Error("Verbindungstest fehlgeschlagen."); });
    });

    if (name !== "Lidarr" && selected("Bazarr")) await note(`Bazarr → ${name}`, async () => {
      const config = await s.additional.bazarr("/system/settings");
      if (config.general?.["use_" + slug] !== true) return;
      const section = config[slug];
      if (section?.ip !== slug || Number(section.port) !== port || section.ssl !== false || !["", "/"].includes(section.base_url ?? ""))
        throw Error("Verbindung nicht eindeutig verwaltet – unverändert.");
      out.checked++;
      if (section.apikey !== key) {
        await s.additional.bazarr("/system/settings", { method: "POST", body: new URLSearchParams({ [`settings-${slug}-apikey`]: key }) });
        const again = await s.additional.bazarr("/system/settings");
        if (again[slug]?.apikey !== key) throw Error("Neuer Schlüssel nicht gespeichert.");
        out.repaired.push(`Bazarr → ${name}`);
      }
    });

    if (selected("Prowlarr")) await note(`Prowlarr → ${name}`, async () => {
      const apps = (await s.arr("Prowlarr", "/applications")).filter((a) => a.name === "StackPilot " + name);
      if (!apps.length) return;
      const [app] = apps;
      const base = app.fields?.find((f) => f.name === "baseUrl")?.value;
      const fields = app.fields?.filter((f) => f.name === "apiKey") || [];
      if (apps.length !== 1 || app.implementation !== name || !url(slug, port).includes(base) || fields.length !== 1 || !Number.isSafeInteger(app.id))
        throw Error("Verbindung nicht eindeutig verwaltet – unverändert.");
      out.checked++;
      const current = fields[0].value;
      const works = current === key || (masked(current) && await s.arr("Prowlarr", "/applications/test", { method: "POST", body: app }).then(() => true, () => false));
      if (!works) {
        const next = { ...app, fields: app.fields.map((f) => (f.name === "apiKey" ? { ...f, value: key } : f)) };
        await s.arr("Prowlarr", `/applications/${app.id}`, { method: "PUT", body: next });
        out.repaired.push(`Prowlarr → ${name}`);
        await s.arr("Prowlarr", "/applications/test", { method: "POST", body: next }).catch(() => { throw Error("Verbindungstest fehlgeschlagen."); });
      }
    });
  }

  // Quellen in Sonarr/Radarr/Lidarr, die Prowlarr synchronisiert hat, tragen Prowlarrs Schlüssel
  const pKey = selected("Prowlarr") ? keyOf(s, "Prowlarr") : null;
  if (pKey) for (const name of targets) await note(`${name} → Prowlarr-Quellen`, async () => {
    const rows = (await s.arr(name, "/indexer")).filter((r) => (r.fields || []).some((f) => /^(baseUrl|url)$/i.test(f.name) && /^http:\/\/prowlarr:9696\/\d+\/?$/.test(f.value || "")));
    let fixed = 0;
    for (const row of rows) {
      const fields = (row.fields || []).filter((f) => f.name === "apiKey");
      if (fields.length !== 1 || !["Torznab", "Newznab"].includes(row.implementation) || !Number.isSafeInteger(row.id)) {
        out.problems.push(`${name} → Prowlarr-Quelle „${String(row.name).slice(0, 60)}“: nicht eindeutig – unverändert.`);
        continue;
      }
      out.checked++;
      const current = fields[0].value;
      const works = current === pKey || (masked(current) && await s.arr(name, "/indexer/test", { method: "POST", body: row }).then(() => true, () => false));
      if (works) continue;
      await s.arr(name, `/indexer/${row.id}`, { method: "PUT", body: { ...row, fields: row.fields.map((f) => (f.name === "apiKey" ? { ...f, value: pKey } : f)) } });
      fixed++;
    }
    if (fixed) out.repaired.push(`${name} → Prowlarr-Quellen (${fixed})`);
  });
  return out;
}

/** Gemerkte Anmeldungen (z. B. Seerr-Sitzung) gehören evtl. zum alten Datenstand – verwerfen. */
export function forgetSessions(s) {
  if (s?.cookies && typeof s.cookies === "object") for (const k of Object.keys(s.cookies)) delete s.cookies[k];
}

/** Ergebnis in einem Satz für die Oberfläche. */
export function reconcileSummary(r) {
  if (!r) return "";
  const parts = [];
  if (r.repaired.length) parts.push(`Schlüssel abgeglichen: ${r.repaired.join(", ")}.`);
  if (r.problems.length) parts.push(`Bitte prüfen: ${r.problems.join("; ")}.`);
  return parts.join(" ");
}
