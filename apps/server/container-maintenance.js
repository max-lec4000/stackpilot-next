import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import catalogFile from "../../packages/catalog/services.json" with { type: "json" };

const execute = promisify(execFile);
const supported = ["Sonarr", "Radarr", "Lidarr", "Prowlarr", "Bazarr", "Seerr"];
const inProgress = ["snapshotting", "changing", "rolling-back", "recovery-required"];
const digestRef = /^[a-z0-9.\/:-]+@sha256:[a-f0-9]{64}$/;
const owns = (root, file) => file === root || file.startsWith(root + path.sep);
const reviewOf = (values) => createHash("sha256").update(JSON.stringify(values)).digest("hex");
const hasDirectory = async (file) => {
  const stat = await lstat(file).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(file) !== file))
    throw Error("Unsicherer Konfigurations- oder Sicherungspfad.");
  return Boolean(stat);
};

export function pendingContainerMaintenance(plan, vault) {
  if (!plan) return false;
  return supported.some((name) => {
    const record = vault.get(`container-maintenance:${plan.rootId || plan.id}:${catalogFile.services[name].slug}`);
    return record?.planId === plan.id && inProgress.includes(record.phase);
  });
}

export class ContainerMaintenance {
  constructor(hub, options = {}) {
    this.hub = hub;
    this.engine = hub.engine;
    this.catalog = options.catalog || catalogFile.services;
    this.run = options.run || ((command, args, timeout) => execute(command, args, { timeout }));
    this.verify = options.verify || (async (s, name) => {
      await s.wait(name);
      if (name === "Seerr") {
        const actor = await s.additional.seerr("/auth/me");
        if (!Number.isSafeInteger(actor?.id)) throw Error("Seerr-Anmeldung nicht bestätigt.");
      }
    });
  }
  root(plan) {
    return plan.rootId || plan.id;
  }
  key(plan, name) {
    return `container-maintenance:${this.root(plan)}:${this.catalog[name].slug}`;
  }
  status(plan, name) {
    const record = this.engine.vault.get(this.key(plan, name));
    const from = plan.images[name], to = this.catalog[name].image;
    const samePlan = record?.planId === plan.id;
    return {
      name, from, to,
      review: reviewOf([plan.id, name, from, to, record?.id, record?.phase]),
      phase: samePlan ? record.phase : null,
      update: (!samePlan || !inProgress.includes(record.phase)) && from !== to && digestRef.test(from) && digestRef.test(to),
      rollback: samePlan && (inProgress.includes(record.phase) || record.phase === "updated"),
    };
  }
  list() {
    const current = this.engine.current();
    if (current?.job.status !== "completed") return { services: [] };
    return { services: supported.filter((name) => current.plan.spec.selected.includes(name)).map((name) => this.status(current.plan, name)) };
  }
  async container(plan, slug, images) {
    const ids = (await this.engine.docker(["ps", "-aq", "--no-trunc", "--filter", `label=com.docker.compose.project=${plan.project}`, "--filter", `label=com.docker.compose.service=${slug}`])).trim().split(/\s+/).filter(Boolean);
    if (ids.length !== 1 || !/^[a-f0-9]{64}$/.test(ids[0])) throw Error("Container nicht eindeutig dem Stack zugeordnet.");
    const [row] = JSON.parse(await this.engine.docker(["inspect", ids[0]]));
    const labels = row?.Config?.Labels;
    if (row?.Id !== ids[0] || labels?.["io.stackpilot.plan"] !== this.root(plan) ||
        labels["io.stackpilot.managed"] !== "true" || !images.includes(row.Config.Image) ||
        row.HostConfig.Privileged || row.State.Paused)
      throw Error("Container oder Version weicht vom geprüften Stack ab.");
    return row;
  }
  paths(plan, record) {
    const slug = this.catalog[record.name].slug;
    const base = path.join(plan.appdata, ".stackpilot-container-backups");
    const directory = path.join(base, record.id);
    const manifests = path.join(this.engine.store.directory, "deployments", plan.id);
    return { slug, base, directory, manifest: path.join(manifests, "compose.json"),
      bootstrap: path.join(manifests, "bootstrap.json"), data: path.join(plan.appdata, slug),
      snapshot: path.join(directory, "snapshot"), failedData: path.join(directory, "after-update"),
      restore: path.join(directory, "restoring") };
  }
  async noSharedWrites(container, data) {
    const ids = (await this.engine.docker(["ps", "-q", "--no-trunc"])).trim().split(/\s+/).filter((id) => id && id !== container.Id);
    if (ids.length > 250 || ids.some((id) => !/^[a-f0-9]{64}$/.test(id))) throw Error("Andere Container konnten nicht geprüft werden.");
    const others = ids.length ? JSON.parse(await this.engine.docker(["inspect", ...ids])) : [];
    for (const other of others) {
      if (other.Mounts.some((mount) => mount.RW && mount.Source && (owns(data, mount.Source) || owns(mount.Source, data))))
        throw Error("Die Dienstkonfiguration wird zusätzlich von einem anderen Container verwendet.");
    }
    const mounts = (await readFile("/proc/self/mountinfo", "utf8")).split("\n").map((row) =>
      row.split(" ")[4]?.replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8))));
    if (mounts.some((mount) => mount && owns(data, mount)))
      throw Error("Im Konfigurationsordner liegt ein eigener Mountpunkt.");
  }
  async stop(row, clean) {
    if (row.State.Running || row.State.Restarting)
      await this.engine.docker(["stop", "--time", "60", row.Id], { timeout: 75000 });
    const [after] = JSON.parse(await this.engine.docker(["inspect", row.Id]));
    if (after.Id !== row.Id || after.State.Running || after.State.Restarting ||
        (clean && (after.State.OOMKilled || after.State.ExitCode === 137)))
      throw Error("Geordneter Containerstopp nicht bestätigt.");
  }
  async setManifest(file, plan, slug, allowed, image) {
    const compose = JSON.parse(await readFile(file, "utf8"));
    if (compose.name !== plan.project || !allowed.includes(compose.services?.[slug]?.image))
      throw Error("Gespeicherter Installationsplan weicht vom Wartungsauftrag ab.");
    compose.services[slug].image = image;
    const scratch = await mkdtemp(path.join(path.dirname(file), ".maintenance-"));
    try {
      const temp = path.join(scratch, "manifest.json");
      await writeFile(temp, JSON.stringify(compose, null, 2), { mode: 0o600, flush: true });
      await rename(temp, file);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }
  async startAndVerify(s, plan, files, record, image) {
    const allowed = [record.from, record.to];
    for (const file of [files.manifest, files.bootstrap])
      await this.setManifest(file, plan, files.slug, allowed, image);
    await this.engine.docker(["compose", "-f", files.manifest, "up", "-d", "--no-deps", "--pull", "never", "--no-build", files.slug], { timeout: 120000 });
    const running = await this.container(plan, files.slug, [image]);
    const id = (await this.engine.docker(["image", "inspect", image, "--format", "{{.Id}}"])).trim();
    if (!running.State.Running || running.Image !== id) throw Error("Gestartetes Container-Image nicht bestätigt.");
    await this.verify(s, record.name);
    if ((await this.container(plan, files.slug, [image])).Id !== running.Id) throw Error("Container hat sich während der Prüfung geändert.");
  }
  saveVersion(plan, record, image, phase) {
    const slug = this.catalog[record.name].slug;
    const change = (services) => services?.[slug] ? { ...services, [slug]: { ...services[slug], image } } : services;
    this.engine.store.transaction(() => {
      this.engine.store.replacePlan({ ...plan, images: { ...plan.images, [record.name]: image },
        serviceDefinitions: change(plan.serviceDefinitions), preservedServices: change(plan.preservedServices) });
      this.engine.vault.set(this.key(plan, record.name), { ...record, phase });
    });
  }
  async restore(s, plan, record, files) {
    const key = this.key(plan, record.name);
    const current = await this.container(plan, files.slug, [record.from, record.to]);
    if (record.phase === "snapshotting") {
      if (current.Config.Image !== record.from) throw Error("Ursprünglicher Container nicht eindeutig nachweisbar.");
      if (!current.State.Running) await this.engine.docker(["start", current.Id], { timeout: 75000 });
      await this.verify(s, record.name);
      this.engine.vault.set(key, { ...record, phase: "rolled-back" });
      return;
    }
    if (!await hasDirectory(files.snapshot)) throw Error("Konsistente Sicherung fehlt.");
    await this.engine.docker(["image", "inspect", record.from, "--format", "{{.Id}}"]);
    await this.noSharedWrites(current, files.data);
    this.engine.vault.set(key, { ...record, phase: "rolling-back" });
    await this.stop(current, false);
    if (!await hasDirectory(files.failedData)) await rename(files.data, files.failedData);
    if (!await hasDirectory(files.data)) {
      await rm(files.restore, { recursive: true, force: true });
      await this.run("cp", ["-a", "--reflink=auto", "--", files.snapshot, files.restore], 180000);
      await this.run("sync", ["-f", files.restore], 90000);
      await rename(files.restore, files.data);
    }
    await this.startAndVerify(s, plan, files, record, record.from);
    this.saveVersion(plan, record, record.from, "rolled-back");
  }
  async apply(body, rollback = false) {
    const name = body.name;
    if (!supported.includes(name) || body.confirmation !== "OK") throw Error("Dienst und Bestätigung fehlen.");
    return this.hub.mutate([name], async ({ s, plan }) => {
      const status = this.status(plan, name), key = this.key(plan, name);
      if (body.review !== status.review || !(rollback ? status.rollback : status.update))
        throw Error("Die Wartungsvorschau ist nicht mehr aktuell.");
      const previous = this.engine.vault.get(key);
      if (rollback) {
        await this.restore(s, plan, previous, this.paths(plan, previous));
        return { phase: "rolled-back" };
      }
      if (pendingContainerMaintenance(plan, this.engine.vault))
        throw Error("Zuerst die unterbrochene Container-Wartung abschließen.");
      await this.engine.validate(plan, true);
      const record = { id: randomUUID(), planId: plan.id, name, from: status.from, to: status.to, phase: "snapshotting" };
      const files = this.paths(plan, record);
      const current = await this.container(plan, files.slug, [record.from]);
      if (!current.State.Running || !await hasDirectory(files.data) ||
          !current.Mounts.some((mount) => mount.RW && mount.Type === "bind" && mount.Source === files.data))
        throw Error("Laufender Container oder Konfigurationsordner konnte nicht bestätigt werden.");
      await this.noSharedWrites(current, files.data);
      await this.verify(s, name);
      await this.engine.docker(["image", "inspect", record.from, "--format", "{{.Id}}"]);
      try {
        await this.engine.docker(["image", "inspect", record.to, "--format", "{{.Id}}"]);
      } catch {
        await this.engine.docker(["pull", record.to], { timeout: 300000 });
      }
      await mkdir(files.base, { mode: 0o700, recursive: true });
      if (!await hasDirectory(files.base) || ((await lstat(files.base)).mode & 0o077))
        throw Error("Privater Sicherungsordner konnte nicht bestätigt werden.");
      await mkdir(files.directory, { mode: 0o700 });
      this.engine.vault.set(key, record);
      try {
        await this.stop(current, true);
        await this.run("cp", ["-a", "--reflink=auto", "--", files.data, files.snapshot], 180000);
        await this.run("sync", ["-f", files.snapshot], 90000);
        record.phase = "changing";
        this.engine.vault.set(key, record);
        await this.startAndVerify(s, plan, files, record, record.to);
        this.saveVersion(plan, record, record.to, "updated");
        return { phase: "updated" };
      } catch {
        try {
          await this.restore(s, plan, record, files);
          return { phase: "rolled-back" };
        } catch {
          if (record.phase === "changing") this.engine.vault.set(key, { ...record, phase: "recovery-required" });
          throw Error("Dienst konnte nicht bestätigt werden. In der Wartungsübersicht Rückkehr erneut ausführen.");
        }
      }
    });
  }
}
