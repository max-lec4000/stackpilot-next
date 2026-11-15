import { randomUUID } from "node:crypto";
import { Services } from "./service-api.js";
export class SafetyCheck {
  constructor(engine, guard, options = {}) {
    this.engine = engine;
    this.guard = guard;
    this.services =
      options.services || ((p, r) => new Services(p, engine.vault, r));
    this.pending = null;
  }
  list() {
    return this.engine.list().filter((j) => j.kind === "safety");
  }
  async start(body) {
    if (body.confirmation !== "OK")
      throw Error(
        "Der Test unterbricht kurz das VPN und stoppt qBittorrent. Mit OK bestätigen.",
      );
    if (this.pending) throw Error("Ein Schutztest läuft bereits.");
    const current = this.engine.current();
    if (
      !current ||
      current.job.status !== "completed" ||
      !current.plan.spec.vpn ||
      !current.plan.spec.selected.includes("qBittorrent")
    )
      throw Error("Zuerst einen Stack mit Mullvad fertig einrichten.");
    const id = randomUUID(),
      plan = current.plan;
    const old = this.list().find((j) =>
      ["paused", "failed"].includes(j.status),
    );
    if (old) {
      if (body.operationId !== old.id)
        throw Error("Den unterbrochenen Schutztest zuerst erneut prüfen.");
      if (old.stackPlanId !== plan.id)
        throw Error("Stack hat sich geändert. Vorherigen Auftrag beenden.");
    }
    const owner = "safety:" + id;
    if (!this.engine.store.claim(owner))
      throw Error("Ein anderer Auftrag läuft.");
    let job;
    try {
      if (old) {
        job = old;
        job.status = "queued";
        job.error = null;
        job.steps.forEach((s) => (s.status = "pending"));
        this.engine.store.saveOperation(job);
      } else
        job = this.engine.store.createOperation({
          id,
          planId: id,
          stackPlanId: plan.id,
          kind: "safety",
          project: plan.project,
          status: "queued",
          createdAt: new Date().toISOString(),
          error: null,
          steps: [
            ["stop", "Downloadclient sicher anhalten"],
            ["identity", "Mullvad-Ausgang prüfen"],
            ["isolation", "Tunnel unterbrechen und Ausfallsperre prüfen"],
            ["reconnect", "Mullvad-Wiederverbindung prüfen"],
            ["ready", "Downloadclient geschützt starten"],
          ].map(([id, label]) => ({
            id,
            label,
            status: "pending",
            attempts: 0,
          })),
        });
      this.engine.vault.set(`safety-latch:${plan.rootId || plan.id}`, {
        operationId: job.id,
      });
    } catch (e) {
      this.engine.store.release(owner);
      throw e;
    }
    this.pending = this.run(job, plan, owner)
      .catch(() => {})
      .finally(() => {
        this.pending = null;
      });
    return job;
  }
  async pauseTorrents(client) {
    await client.qbit("/torrents/stop", { hashes: "all" });
    for (let attempt = 0; attempt < 20; attempt++) {
      const torrents = await client.qbit("/torrents/info");
      if (
        Array.isArray(torrents) &&
        torrents.every(
          (t) =>
            /^(paused|stopped)/i.test(t.state) ||
            ["error", "missingFiles"].includes(t.state),
        )
      )
        return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw Error("Downloadclient bestätigt die Pause nicht.");
  }
  async run(job, plan, owner) {
    const heartbeat = setInterval(() => this.engine.store.claim(owner), 10000);
    heartbeat.unref?.();
    let qbit;
    try {
      job.status = "running";
      this.engine.store.saveOperation(job);
      for (const step of job.steps) {
        if (!this.engine.store.owns(owner))
          throw Error("Auftragssperre verloren.");
        if (this.engine.current()?.plan.id !== plan.id)
          throw Error("Stack wurde verändert.");
        step.status = "running";
        step.attempts++;
        this.engine.store.saveOperation(job);
        const cs = await this.engine.validate(plan, true);
        qbit = cs.find((c) => c.service === "qbittorrent");
        if (!qbit) throw Error("Downloadclient fehlt.");
        if (step.id === "stop") {
          if (qbit.status === "running") {
            const s = this.services(
              plan,
              cs.find((c) => c.service === "api-relay").id,
            );
            const torrents = await s.qbit("/torrents/info");
            const key = `safety:${job.id}:active`;
            this.engine.vault.ensure(key, () =>
              torrents
                .filter((t) => !/^(paused|stopped)/i.test(t.state))
                .map((t) => t.hash)
                .filter((h) => /^[a-f0-9]{40,64}$/i.test(h)),
            );
            await this.pauseTorrents(s);
          }
          await this.engine.docker(["update", "--restart=no", qbit.id]);
          if (qbit.status === "paused")
            await this.engine.docker(["unpause", qbit.id]);
          await this.engine.docker(["stop", "--time", "10", qbit.id], {
            timeout: 30000,
          });
        } else if (["identity", "isolation", "reconnect"].includes(step.id)) {
          await this.engine.vpnCheck(
            plan,
            step.id === "isolation" ? "isolation" : "identity",
          );
        } else {
          await this.engine.docker(["start", qbit.id]);
          const s = this.services(
            plan,
            cs.find((c) => c.service === "api-relay").id,
          );
          await s.wait("qBittorrent");
          await this.pauseTorrents(s);
          await this.engine.vpnCheck(plan, "identity");
          const hashes = this.engine.vault.get(`safety:${job.id}:active`) || [];
          const key = `download-policy:${plan.rootId || plan.id}:paused`;
          this.engine.vault.set(key, [
            ...new Set([...(this.engine.vault.get(key) || []), ...hashes]),
          ]);
        }
        step.status = "completed";
        this.engine.store.saveOperation(job);
      }
      await this.engine.docker(["update", "--restart=unless-stopped", qbit.id]);
      this.engine.vault.set(`safety-latch:${plan.rootId || plan.id}`, null);
      job.status = "completed";
      job.finishedAt = new Date().toISOString();
      job.error = null;
    } catch {
      if (qbit)
        try {
          await this.engine.docker(["update", "--restart=no", qbit.id]);
          await this.engine.docker(["stop", "--time", "10", qbit.id], {
            timeout: 30000,
          });
        } catch {}
      const step = job.steps.find((s) => s.status === "running");
      if (step) step.status = "failed";
      job.status = "failed";
      job.error =
        "Schutztest nicht vollständig bestanden. Downloads bleiben angehalten. Unter Verwaltung erneut prüfen; VPN-Konfiguration und Diagnose kontrollieren.";
    } finally {
      this.engine.store.saveOperation(job);
      clearInterval(heartbeat);
      this.engine.store.release(owner);
      await this.guard.check(true);
    }
  }
}
