import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import catalogFile from "../../packages/catalog/services.json" with { type: "json" };
import { forgetSessions, reconcileKeys, reconcileSummary } from "./key-reconcile.js";

const execute = promisify(execFile);
const supported = ["Sonarr", "Radarr", "Lidarr", "Prowlarr", "Bazarr", "Seerr", "Jellyfin", "qBittorrent", "Streamystats"];
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
    this.jellyfin = options.jellyfin;
    this.run = options.run || ((command, args, timeout) => execute(command, args, { timeout }));
    this.retryDelay = options.retryDelay ?? 2000;
    this.verify = options.verify || (async (s, name) => {
      await s.wait(name);
      if (name === "Seerr") {
        // Seerr antwortet schon, bevor es seine Einstellungen geladen hat; in dieser Zeit lehnt
        // es den API-Schlüssel kurz mit 401/403 ab. Deshalb eine Weile erneut versuchen.
        let actor, last;
        for (let i = 0; i < 20 && !actor; i++) {
          try { actor = await s.additional.seerr("/auth/me"); } catch (e) {
            last = e;
            if (!/HTTP (401|403|5\d\d)/.test(e.message)) throw e;
            await new Promise((r) => setTimeout(r, this.retryDelay));
          }
        }
        if (!actor && last) throw last;
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
    const from = plan.images[name], { image: to, channel } = this.catalog[name];
    const samePlan = record?.planId === plan.id;
    const eligible = (name !== "Jellyfin" || (this.jellyfin?.compatible(from) && this.jellyfin.compatible(to))) &&
      (name !== "qBittorrent" || (plan.spec.vpn && !this.engine.vault.get(`safety-latch:${this.root(plan)}`)));
    return {
      name, from, to,
      review: reviewOf([plan.id, name, from, to, record?.id, record?.phase]),
      phase: samePlan ? record.phase : null,
      snapshotAt: samePlan ? record.snapshotAt || null : null,
      update: Boolean(channel === "stable" && eligible && (!samePlan || !inProgress.includes(record.phase)) &&
        from !== to && digestRef.test(from) && digestRef.test(to)),
      rollback: samePlan && (inProgress.includes(record.phase) || record.phase === "updated"),
      ...(name === "Jellyfin" && { note: from !== to && !eligible
        ? "Für den Wechsel fehlt die Abnahme beider Jellyfin-Images mit geschützter Anmeldung."
        : "Jellyfin-Wartung nur mit privatem HTTPS und abgeschaltetem Funnel." }),
    };
  }
  async list() {
    const current = this.engine.current();
    if (current?.job.status !== "completed") return { services: [] };
    const blocked = this.engine.store.activeLease() || pendingContainerMaintenance(current.plan, this.engine.vault);
    const services = supported.filter((name) => current.plan.spec.selected.includes(name)).map((name) => {
      const status = this.status(current.plan, name);
      return { ...status, update: !blocked && status.update };
    });
    const jellyfin = services.find((service) => service.name === "Jellyfin" && service.update);
    if (jellyfin) {
      try {
        await this.jellyfin.privateGateway(current.plan);
      } catch (error) {
        jellyfin.update = false;
        if (error.userFacing) jellyfin.note = error.message;
      }
    }
    return { services };
  }
  async applyBatch(body, couchdeck) {
    const targets = body.targets;
    if (body.confirmation !== "OK" || !Array.isArray(targets) || !targets.length ||
        targets.length > supported.length + 1 ||
        targets.some((target) => !target || typeof target.review !== "string" ||
          (!supported.includes(target.name) && target.name !== "Couchdeck")) ||
        new Set(targets.map((target) => target.name)).size !== targets.length)
      throw Error("Anwendungen und Bestätigung fehlen oder sind ungültig.");

    const available = new Map((await this.list()).services.filter((service) => service.update)
      .map(({ name, review }) => [name, review]));
    if (targets.some(({ name }) => name === "Couchdeck")) {
      const status = await couchdeck.status();
      if (status.updateVersion && status.helper.available && !status.helper.running)
        available.set("Couchdeck", status.updateVersion);
    }
    if (targets.some(({ name, review }) => available.get(name) !== review))
      throw Error("Die Update-Auswahl ist nicht mehr aktuell. Bitte erneut prüfen.");

    const results = [];
    for (const { name, review } of targets) {
      try {
        const { phase } = name === "Couchdeck"
          ? await couchdeck.update(review)
          : await this.apply({ name, review, confirmation: "OK" });
        results.push({ name, phase });
      } catch (error) {
        results.push({ name, phase: "failed", error: error.userFacing ? error.message :
          "Update fehlgeschlagen. Den Dienst und die Wartungsübersicht prüfen." });
      }
    }
    return { results };
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
      failedRestore: path.join(directory, "after-rollback"),
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
    if (record.name === "Jellyfin") {
      await s.wait(record.name);
      await this.jellyfin.verify(this.planAtImage(plan, record.name, image), image, true);
    } else await this.verifyService(s, record.name, this.planAtImage(plan, record.name, image));
    if ((await this.container(plan, files.slug, [image])).Id !== running.Id) throw Error("Container hat sich während der Prüfung geändert.");
  }
  async verifyService(s, name, plan) {
    if (name === "qBittorrent") {
      if (!plan.spec.vpn || this.engine.vault.get(`safety-latch:${this.root(plan)}`))
        throw Error("qBittorrent-Wartung braucht den aktiven VPN-Schutz.");
      await this.engine.vpnCheck(plan);
    }
    await this.verify(s, name);
    if (name === "qBittorrent") await s.verifyQbit();
    if (name === "Streamystats") await s.additional.verify(name);
  }
  async copyData(name, source, target) {
    if (name !== "Streamystats") {
      await this.run("cp", ["-a", "--reflink=auto", "--", source, target], 180000);
      await this.run("sync", ["-f", target], 90000);
      return;
    }
    if (!await hasDirectory(source)) throw Error("Streamystats-Daten fehlen.");
    // PostgreSQL runs as a different UID. Use the pinned StackPilot helper to
    // preserve ownership without exposing the Docker socket to the helper.
    await mkdir(target, { mode: 0o700 });
    await this.engine.docker(["run", "--rm", "--pull", "never", "--network", "none",
      "--read-only", "--cap-drop=ALL", "--cap-add=CHOWN", "--cap-add=DAC_OVERRIDE", "--cap-add=FOWNER",
      "--security-opt=no-new-privileges:true", "--user", "0:0",
      "--mount", `type=bind,source=${source},target=/snapshot-source,readonly`,
      "--mount", `type=bind,source=${target},target=/snapshot-target`,
      "--entrypoint", "/bin/sh", catalogFile.services.ApiRelay.image,
      "-ec", "cp -a /snapshot-source/. /snapshot-target/ && sync -f /snapshot-target"], { timeout: 270000 });
  }
  async removeCopy(name, file) {
    if (name !== "Streamystats") {
      await rm(file, { recursive: true, force: true });
    } else if (await hasDirectory(file)) {
      await this.engine.docker(["run", "--rm", "--pull", "never", "--network", "none",
        "--read-only", "--cap-drop=ALL", "--cap-add=DAC_OVERRIDE",
        "--security-opt=no-new-privileges:true", "--user", "0:0",
        "--mount", `type=bind,source=${path.dirname(file)},target=/copies`,
        "--entrypoint", "rm", catalogFile.services.ApiRelay.image,
        "-rf", "--", `/copies/${path.basename(file)}`], { timeout: 90000 });
    }
  }
  planAtImage(plan, name, image) {
    const slug = this.catalog[name].slug;
    const change = (services) => services?.[slug] ? { ...services, [slug]: { ...services[slug], image } } : services;
    return { ...plan, images: { ...plan.images, [name]: image },
      serviceDefinitions: change(plan.serviceDefinitions), preservedServices: change(plan.preservedServices) };
  }
  saveVersion(plan, record, image, phase) {
    this.engine.store.transaction(() => {
      this.engine.store.replacePlan(this.planAtImage(plan, record.name, image));
      this.engine.vault.set(this.key(plan, record.name), { ...record, phase });
    });
  }
  async restore(s, plan, record, files) {
    const key = this.key(plan, record.name);
    const current = await this.container(plan, files.slug, [record.from, record.to]);
    if (record.name === "Jellyfin") {
      if (!this.jellyfin?.compatible(record.from)) throw Error("Das gesicherte Jellyfin-Image ist nicht abgenommen.");
      await this.jellyfin.privateGateway(plan);
      this.jellyfin.checkContainer(plan, current);
    }
    if (record.phase === "snapshotting") {
      if (current.Config.Image !== record.from) throw Error("Ursprünglicher Container nicht eindeutig nachweisbar.");
      if (!current.State.Running) await this.engine.docker(["start", current.Id], { timeout: 75000 });
      if (record.name === "Jellyfin") {
        await s.wait(record.name);
        await this.jellyfin.verify(plan, record.from, true);
      } else await this.verifyService(s, record.name, plan);
      this.engine.vault.set(key, { ...record, phase: "rolled-back" });
      return;
    }
    if (!await hasDirectory(files.snapshot)) throw Error("Konsistente Sicherung fehlt.");
    await this.engine.docker(["image", "inspect", record.from, "--format", "{{.Id}}"]);
    await this.noSharedWrites(current, files.data);
    this.engine.vault.set(key, { ...record, phase: "rolling-back" });
    await this.stop(current, false);
    const savedUpdateData = await hasDirectory(files.failedData);
    const currentData = await hasDirectory(files.data);
    if (!savedUpdateData && !currentData) throw Error("Die bisherige Dienstkonfiguration fehlt.");
    await this.removeCopy(record.name, files.restore);
    await this.copyData(record.name, files.snapshot, files.restore);
    if (!savedUpdateData) {
      await rename(files.data, files.failedData);
    } else if (currentData) {
      if (await hasDirectory(files.failedRestore))
        await this.removeCopy(record.name, files.failedRestore);
      await rename(files.data, files.failedRestore);
    }
    await rename(files.restore, files.data);
    await this.startAndVerify(s, plan, files, record, record.from);
    this.saveVersion(plan, record, record.from, "rolled-back");
    // Älterer Datenstand kann alte Schlüssel anderer Apps enthalten → mit dem Tresor abgleichen
    return this.reconcileAfter(s);
  }
  async reconcileAfter(s) {
    try {
      forgetSessions(s);
      return await reconcileKeys(s);
    } catch (e) {
      return { checked: 0, repaired: [], problems: [String(e?.message || e).slice(0, 160)] };
    }
  }
  /** Verwaltete Verbindungen von Hand abgleichen (Knopf in der Wartungsübersicht). */
  async reconcile(body) {
    if (body.confirmation !== "OK") throw Error("Abgleich mit OK bestätigen.");
    const current = this.engine.current();
    if (current?.job.status !== "completed") throw Error("Kein eingerichteter Stack.");
    return this.hub.mutate(current.plan.spec.selected, async ({ s }) => {
      const r = await this.reconcileAfter(s);
      return { ...r, message: reconcileSummary(r) || `Alle ${r.checked} verwalteten Verbindungen stimmen.` };
    });
  }
  async apply(body, rollback = false) {
    const name = body.name;
    if (!supported.includes(name) || body.confirmation !== "OK") throw Error("Dienst und Bestätigung fehlen.");
    const names = [name];
    return this.hub.mutate(names, async ({ s, plan: checkedPlan }) => {
      const plan = this.engine.current().plan;
      if (plan.id !== checkedPlan.id) throw Error("Der laufende Installationsplan wurde geändert.");
      const status = this.status(plan, name), key = this.key(plan, name);
      if (body.review !== status.review || !(rollback ? status.rollback : status.update))
        throw Error("Die Wartungsvorschau ist nicht mehr aktuell.");
      const previous = this.engine.vault.get(key);
      if (rollback) {
        const reconciled = await this.restore(s, plan, previous, this.paths(plan, previous));
        return { phase: "rolled-back", reconciled: reconcileSummary(reconciled) };
      }
      if (pendingContainerMaintenance(plan, this.engine.vault))
        throw Error("Zuerst die unterbrochene Container-Wartung abschließen.");
      await this.engine.validate(plan, true);
      const record = { id: randomUUID(), planId: plan.id, name, from: status.from, to: status.to, phase: "snapshotting" };
      const files = this.paths(plan, record);
      const current = await this.container(plan, files.slug, [record.from]);
      const dataMount = name === "Streamystats" ? path.join(files.data, "database") : files.data;
      if (!current.State.Running || !await hasDirectory(files.data) ||
          !current.Mounts.some((mount) => mount.RW && mount.Type === "bind" && mount.Source === dataMount))
        throw Error("Laufender Container oder Konfigurationsordner konnte nicht bestätigt werden.");
      await this.noSharedWrites(current, files.data);
      if (name === "Jellyfin") await this.jellyfin.verify(plan, record.from);
      else await this.verifyService(s, name, plan);
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
      if (name === "Jellyfin") await this.jellyfin.privateGateway(plan);
      this.engine.vault.set(key, record);
      try {
        await this.stop(current, true);
        await this.copyData(name, files.data, files.snapshot);
        record.snapshotAt = new Date().toISOString();
        record.phase = "changing";
        this.engine.vault.set(key, record);
        await this.startAndVerify(s, plan, files, record, record.to);
        this.saveVersion(plan, record, record.to, "updated");
        return { phase: "updated" };
      } catch {
        try {
          const reconciled = await this.restore(s, plan, record, files);
          return { phase: "rolled-back", reconciled: reconcileSummary(reconciled) };
        } catch {
          if (record.phase === "changing") this.engine.vault.set(key, { ...record, phase: "recovery-required" });
          throw Error("Dienst konnte nicht bestätigt werden. In der Wartungsübersicht Rückkehr erneut ausführen.");
        }
      }
    }, async () => {
      // Eine unterbrochene Rückkehr kann den Container schon auf das alte Image gestellt haben –
      // dann gegen das tatsächlich laufende der beiden Images prüfen (gilt für alle Apps).
      if (!rollback) return this.hub.context(names);
      const plan = this.engine.current()?.plan;
      if (!plan?.spec.selected.includes(name)) return this.hub.context(names);
      const status = this.status(plan, name);
      if (!status.rollback || status.review !== body.review)
        throw Error("Die Wartungsvorschau ist nicht mehr aktuell.");
      const record = this.engine.vault.get(this.key(plan, name));
      const row = await this.container(plan, this.catalog[name].slug, [record.from, record.to]);
      return this.hub.context(names, this.planAtImage(plan, name, row.Config.Image));
    });
  }
}
