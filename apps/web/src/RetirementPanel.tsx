import { useEffect, useState } from "react";
import { get, type Inventory } from "./ServerCheck";
type Container = {
  id: string;
  name: string;
  component: string;
  image: string;
  restart: string;
  network: string;
  workingDir: string | null;
  configFiles: string | null;
  mounts: { source: string; destination: string; type: string }[];
};
type Plan = {
  id: string;
  host: string;
  project: string;
  confirmation: string;
  expiresAt: string;
  containers: Container[];
  warnings: string[];
  steps: { id: string; label: string }[];
};
type Operation = {
  kind: string;
  id: string;
  project: string;
  status: string;
  error: string | null;
  pauseRequested: boolean;
  steps: { id: string; label: string; status: string; attempts: number }[];
};
export async function action<T>(url: string, body: unknown): Promise<T> {
  const session = await get<{ token: string }>("/api/session");
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-StackPilot-Token": session.token,
    },
    body: JSON.stringify(body),
  });
  if (r.status === 401)
    window.dispatchEvent(new Event("stackpilot:auth-required"));
  window.dispatchEvent(new Event("stackpilot:mutation"));
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Aktion fehlgeschlagen.");
  return data;
}
const statusText: Record<string, string> = {
  queued: "Wartet",
  running: "Läuft",
  paused: "Pausiert",
  failed: "Fehlgeschlagen",
  completed: "Abgeschlossen",
  cancelled: "Beendet",
};
export function RetirementPanel({
  inventory,
  onInventory,
}: {
  inventory: Inventory;
  onInventory: (v: Inventory) => void;
}) {
  const projects = [
    ...new Set(
      inventory.containers
        .filter((c) => c.component && c.project && c.project !== "stackpilot")
        .map((c) => c.project!),
    ),
  ];
  const [project, setProject] = useState(projects[0] || "stack");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [autostart, setAutostart] = useState(false);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function refresh() {
    try {
      const data = await get<{ operations: Operation[] }>("/api/operations");
      setOperations(data.operations.filter((o) => o.kind === "retirement"));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, []);
  async function perform(task: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await task();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="tile retirement-panel">
      <span className="eyebrow">ECHTER EINGRIFF · DATEN BEHALTEN</span>
      <h3>Alten Medienstack gezielt ablösen</h3>
      <p>
        Dieser Bereich stoppt und entfernt nach Bestätigung echte Container auf
        dem lokalen Docker-Daemon. Neue Apps werden dadurch noch nicht
        installiert. Aufträge und ursprüngliche Zuordnung bleiben lokal im
        Journal gespeichert.
      </p>
      <label>
        Altes Compose-Projekt
        <input
          value={project}
          onChange={(e) => {
            setProject(e.target.value);
            setPlan(null);
            setConfirmation("");
            setAutostart(false);
          }}
          list="old-projects"
        />
      </label>
      <datalist id="old-projects">
        {projects.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      <button
        disabled={busy}
        onClick={() =>
          perform(async () => {
            setPlan(await action<Plan>("/api/retirement/plan", { project }));
            setConfirmation("");
            setAutostart(false);
          })
        }
      >
        Ablöseplan erstellen
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {plan && (
        <div className="notice">
          <h3>
            {plan.containers.length} Container auf {plan.host}
          </h3>
          <p>
            Projekt: <b>{plan.project}</b> · gültig bis{" "}
            {new Date(plan.expiresAt).toLocaleTimeString("de-AT")}
          </p>
          {plan.warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
          {plan.containers.map((c) => (
            <details key={c.id}>
              <summary>
                {c.name} · {c.component}
              </summary>
              <p>
                <code>{c.id}</code>
                <br />
                Image: {c.image}
                <br />
                Neustartregel: {c.restart}
                <br />
                Netzwerk: {c.network}
                <br />
                Bisheriger Compose-Ordner: {c.workingDir || "Nicht ermittelt"}
                <br />
                Compose-Dateien: {c.configFiles || "Nicht ermittelt"}
              </p>
              <ul>
                {c.mounts.map((m, i) => (
                  <li key={i}>
                    <code>
                      {m.source} → {m.destination}
                    </code>{" "}
                    · bleibt erhalten
                  </li>
                ))}
              </ul>
            </details>
          ))}
          <label className="checkline">
            <input
              type="checkbox"
              checked={autostart}
              onChange={(e) => setAutostart(e.target.checked)}
            />{" "}
            Ich habe geprüft, dass kein externer Dienst oder Controller den
            alten Stack erneut erstellt. Seine Compose-Dateien werden nicht
            automatisch verändert.
          </label>
          <label>
            Zur Bestätigung exakt eingeben: <b>{plan.confirmation}</b>
            <input
              autoComplete="off"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          </label>
          <button
            className="danger"
            disabled={busy || !autostart || confirmation !== plan.confirmation}
            onClick={() =>
              perform(async () => {
                await action("/api/retirement/confirm", {
                  planId: plan.id,
                  confirmation,
                  autostartAcknowledged: autostart,
                });
                setPlan(null);
                setConfirmation("");
                setAutostart(false);
              })
            }
          >
            Alten Stack wirklich ablösen
          </button>
        </div>
      )}
      <h3>Gespeicherte Aufträge</h3>
      {operations.length === 0 ? (
        <p>Noch kein echter Ablöseauftrag.</p>
      ) : (
        operations.map((op) => (
          <div className="tile" key={op.id}>
            <div className="row">
              <b>
                {op.project} · {statusText[op.status] || op.status}
              </b>
              <span className="badge">
                {op.steps.filter((s) => s.status === "completed").length}/
                {op.steps.length}
              </span>
            </div>
            <small>
              Auftrag {op.id.slice(0, 8)} · Beim Verlassen dieser Ansicht läuft
              ein aktiver Auftrag weiter.
            </small>
            {op.error && <p className="warning">{op.error}</p>}
            <details>
              <summary>Schritte und Versuche</summary>
              <ul className="jobs">
                {op.steps.map((s) => (
                  <li key={s.id}>
                    {s.status === "completed"
                      ? "✓"
                      : s.status === "failed"
                        ? "!"
                        : "○"}{" "}
                    {s.label} · {s.status} · {s.attempts} Versuche
                  </li>
                ))}
              </ul>
            </details>
            {["running", "queued"].includes(op.status) && (
              <button
                disabled={busy || op.pauseRequested}
                onClick={() =>
                  perform(() =>
                    action("/api/retirement/pause", { operationId: op.id }),
                  )
                }
              >
                {op.pauseRequested
                  ? "Pause angefordert …"
                  : "Nach aktuellem Schritt pausieren"}
              </button>
            )}
            {["paused", "failed"].includes(op.status) && (
              <button
                disabled={busy}
                onClick={() =>
                  perform(() =>
                    action("/api/retirement/resume", { operationId: op.id }),
                  )
                }
              >
                Zustand prüfen und fortsetzen
              </button>
            )}
            {["paused", "failed"].includes(op.status) && (
              <button
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      "Auftrag ohne weitere Änderungen beenden? Bereits ausgeführte Schritte bleiben wirksam. Es erfolgt keine Wiederherstellung.",
                    )
                  )
                    perform(() =>
                      action("/api/retirement/end", {
                        operationId: op.id,
                        confirmation: "AUFTRAG BEENDEN",
                      }),
                    );
                }}
              >
                Ohne weitere Änderungen beenden
              </button>
            )}
            {op.status === "completed" && (
              <p>
                Containerablösung abgeschlossen. Daten/Volumes bleiben erhalten.
                Server erneut prüfen; unbekannte Listener werden nicht
                automatisch beendet.
                <button
                  disabled={busy}
                  onClick={() =>
                    perform(async () =>
                      onInventory(await get<Inventory>("/api/inventory")),
                    )
                  }
                >
                  Server und Ports erneut prüfen
                </button>
              </p>
            )}
          </div>
        ))
      )}
      <p className="muted">
        Kein Konfigurationsbackup und kein automatisches Wiederherstellen des
        alten Stacks. Das Journal ersetzt keine Sicherung. Nach einem
        Prozessabbruch kann die Executor-Sperre bis zu 90 Sekunden auslaufen.
      </p>
    </div>
  );
}
