import { setupError } from "./setup-error.js";

export const minimumStreamyfinSeerrVersion = "3.5.3";
const minimumParts = minimumStreamyfinSeerrVersion.split(".").map(Number);
// Add an official image digest and its exact version after the release is
// available and the gateway has passed acceptance with that image.
const approvedImages = new Map();

export function streamyfinSeerrVersion(value) {
  const match = typeof value === "string" &&
    /^v?(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/.exec(value);
  if (!match) return { version: null, supported: false };
  const parts = match.slice(1).map(Number);
  const difference = parts.findIndex((part, index) => part !== minimumParts[index]);
  return {
    version: parts.join("."),
    supported: difference < 0 || parts[difference] > minimumParts[difference],
  };
}

async function managedSeerr(plan, docker) {
  const root = plan.rootId || plan.id;
  const ids = (await docker(["ps", "-q", "--no-trunc",
    "--filter", "label=com.docker.compose.project=" + plan.project,
    "--filter", "label=com.docker.compose.service=seerr",
    "--filter", "label=io.stackpilot.plan=" + root])).trim().split(/\s+/);
  if (ids.length !== 1 || !/^[a-f0-9]{64}$/.test(ids[0]))
    throw setupError("Der laufende Seerr-Container ist nicht eindeutig bestätigt.");
  const [row] = JSON.parse(await docker(["inspect", ids[0]]));
  const labels = row?.Config?.Labels;
  if (row?.Id !== ids[0] || row.State?.Running !== true || row.State.Restarting ||
      labels?.["io.stackpilot.managed"] !== "true" || labels["io.stackpilot.plan"] !== root ||
      labels["com.docker.compose.project"] !== plan.project || labels["com.docker.compose.service"] !== "seerr" ||
      row.Config.Image !== plan.images?.Seerr)
    throw setupError("Seerr weicht vom gespeicherten Installationsplan ab.");
  return { id: row.Id, image: row.Config.Image, imageId: row.Image };
}

export async function inspectStreamyfinSeerr({ plan, s }, docker) {
  const result = { ready: false, version: null, minimumVersion: minimumStreamyfinSeerrVersion };
  try {
    const before = await managedSeerr(plan, docker);
    const status = await s.request("Seerr", "/api/v1/status");
    const { version, supported } = streamyfinSeerrVersion(status?.version);
    if (!supported)
      return {
        ...result, version,
        reason: version
          ? `Seerr ${version} läuft. Für Streamyfin ist mindestens Seerr ${minimumStreamyfinSeerrVersion} erforderlich.`
          : "Die laufende Seerr-Version konnte nicht als stabile Veröffentlichung bestätigt werden.",
      };
    if (!/^ghcr\.io\/seerr-team\/seerr@sha256:[a-f0-9]{64}$/.test(before.image) ||
        approvedImages.get(before.image) !== version)
      return { ...result, version, reason: `Das laufende Seerr-Image für ${version} ist noch nicht für das Streamyfin-Gateway abgenommen.` };
    const expectedId = (await docker(["image", "inspect", before.image, "--format", "{{.Id}}"])).trim();
    const after = await managedSeerr(plan, docker);
    if (before.id !== after.id || before.image !== after.image ||
        !/^sha256:[a-f0-9]{64}$/.test(expectedId) || before.imageId !== expectedId || after.imageId !== expectedId)
      return { ...result, version, reason: "Seerr oder sein Image hat sich während der Prüfung geändert. Erneut prüfen." };
    return { ...result, version, ready: true, containerId: after.id, image: after.image };
  } catch (error) {
    return {
      ...result,
      reason: error.userFacing === true ? error.message : "Die laufende Seerr-Version konnte nicht verifiziert werden.",
    };
  }
}
