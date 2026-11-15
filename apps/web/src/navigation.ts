import { useCallback, useEffect, useState } from "react";

const views: Record<string, string> = {
  "Übersicht": "",
  "Medien entdecken": "entdecken",
  "Meine Anfragen": "anfragen",
  "Downloads": "downloads",
  "Anwendungen": "anwendungen",
  "Verwaltung": "verwaltung",
  "Stack konfigurieren": "einrichten",
};
const areas = new Set([
  "remote", "sources", "profiles", "connections", "safety", "backups",
  "diagnosis", "history", "audit", "about", "music",
]);
type Route = { view: string; area: string };
function readRoute(): Route {
  const [path, area = "", extra] = window.location.hash.replace(/^#\/?/, "").split("/");
  const view = Object.entries(views).find(([, value]) => value === path)?.[0];
  if (!view || extra !== undefined || (area && (view !== "Verwaltung" || !areas.has(area))))
    return { view: "Übersicht", area: "" };
  return { view, area };
}
export function viewHref(view: string, area = "") {
  const path = views[view] ?? "";
  return `#/${path}${view === "Verwaltung" && areas.has(area) ? "/" + area : ""}`;
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
