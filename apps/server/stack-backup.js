import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
const beneath = (file, root) => file === root || file.startsWith(root + path.sep);
export async function stackBackupPlan(engine, { includeData = false } = {}) {
  const current = engine.current();
  if (!current || current.job.status !== "completed") throw Error("Einrichtung vor einer Stack-Sicherung abschließen.");
  if (current.plan.uid !== process.getuid()) throw Error("Sicherung als ursprünglicher StackPilot-Nutzer ausführen.");
  const plan = current.plan, rootId = plan.rootId || plan.id;
  const roots = [{ label: "state", directory: await realpath(engine.store.directory) }, { label: "appdata", directory: await realpath(plan.appdata) }];
  const dataRoot = await realpath(plan.spec.path);
  for (const directory of [roots[1].directory, dataRoot]) {
    const owner = JSON.parse(await readFile(path.join(directory, ".stackpilot-owner.json"), "utf8"));
    if (owner.planId !== rootId) throw Error("Datenordner gehört nicht zum aktuellen Stack.");
  }
  if (includeData) roots.push({ label: "data", directory: dataRoot });
  const registry = [{ id: rootId, project: plan.project }];
  for (const [key, kind] of [["identity-preparation:", "identity"], ["jellyfin-protection:", "media"], ["oidc-backchannel:", "oidc"]]) {
    const record = engine.vault.get(key + rootId);
    if (!record) continue;
    if (record.rootId !== rootId || typeof record.id !== "string" || record.project !== "sp-" + kind + "-" + record.id.slice(0, 8)) throw Error("Zusatzdienst ist nicht eindeutig dem Stack zugeordnet.");
    registry.push({ id: kind === "identity" ? record.id : rootId, project: record.project });
  }
  const rawIds = (await engine.docker(["ps", "-aq", "--no-trunc", "--filter", "label=io.stackpilot.plan"])).trim();
  const ids = rawIds ? rawIds.split(/\s+/) : [];
  if (ids.length > 200 || ids.some((id) => !/^[a-f0-9]{64}$/.test(id))) throw Error("Containerbestand nicht eindeutig auslesbar.");
  const all = ids.length ? JSON.parse(await engine.docker(["inspect", ...ids])) : [];
  const containers = [];
  const allowedRoots = [...roots.map((root) => root.directory), dataRoot];
  for (const container of all) {
    const labels = container.Config?.Labels || {};
    if (!registry.some((entry) => entry.id === labels["io.stackpilot.plan"])) continue;
    if (!registry.some((entry) => entry.id === labels["io.stackpilot.plan"] && entry.project === labels["com.docker.compose.project"])) throw Error("Fremdes Compose-Projekt verwendet die Stack-Zuordnung.");
    if (container.HostConfig?.Privileged || container.State?.Restarting || container.State?.Paused) throw Error("Containerzustand oder Rechte müssen vor einer Sicherung geprüft werden.");
    for (const mount of container.Mounts || []) {
      if (mount.Type === "tmpfs") continue;
      if (mount.Type !== "bind") throw Error("Nicht unterstütztes Datenvolume; vollständige Sicherung wäre unbestätigt.");
      const source = await realpath(mount.Source);
      if (!allowedRoots.some((root) => beneath(source, root)) && !["/etc/localtime", "/etc/timezone", "/etc/ssl/certs"].includes(source))
        throw Error("Container verwendet eine nicht zugeordnete Datenablage. Diese muss vor der Sicherung einbezogen werden.");
    }
    containers.push({ id: container.Id, name: container.Name?.replace(/^\//, ""), service: labels["com.docker.compose.service"], project: labels["com.docker.compose.project"], root: labels["io.stackpilot.plan"], image: container.Config.Image, running: container.State.Running === true });
  }
  if (!containers.length) throw Error("Keine zugeordneten Mediencontainer gefunden.");
  return { schemaVersion: 1, planId: plan.id, rootId, includeData, roots, containers, mediaIncluded: includeData, mode: includeData ? "complete-with-media-and-downloads" : "configuration-and-databases", systemDependencies: ["Linux", "Docker", "passende UID/GID und Geräte-/Netzkonfiguration"], createdAt: new Date().toISOString() };
}
const order = (container) => /gluetun/.test(container.service || "") ? 0 : /database|postgres/.test(container.service || "") ? 1 : /server|worker/.test(container.service || "") ? 2 : 3;
export async function freezeStackForBackup(plan, { docker, manager, journal, archive }) {
  const previous = plan.containers.filter((container) => container.running).sort((a, b) => order(a) - order(b));
  const record = { plan, previous, managerWasRunning: await manager.running(), state: "prepared" };
  await journal(record);
  let result, failure;
  async function inspect(container) {
    const [row] = JSON.parse(await docker(["inspect", container.id]));
    const labels = row?.Config?.Labels || {};
    if (row?.Id !== container.id || labels["io.stackpilot.plan"] !== container.root || labels["com.docker.compose.project"] !== container.project || row.Config.Image !== container.image) throw Error("Containerzuordnung wurde während der Sicherung geändert.");
    return row;
  }
  try {
    if (record.managerWasRunning) await manager.stop();
    record.state = "stopping"; await journal(record);
    for (const container of [...previous].reverse()) {
      await inspect(container);
      await docker(["stop", "--time", "60", container.id]);
    }
    for (const container of plan.containers) {
      const row = await inspect(container);
      if (row.State.Running || row.State.Restarting || row.State.OOMKilled || (previous.some((item) => item.id === container.id) && row.State.ExitCode === 137))
        throw Error("Geordnetes Ende aller Datenbank-/App-Prozesse ist nicht bestätigt.");
    }
    record.state = "frozen"; await journal(record);
    result = await archive();
    record.state = "archive-created"; await journal(record);
  } catch (error) { failure = error; }
  try {
    record.state = "resuming"; await journal(record);
    for (const container of previous) {
      if (!(await inspect(container)).State.Running) await docker(["start", container.id]);
    }
    if (record.managerWasRunning) await manager.start();
    record.state = failure ? "failed-and-resumed" : "completed"; await journal(record);
  } catch {
    record.state = "resume-required"; await journal(record);
    throw Error("Sicherung und Wiederanlauf nicht gemeinsam bestätigt. Privaten Sicherungsauftrag prüfen und nur die darin zugeordneten Dienste fortsetzen.");
  }
  if (failure) throw failure;
  return result;
}
