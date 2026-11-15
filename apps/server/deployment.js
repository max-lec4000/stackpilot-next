import { catalog } from "./catalog.js";
import { randomUUID } from "node:crypto";
import {
  components,
  plan,
  portConflicts,
} from "../../packages/domain/planner.js";
import { missingRequirements } from "../../packages/domain/apps.js";
import { localDocker } from "./retirement.js";
import { inventory, inspectPath, command } from "./inventory.js";
export function deploymentReadiness(spec, host, storage, options = {}) {
  if (
    !spec ||
    !Array.isArray(spec.selected) ||
    spec.selected.length > components.length ||
    spec.selected.some((s) => !components.includes(s)) ||
    typeof spec.path !== "string" ||
    typeof spec.username !== "string" ||
    typeof spec.vpn !== "boolean"
  )
    throw new Error("Ungültige Stack-Auswahl.");
  const proposal = plan(spec);
  if (spec.selected.includes("qBittorrent") && !spec.vpn)
    proposal.errors.push(
      "Downloads benötigen ein aktives, geprüftes VPN. Für qBittorrent Mullvad aktivieren und eine WireGuard-Datei importieren.",
    );
  // Pflicht-Partner kommen aus dem App-Katalog (packages/domain/apps.js).
  for (const problem of missingRequirements(spec.selected))
    proposal.errors.push(problem + " Bitte mit auswählen.");
  if (spec.remote === true && !spec.selected.includes("Jellyfin"))
    proposal.errors.push("Zugriff von unterwegs benötigt Jellyfin im verwalteten Stack.");
  if (
    spec.remote === true &&
    typeof spec.viewer === "string" &&
    spec.viewer.trim() &&
    !/^[a-z][a-z0-9_-]{2,31}$/.test(spec.viewer.trim().toLowerCase())
  )
    proposal.errors.push(
      "Zuschauer-Benutzername: 3–32 Zeichen, Buchstaben, Ziffern, - und _, beginnend mit einem Buchstaben.",
    );
  if (spec.couchdeck === true && !spec.selected.includes("Jellyfin"))
    proposal.errors.push(
      "Couchdeck benötigt Jellyfin im verwalteten Stack.",
    );
  const blockers = [...proposal.errors];
  const warnings = [...proposal.warnings];
  if (host.platform !== "linux")
    blockers.push("Der Pilot benötigt einen lokalen Linux-Server.");
  const ubuntu = /^Ubuntu 24\.04(?:\.| |$)/.test(host.release || "");
  if (!ubuntu) {
    if (options.allowUnqualifiedLinux)
      warnings.push(
        "Expliziter Linux-Entwicklertestmodus. Diese Distribution ist nicht als Ubuntu-Ziel freigegeben.",
      );
    else
      blockers.push(
        "Echte Installation ist derzeit für Ubuntu Server 24.04 freigegeben. Auf anderen Systemen bleiben Prüfung und Simulation verfügbar.",
      );
  }
  if (
    host.details?.architecture &&
    host.details.architecture !== "x64" &&
    !options.allowUnqualifiedLinux
  )
    blockers.push("Der Installationspilot ist bisher nur auf x86-64 geprüft.");
  if (!host.docker.available)
    blockers.push("Lokaler Docker-Daemon ist nicht erreichbar.");
  if (!host.compose.available)
    blockers.push("Docker Compose ist nicht verfügbar.");
  if (!host.containerScanComplete)
    blockers.push(
      "Vorhandene Container konnten nicht vollständig geprüft werden.",
    );
  const conflicts = portConflicts(
    spec.selected.filter((n) => !options.existing?.includes(n)),
    host.listening,
  );
  for (const c of conflicts)
    blockers.push(`${c.component}: Webport ${c.port} ist belegt.`);
  const existing = host.containers.filter(
    (c) =>
      c.component &&
      proposal.selected.some((s) => s.toLowerCase() === c.component) &&
      !options.ownedIds?.includes(c.ID),
  );
  for (const c of existing)
    blockers.push(
      `${c.Names}: vorhandene Installation zuerst ausdrücklich ablösen oder einbinden.`,
    );
  if (!storage.writable)
    blockers.push(
      "Der vorhandene Speicherpfad bzw. Elternpfad ist für den aktuellen Prozess nicht beschreibbar.",
    );
  if (!storage.exists)
    warnings.push(
      "Der Datenpfad fehlt und müsste als bestätigter Installationsschritt angelegt werden.",
    );
  const requiredGiB =
    options.existing?.length &&
    spec.selected.every((n) => options.existing.includes(n))
      ? 2
      : 10;
  if (storage.freeBytes < requiredGiB * 1024 ** 3)
    blockers.push(
      `Weniger als ${requiredGiB} GiB freier Platz am Ziel. Der Vorgang braucht Platz für Images und Konfiguration.`,
    );
  if (spec.vpn && !options.vpnProfile)
    blockers.push(
      "Mullvad-WireGuard-Datei zuerst geschützt importieren. Die Ausfallsperre wird vor dem Start von qBittorrent echt geprüft.",
    );
  for (const name of proposal.selected)
    if (!catalog.services[name]?.installable)
      blockers.push(
        `${name}: automatische Einrichtung ist für diese Version noch nicht freigegeben.`,
      );
  return {
    id: randomUUID(),
    kind: "deployment-preflight",
    createdAt: new Date().toISOString(),
    host: host.host,
    release: host.release,
    testPlatform: !ubuntu && !!options.allowUnqualifiedLinux,
    executable: blockers.length === 0,
    project: "stackpilot",
    spec: {
      selected: proposal.selected,
      path: spec.path,
      username: spec.username,
      vpn: spec.vpn,
      language: spec.language === "Englisch" ? "Englisch" : "Deutsch",
      quality:
        spec.quality === "Originalqualität"
          ? "Originalqualität"
          : "1080p · ausgewogen",
      // Couchdeck läuft direkt auf dem Server (kein Container) und ist abwählbar.
      // Nach der Installation gleich den Zugriff von unterwegs einrichten und – falls ein
      // Name angegeben ist – den ersten Zuschauer einladen.
      // Vorhandenen Medienordner eines früheren Stacks weiterverwenden (nur Erstinstallation).
      adopt: spec.adopt === true,
      remote: spec.remote === true,
      viewer:
        spec.remote === true &&
        typeof spec.viewer === "string" &&
        /^[a-z][a-z0-9_-]{2,31}$/.test(spec.viewer.trim().toLowerCase())
          ? spec.viewer.trim().toLowerCase()
          : "",
      couchdeck: spec.couchdeck === true,
      couchdeckYoutube: spec.couchdeck === true && spec.couchdeckYoutube === true,
    },
    blockers,
    warnings,
    portConflicts: conflicts,
    existing: existing.map((c) => ({
      id: c.ID,
      name: c.Names,
      project: c.project,
    })),
    storage,
    connections: proposal.connections,
    plannedPaths: [
      {
        host: spec.path,
        container: "/data",
        purpose: "Gemeinsame Downloads und Medien",
      },
      {
        host: spec.path.replace(/\/$/, "") + "-appdata",
        container: "Dienstabhängig",
        purpose:
          "Getrennte Konfigurationen außerhalb des Medienordners; Rechte und Mountgrenzen erneut prüfen",
      },
    ],
    requirements: [
      "Images gegen freigegebenen Katalog auflösen und Digests festhalten",
      "Container-UID/GID und optional GPU-Geräte prüfen",
      "Interne Geheimnisse geschützt erzeugen und Dienstkonten initialisieren",
      "Dienstverbindungen per versionsabhängigem Adapter einrichten und testen",
      "Fortschritt und Fehlerversuche im dauerhaften Auftragsjournal speichern",
    ],
  };
}
export async function createDeploymentPlan(spec, store) {
  const [host, storage] = await Promise.all([
    inventory(async (binary, args) =>
      binary === "docker"
        ? localDocker(args)
            .then((output) => ({ ok: true, output }))
            .catch(() => ({
              ok: false,
              reason: "Lokaler Docker-Daemon nicht erreichbar.",
            }))
        : command(binary, args),
    ),
    inspectPath(spec?.path),
  ]);
  const result = deploymentReadiness(spec, host, storage);
  return store.savePlan(result);
}
