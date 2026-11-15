// Local installation preference. Never inferred from a tracked repository file.
const repository = "https://github.com/max-lec4000/stackpilot.git";
const branch = "main";
function prepare(store) {
  if (!store?.db) return false;
  store.db.exec(
    "CREATE TABLE IF NOT EXISTS development_report_consent(id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), repository TEXT NOT NULL, branch TEXT NOT NULL, updated_at TEXT NOT NULL)",
  );
  return true;
}
export function reportConsent(store) {
  if (!prepare(store)) return false;
  const row = store.db
    .prepare(
      "SELECT enabled,repository,branch FROM development_report_consent WHERE id=1",
    )
    .get();
  return (
    row?.enabled === 1 && row.repository === repository && row.branch === branch
  );
}
export function setReportConsent(store, enabled) {
  if (typeof enabled !== "boolean")
    throw Error("Entwicklungsupload ausdrücklich ein- oder ausschalten.");
  if (!prepare(store))
    throw Error("Lokaler StackPilot-Zustand ist nicht verfügbar.");
  const updatedAt = new Date().toISOString();
  store.db
    .prepare(
      "INSERT INTO development_report_consent(id,enabled,repository,branch,updated_at) VALUES(1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled,repository=excluded.repository,branch=excluded.branch,updated_at=excluded.updated_at",
    )
    .run(enabled ? 1 : 0, repository, branch, updatedAt);
  return { enabled, repository, branch, updatedAt };
}
