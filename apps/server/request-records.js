import { positiveId } from "./media-hub.js";
export class RequestRecords {
  constructor(store) {
    this.store = store;
    store.db.exec(
      "CREATE TABLE IF NOT EXISTS request_records(root TEXT NOT NULL,id INTEGER NOT NULL,archived INTEGER NOT NULL DEFAULT 0,cancelled INTEGER NOT NULL DEFAULT 0,data TEXT NOT NULL,updated TEXT NOT NULL,PRIMARY KEY(root,id));",
    );
  }
  root(plan) {
    return plan.rootId || plan.id;
  }
  get(plan, id) {
    const r = this.store.db
      .prepare("SELECT * FROM request_records WHERE root=? AND id=?")
      .get(this.root(plan), positiveId(id));
    return r
      ? {
          ...JSON.parse(r.data),
          archived: !!r.archived,
          cancelled: !!r.cancelled,
          updatedAt: r.updated,
        }
      : null;
  }
  put(plan, id, data, flags = {}) {
    const before = this.get(plan, id);
    if (
      before &&
      data.mediaId !== undefined &&
      (before.mediaId !== data.mediaId ||
        before.type !== data.type ||
        before.createdAt !== data.createdAt)
    )
      throw Error(
        "Seerr hat eine Anfrage-ID wiederverwendet. Lokalen Verlauf vor einer Übernahme prüfen.",
      );
    const value = { ...before, ...data, id: positiveId(id) };
    delete value.archived;
    delete value.cancelled;
    delete value.updatedAt;
    this.store.db
      .prepare(
        "INSERT INTO request_records VALUES(?,?,?,?,?,?) ON CONFLICT(root,id) DO UPDATE SET archived=excluded.archived,cancelled=excluded.cancelled,data=excluded.data,updated=excluded.updated",
      )
      .run(
        this.root(plan),
        positiveId(id),
        Number(flags.archived ?? before?.archived ?? false),
        Number(flags.cancelled ?? before?.cancelled ?? false),
        JSON.stringify(value),
        new Date().toISOString(),
      );
    return this.get(plan, id);
  }
  archivedEntries(plan) {
    return new Map(
      this.store.db
        .prepare(
          "SELECT id,data FROM request_records WHERE root=? AND (archived=1 OR cancelled=1)",
        )
        .all(this.root(plan))
        .map((row) => [row.id, JSON.parse(row.data)]),
    );
  }
  archivedIds(plan) {
    return new Set(
      this.store.db
        .prepare(
          "SELECT id FROM request_records WHERE root=? AND (archived=1 OR cancelled=1)",
        )
        .all(this.root(plan))
        .map((r) => r.id),
    );
  }
  history(plan, { page = 1, type = "all" } = {}) {
    page = positiveId(page);
    if (!["all", "movie", "tv"].includes(type))
      throw Error("Ungültiger Medientyp.");
    const where =
      "root=? AND (archived=1 OR cancelled=1 OR json_extract(data,'$.cancelPending')=1)" +
      (type === "all" ? "" : " AND json_extract(data,'$.type')=?");
    const params = [this.root(plan), ...(type === "all" ? [] : [type])];
    const total = this.store.db
      .prepare("SELECT COUNT(*) AS n FROM request_records WHERE " + where)
      .get(...params).n;
    const pages = Math.max(1, Math.ceil(total / 8));
    page = Math.min(page, pages);
    const results = this.store.db
      .prepare(
        "SELECT * FROM request_records WHERE " +
          where +
          " ORDER BY updated DESC,id DESC LIMIT 8 OFFSET ?",
      )
      .all(...params, (page - 1) * 8)
      .map((r) => ({
        ...JSON.parse(r.data),
        archived: !!r.archived,
        cancelled: !!r.cancelled,
        updatedAt: r.updated,
      }));
    return { page, pages, total, results };
  }
}
