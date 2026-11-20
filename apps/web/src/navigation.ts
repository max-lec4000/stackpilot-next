import { useCallback, useEffect, useState } from "react";

/**
 * Zielnavigation (Phase 7.0b): neun Bereiche nach Aufgaben, jeweils mit Unterseiten.
 * Jede Unterseite zeigt eine bestehende Ansicht (view) bzw. einen Verwaltungsbereich (area);
 * so bleiben die Bausteine unverändert, und navigate(view, area) funktioniert weiter.
 * Adressen: #/<bereich>/<unterseite>; alte Adressen werden auf die neuen umgeleitet.
 */
export type Page = { id: string; title: string; view: string; area?: string };
export type Section = { id: string; title: string; icon: string; description: string; pages: Page[] };

export const sections: Section[] = [
  { id: "", title: "Zuhause", icon: "home", description: "Dein Stack, deine Medien – die wichtigen Dinge auf einen Blick.",
    pages: [{ id: "", title: "Übersicht", view: "Übersicht" }] },
  { id: "medien", title: "Medien", icon: "discover", description: "Finden, ansehen und hören.",
    pages: [
      { id: "entdecken", title: "Entdecken", view: "Medien entdecken" },
      { id: "musik", title: "Musik", view: "Verwaltung", area: "music" },
    ] },
  { id: "anfragen", title: "Anfragen", icon: "requests", description: "Vom Wunsch bis zur Wiedergabe.",
    pages: [
      { id: "", title: "Meine Anfragen", view: "Meine Anfragen" },
      { id: "freigabe", title: "Freigabe je Zuschauer", view: "Verwaltung", area: "viewer-requests" },
    ] },
  { id: "downloads", title: "Downloads", icon: "downloads", description: "Transfers, Größen und VPN-Schutz.",
    pages: [{ id: "", title: "Downloads", view: "Downloads" }] },
  { id: "personen", title: "Personen", icon: "remote", description: "Zuschauer einladen, Anmeldung und Profile verwalten.",
    pages: [{ id: "", title: "Zuschauer", view: "Verwaltung", area: "people" }] },
  { id: "qualitaet", title: "Qualität & Quellen", icon: "profiles", description: "Größenregeln, Profile, Suchquellen und Untertitel.",
    pages: [
      { id: "", title: "Medienprofile", view: "Verwaltung", area: "profiles" },
      { id: "quellen", title: "Quellen", view: "Verwaltung", area: "sources" },
      { id: "untertitel", title: "Untertitel", view: "Verwaltung", area: "subtitles" },
    ] },
  { id: "speicher", title: "Speicher", icon: "backups", description: "Wofür der Platz draufgeht – und gezielt aufräumen.",
    pages: [
      { id: "", title: "Belegung", view: "Verwaltung", area: "storage" },
      { id: "aufraeumen", title: "Aufräumen", view: "Verwaltung", area: "media-files" },
    ] },
  { id: "couchdeck", title: "Couchdeck", icon: "apps", description: "Der Bildschirm am Server: Zustand, Start und Updates.",
    pages: [{ id: "", title: "Couchdeck", view: "Verwaltung", area: "couchdeck" }] },
  { id: "system", title: "System", icon: "settings", description: "Apps, Updates, Zugriff und Diagnose.",
    pages: [
      { id: "", title: "Apps & Container", view: "Anwendungen" },
      { id: "updates", title: "Updates & Sicherungen", view: "Verwaltung", area: "backups" },
      { id: "zugriff", title: "Zugriff & Netzwerk", view: "Verwaltung", area: "remote" },
      { id: "vpn", title: "VPN & Ausfallsperre", view: "Verwaltung", area: "safety" },
      { id: "verbindungen", title: "Verbindungen", view: "Verwaltung", area: "connections" },
      { id: "diagnose", title: "Diagnose", view: "Verwaltung", area: "diagnosis" },
      { id: "auftraege", title: "Auftragsverlauf", view: "Verwaltung", area: "history" },
      { id: "verlauf", title: "Änderungsverlauf", view: "Verwaltung", area: "audit" },
      { id: "ueber", title: "Über StackPilot", view: "Verwaltung", area: "about" },
      { id: "einrichten", title: "Stack konfigurieren", view: "Stack konfigurieren" },
    ] },
];

// Alte Adressen (vor 7.0b) → neue
const legacy: Record<string, string> = {
  entdecken: "medien/entdecken",
  anwendungen: "system",
  verwaltung: "system",
  einrichten: "system/einrichten",
  "verwaltung/music": "medien/musik",
  "verwaltung/media-files": "speicher/aufraeumen",
  "verwaltung/remote": "system/zugriff",
  "verwaltung/sources": "qualitaet/quellen",
  "verwaltung/profiles": "qualitaet",
  "verwaltung/connections": "system/verbindungen",
  "verwaltung/safety": "system/vpn",
  "verwaltung/backups": "system/updates",
  "verwaltung/diagnosis": "system/diagnose",
  "verwaltung/history": "system/auftraege",
  "verwaltung/audit": "system/verlauf",
  "verwaltung/about": "system/ueber",
};

export type Route = { view: string; area: string; section: Section; page: Page };
const home = sections[0];
const routeOf = (section: Section, page: Page): Route => ({ view: page.view, area: page.area || "", section, page });
const hrefOf = (section: Section, page: Page) => "#/" + [section.id, page.id].filter(Boolean).join("/");

/** Pfad (ohne #/) → Route; alte Pfade werden übersetzt. null = unbekannt. */
export function resolvePath(raw: string): { route: Route; legacy: boolean } | null {
  let path = raw.replace(/^#?\/?/, "").replace(/\/$/, "");
  const old = legacy[path];
  if (old !== undefined) path = old;
  const [sectionId = "", pageId = "", extra] = path.split("/");
  if (extra !== undefined) return null;
  const section = sections.find((s) => s.id === sectionId);
  const page = section?.pages.find((p) => p.id === pageId);
  if (!section || !page) return null;
  return { route: routeOf(section, page), legacy: old !== undefined };
}

function readRoute(): Route {
  const found = resolvePath(window.location.hash);
  if (!found) return routeOf(home, home.pages[0]);
  // Alte Adresse sichtbar auf die neue umstellen (ohne zusätzlichen Verlaufseintrag)
  if (found.legacy) window.history.replaceState(null, "", hrefOf(found.route.section, found.route.page));
  return found.route;
}

/** Adresse zu einer bestehenden Ansicht bzw. einem Verwaltungsbereich. */
export function viewHref(view: string, area = "") {
  for (const section of sections)
    for (const page of section.pages)
      if (page.view === view && (page.area || "") === area) return hrefOf(section, page);
  // „Verwaltung“ ohne bekannten Bereich → System; unbekannte Ansicht → Zuhause
  if (view === "Verwaltung") return "#/system";
  return "#/";
}

export function sectionHref(section: Section, page: Page = section.pages[0]) {
  return hrefOf(section, page);
}

/** Hash routes work with the existing loopback-only static server and browser history. */
export function useNavigation() {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const update = () => setRoute(readRoute());
    window.addEventListener("hashchange", update);
    window.addEventListener("popstate", update);
    return () => {
      window.removeEventListener("hashchange", update);
      window.removeEventListener("popstate", update);
    };
  }, []);
  const navigate = useCallback((view: string, area = "", replace = false) => {
    const hash = viewHref(view, area);
    if (window.location.hash !== hash) {
      if (replace) window.history.replaceState(null, "", hash);
      else window.history.pushState(null, "", hash);
    }
    setRoute(readRoute());
  }, []);
  return { ...route, navigate };
}
