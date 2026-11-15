import { randomUUID } from "node:crypto";

// Local delivery only. No email, webhooks, account lists or credentials.
export class Notifications {
  constructor(store, operations, hub) {
    Object.assign(this, { store, operations, hub });
    store.db.exec("CREATE TABLE IF NOT EXISTS notice_signals(key TEXT PRIMARY KEY,state TEXT NOT NULL); CREATE TABLE IF NOT EXISTS notices(id TEXT PRIMARY KEY,title TEXT NOT NULL,message TEXT NOT NULL,target TEXT NOT NULL,created TEXT NOT NULL,seen INTEGER NOT NULL DEFAULT 0)");
    this.page = 1;
  }
  observe(key, state, notice) {
    return this.store.transaction(() => {
    const old = this.store.db.prepare("SELECT state FROM notice_signals WHERE key=?").get(key);
    this.store.db.prepare("INSERT INTO notice_signals VALUES(?,?) ON CONFLICT(key) DO UPDATE SET state=excluded.state").run(key, state);
    if (old?.state === state || !notice) return;
    this.store.db.prepare("INSERT INTO notices(id,title,message,target,created) VALUES(?,?,?,?,?)").run(randomUUID(), notice.title.slice(0, 180), notice.message.slice(0, 600), notice.target, new Date().toISOString());
    this.store.db.exec("DELETE FROM notices WHERE id NOT IN (SELECT id FROM notices ORDER BY rowid DESC LIMIT 500)");
    });
  }
  async collect() {
    if (this.running) return;
    this.running = true;
    try {
      const ops = await this.operations.inspect();
      const keys = new Set();
      for (const task of ops.tasks) {
        const key = "operation:" + task.id;
        keys.add(key);
        this.observe(key, task.state, { title: task.title, message: task.reason, target: task.target === "setup" ? "#/einrichten" : "#/verwaltung" });
      }
      for (const row of this.store.db.prepare("SELECT key FROM notice_signals WHERE key LIKE 'operation:%'").all())
        if (!keys.has(row.key)) this.observe(row.key, "clear", null);
      const current = this.hub.engine.current();
      if (current?.job.status === "completed" && current.plan.spec.selected.includes("Seerr")) {
        // Rotate bounded pages: large histories do not create an unbounded poll.
        const requests = await this.hub.requests({ page: this.page, filter: "all", type: "all" });
        for (const item of requests.results) {
          const key = `request:${current.plan.rootId || current.plan.id}:${item.id}`;
          const old = this.store.db.prepare("SELECT state FROM notice_signals WHERE key=?").get(key);
          const title = item.state === "available" ? "Medium ist verfügbar" : ["failed", "attention"].includes(item.state) ? "Anfrage benötigt Aufmerksamkeit" : null;
          this.observe(key, item.state, old && title ? { title, message: item.title, target: "#/anfragen" } : null);
        }
        this.page = this.page < requests.pages ? this.page + 1 : 1;
      }
      this.error = null;
      this.checkedAt = new Date().toISOString();
    } catch {
      this.error = "Hinweise konnten nicht vollständig aktualisiert werden. Vorhandene Meldungen bleiben erhalten.";
    } finally { this.running = false; }
  }
  list() {
    return {
      results: this.store.db.prepare("SELECT * FROM notices ORDER BY rowid DESC LIMIT 100").all().map((row) => ({ ...row, seen: !!row.seen })),
      unread: this.store.db.prepare("SELECT count(*) AS n FROM notices WHERE seen=0").get().n,
      checkedAt: this.checkedAt || null,
      error: this.error || null,
    };
  }
  mark(ids) {
    if (!Array.isArray(ids) || ids.length > 100 || ids.some((id) => typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id))) throw Error("Ungültige Meldungsauswahl.");
    const update = this.store.db.prepare("UPDATE notices SET seen=1 WHERE id=?");
    this.store.transaction(() => { for (const id of ids) update.run(id); });
    return this.list();
  }
  start() {
    void this.collect();
    this.timer = setInterval(() => void this.collect(), 60000);
    this.timer.unref?.();
  }
  close() { clearInterval(this.timer); }
}
