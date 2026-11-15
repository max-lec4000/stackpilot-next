import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID, createHash } from "node:crypto";
import os from "node:os";
import { classifyContainer, safeSource } from "./inventory.js";
const execute = promisify(execFile);
const template =
  '{{$firewall := false}}{{range (index .Config "Env")}}{{if eq . "FIREWALL=on"}}{{$firewall = true}}{{end}}{{end}}{"firewallOn":{{$firewall}},"id":{{json .Id}},"name":{{json .Name}},"imageId":{{json .Image}},"image":{{json .Config.Image}},"status":{{json .State.Status}},"restart":{{json .HostConfig.RestartPolicy.Name}},"network":{{json .HostConfig.NetworkMode}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"workingDir":{{json (index .Config.Labels "com.docker.compose.project.working_dir")}},"configFiles":{{json (index .Config.Labels "com.docker.compose.project.config_files")}},"managedPlan":{{json (index .Config.Labels "io.stackpilot.plan")}},"privileged":{{json .HostConfig.Privileged}},"capAdd":{{json (index .HostConfig "CapAdd")}},"devices":{{json (index .HostConfig "Devices")}},"sysctls":{{json (index .HostConfig "Sysctls")}},"bindings":{{json (index .HostConfig "PortBindings")}},"networkNames":[{{$first := true}}{{range $name, $_ := .NetworkSettings.Networks}}{{if not $first}},{{end}}{{json $name}}{{$first = false}}{{end}}],"mounts":{{json .Mounts}}}';
