// A deletion journal is stronger evidence than a cached Seerr/Jellyfin index.
export const removedMovieKey = (plan, id) =>
  `removed-movie:${plan.rootId || plan.id}:${id}`;
export class RemovedMovies {
  constructor(hub) {
    this.hub = hub;
    this.indexed = new Set();
  }
  marker(plan, id) {
    const { engine } = this.hub,
      key = removedMovieKey(plan, id);
    let value = engine.vault.get(key);
    if (value) return value;
    const root = plan.rootId || plan.id;
    // Upgrade already completed deletions from versions before this index existed.
    if (!this.indexed.has(root)) {
      const db = engine.vault.store?.db;
      if (db)
        for (const row of db
          .prepare(
            "SELECT name FROM vault WHERE name GLOB 'movie-removal:*' ORDER BY rowid DESC",
          )
          .all()) {
          const record = engine.vault.get(row.name);
          if (!record?.steps?.done) continue;
          const original =
            record.rootId ||
            engine.store.plan(record.planId)?.rootId ||
            record.planId;
          if (original !== root) continue;
          const recordKey = removedMovieKey(plan, record.tmdbId);
          if (!engine.vault.get(recordKey))
            engine.vault.set(recordKey, {
              requestId: record.requestId,
              mediaRecordId: record.mediaRecordId,
              removedAt: record.completedAt || null,
            });
        }
      this.indexed.add(root);
    }
    return engine.vault.get(key);
  }
  async reconcile(s, plan, detail, id) {
    const marker = this.marker(plan, id);
    if (!marker) return detail;
    const list = await s.arr("Radarr", `/movie?tmdbId=${id}`);
    if (!Array.isArray(list)) throw Error("Radarr-Dateistatus nicht prüfbar.");
    if (list.some((m) => m.tmdbId === id && m.hasFile)) return detail;
    let requests = (detail.mediaInfo?.requests || []).filter(
      (r) => r.id !== marker.requestId,
    );
    if (marker.newRequestId) {
      let current;
      try {
        current = await s.additional.seerr(`/request/${marker.newRequestId}`);
      } catch (e) {
        if (!/HTTP 404/.test(e.message)) throw e;
      }
      if (current) {
        if (
          current.media?.tmdbId !== id ||
          current.media?.mediaType !== "movie"
        )
          throw Error("Neue Anfrage ist nicht eindeutig zugeordnet.");
        requests = requests.filter((r) => r.id !== current.id);
        requests.push(current);
      }
    }
    const active = requests.some((r) => ![3, 5].includes(r.status));
    return {
      ...detail,
      removedMovie: true,
      availabilityNote: active
        ? "Neue Anfrage vorhanden. Die zuvor gelöschte Version ist nicht mehr verfügbar."
        : "Die vorherige Version wurde gelöscht. Der Bibliotheksstatus kann noch veraltet sein; eine neue Anfrage ist möglich.",
      mediaInfo: { ...detail.mediaInfo, status: active ? 3 : 6, requests },
    };
  }
}
