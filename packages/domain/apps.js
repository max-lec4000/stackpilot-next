// Katalog der Beziehungen zwischen den Apps. Eine neue App wird hier eingetragen; Planer,
// Assistent und Einrichtung lesen daraus, welche Apps sie braucht und von welchen sie
// Adresse und API-Schlüssel automatisch bekommt (siehe Services.linksFor()).
//
//   requires:    ohne diese App ist die Auswahl nicht einrichtbar (Fehler im Plan)
//   requiresAny: mindestens eine davon muss gewählt sein (Fehler im Plan)
//   linksTo:     bekommt Adresse und Schlüssel dieser Apps, wenn sie mit gewählt sind
//   group:       Abschnitt im Assistenten
export const apps = {
  Jellyfin: { group: "media", icon: "▷", label: "Medien & Bibliotheken" },
  Streamystats: { group: "media", icon: "▥", label: "Jellyfin-Statistiken", requires: ["Jellyfin"], linksTo: ["Jellyfin"] },
  Seerr: { group: "media", icon: "✦", label: "Medienanfragen", requires: ["Jellyfin"], linksTo: ["Jellyfin", "Sonarr", "Radarr"] },
  Sonarr: { group: "arr", icon: "◉", label: "Serien", linksTo: ["qBittorrent"] },
  Radarr: { group: "arr", icon: "◈", label: "Filme", linksTo: ["qBittorrent"] },
  Lidarr: { group: "arr", icon: "♫", label: "Musik", linksTo: ["qBittorrent"] },
  Prowlarr: { group: "arr", icon: "⌕", label: "Indexer", linksTo: ["Sonarr", "Radarr", "Lidarr"] },
  Bazarr: { group: "arr", icon: "Aa", label: "Untertitel", requiresAny: ["Sonarr", "Radarr"], linksTo: ["Sonarr", "Radarr"] },
  qBittorrent: { group: "download", icon: "↓", label: "Downloads" },
};
export const appNames = Object.keys(apps);
/** Alle Verbindungen [von, zu] für eine Auswahl. */
export function linksIn(selected) {
  return appNames
    .filter((name) => selected.includes(name))
    .flatMap((name) => (apps[name].linksTo || []).filter((to) => selected.includes(to)).map((to) => [name, to]));
}
/** Fehlende Pflicht-Partner einer Auswahl als lesbare Hinweise. */
export function missingRequirements(selected) {
  const problems = [];
  for (const name of appNames.filter((n) => selected.includes(n))) {
    for (const need of apps[name].requires || [])
      if (!selected.includes(need)) problems.push(`${name} benötigt ${need}.`);
    const any = apps[name].requiresAny;
    if (any && !any.some((n) => selected.includes(n)))
      problems.push(`${name} benötigt ${any.join(" oder ")}.`);
  }
  return problems;
}