export async function localDocker(args, options = {}) {
  const env = { ...process.env, LC_ALL: "C" };
  for (const key of [
    "DOCKER_HOST",
    "DOCKER_CONTEXT",
    "DOCKER_TLS",
    "DOCKER_TLS_VERIFY",
    "DOCKER_CERT_PATH",
  ])
    delete env[key];
  try {
    const { stdout } = await execute(
      "docker",
      ["--host=unix:///var/run/docker.sock", ...args],
      {
        env,
        timeout: options.timeout || 60000,
        maxBuffer: 4 * 1024 * 1024,
        encoding: "utf8",
      },
    );
    return stdout;
  } catch {
    throw new Error(
      "Docker-Operation fehlgeschlagen. Prüfe lokalen Docker-Socket, Berechtigungen und Zustand.",
    );
  }
}
export function fingerprint(c) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        id: c.id,
        name: c.name,
        imageId: c.imageId,
        project: c.project,
        service: c.service,
        network: c.network,
        mounts: c.mounts,
      }),
    )
    .digest("hex");
}
export async function readContainers(docker = localDocker) {
  const ids = (await docker(["ps", "-aq", "--no-trunc"]))
    .trim()
    .split("\n")
    .filter(Boolean);
  if (ids.length > 100)
    throw new Error(
      "Mehr als 100 Container: automatische Ablösung ist für diesen Pilot gesperrt.",
    );
  if (ids.some((id) => !/^[a-f0-9]{64}$/.test(id)))
    throw new Error("Container-IDs sind nicht eindeutig.");
  if (!ids.length) return [];
  const raw = await docker(["inspect", "--format", template, ...ids]);
  return raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const c = JSON.parse(line);
      const component = classifyContainer({
        Names: c.name,
        Image: c.image,
      }).component;
      return {
        id: c.id,
        name: c.name.replace(/^\//, ""),
        imageId: c.imageId,
        image: c.image,
        status: c.status,
        restart: c.restart,
        network: c.network,
        project: c.project,
        service: c.service,
        workingDir: c.workingDir,
        configFiles: c.configFiles,
        managedPlan: c.managedPlan || null,
        privileged: c.privileged === true,
        networkNames: c.networkNames || [],
        firewallOn: c.firewallOn === true,
        capAdd: c.capAdd || [],
        devices: c.devices || [],
        sysctls: c.sysctls || {},
        bindings: c.bindings || {},
        component,
        mounts: (c.mounts || []).map((m) => ({
          type: m.Type,
          name: m.Name || null,
          source: safeSource(m.Source),
          destination: m.Destination,
          writable: m.RW,
        })),
      };
    });
}
const configPaths = {
  jellyfin: "/config",
  sonarr: "/config",
  radarr: "/config",
  lidarr: "/config",
  prowlarr: "/config",
  bazarr: "/config",
  qbittorrent: "/config",
  seerr: "/app/config",
  gluetun: "/gluetun",
  streamystats: "/var/lib/postgresql/data",
};
export function buildRetirementPlan(containers, project) {
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(project) || project === "stackpilot")
    throw new Error(
      "Wähle einen gültigen alten Compose-Projektnamen, nicht stackpilot.",
    );
  const selected = containers.filter((c) => c.project === project);
  if (!selected.length)
    throw new Error("Kein Container dieses Compose-Projekts gefunden.");
  if (selected.some((c) => !c.component || c.service !== c.component))
    throw new Error(
      "Projekt enthält unbekannte oder nicht eindeutig zugeordnete Dienste. Keine pauschale Ablösung möglich.",
    );
  for (const c of selected) {
    if (
      !c.mounts.some(
        (m) =>
          m.destination === configPaths[c.component] &&
          ["bind", "volume"].includes(m.type),
      )
    )
      throw new Error(
        `Persistente Konfiguration für ${c.name} nicht nachgewiesen. Ablösung gesperrt.`,
      );
  }
  const ids = new Set(selected.map((c) => c.id));
  for (const c of containers) {
    if (c.network?.startsWith("container:") && !ids.has(c.id)) {
      const target = c.network.slice(10);
      if (selected.some((s) => s.id.startsWith(target) || s.name === target))
        throw new Error(
          "Ein fremder Container teilt den Netzwerk-Namespace eines betroffenen Dienstes.",
        );
    }
  }
  selected.sort(
    (a, b) =>
      (a.component === "qbittorrent" ? -1 : a.component === "gluetun" ? 1 : 0) -
        (b.component === "qbittorrent"
          ? -1
          : b.component === "gluetun"
            ? 1
            : 0) || a.name.localeCompare(b.name),
  );
  const plan = {
    id: randomUUID(),
    kind: "retirement",
    host: os.hostname(),
    project,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 30 * 60000).toISOString(),
    confirmation: `ALTEN STACK ${project} ABLÖSEN`,
    containers: selected.map((c) => ({ ...c, fingerprint: fingerprint(c) })),
    preserveData: true,
    warnings: [
      "Container werden wirklich gestoppt und entfernt. Es gibt keinen automatischen Rückweg.",
      "Mounts/Volumes und ihre Inhalte werden nicht gelöscht. Das Auftragsmanifest ist keine Sicherung der Dienstkonfiguration.",
      "Docker stop wartet bis zu 30 Sekunden und kann einen nicht reagierenden Container danach beenden. Eine eigene Sicherung wird empfohlen.",
      "Alte Compose-Dateien, externe Controller und Autostart-Dienste bleiben unverändert. Deren erneutes Erstellen muss vorab verhindert werden.",
      "Der Vorgang installiert noch keinen neuen Medienstack.",
    ],
    steps: [],
  };
  plan.steps = [
    ...selected.map((c) => ({
      id: `restart:${c.id}`,
      containerId: c.id,
      action: "disable-restart",
      label: `${c.name}: Docker-Neustart deaktivieren`,
    })),
    ...selected.map((c) => ({
      id: `stop:${c.id}`,
      containerId: c.id,
      action: "stop",
      label: `${c.name}: geordnet stoppen`,
    })),
    ...selected.map((c) => ({
      id: `remove:${c.id}`,
      containerId: c.id,
      action: "remove",
      label: `${c.name}: Container entfernen, Daten behalten`,
    })),
  ];
  return plan;
}
export class RetirementEngine {
  constructor(store, docker = localDocker) {
    this.store = store;
    this.docker = docker;
    this.owner = randomUUID();
    this.running = false;
  }
  async createPlan(project) {
    const plan = buildRetirementPlan(
      await readContainers(this.docker),
      project,
    );
    return this.store.savePlan(plan);
  }
  async validate(plan, allowMissing = false) {
    if (plan.host !== os.hostname())
      throw new Error("Der Plan gehört zu einem anderen Server.");
    const current = await readContainers(this.docker);
    const original = new Set(plan.containers.map((c) => c.id));
    if (current.some((c) => c.project === plan.project && !original.has(c.id)))
      throw new Error(
        "Im alten Projekt wurden neue Container gefunden. Externen Autostart prüfen; neuen Plan erstellen.",
      );
    for (const c of current) {
      if (c.network?.startsWith("container:") && !original.has(c.id)) {
        const target = c.network.slice(10);
        if (
          plan.containers.some(
            (s) => s.id.startsWith(target) || s.name === target,
          )
        )
          throw new Error(
            "Neue fremde Netzwerk-Abhängigkeit erkannt. Ausführung gesperrt.",
          );
      }
    }
    for (const c of plan.containers) {
      const actual = current.find((v) => v.id === c.id);
      if (!actual) {
        if (!allowMissing)
          throw new Error(
            "Containerzustand hat sich geändert. Neuen Plan erstellen.",
          );
        continue;
      }
      if (fingerprint(actual) !== c.fingerprint)
        throw new Error(
          "Containerkonfiguration hat sich seit der Planung geändert. Ausführung gesperrt.",
        );
    }
    return current;
  }
  async confirm(id, text, autostartAcknowledged) {
    const plan = this.store.plan(id);
    if (!plan || plan.kind !== "retirement")
      throw new Error("Ablöseplan nicht gefunden.");
    const duplicate = this.store.operations().find((j) => j.planId === id);
    if (duplicate) return duplicate;
    if (Date.parse(plan.expiresAt) < Date.now())
      throw new Error("Plan abgelaufen. Bitte neu erstellen.");
    if (text !== plan.confirmation || autostartAcknowledged !== true)
      throw new Error(
        "Bestätigung und Prüfung des externen Autostarts fehlen.",
      );
    await this.validate(plan);
    const op = this.store.createOperation({
      id: randomUUID(),
      planId: plan.id,
      kind: "retirement",
      project: plan.project,
      status: "queued",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      pauseRequested: false,
      error: null,
      steps: plan.steps.map((s) => ({ ...s, status: "pending", attempts: 0 })),
    });
    void this.run(op.id).catch(() => {});
    return op;
  }
  list() {
    return this.store.transaction(() => {
      const list = this.store.operations();
      if (!this.running && !this.store.activeLease())
        for (const j of list)
          if (["queued", "running"].includes(j.status)) {
            j.status = "paused";
            j.error =
              "Ausführung wurde unterbrochen. Zustand prüfen und gezielt fortsetzen.";
            this.store.saveOperation(j);
          }
      return list;
    });
  }
  pause(id) {
    return this.store.transaction(() => {
      const op = this.store.operation(id);
      if (!op) throw new Error("Auftrag nicht gefunden.");
      if (["running", "queued"].includes(op.status)) {
        op.pauseRequested = true;
        this.store.saveOperation(op);
      }
      return op;
    });
  }
  end(id, confirmation) {
    return this.store.transaction(() => {
      if (this.running || this.store.activeLease())
        throw new Error("Executor arbeitet noch. Erst pausieren und warten.");
      if (confirmation !== "AUFTRAG BEENDEN")
        throw new Error("Bestätigung fehlt.");
      const op = this.store.operation(id);
      if (!op) throw new Error("Auftrag nicht gefunden.");
      if (op.status === "completed") return op;
      op.status = "cancelled";
      op.error =
        "Ohne weitere Änderungen beendet. Bereits ausgeführte Schritte wurden nicht rückgängig gemacht.";
      return this.store.saveOperation(op);
    });
  }
  async resume(id) {
    const initial = this.store.operation(id);
    if (!initial) throw new Error("Auftrag nicht gefunden.");
    if (initial.status === "completed") return initial;
    if (initial.status === "cancelled")
      throw new Error(
        "Ein beendeter Auftrag kann nicht erneut gestartet werden. Erstelle einen neuen Plan.",
      );
    await this.validate(this.store.plan(initial.planId), true);
    const op = this.store.transaction(() => {
      if (this.running || this.store.activeLease())
        throw new Error("Ein Executor arbeitet bereits. Bitte warten.");
      const current = this.store.operation(id);
      if (["cancelled", "completed"].includes(current.status))
        throw new Error("Auftrag ist bereits beendet.");
      if (
        this.store
          .operations()
          .some(
            (j) =>
              j.id !== id &&
              ["running", "queued", "paused", "failed"].includes(j.status),
          )
      )
        throw new Error("Ein anderer Auftrag ist noch offen.");
      current.pauseRequested = false;
      current.error = null;
      current.status = "queued";
      return this.store.saveOperation(current);
    });
    void this.run(op.id).catch(() => {});
    return op;
  }
  async run(id) {
    if (this.running || !this.store.claim(this.owner)) return;
    this.running = true;
    const heartbeat = setInterval(() => this.store.claim(this.owner), 10000);
    try {
      let op = this.store.operation(id);
      if (!op || !"queued running".split(" ").includes(op.status)) return;
      const plan = this.store.plan(op.planId);
      op.status = "running";
      this.store.saveOperation(op);
      await this.validate(plan, true);
      for (const originalStep of op.steps) {
        op = this.store.operation(id);
        if (!this.store.owns(this.owner))
          throw new Error("Executor-Sperre verloren.");
        if (op.pauseRequested) {
          op.status = "paused";
          this.store.saveOperation(op);
          return;
        }
        const step = op.steps.find((s) => s.id === originalStep.id);
        if (step.status === "completed") continue;
        step.status = "running";
        step.attempts++;
        this.store.saveOperation(op);
        const current = await this.validate(plan, true);
        const container = current.find((c) => c.id === step.containerId);
        if (container) {
          if (step.action === "disable-restart")
            await this.docker(["update", "--restart=no", container.id]);
          else if (step.action === "stop")
            await this.docker(["stop", "--time", "30", container.id]);
          else if (step.action === "remove") {
            if (
              container.status === "running" ||
              container.status === "restarting"
            )
              throw new Error("Container läuft wieder. Entfernen gesperrt.");
            await this.docker(["rm", container.id]);
          } else throw new Error("Unbekannte Aktion.");
        }
        if (!this.store.owns(this.owner))
          throw new Error("Executor-Sperre verloren.");
        const fresh = this.store.operation(id);
        const changed = fresh.steps.find((s) => s.id === step.id);
        changed.status = "completed";
        changed.attempts = step.attempts;
        this.store.saveOperation(fresh);
      }
      await this.validate(plan, true);
      op = this.store.operation(id);
      op.status = "completed";
      op.error = null;
      this.store.saveOperation(op);
    } catch (e) {
      const op = this.store.operation(id);
      if (op && this.store.owns(this.owner)) {
        op.status = "failed";
        op.error = e.message;
        const active = op.steps.find((s) => s.status === "running");
        if (active) active.status = "failed";
        this.store.saveOperation(op);
      }
    } finally {
      clearInterval(heartbeat);
      this.store.release(this.owner);
      this.running = false;
    }
  }
}
