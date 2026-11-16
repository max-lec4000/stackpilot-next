import { isDeepStrictEqual } from "node:util";
import { catalog } from "./catalog.js";

const targets = ["Sonarr", "Radarr", "Lidarr"];
const masked = key => typeof key === "string" && /^\*+$/.test(key);

export async function prowlarrKeyConsumers(s, previous, next, pending, expected) {
  const selected = targets.filter(name => s.plan.spec.selected.includes(name));
  async function indexes() {
    const entries = await Promise.all(selected.map(async name => {
      const rows = await s.arr(name, "/indexer");
      return [name, rows.flatMap(row => {
        const endpoints = (row.fields || []).filter(field => /^(baseUrl|url)$/i.test(field.name));
        const connected = endpoints.some(field => typeof field.value === "string" &&
          /^https?:\/\/prowlarr(?=[:/]|$)/i.test(field.value));
        const fields = row.fields?.filter(field => field.name === "apiKey") || [];
        const key = fields[0]?.value;
        if (!connected && ![previous, next].includes(key)) return [];
        const url = endpoints[0]?.value;
        const ref = typeof url === "string" && /^http:\/\/prowlarr:9696\/(\d+)\/?$/.exec(url);
        if (!ref || endpoints.length !== 1 || fields.length !== 1 ||
            !["Torznab", "Newznab"].includes(row.implementation) ||
            !(masked(key) || [previous, next].includes(key)) || !Number.isSafeInteger(row.id))
          throw Error(`${name}: Eine Prowlarr-Quelle ist nicht eindeutig verwaltet.`);
        return [{ row, key, source: Number(ref[1]) }];
      })];
    }));
    return Object.fromEntries(entries);
  }
  const initial = await indexes();
  const getIds = entries => Object.fromEntries(selected.map(name =>
    [name, entries[name].map(({ row, source }) => [row.id, source]).sort((a, b) => a[0] - b[0])]));
  const ids = getIds(initial);
  if (expected && !isDeepStrictEqual(expected, ids))
    throw Error("Die Prowlarr-Quellen haben sich seit dem vorbereiteten Schlüsselwechsel geändert.");

  async function verifyOwnership(key) {
    const options = { headers: { "X-Api-Key": key } };
    const [apps, sources] = await Promise.all([s.arr("Prowlarr", "/applications", options), s.arr("Prowlarr", "/indexer", options)]);
    for (const name of selected) {
      if (!ids[name].length) continue;
      const { slug, port } = catalog.services[name];
      const owners = apps.filter(app => app.implementation === name && app.name === "StackPilot " + name &&
        app.fields?.some(field => field.name === "baseUrl" && [`http://${slug}:${port}`, `http://${slug}:${port}/`].includes(field.value)) &&
        app.fields?.some(field => field.name === "prowlarrUrl" && ["http://prowlarr:9696", "http://prowlarr:9696/"].includes(field.value)));
      if (owners.length !== 1 || ids[name].some(([, source]) => !sources.some(row => row.id === source)))
        throw Error(`${name}: Prowlarr konnte die synchronisierte Quelle nicht eindeutig bestätigen.`);
    }
  }
  if (!pending) await verifyOwnership(previous);
  return {
    ids,
    async update() {
      await verifyOwnership(next);
      const current = await indexes();
      if (!isDeepStrictEqual(ids, getIds(current)))
        throw Error("Die synchronisierten Prowlarr-Quellen wurden parallel geändert. Erneut prüfen.");
      for (const name of selected) {
        for (const { row, key } of current[name]) {
          try {
            const verify = async () => {
              const saved = await s.arr(name, `/indexer/${row.id}`);
              const field = saved.fields?.find(field => field.name === "apiKey");
              if (field?.value === next) return;
              if (!masked(field?.value)) throw Error("Gespeicherter Schlüssel weicht ab.");
              await s.arr(name, "/indexer/test", { method: "POST", body: saved });
            };
            if (key === next) continue;
            if (masked(key) && await verify().then(() => true, () => false)) continue;
            await s.arr(name, `/indexer/${row.id}`, {
              method: "PUT", body: { ...row, fields: row.fields.map(field =>
                field.name === "apiKey" ? { ...field, value: next } : field) },
            });
            await verify();
          } catch {
            throw Error(`Prowlarr nutzt den neuen Schlüssel. Quelle in ${name} noch nicht bestätigt. Dieselbe Aktion erneut ausführen.`);
          }
        }
      }
    },
  };
}
