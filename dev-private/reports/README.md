export const components = [
  "Jellyfin",
  "Streamystats",
  "Sonarr",
  "Radarr",
  "Lidarr",
  "Prowlarr",
  "Bazarr",
  "Seerr",
  "qBittorrent",
];
const connections = [
  ["Streamystats", "Jellyfin"],
  ["Prowlarr", "Sonarr"],
  ["Prowlarr", "Radarr"],
  ["Prowlarr", "Lidarr"],
  ["Bazarr", "Sonarr"],
  ["Bazarr", "Radarr"],
  ["Seerr", "Jellyfin"],
  ["Seerr", "Sonarr"],
  ["Seerr", "Radarr"],
  ["Sonarr", "qBittorrent"],
  ["Radarr", "qBittorrent"],
  ["Lidarr", "qBittorrent"],
];
/** @param {{selected:string[],vpn:boolean,path:string,username:string}} spec */
export function plan(spec) {
  const selected = components.filter((c) => spec.selected.includes(c));
  const errors = [];
  if (!selected.length) errors.push("Wähle mindestens eine Anwendung.");
  if (
    !/^\/[a-zA-Z0-9_/-]+$/.test(spec.path) ||
    spec.path.split("/").includes("..") ||
    spec.path === "/"
  )
    errors.push(
      "Gib einen eigenen absoluten Datenpfad ohne Leerzeichen oder übergeordnete Verzeichnisse an.",
    );
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{2,31}$/.test(spec.username))
    errors.push("Benutzername: 3–32 Zeichen, beginnend mit einem Buchstaben.");
  if (spec.vpn && !selected.includes("qBittorrent"))
    errors.push("VPN erfordert die Auswahl von qBittorrent.");
  const warnings = [];
  for (const [from, to] of [
    ["Streamystats", "Jellyfin"],
    ["Bazarr", "Sonarr oder Radarr"],
    ["Seerr", "Jellyfin"],
  ]) {
    if (
      selected.includes(from) &&
      !(to.includes(" oder ")
        ? selected.includes("Sonarr") || selected.includes("Radarr")
        : selected.includes(to))
    )
      warnings.push(`${from}: ${to} fehlt; Verbindung bleibt offen.`);
  }
  return {
    selected,
    errors,
    warnings,
    connections: connections.filter(
      ([a, b]) => selected.includes(a) && selected.includes(b),
    ),
    steps: [
      "Serverprüfung simulieren",
      "Speicher und Rechte simulieren",
      ...selected.map((c) => `${c} einrichten (Simulation)`),
      ...(spec.vpn ? ["Mullvad-Verbindung und Ausfallsperre simulieren"] : []),
      "Dienstverbindungen simulieren",
      "Funktionsprüfung simulieren",
    ],
  };
}

export const defaultPorts = {
  Jellyfin: 8096,
  Streamystats: 3000,
  Sonarr: 8989,
  Radarr: 7878,
  Lidarr: 8686,
  Prowlarr: 9696,
  Bazarr: 6767,
  Seerr: 5055,
  qBittorrent: 8080,
};
/** Momentaufnahme bekannter Webports, keine Reservierung oder vollständige UDP-Prüfung.
 * @param {string[]} selected @param {string[]} listening */
export function portConflicts(selected, listening) {
  const occupied = new Set(
    listening.map((a) => Number(a.match(/:(\d+)$/)?.[1])).filter(Boolean),
  );
  return selected
    .filter((name) => occupied.has(defaultPorts[name]))
    .map((name) => ({ component: name, port: defaultPorts[name] }));
}


## Nachkontrolle nach Ablösung: 7. November 2026, 16:59 Uhr Wien

Quelle: `stackpilot-serverbericht-2026-11-07T15-59-53-471Z.json`
(Erhebung 15:59:53 UTC). Dieser Abschnitt aktualisiert den oben beschriebenen
Ausgangszustand; die ursprüngliche Auswertung bleibt zur Nachvollziehbarkeit erhalten.

- Docker und Compose sind weiterhin erreichbar; Containerabfrage vollständig.
- Keine Container mehr vorhanden. Alle zehn IDs des alten Compose-Projekts
  `stack` aus dem ersten Bericht fehlen im neuen Bericht.
- Sämtliche neun vorgesehenen Webports sind zum Erhebungszeitpunkt frei:
  3000, 5055, 6767, 7878, 8080, 8096, 8686, 8989 und 9696.
- Keine geladenen passenden systemd-Mediendienste oder weiteren erkannten
  Ablösekandidaten. Die Listener auf 8787 und 18789 bleiben vorhanden und werden
  nicht den entfernten Mediencontainern zugeordnet. SSH/DNS/Netzwerk und
  StackPilot auf 5173 sind weiterhin sichtbar; kein Anlass zur Bereinigung.
- Root-Dateisystem: rund 72,7 GiB verfügbar, weiterhin ext4 auf LVM.
  Keine Speichervergrößerung oder Dataset-Änderung aus dem Bericht ableitbar.
- Die Momentaufnahme bestätigt die Ablösung und freigewordenen Ports. Sie enthält
  keinen Nachweis über Vollständigkeit/Integrität alter Daten oder Sicherungen;
  Volume- und Bind-Mount-Inhalte werden vom Bericht bewusst nicht gelesen.
- Kein Nachweis, dass ein externer Controller die alten Container nie wieder
  erstellt. Vor der echten Neuinstallation wird der Istzustand erneut geprüft.

### Verbleibende Voraussetzungen für die echte Neuinstallation

Der alte Stack und seine Webports blockieren nicht mehr. Offen bleiben der
bestätigte Daten-/Konfigurationspfad samt Rechten, funktionale GPU-/Hardlinktests,
Image-Digests und versionsabhängige Dienstadapter, sichere Konto-/Schlüsselanlage,
externe Zugänge sowie optional Mullvad-Konfiguration und Ausfallsperre.
Die App bietet dafür bislang eine echte Vorprüfung und eine Installationssimulation;
sie führt noch keine neue Medieninstallation durch.
