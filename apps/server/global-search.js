import { managedServices } from "./managed.js";
export async function globalSearch(query, hub, managed = managedServices) {
  if (typeof query !== "string" || query.trim().length < 2 || query.length > 160) throw Error("Ungültiger Suchbegriff: 2–160 Zeichen angeben.");
  const text = query.trim(), term = text.toLocaleLowerCase("de");
  const result = { applications: [], media: [], requested: [], unavailable: [] };
  const [apps, media] = await Promise.allSettled([
    managed(hub.engine),
    hub.search(text),
  ]);
  if (apps.status === "fulfilled") result.applications = apps.value.services.filter((service) => service.name.toLocaleLowerCase("de").includes(term)).map((service) => ({ title: service.name, state: service.state }));
  else result.unavailable.push("Anwendungen");
  if (media.status === "fulfilled") {
    result.media = media.value.results.slice(0, 12).map((item) => ({ id: item.id, type: item.type, title: item.title, year: item.year, requested: item.requested, available: item.status === 5 }));
    result.requested = result.media.filter((item) => item.requested);
  } else result.unavailable.push("Mediensuche und Anfragenzuordnung");
  return result;
}
