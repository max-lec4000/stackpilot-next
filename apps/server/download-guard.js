import { randomUUID } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { readContainers } from "./retirement.js";
import { Services } from "./service-api.js";
import { probeVpn } from "./vpn.js";

export async function snapshotQbitConfig(engine, plan, key) {
  if (engine.vault.get(key)) return;
  const owner = JSON.parse(
    await readFile(path.join(plan.appdata, ".stackpilot-owner.json"), "utf8"),
  );
  if (owner.planId !== (plan.rootId || plan.id))
    throw new Error("Konfigurationsordner gehört nicht zum Stack.");
  const file = path.join(
    plan.appdata,
    "qbittorrent/qBittorrent/qBittorrent.conf",
  );
  const info = await lstat(file);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size > 1024 * 1024 ||
    (await realpath(file)) !== file
  )
    throw new Error(
      "Downloadclient-Konfiguration kann nicht sicher gesichert werden.",
    );
  engine.vault.set(key, { config: await readFile(file, "utf8") });
}

export class DownloadGuard {
  constructor(engine, options = {}) {
    this.engine = engine;
    this.scan = options.scan || (() => readContainers(engine.docker));
    this.proof =
      options.proof ||
      (async (plan, containers) => {
        const probe = containers.find((c) => c.service === "vpn-probe");
        const profile = engine.vault.get(`vpn-profile:${plan.vpnProfileId}`);
        if (!probe || !profile) throw new Error("VPN-Nachweis fehlt.");
        await probeVpn(probe.id, profile.controlKey, "identity");
      });
    this.services =
      options.services ||
      ((plan, containers) => {
        const relay = containers.find((c) => c.service === "api-relay");
        if (!relay) throw new Error("API-Brücke fehlt.");
        const client = new Services(plan, engine.vault, relay.id);
        client.timeout = 6000;
        return client;
      });
    this.status = {
      state: "checking",
      reason: "VPN-Zustand wird geprüft.",
      checkedAt: null,
      enforced: false,
    };
    this.pending = null;
  }
  start() {
    if (this.timer) return;
    void this.check(true);
    this.timer = setInterval(() => void this.check(true), 30000);
    this.timer.unref?.();
  }
  close() {
    clearInterval(this.timer);
    this.timer = null;
  }
  set(state, reason, enforced = false) {
    this.status = {
      state,
      reason,
      enforced,
      checkedAt: new Date().toISOString(),
    };
    return this.status;
  }
  check(force = false) {
    if (this.pending) return this.pending;
    if (
      !force &&
      this.status.checkedAt &&
      Date.now() - Date.parse(this.status.checkedAt) < 15000
    )
      return Promise.resolve(this.status);
    this.pending = this.inspect()
      .catch(() =>
        this.set(
          "unknown",
          "Downloadschutz konnte nicht vollständig geprüft werden. Diagnose öffnen.",
        ),
      )
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }
  owned(plan, containers) {
    return containers.filter(
      (c) =>
        c.project === plan.project &&
        c.managedPlan === (plan.rootId || plan.id),
    );
  }
  async inspect() {
    const current = this.engine.current();
    if (!current?.plan.spec.selected.includes("qBittorrent"))
      return this.set("not-required", "Kein Downloadclient eingerichtet.");
    if (this.engine.store.activeLease())
      return this.set(
        "checking",
        "Einrichtungs- oder Wartungsauftrag läuft. Der VPN-Netzwerkschutz bleibt Voraussetzung.",
      );
    const plan = current.plan;
    const containers = this.owned(plan, await this.scan());
    const qbit = containers.find(
      (c) => c.service === "qbittorrent" && c.image === plan.images.qBittorrent,
    );
    if (!qbit)
      return this.set(
        "blocked",
        "Downloadclient fehlt oder seine Zuordnung hat sich geändert.",
      );
    if (!plan.spec.vpn) {
      const active = ["running", "restarting", "paused"].includes(qbit.status);
      if (active) {
        try {
          await snapshotQbitConfig(
            this.engine,
            plan,
            `download-policy:${plan.rootId || plan.id}:legacy-config`,
          );
        } catch {}
      }
      if (this.engine.store.activeLease())
        return this.set("checking", "Wartungsauftrag läuft.");
      await this.engine.docker(["update", "--restart=no", qbit.id]);
      if (active) {
        if (qbit.status === "paused")
          await this.engine.docker(["unpause", qbit.id]);
        await this.engine.docker(["stop", "--time", "10", qbit.id], {
          timeout: 30000,
        });
      }
      return this.set(
        "blocked",
        "Ungeschützter Downloadclient angehalten. Unter Verwaltung Mullvad einrichten; Daten bleiben erhalten.",
        true,
      );
    }
    if (this.engine.vault.get(`safety-latch:${plan.rootId || plan.id}`)) {
      await this.engine.docker(["update", "--restart=no", qbit.id]);
      if (qbit.status === "paused")
        await this.engine.docker(["unpause", qbit.id]);
      if (["running", "restarting", "paused"].includes(qbit.status))
        await this.engine.docker(["stop", "--time", "10", qbit.id], {
          timeout: 30000,
        });
      return this.set(
        "blocked",
        "Schutztest unterbrochen oder fehlgeschlagen. Unter Verwaltung erneut prüfen.",
        true,
      );
    }
    let trusted = false;
    try {
      await this.engine.validate(plan, true);
      trusted = true;
      await this.proof(plan, containers);
      this.checkedPlanId = plan.id;
      return this.set(
        "connected",
        "Mullvad-Ausgang geprüft. Downloads sind durch das VPN-Netzwerk geschützt.",
        true,
      );
    } catch {
      this.set(
        "blocked",
        "VPN ist nicht nachgewiesen. Downloadclient wird gesichert angehalten.",
      );
      if (this.engine.store.activeLease())
        return this.set("checking", "Wartungsauftrag läuft.");
      if (["running", "restarting", "paused"].includes(qbit.status)) {
        try {
          if (qbit.status !== "running")
            throw new Error("Downloadclient nicht ansprechbar.");
          if (!trusted)
            throw new Error("Containerzuordnung nicht vertrauenswürdig.");
          const services = this.services(plan, containers);
          const torrents = await services.qbit("/torrents/info");
          const hashes = torrents
            .filter((t) => !/^(paused|stopped)/i.test(t.state))
            .map((t) => t.hash)
            .filter((h) => /^[a-f0-9]{40,64}$/i.test(h));
          if (hashes.length) {
            const key = `download-policy:${plan.rootId || plan.id}:paused`;
            const previous = this.engine.vault.get(key) || [];
            this.engine.vault.set(key, [...new Set([...previous, ...hashes])]);
            await services.qbit("/torrents/stop", { hashes: hashes.join("|") });
          }
        } catch {
          await this.engine.docker(["update", "--restart=no", qbit.id]);
          if (qbit.status === "paused")
            await this.engine.docker(["unpause", qbit.id]);
          await this.engine.docker(["stop", "--time", "10", qbit.id], {
            timeout: 30000,
          });
        }
      }
      return this.set(
        "blocked",
        "VPN ist nicht nachgewiesen. Downloads pausiert; kein ungeschützter Rückfall.",
        true,
      );
    }
  }
  async resume() {
    const status = await this.check(true);
    if (status.state !== "connected")
      throw new Error(
        "Fortsetzen gesperrt: zuerst die VPN-Verbindung herstellen und prüfen.",
      );
    const current = this.engine.current();
    if (
      !current?.plan.spec.vpn ||
      current.plan.id !== this.checkedPlanId ||
      this.engine.store.activeLease()
    )
      throw new Error("Fortsetzen während Einrichtung oder ohne VPN gesperrt.");
    const owner = "download-resume:" + randomUUID();
    if (!this.engine.store.claim(owner))
      throw Error("Ein anderer Auftrag läuft.");
    const timer = setInterval(() => this.engine.store.claim(owner), 10000);
    timer.unref?.();
    try {
      const plan = current.plan,
        containers = await this.engine.validate(plan, true);
      await this.proof(plan, containers);
      if (this.engine.vault.get(`safety-latch:${plan.rootId || plan.id}`))
        throw Error("Schutztest zuerst abschließen.");
      const qbit = containers.find((c) => c.service === "qbittorrent");
      if (!qbit) throw new Error("Downloadclient fehlt.");
      if (qbit.status !== "running") {
        await this.engine.docker(["start", qbit.id]);
        await this.services(plan, containers).wait("qBittorrent");
      }
      const key = `download-policy:${plan.rootId || plan.id}:paused`;
      const hashes = this.engine.vault.get(key) || [];
      if (hashes.length)
        await this.services(plan, containers).qbit("/torrents/start", {
          hashes: hashes.join("|"),
        });
      this.engine.vault.set(key, []);
      await this.engine.docker(["update", "--restart=unless-stopped", qbit.id]);
      return { ok: true, resumed: hashes.length };
    } finally {
      clearInterval(timer);
      this.engine.store.release(owner);
    }
  }
}
