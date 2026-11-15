import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import path from "node:path";
export class StateStore {
  constructor(
    directory = process.env.STACKPILOT_STATE_DIR || path.resolve(".stackpilot"),
  ) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.directory = directory;
    this.db = new DatabaseSync(path.join(directory, "state.sqlite"));
    chmodSync(path.join(directory, "state.sqlite"), 0o600);
    this.db.exec(
      "PRAGMA journal_mode=DELETE; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS plans(id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY, plan_id TEXT UNIQUE NOT NULL, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS lease(id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT,expires INTEGER); INSERT OR IGNORE INTO lease VALUES(1,NULL,0);",
    );
  }
  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  savePlan(plan) {
    this.db
      .prepare("INSERT INTO plans VALUES(?,?)")
      .run(plan.id, JSON.stringify(plan));
    return plan;
  }
  plan(id) {
    const row = this.db.prepare("SELECT data FROM plans WHERE id=?").get(id);
    return row ? JSON.parse(row.data) : null;
  }
  operation(id) {
    const row = this.db
      .prepare("SELECT data FROM operations WHERE id=?")
      .get(id);
    return row ? JSON.parse(row.data) : null;
  }
  latestDeployment() {
    const row = this.db
      .prepare(
        "SELECT data FROM operations WHERE json_extract(data,'$.kind')='deployment' AND json_extract(data,'$.status')!='cancelled' ORDER BY rowid DESC LIMIT 1",
      )
      .get();
    return row ? JSON.parse(row.data) : null;
  }
  operations() {
    return this.db
      .prepare("SELECT data FROM operations ORDER BY rowid DESC LIMIT 30")
      .all()
      .map((r) => JSON.parse(r.data));
  }
  createOperation(op) {
    return this.transaction(() => {
      const existing = this.db
        .prepare("SELECT data FROM operations WHERE plan_id=?")
        .get(op.planId);
      if (existing) return JSON.parse(existing.data);
      if (
        this.operations().some((j) =>
          ["running", "queued", "paused", "failed"].includes(j.status),
        )
      )
        throw new Error(
          "Ein bestehender Auftrag muss zuerst fortgesetzt oder abgeschlossen werden.",
        );
      this.db
        .prepare("INSERT INTO operations VALUES(?,?,?)")
        .run(op.id, op.planId, JSON.stringify(op));
      return op;
    });
  }
  saveOperation(op) {
    op.updatedAt = new Date().toISOString();
    this.db
      .prepare("UPDATE operations SET data=? WHERE id=?")
      .run(JSON.stringify(op), op.id);
    return op;
  }
  claim(owner) {
    return (
      this.db
        .prepare(
          "UPDATE lease SET owner=?,expires=? WHERE id=1 AND (expires<? OR owner=?)",
        )
        .run(owner, Date.now() + 90000, Date.now(), owner).changes === 1
    );
  }
  owns(owner) {
    const lease = this.db
      .prepare("SELECT owner,expires FROM lease WHERE id=1")
      .get();
    return lease.owner === owner && lease.expires > Date.now();
  }
  activeLease() {
    return (
      this.db.prepare("SELECT expires FROM lease WHERE id=1").get().expires >
      Date.now()
    );
  }
  release(owner) {
    this.db
      .prepare("UPDATE lease SET owner=NULL,expires=0 WHERE id=1 AND owner=?")
      .run(owner);
  }
  close() {
    this.db.close();
  }
}
