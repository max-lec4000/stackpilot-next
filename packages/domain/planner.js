import { appNames, linksIn, missingRequirements } from "./apps.js";
export const components = appNames;
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
  const warnings = missingRequirements(selected).map(
    (problem) => problem + " Verbindung bleibt sonst offen.",
  );
  return {
    selected,
    errors,
    warnings,
    connections: linksIn(selected),
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
