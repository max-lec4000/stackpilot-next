import { useEffect, useRef, useState } from "react";
import { get } from "./ServerCheck";
import { StatusBadge } from "./ui";
type StorageUsage = {
  state: string;
  freeBytes: number | null;
  totalBytes: number | null;
  usedBytes?: number | null;
};
export type OperationOverview = {
  observedAt: string;
  phase: string;
  tasks: {
    id: string;
    state: string;
    title: string;
    reason: string;
    action: string;
    target: string;
  }[];
  storage: StorageUsage;
  systemStorage?: StorageUsage | null;
  sharedStorage?: boolean;
  applications: { name: string; state: string }[];
};
export function useOperations() {
  const [data, setData] = useState<OperationOverview | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const version = useRef(0);
  async function refresh(force = false) {
    const current = ++version.current;
    setBusy(true);
    try {
      const result = await get<OperationOverview>(
        "/api/operations/overview" + (force ? "?force=1" : ""),
      );
      if (current !== version.current) return;
      setData(result);
      setError("");
    } catch (e) {
      if (current !== version.current) return;
      setData(null);
      setError((e as Error).message);
    } finally {
      if (current === version.current) setBusy(false);
    }
  }
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState !== "hidden") void refresh();
    }, 30000);
    return () => {
      ++version.current;
      clearInterval(timer);
    };
  }, []);
  return { data, error, busy, refresh };
}
export function OperationNotices({
  data,
  onSetup,
  onManage,
}: {
  data: OperationOverview;
  onSetup: () => void;
  onManage: () => void;
}) {
  if (!data.tasks.length)
    return (
      <p className="dashboard-check-summary">
        <StatusBadge tone="success">Keine offenen Betriebshinweise</StatusBadge>
        <small>Container- und Speicherprüfung; keine Wiedergabeabnahme.</small>
      </p>
    );
  return (
    <details className="dashboard-notices">
      <summary>
        <StatusBadge tone="warning">{data.tasks.length} {data.tasks.length === 1 ? "Betriebshinweis" : "Betriebshinweise"}</StatusBadge>
        <span>{data.tasks[0].title}</span>
      </summary>
      <ul className="dashboard-task-list">
        {data.tasks.map((task) => (
          <li key={task.id}>
            <div>
              <b>{task.title}</b>
              <p>{task.reason}</p>
            </div>
            <button onClick={task.target === "setup" ? onSetup : onManage}>
              {task.action}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
// Retained for existing embedding points. The main dashboard uses the same hook
// directly so app and storage facts are displayed only once.
export function Operations({
  onSetup,
  onManage,
}: {
  onSetup: () => void;
  onManage: () => void;
}) {
  const { data, error, busy, refresh } = useOperations();
  return (
    <div className="operations-overview">
      <button disabled={busy} onClick={() => void refresh(true)}>
        Betriebsstand prüfen
      </button>
      {error && <p className="error" role="alert">{error}</p>}
      {!data && !error && <p role="status">Betriebsstand wird geladen …</p>}
      {data && <OperationNotices data={data} onSetup={onSetup} onManage={onManage} />}
    </div>
  );
}
