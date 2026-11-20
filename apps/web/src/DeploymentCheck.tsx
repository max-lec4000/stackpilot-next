import { useEffect, useRef, useState } from "react";
import { action } from "./RetirementPanel";
import { get } from "./ServerCheck";
import { useConfirm } from "./ui";
type Plan = {
  id: string;
  host: string;
  createdAt: string;
  executable: boolean;
  confirmation: string;
  blockers: string[];
  warnings: string[];
  images: Record<string, string>;
  added?: string[];
  existing?: string[];
  vpnTransition?: boolean;
  plannedPaths: { host: string; container: string; purpose: string }[];
};
type Operation = {
  id: string;
  kind: string;
  project: string;
  status: string;
  error: string | null;
  pauseRequested: boolean;
  steps: { id: string; label: string; status: string; attempts: number }[];
  checks: { service: string; scope: string; status: string }[];
};
const statusText: Record<string, string> = {
  queued: "Wartet",
  running: "Läuft",
  paused: "Pausiert",
  failed: "Fehlgeschlagen",
  completed: "Abgeschlossen",
  cancelled: "Beendet",
};
export function DeploymentCheck({
  selected,
  path,
  username,
  vpn,
  language,
  quality,
  vpnProfileId,
  couchdeck = false,
  couchdeckYoutube = false,
  remote = false,
  viewer = "",
  adopt = false,
  onStarted,
  onPlanState,
  showPlanner = true,
}: {
  selected: string[];
  path: string;
  username: string;
  vpn: boolean;
  vpnProfileId?: string;
  language: string;
  quality: string;
  couchdeck?: boolean;
  couchdeckYoutube?: boolean;
  remote?: boolean;
  viewer?: string;
  adopt?: boolean;
  onStarted?: () => void;
  onPlanState?: (hint: string) => void;
  showPlanner?: boolean;
}) {
  const confirmCard = useRef<HTMLDivElement>(null);
  const [result, setResult] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const { ask, dialog } = useConfirm();
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [operations, setOperations] = useState<Operation[]>([]);
  const signature = JSON.stringify({
    selected,
    path,
    username,
    vpn,
    vpnProfileId,
    language,
    quality,
    couchdeck,
    couchdeckYoutube,
    remote,
    viewer,
    adopt,
  });
  const [checked, setChecked] = useState("");
  useEffect(() => {
    onPlanState?.(
      error
        ? "Prüfung fehlgeschlagen. Siehe Fehlermeldung im Plan."
        : !result
          ? "Zuerst den echten Installationsplan prüfen."
          : checked !== signature
            ? "Auswahl geändert. Plan erneut prüfen."
            : result.executable
              ? "Plan ist bereit. Im Plan bestätigen und den Gesamtauftrag starten."
              : "Installation blockiert. Die im Plan genannten Punkte zuerst beheben.",
    );
  }, [result, checked, signature, error, onPlanState]);
  useEffect(() => {
    if (result?.executable && checked === signature)
      confirmCard.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
  }, [result, checked, signature]);
  async function refresh() {
    try {
      const data = await get<{ operations: Operation[] }>("/api/operations");
      setOperations(data.operations.filter((o) => o.kind === "deployment"));
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
    <div className="tile deployment-panel">
      {showPlanner && (
        <>
          <span className="eyebrow">ECHTE GEMEINSAME INSTALLATION</span>
          <h3>Dein Stack als ein Gesamtauftrag</h3>
          <p>
            Der Plan prüft den Server neu. Ausführbare Auswahlen werden nach
            Bestätigung gemeinsam installiert, mit getrennten Passwörtern
            eingerichtet und miteinander verbunden. Ein verwalteter Stack wird
            um die neu gewählten Apps erweitert; vorhandene Konten und Daten
            bleiben erhalten.
          </p>
          <button
            className="primary plan-check-button"
            disabled={busy}
            onClick={() =>
              perform(async () => {
                const plan = await action<Plan>("/api/deployment/plan", {
                  selected,
                  path,
                  username,
                  vpn,
                  vpnProfileId,
                  language,
                  quality,
                  couchdeck,
                  couchdeckYoutube,
                  remote,
                  viewer,
                  adopt,
                });
                setResult(plan);
                setChecked(signature);
                setConfirmation("");
              })
            }
          >
            {busy
              ? "Server und Installationsplan werden geprüft …"
              : "Echten Installationsplan prüfen"}
          </button>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {result && checked === signature && (
        <>
          <p>
            Server: {result.host} · Plan {result.id.slice(0, 8)}
          </p>
          <h3>
            {result.executable
              ? "Bereit zur bestätigten Installation"
              : "Noch blockiert"}
          </h3>
          <ul>
            {result.blockers.map((b) => (
              <li className="warning" key={b}>
                {b}
              </li>
            ))}
          </ul>
          {result.executable && (
            <div className="install-confirmation" ref={confirmCard}>
              <h3>Bereit? Deinen Stack jetzt einrichten.</h3>
              <p>
                {result.existing?.length
                  ? "Vorhandene Apps bleiben erhalten. Neu gewählte Apps und angezeigte Verbindungen werden eingerichtet."
                  : "Die angezeigten Apps, Speicherpfade und Verbindungen werden gemeinsam eingerichtet."}
              </p>
              <p>
                {result.added?.length
                  ? "Neu: " + result.added.join(", ")
                  : selected.join(", ")}
              </p>
              <p>
                Speicher: <code>{path}</code> · VPN:{" "}
                {vpn ? "Mullvad mit Ausfallsperrenprüfung" : "aus"}
              </p>
              <label>
                Zur Bestätigung exakt eingeben: <b>{result.confirmation}</b>
                <input
                  autoComplete="off"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                />
              </label>
              <button
                className="primary"
                disabled={
                  busy ||
                  confirmation !== result.confirmation ||
                  (selected.includes("qBittorrent") && !vpn)
                }
                onClick={() =>
                  perform(async () => {
                    await action("/api/deployment/confirm", {
                      planId: result.id,
                      confirmation,
                    });
                    onStarted?.();
                    setResult(null);
                    setConfirmation("");
                  })
                }
              >
                {result.existing?.length
                  ? "Bestätigte Erweiterung wirklich ausführen"
                  : "Gesamten Stack wirklich installieren"}
              </button>
            </div>
          )}
          {result.warnings.map((w) => (
            <p className="muted" key={w}>
              {w}
            </p>
          ))}
          {!!result.existing?.length && (
            <p className="notice">
              Bleiben erhalten: {result.existing.join(", ")}. Neu:{" "}
              {result.added?.join(", ") || "keine App"}.
              {result.vpnTransition &&
                " qBittorrent wird kontrolliert auf VPN umgestellt."}
            </p>
          )}
          {!result.executable && (
            <p role="status" className="warning">
              Installation blockiert. Behebe die oben genannten Punkte und prüfe
              den Plan erneut.
            </p>
          )}
          <h3>Speicherzuordnung</h3>
          {result.plannedPaths.map((p) => (
            <p key={p.host}>
              <code>
                {p.host} → {p.container}
              </code>
              <br />
              {p.purpose}
            </p>
          ))}
          <details>
            <summary>Festgelegte Images ansehen</summary>
            {Object.entries(result.images).map(([n, image]) => (
              <p key={n}>
                <b>{n}</b>
                <br />
                <code>{image}</code>
              </p>
            ))}
          </details>
        </>
      )}
      {result && checked !== signature && (
        <p className="warning">Auswahl geändert. Erneut prüfen.</p>
      )}
      {!showPlanner && operations.length === 0 && (
        <p>
          Noch kein Installationsauftrag. Im Schritt Gesamtplan eine Auswahl
          prüfen und bestätigen.
        </p>
      )}
      {operations.length > 0 && <h3>Gespeicherte Installationsaufträge</h3>}
      {operations.map((op) => (
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
          <p className="muted">
            {op.status === "completed"
              ? "Dein Stack ist eingerichtet. Der Auftrag ist abgeschlossen."
              : ["running", "queued"].includes(op.status)
                ? "Die Ausführung läuft auf dem Server weiter, auch wenn du diese Ansicht verlässt."
                : "Der Auftrag wartet. Über die Schaltflächen kannst du ihn fortsetzen oder beenden."}
          </p>
          {op.error && <p className="warning">{op.error}</p>}
          <progress
            value={op.steps.filter((s) => s.status === "completed").length}
            max={op.steps.length}
          />
          <details open={op.status !== "completed"}>
            <summary>Einrichtungsschritte und Versuche</summary>
            <ul className="jobs">
              {op.steps.map((s) => (
                <li key={s.id}>
                  {s.status === "completed"
                    ? "✓"
                    : s.status === "failed"
                      ? "!"
                      : "○"}{" "}
                  {s.label} · {s.attempts} Versuche
                </li>
              ))}
            </ul>
          </details>
          {["running", "queued"].includes(op.status) && (
            <button
              disabled={busy || op.pauseRequested}
              onClick={() =>
                perform(() =>
                  action("/api/deployment/pause", { operationId: op.id }),
                )
              }
            >
              {op.pauseRequested
                ? "Pause angefordert …"
                : "Nach aktuellem Schritt pausieren"}
            </button>
          )}
          {["paused", "failed"].includes(op.status) && (
            <>
              <button
                disabled={busy}
                onClick={() =>
                  perform(() =>
                    action("/api/deployment/resume", { operationId: op.id }),
                  )
                }
              >
                Zustand prüfen und fortsetzen
              </button>
              <button
                disabled={busy}
                onClick={async () => {
                  if (
                    await ask(
                      "Ohne weitere Änderungen beenden? Bereits angelegte Container und Dateien bleiben erhalten.",
                      "Auftrag beenden",
                    )
                  )
                    perform(() =>
                      action("/api/deployment/end", {
                        operationId: op.id,
                        confirmation: "AUFTRAG BEENDEN",
                      }),
                    );
                }}
              >
                Ohne weitere Änderungen beenden
              </button>
              {dialog}
            </>
          )}
          {op.status === "completed" && (
            <p>
              Konten, Bibliotheken und Dienstverbindungen geprüft. Webzugänge
              und geschützte Passwortanzeige findest du unter Anwendungen.
              {op.steps.some(
                (s) => s.id === "vpn-isolation" && s.status === "completed",
              )
                ? " Mullvad-Verbindung und Ausfallsperre wurden in diesem Auftrag geprüft."
                : op.checks.some(
                      (c) => c.service === "Mullvad" && c.status === "passed",
                    )
                  ? " Der Mullvad-Ausgang wurde in diesem Auftrag geprüft; der bestehende Tunnel wurde nicht erneut für einen Ausfalltest unterbrochen."
                  : " Dieser Auftrag enthält keinen VPN-Nachweis."}{" "}
              Ein echter Medien-Download wurde dadurch nicht geprüft.
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
