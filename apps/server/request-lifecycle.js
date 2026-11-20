import { couchdeckFilmKey } from "./couchdeck-film-requests.js";
import { createHash, randomUUID } from "node:crypto";
import { positiveId } from "./media-hub.js";
import { activeSearch } from "../../packages/domain/search-status.js";
import { seerrServiceAdmin, qualityPolicyKey } from "./quality-policy.js";
import { setupError } from "./identity/setup-error.js";
const hash = (v) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const requestIdentity = (r) =>
  hash([
    r.id,
    r.media?.tmdbId,
    r.media?.mediaType,
    r.serverId,
    r.is4k,
    (r.seasons || []).map((s) => s.seasonNumber),
    r.requestedBy?.id,
    r.createdAt,
  ]);
const itemIdentity = (i) =>
  i
    ? hash([
        i.id,
        i.tmdbId,
        i.tvdbId,
        i.path,
        i.qualityProfileId,
        i.monitored,
        (i.seasons || []).map((s) => [s.seasonNumber, s.monitored]),
      ])
    : null;
export class RequestLifecycle {
  constructor(hub, diagnostics, records) {
    Object.assign(this, { hub, diagnostics, records });
  }
  async approve(body) {
    if (body.confirmation !== "OK") throw Error("Freigabe mit OK bestätigen.");
    const id = positiveId(body.requestId);
    await this.hub.requireVpn();
    return this.hub.mutate(["Seerr"], async ({ s, plan }) => {
      if (!seerrServiceAdmin(await s.additional.seerr("/auth/me")))
        throw Error("Das Seerr-Dienstkonto darf keine Anfragen freigeben.");
      const target = await this.diagnostics.target(s, id);
      if (target.request.status !== 1) throw Error("Die Anfrage wartet nicht mehr auf Freigabe. Neu laden.");
      if (target.kind === "movie") {
        const capped = this.hub.engine.vault.get?.(couchdeckFilmKey(plan, target.mediaId));
        if (capped?.requestId === id && capped.userId !== target.request.requestedBy?.id)
          throw Error("Die Couchdeck-Anfrage ist noch keinem bestätigten Zuschauer zugeordnet. Zuerst in Couchdeck erneut anfragen, um die Vorbereitung fortzusetzen.");
        const ownCap = capped?.requestId === id && capped.userId === target.request.requestedBy?.id ? capped.rule?.capGiB : 0;
        const setting = ownCap ? {rate:0,capGiB:ownCap} : this.hub.sizeLimits.config(plan);
        if (setting.rate || setting.capGiB) {
          const detail = await s.additional.seerr(`/movie/${target.mediaId}?language=de`);
          const rule = await this.hub.sizeLimits.forRequest(s, plan, detail, setting.rate, setting.capGiB || 0);
          const r = target.request;
          await s.additional.seerr(`/request/${id}`, { method: "PUT", body: {
            mediaType: "movie", serverId: rule.serverId, profileId: rule.profileId,
            ...(typeof r.rootFolder === 'string' ? {rootFolder:r.rootFolder} : {}),
            ...(Array.isArray(r.tags) ? {tags:r.tags} : {}),
          } });
          const saved = await s.additional.seerr(`/request/${id}`);
          if (saved.status !== 1 || saved.profileId !== rule.profileId || saved.serverId !== rule.serverId ||
              requestIdentity(saved) !== requestIdentity({ ...r, serverId: rule.serverId }))
            throw Error("Seerr hat Anfrage und Größenprofil nicht bestätigt. Keine Freigabe.");
          await this.hub.sizeLimits.verify(s, rule);
          this.hub.engine.vault.set(qualityPolicyKey(plan, "movie", target.mediaId), {
            profileId: rule.profileId, serverId: rule.serverId, compact: true,
            size: { ...rule, ...(setting.rate ? { rate: setting.rate } : {}) },
          });
        }
      }
      await s.additional.seerr(`/request/${id}/approve`, { method: "POST" });
      const confirmed = await s.additional.seerr(`/request/${id}`);
      if (![2, 5].includes(confirmed.status)) throw Error("Seerr hat die Freigabe nicht bestätigt. Status erneut laden.");
      return { ok: true, status: confirmed.status };
    });
  }
  /** Wartende Anfrage ablehnen; die Begründung bleibt in StackPilot (Seerr kennt keine). */
  async decline(body) {
    if (body.confirmation !== "OK") throw Error("Ablehnen mit OK bestätigen.");
    const id = positiveId(body.requestId);
    const reason = typeof body.reason === "string"
      ? body.reason.replace(/[\u0000-\u001f\u007f\s]+/g, " ").trim().slice(0, 300) : "";
    return this.hub.mutate(["Seerr"], async ({ s, plan }) => {
      if (!seerrServiceAdmin(await s.additional.seerr("/auth/me")))
        throw Error("Das Seerr-Dienstkonto darf keine Anfragen ablehnen.");
      const request = await s.additional.seerr(`/request/${id}`);
      const kind = request?.media?.mediaType;
      if (!["movie", "tv"].includes(kind)) throw Error("Anfrage nicht mehr vorhanden.");
      if (request.status !== 1) throw Error("Die Anfrage wartet nicht mehr auf Freigabe. Neu laden.");
      await s.additional.seerr(`/request/${id}/decline`, { method: "POST" });
      const confirmed = await s.additional.seerr(`/request/${id}`);
      if (confirmed.status !== 3) throw Error("Seerr hat die Ablehnung nicht bestätigt. Status erneut laden.");
      this.records?.put(plan, id, {
        type: kind, mediaId: request.media.tmdbId, createdAt: request.createdAt,
        decision: { action: "declined", reason, at: new Date().toISOString() },
      });
      return { ok: true, status: 3 };
    });
  }
  /** Mehrere wartende Anfragen nacheinander freigeben oder ablehnen; Ergebnis je Anfrage. */
  async batch(body) {
    if (body.confirmation !== "OK") throw Error("Mit OK bestätigen.");
    if (!["approve", "decline"].includes(body.action)) throw Error("Unbekannte Sammelaktion.");
    const ids = [...new Set((Array.isArray(body.requestIds) ? body.requestIds : []).map(positiveId))];
    if (!ids.length || ids.length > 25) throw Error("1 bis 25 Anfragen auswählen.");
    const results = [];
    for (const requestId of ids) {
      try {
        if (body.action === "approve") await this.approve({ requestId, confirmation: "OK" });
        else await this.decline({ requestId, reason: body.reason, confirmation: "OK" });
        results.push({ requestId, ok: true });
      } catch (e) {
        results.push({ requestId, ok: false, error: String(e?.message || e).slice(0, 300) });
      }
    }
    return { results, done: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
  }
  key(plan, id) {
    return `request-cancel:${plan.rootId || plan.id}:${positiveId(id)}`;
  }
  async context(id) {
    const { s, plan } = await this.hub.context(["Seerr"]);
    const target = await this.diagnostics.target(s, positiveId(id));
    const detail = await s.additional.seerr(
      `/${target.kind}/${target.mediaId}?language=de`,
    );
    if (!Array.isArray(detail.mediaInfo?.requests))
      throw setupError("Weitere Anfragen konnten nicht sicher geprüft werden.");
    const others = detail.mediaInfo.requests.filter(
      (r) => r.id !== Number(id) && ![3, 5].includes(r.status),
    );
    const selected = (target.request.seasons || []).map((v) => v.seasonNumber);
    if (
      target.kind === "tv" &&
      (!selected.length ||
        selected.some((n) => !Number.isSafeInteger(n) || n < 1))
    )
      throw setupError(
        "Die angefragten Staffeln sind nicht eindeutig bestätigt.",
      );
    const overlaps = others.some(
      (r) =>
        target.kind === "movie" ||
        (r.seasons || []).some((v) => selected.includes(v.seasonNumber)),
    );
    const commands = target.item ? await s.arr(target.service, "/command") : [];
    if (!Array.isArray(commands))
      throw setupError("Laufende Suchaufträge konnten nicht geprüft werden.");
    const active =
      target.item &&
      commands.some(
        (c) =>
          activeSearch(c, target.kind, target.item.id) ||
          (["queued", "started"].includes(c.status) &&
            /rsssync/i.test(c.name || c.body?.name || "")),
      );
    return {
      s,
      plan,
      target,
      detail,
      overlaps,
      active,
      selected,
      review: hash([
        target.request,
        itemIdentity(target.item),
        others,
        commands.filter(
          (c) => target.item && activeSearch(c, target.kind, target.item.id),
        ),
      ]),
    };
  }
  editableSeasons(c) {
    return c.target.kind === "tv" && c.target.request.status === 1 &&
      c.selected.length > 1 && !c.overlaps && !c.active
      ? c.selected : [];
  }
  monitoredSeasons(c) {
    return c.target.kind === "tv" && c.target.request.status === 2 &&
      !c.overlaps && !c.active && c.target.item?.monitored
      ? (c.target.item.seasons || []).filter((season) =>
          season.monitored && c.selected.includes(season.seasonNumber),
        ).map((season) => season.seasonNumber)
      : [];
  }
  async cancelSeason(body) {
    if (body.confirmation !== "OK") throw Error("Staffelabbruch mit OK bestätigen.");
    const id = positiveId(body.requestId), season = positiveId(body.season);
    return this.hub.mutate(["Seerr"], async () => {
      const c = await this.context(id);
      if (body.review !== c.review)
        throw Error("Anfrage oder Dienstzustand wurde geändert. Neu prüfen.");
      if (this.hub.engine.vault.get(this.key(c.plan, id))?.status === "running")
        throw Error("Ein vollständiger Abbruch wurde bereits begonnen.");
      if (this.monitoredSeasons(c).includes(season)) {
        const item = c.target.item;
        const route = `/series/${positiveId(item.id)}`;
        const next = { ...item, seasons: item.seasons.map((entry) =>
          entry.seasonNumber === season ? { ...entry, monitored: false } : entry,
        ) };
        await c.s.arr("Sonarr", route, { method: "PUT", body: next });
        if (itemIdentity(await c.s.arr("Sonarr", route)) !== itemIdentity(next))
          throw Error("Sonarr hat den neuen Überwachungszustand nicht bestätigt. Erneut prüfen.");
        return { ok: true, monitoringStopped: true };
      }
      if (!this.editableSeasons(c).includes(season))
        throw Error("Diese Staffel kann im aktuellen Zustand nicht geändert werden.");
      const request = c.target.request;
      const seasons = c.selected.filter((number) => number !== season);
      const route = `/request/${id}`;
      await c.s.additional.seerr(route, {
        method: "PUT",
        body: {
          mediaType: "tv", seasons,
          serverId: request.serverId ?? undefined,
          profileId: request.profileId ?? undefined,
          rootFolder: request.rootFolder ?? undefined,
          languageProfileId: request.languageProfileId ?? undefined,
          tags: request.tags ?? undefined,
        },
      });
      const saved = await c.s.additional.seerr(route);
      this.hub.invalidateRequests?.();
      const remaining = saved?.seasons?.map((entry) => entry.seasonNumber);
      if (!Array.isArray(remaining) || remaining.length !== seasons.length ||
          new Set(remaining).size !== seasons.length ||
          seasons.some((number) => !remaining.includes(number)))
        throw Error("Seerr hat die verbleibenden Staffeln nicht bestätigt. Anfrage neu öffnen.");
      return { ok: true };
    });
  }
  public(c) {
    return {
      requestId: c.target.request.id,
      review: c.review,
      title: String(c.detail.title || c.detail.name || "Anfrage").slice(0, 240),
      type: c.target.kind,
      editableSeasons: this.editableSeasons(c),
      monitoredSeasons: this.monitoredSeasons(c),
      canCancel:
        !c.overlaps &&
        !c.active &&
        c.target.request.status !== 5 &&
        !(c.target.kind === "movie" && c.target.item?.hasFile),
      blockers: [
        ...(c.target.request.status === 5 ||
        (c.target.kind === "movie" && c.target.item?.hasFile)
          ? [
              "Bereits verfügbare Medien archivieren oder über Film löschen verwalten.",
            ]
          : []),
        ...(c.overlaps
          ? [
              "Weitere aktive Anfragen betreffen dasselbe Medium oder dieselben Staffeln. Nur archivieren oder die Anfragen gemeinsam in Seerr verwalten.",
            ]
          : []),
        ...(c.active
          ? [
              "Ein Suchauftrag läuft noch. Nach dessen Abschluss erneut prüfen; laufende Downloads können unter Downloads gezielt pausiert werden.",
            ]
          : []),
      ],
      message:
        "Abbrechen beendet die zukünftige Überwachung dieses Films beziehungsweise der angefragten Staffeln und entfernt die Seerr-Anfrage. Laufende Downloads und vorhandene Dateien bleiben erhalten. Archivieren blendet nur die Anfrage aus.",
    };
  }
  finish(plan, job) {
    job.status = "completed";
    this.hub.engine.vault.set(this.key(plan, job.requestId), job);
    this.records.put(
      plan,
      job.requestId,
      { ...job.metadata, cancelPending: false },
      {
        archived: true,
        cancelled: true,
      },
    );
    this.hub.invalidateRequests?.();
    return {
      ok: true,
      message:
        "Anfrage abgebrochen und archiviert. Vorhandene Dateien und laufende Downloads bleiben erhalten.",
    };
  }
  async recovery(id) {
    const { s, plan } = await this.hub.context(["Seerr"]),
      job = this.hub.engine.vault.get(this.key(plan, id));
    if (job?.deleteStarted && job.status !== "abandoned") {
      try {
        await s.additional.seerr(`/request/${positiveId(id)}`);
      } catch (e) {
        if (/HTTP 404/.test(e.message)) return { plan, job };
        throw e;
      }
    }
    return null;
  }
  async preview(id) {
    const recovery = await this.recovery(id);
    if (recovery)
      return {
        requestId: Number(id),
        review: hash(recovery.job),
        title: recovery.job.metadata.title,
        type: recovery.job.metadata.type,
        canCancel: true,
        resuming: true,
        blockers: [],
        message:
          "Seerr hat die Anfrage bereits entfernt. Nur die lokale Bestätigung des Abbruchs fortsetzen.",
      };
    const c = await this.context(id),
      job = this.hub.engine.vault.get(this.key(c.plan, id));
    const result = this.public(c);
    if (job?.status === "running") {
      result.aborting = true;
      result.message +=
        " Einen begonnenen Abbruch kannst du verwerfen und nur archivieren. Bereits deaktivierte Überwachung bleibt dabei deaktiviert; Dateien und laufende Downloads bleiben erhalten.";
    }
    return result;
  }
  async archive(body) {
    const id = positiveId(body.requestId);
    return this.hub.mutate(["Seerr"], async ({ s, plan }) => {
      if (body.restore === true) {
        const old = this.records.get(plan, id);
        if (!old || old.cancelled || old.cancelPending)
          throw Error(
            "Abgebrochene Anfragen können nicht wiederhergestellt werden. Das Medium erneut anfragen.",
          );
        await s.additional.seerr(`/request/${id}`);
        const result = this.records.put(plan, id, {}, { archived: false });
        this.hub.invalidateRequests?.();
        return result;
      }
      const request = await s.additional.seerr(`/request/${id}`);
      const kind = request.media?.mediaType;
      if (!["movie", "tv"].includes(kind)) throw Error("Unbekannte Anfrage.");
      const detail = await s.additional.seerr(
        `/${kind}/${positiveId(request.media.tmdbId)}?language=de`,
      );
      const old = this.records.get(plan, id);
      if (old?.cancelPending) {
        if (body.abandon !== true || body.confirmation !== "OK")
          throw Error(
            "Begonnenen Abbruch im Archiv ausdrücklich verwerfen oder gezielt fortsetzen.",
          );
        const job = this.hub.engine.vault.get(this.key(plan, id));
        if (
          !job ||
          job.status !== "running" ||
          job.identity !== requestIdentity(request)
        )
          throw Error("Abbruchauftrag nicht eindeutig zugeordnet.");
        job.status = "abandoned";
        this.hub.engine.vault.set(this.key(plan, id), job);
      }
      const result = this.records.put(
        plan,
        id,
        {
          type: kind,
          mediaId: request.media.tmdbId,
          title: String(detail.title || detail.name || "Anfrage").slice(0, 240),
          createdAt: request.createdAt,
          cancelPending: false,
        },
        { archived: true },
      );
      this.hub.invalidateRequests?.();
      return result;
    });
  }
  async cancel(body) {
    if (body.confirmation !== "OK") throw Error("Abbrechen mit OK bestätigen.");
    return this.hub.mutate(["Seerr"], async () => {
      const recovered = await this.recovery(body.requestId);
      if (recovered) {
        if (body.review !== hash(recovered.job))
          throw Error("Bestätigung wurde geändert. Neu prüfen.");
        return this.finish(recovered.plan, recovered.job);
      }
      const c = await this.context(body.requestId),
        p = this.public(c);
      if (body.review !== c.review)
        throw Error("Anfrage oder Dienstzustand wurde geändert. Neu prüfen.");
      if (!p.canCancel) throw Error(p.blockers.join(" "));
      const { target, s, plan } = c,
        id = positiveId(body.requestId),
        key = this.key(plan, id);
      let job = this.hub.engine.vault.get(key);
      if (
        job &&
        (job.identity !== requestIdentity(target.request) ||
          ![job.before, job.after].includes(itemIdentity(target.item)))
      )
        throw Error(
          "Das Medium wurde außerhalb dieses Abbruchs verändert. Keine weitere Änderung.",
        );
      job ||= {
        id: randomUUID(),
        requestId: id,
        identity: requestIdentity(target.request),
        before: itemIdentity(target.item),
        metadata: {
          type: target.kind,
          mediaId: target.mediaId,
          title: p.title,
          createdAt: target.request.createdAt,
        },
        previous: target.item,
        status: "running",
      };
      job.status = "running";
      this.hub.engine.vault.set(key, job);
      this.records.put(plan, id, { ...job.metadata, cancelPending: true });
      if (target.item && itemIdentity(target.item) !== job.after) {
        const route = `/${target.kind === "movie" ? "movie" : "series"}/${positiveId(target.item.id)}`;
        const next =
          target.kind === "movie"
            ? { ...target.item, monitored: false }
            : {
                ...target.item,
                seasons: (target.item.seasons || []).map((sn) =>
                  c.selected.includes(sn.seasonNumber)
                    ? { ...sn, monitored: false }
                    : sn,
                ),
              };
        job.after = itemIdentity(next);
        this.hub.engine.vault.set(key, job);
        await s.arr(target.service, route, { method: "PUT", body: next });
        const actual = await s.arr(target.service, route);
        if (itemIdentity(actual) !== job.after)
          throw Error(
            "Überwachung nicht vollständig deaktiviert. Dateien und Downloads bleiben erhalten.",
          );
      }
      const fresh = await this.context(id);
      if (
        !this.public(fresh).canCancel ||
        requestIdentity(fresh.target.request) !== job.identity ||
        itemIdentity(fresh.target.item) !== (job.after ?? job.before)
      )
        throw Error(
          "Zustand während des Abbruchs geändert. Keine Entfernung der Anfrage.",
        );
      job.deleteStarted = true;
      this.hub.engine.vault.set(key, job);
      await s.additional.seerr(`/request/${id}`, { method: "DELETE" });
      let absent = false;
      try {
        await s.additional.seerr(`/request/${id}`);
      } catch (e) {
        if (/HTTP 404/.test(e.message)) absent = true;
        else throw e;
      }
      if (!absent) throw Error("Seerr hat den Abbruch noch nicht bestätigt.");
      return this.finish(plan, job);
    });
  }
}
