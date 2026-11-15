import { createHash } from "node:crypto";
export class LibrarySync {
  constructor(hub) {
    this.hub = hub;
    this.cache = new Map();
    this.lookups = new Map();
    this.login = null;
    this.loginPending = null;
    this.pending = null;
  }
  start() {
    if (this.timer) return;
    void this.run();
    this.timer = setInterval(() => void this.run(), 60000);
    this.timer.unref?.();
  }
  close() {
    clearInterval(this.timer);
    this.timer = null;
  }
  key(plan) {
    return `library-scan:${plan.rootId || plan.id}`;
  }
  status() {
    const current = this.hub.engine.current();
    return current
      ? this.hub.engine.vault.get(this.key(current.plan)) || {
          state: "idle",
          message: "Noch kein Bibliotheksabgleich angefordert.",
        }
      : { state: "idle", message: "Noch kein Stack eingerichtet." };
  }
  async headers(s, plan) {
    if (this.login?.planId === plan.id) return this.login.headers;
    if (this.loginPending?.planId === plan.id) return this.loginPending.promise;
    const promise = s.additional
      .jellyfinLogin("library-monitor")
      .then((login) => {
        const headers = {
          Authorization: `MediaBrowser Client="StackPilot", Device="library-monitor", DeviceId="stackpilot-library-monitor", Version="0.1.0", Token="${login.AccessToken}"`,
        };
        this.login = { planId: plan.id, headers };
        return headers;
      })
      .finally(() => {
        this.loginPending = null;
      });
    this.loginPending = { planId: plan.id, promise };
    return promise;
  }
  async request(s, plan, route, options = {}) {
    const send = async () =>
      s.request("Jellyfin", route, {
        ...options,
        headers: await this.headers(s, plan),
      });
    try {
      return await send();
    } catch (e) {
      if (!/HTTP 401/.test(e.message)) throw e;
      this.login = null;
      return send();
    }
  }
  async available(s, plan, mediaId) {
    if (
      !plan.spec.selected.includes("Jellyfin") ||
      !Number.isSafeInteger(mediaId) ||
      mediaId < 1
    )
      return null;
    const key = `${plan.id}:${mediaId}`,
      cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < 15000) return cached.value;
    if (this.lookups.has(key)) return this.lookups.get(key);
    const promise = (async () => {
      try {
        const result = await this.request(
          s,
          plan,
          `/Items?Recursive=true&IncludeItemTypes=Movie&AnyProviderIdEquals=Tmdb.${mediaId}&Fields=ProviderIds&Limit=10`,
        );
        if (!Array.isArray(result?.Items)) throw Error("shape");
        const value = result.Items.some(
          (v) => Number(v.ProviderIds?.Tmdb) === mediaId,
        );
        this.cache.set(key, { value, at: Date.now() });
        if (this.cache.size > 250)
          this.cache.delete(this.cache.keys().next().value);
        return value;
      } catch {
        return null;
      } finally {
        this.lookups.delete(key);
      }
    })();
    this.lookups.set(key, promise);
    return promise;
  }
  run(force = false) {
    if (this.pending) return this.pending;
    this.pending = this.inspect(force)
      .catch((error) => {
        const current = this.hub.engine.current();
        if (!current || current.job.status !== "completed")
          return { state: "idle", message: "Einrichtung zuerst abschließen." };
        const record = {
          ...this.status(),
          state: "failed",
          message:
            "Bibliotheksabgleich konnte nicht vollständig bestätigt werden. Jellyfin- und Seerr-Verbindungen prüfen.",
          checkedAt: new Date().toISOString(),
          lastAttemptAt: new Date().toISOString(),
        };
        this.hub.engine.vault.set(this.key(current.plan), record);
        return record;
      })
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }
  async inspect(force) {
    const current = this.hub.engine.current();
    if (
      !current ||
      current.job.status !== "completed" ||
      !current.plan.spec.selected.includes("Jellyfin")
    )
      return { state: "idle", message: "Kein fertig eingerichtetes Jellyfin." };
    if (this.hub.engine.store.activeLease())
      return {
        ...this.status(),
        busy: true,
        message:
          "Einrichtungs- oder Wartungsauftrag läuft. Bibliotheksabgleich wartet.",
      };
    const { s, plan } = await this.hub.context(["Jellyfin"]);
    const before = this.hub.engine.vault.get(this.key(plan)) || {
      state: "idle",
    };
    const now = new Date().toISOString();
    const save = (patch) => {
      const value = { ...before, ...patch, checkedAt: now };
      this.hub.engine.vault.set(this.key(plan), value);
      return value;
    };
    const tasks = await this.request(s, plan, "/ScheduledTasks");
    if (!Array.isArray(tasks)) throw Error("tasks");
    const task = tasks.find((v) => v.Key === "RefreshLibrary");
    if (!task) throw Error("task missing");
    const running = ["Running", "Cancelling"].includes(task.State);
    if (before.state === "jellyfin") {
      if (running)
        return save({
          message: "Jellyfin liest die Medienbibliothek ein.",
          progress: Number.isFinite(task.CurrentProgressPercentage)
            ? task.CurrentProgressPercentage
            : null,
        });
      const endTime =
        task.LastExecutionResult?.EndTimeUtc ||
        task.LastExecutionResult?.EndTime;
      const ended = Date.parse(endTime);
      if (
        !Number.isFinite(ended) ||
        endTime === before.previousEndTime ||
        ended < Date.parse(before.requestedAt) - 1000
      ) {
        if (Date.now() - Date.parse(before.requestedAt) > 1800000)
          throw Error("unconfirmed");
        return save({
          message: "Jellyfin-Auftrag wartet auf einen Abschlussnachweis.",
        });
      }
      if (
        !["Completed", "CompletedWithErrors"].includes(
          task.LastExecutionResult?.Status,
        )
      )
        throw Error("scan failed");
      if (plan.spec.selected.includes("Seerr")) {
        await this.hub.mutate(["Seerr"], async (ctx) => {
          if (ctx.plan.id !== plan.id) throw Error("changed");
          const state = await ctx.s.additional.seerr("/settings/jellyfin/sync");
          if (!state.running)
            await ctx.s.additional.seerr("/settings/jellyfin/sync", {
              method: "POST",
              body: { start: true },
            });
        });
        return save({
          state: "seerr",
          message: "Jellyfin-Scan beendet. Seerr gleicht die Verfügbarkeit ab.",
          progress: null,
        });
      }
      this.cache.clear();
      return save({
        state: "completed",
        message: "Jellyfin-Scan beendet. Verfügbarkeit wird je Medium geprüft.",
        completedAt: now,
        progress: null,
      });
    }
    if (before.state === "seerr") {
      const result = await s.additional.seerr("/settings/jellyfin/sync");
      if (typeof result?.running !== "boolean") throw Error("seerr shape");
      if (result.running)
        return save({
          message: "Seerr gleicht die Medienverfügbarkeit ab.",
          progress:
            Number.isFinite(result.progress) && result.total > 0
              ? Math.min(100, (100 * result.progress) / result.total)
              : null,
        });
      this.cache.clear();
      return save({
        state: "completed",
        message:
          "Bibliotheksabgleich beendet. Verfügbarkeit wird je Medium geprüft.",
        completedAt: now,
        progress: null,
      });
    }
    let imported = [];
    if (plan.spec.selected.includes("Radarr")) {
      const movies = await s.arr("Radarr", "/movie");
      if (!Array.isArray(movies)) throw Error("movies");
      imported = movies
        .filter((v) => v.hasFile)
        .map((v) => [v.tmdbId, v.movieFile?.id || v.movieFileId || v.id])
        .sort((a, b) => a[0] - b[0]);
    }
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(imported))
      .digest("hex");
    if (
      !force &&
      (!imported.length ||
        (before.fingerprint === fingerprint && before.state !== "failed") ||
        Date.now() - (Date.parse(before.lastAttemptAt) || 0) < 300000)
    )
      return before;
    if (running)
      return save({
        state: "jellyfin",
        requestedAt: now,
        previousEndTime:
          task.LastExecutionResult?.EndTimeUtc ||
          task.LastExecutionResult?.EndTime ||
          null,
        fingerprint,
        lastAttemptAt: now,
        message:
          "Ein Jellyfin-Bibliotheksscan läuft bereits; StackPilot wartet darauf.",
      });
    await this.hub.mutate(["Jellyfin"], async (ctx) => {
      if (ctx.plan.id !== plan.id) throw Error("changed");
      await this.request(ctx.s, ctx.plan, "/Library/Refresh", {
        method: "POST",
      });
    });
    this.cache.clear();
    return save({
      state: "jellyfin",
      requestedAt: now,
      previousEndTime:
        task.LastExecutionResult?.EndTimeUtc ||
        task.LastExecutionResult?.EndTime ||
        null,
      lastAttemptAt: now,
      fingerprint,
      message:
        "Jellyfin-Bibliotheksscan angefordert. Danach wird Seerr abgeglichen.",
      progress: null,
    });
  }
}
