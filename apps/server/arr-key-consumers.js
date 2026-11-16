import { isDeepStrictEqual } from "node:util";
import { catalog } from "./catalog.js";

function prowlarrConsumer(s, name, slug, port) {
  const arr = (route, options) => s.arr("Prowlarr", route, options);
  const url = `http://${slug}:${port}`;
  const managedUrl = (app) => app.fields?.some(field =>
    field.name === "baseUrl" && [url, url + "/"].includes(field.value));
  return {
    name: "Prowlarr",
    async read(keys) {
      const apps = await arr("/applications");
      const targets = apps.filter(app => app.name === "StackPilot " + name ||
        (app.implementation === name && managedUrl(app)) ||
        app.fields?.some(field => field.name === "apiKey" && keys.includes(field.value)));
      if (!targets.length) return null;
      const [app] = targets;
      const fields = app.fields?.filter(field => field.name === "apiKey") || [];
      const key = fields[0]?.value;
      const masked = typeof key === "string" && /^\*+$/.test(key);
      if (targets.length !== 1 || app.name !== "StackPilot " + name || app.implementation !== name ||
          !managedUrl(app) || !Number.isSafeInteger(app.id) ||
          fields.length !== 1 || (!masked && !keys.includes(key)))
        throw Error("Prowlarrs verwaltete Verbindung ist nicht eindeutig.");
      return { id: app.id, key: masked ? null : key, app };
    },
    write: ({ app }, key) => arr(`/applications/${app.id}`, {
      method: "PUT", body: { ...app, fields: app.fields.map(field =>
        field.name === "apiKey" ? { ...field, value: key } : field) },
    }),
    verify: ({ app }) => arr("/applications/test", { method: "POST", body: app }),
  };
}

function seerrConsumer(s, name, slug, port) {
  const route = "/settings/" + slug;
  const seerr = (path, options) => s.additional.seerr(path, options);
  return {
    name: "Seerr",
    async read(keys) {
      const rows = await seerr(route);
      const targets = rows.filter(row => row.name === "StackPilot " + name ||
        row.hostname === slug || keys.includes(row.apiKey));
      if (!targets.length) return null;
      const [app] = targets;
      if (targets.length !== 1 || app.name !== "StackPilot " + name ||
          app.hostname !== slug || Number(app.port) !== port || app.useSsl !== false ||
          ![undefined, "", "/"].includes(app.baseUrl) || !Number.isSafeInteger(app.id) ||
          !keys.includes(app.apiKey))
        throw Error("Seerrs verwaltete Verbindung ist nicht eindeutig.");
      return { id: app.id, key: app.apiKey, app };
    },
    write: ({ app: { id, ...settings } }, key) => seerr(`${route}/${id}`, {
      method: "PUT", body: { ...settings, apiKey: key },
    }),
    verify: ({ app }) => seerr(route + "/test", { method: "POST", body: app }),
  };
}

function bazarrConsumer(s, slug, port) {
  const bazarr = (route, options) => s.additional.bazarr(route, options);
  return {
    name: "Bazarr",
    async read(keys) {
      const config = await bazarr("/system/settings");
      if (config.general?.["use_" + slug] === false) return null;
      const section = config[slug];
      if (config.general?.["use_" + slug] !== true || section?.ip !== slug ||
          Number(section.port) !== port || section.ssl !== false ||
          !["", "/"].includes(section.base_url) || !keys.includes(section.apikey))
        throw Error("Bazarrs verwaltete Verbindung ist nicht eindeutig.");
      return { id: slug, key: section.apikey };
    },
    write: (_link, key) => bazarr("/system/settings", {
      method: "POST", body: new URLSearchParams({ [`settings-${slug}-apikey`]: key }),
    }),
    async verify() {
      const { data } = await bazarr("/system/status");
      if (!/^\d+\./.test(data?.[slug + "_version"] || ""))
        throw Error("Bazarr meldet keinen erreichbaren Dienst.");
    },
  };
}

export async function arrKeyConsumers(services, name, previous, next, pending, expected) {
  const { slug, port } = catalog.services[name];
  const consumers = [prowlarrConsumer(services, name, slug, port)];
  if (name !== "Lidarr")
    consumers.push(seerrConsumer(services, name, slug, port), bazarrConsumer(services, slug, port));
  const active = consumers.filter(consumer => services.plan.spec.selected.includes(consumer.name));
  const keys = pending ? [previous, next] : [previous];
  async function discover() {
    return Object.fromEntries(await Promise.all(active.map(async consumer => {
      const link = await consumer.read(keys).catch(() => {
        throw Error(`${consumer.name}: Die verwaltete ${name}-Verbindung ist nicht eindeutig oder nicht erreichbar.`);
      });
      return [consumer.name, link];
    })));
  }
  const initial = await discover();
  const ids = Object.fromEntries(active.map(consumer => [consumer.name, initial[consumer.name]?.id ?? null]));
  if (expected && !isDeepStrictEqual(expected, ids))
    throw Error("Die verwalteten Verbindungen haben sich während des Schlüsselwechsels geändert.");
  const activeLinks = active.filter(consumer => initial[consumer.name]);
  if (!pending)
    for (const consumer of activeLinks)
      await consumer.verify(initial[consumer.name]).catch(() => {
        throw Error(`${consumer.name} bestätigt die bisherige ${name}-Verbindung nicht.`);
      });
  return {
    ids,
    async update() {
      keys.push(next);
      const current = await discover();
      if (active.some(consumer => (current[consumer.name]?.id ?? null) !== ids[consumer.name]))
        throw Error("Die verwalteten Verbindungen haben sich während des Schlüsselwechsels geändert.");
      for (const consumer of activeLinks) {
        try {
          const link = current[consumer.name];
          // A masked Prowlarr field alone does not distinguish the two keys.
          const alreadyWorks = link.key === null &&
            await consumer.verify(link).then(() => true, () => false);
          if (link.key !== next && !alreadyWorks) await consumer.write(link, next);
          const confirmed = await consumer.read(keys);
          if (confirmed?.id !== link.id || (confirmed.key !== null && confirmed.key !== next))
            throw Error("Der neue Schlüssel wurde nicht gespeichert.");
          await consumer.verify(confirmed);
        } catch {
          throw Error(`${name} nutzt den neuen Schlüssel. ${consumer.name} ist noch nicht bestätigt. Dieselbe Aktion erneut ausführen.`);
        }
      }
    },
  };
}
