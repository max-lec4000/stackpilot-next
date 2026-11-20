import { useCallback, useEffect, useRef, useState } from "react";
import { get } from "./ServerCheck";
import { action } from "./RetirementPanel";
import { viewHref } from "./navigation";
import { SectionHeading, StatusBadge, type StatusTone } from "./ui";

type Setup = {
  status: "idle" | "running" | "completed" | "failed" | "interrupted";
  running: boolean;
  steps: { id: string; label: string; status: string }[];
  error: string | null;
  result: {
    ready?: boolean;
    routes?: { url: string; loginUrl: string | null }[];
    invitation?: { username: string; password?: string; loginUrl: string };
  } | null;
};
type Invitation = { username: string; password: string; loginUrl: string };
const stepMark: Record<string, string> = { completed: "✓", running: "…", failed: "✕", pending: "·" };
const setupText: Record<Setup["status"], [string, StatusTone]> = {
  idle: ["Noch nicht eingerichtet", "neutral"],
  running: ["Wird eingerichtet …", "info"],
  completed: ["Eingerichtet", "success"],
  failed: ["Fehlgeschlagen", "danger"],
  interrupted: ["Unterbrochen", "warning"],
};

/** Zugriff von unterwegs in einem Schritt. Zuschauer verwaltet die Seite „Personen“ (7.1a). */
export function RemoteSetupPanel({ auto = false }: { auto?: boolean }) {
  const [setup, setSetup] = useState<Setup | null>(null),
    [invitation, setInvitation] = useState<Invitation | null>(null),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const alive = useRef(true);
  const load = useCallback(async () => {
    try {
      const next = await get<Setup>("/api/remote-setup");
      if (!alive.current) return;
      // Einladung des ersten Zuschauers aus dem Einrichtungsauftrag: einmal anzeigen.
      const first = next.result?.invitation;
      if (first?.password)
        setInvitation((shown) => shown || { username: first.username, password: first.password!, loginUrl: first.loginUrl });
      setSetup(next);
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    void load();
    const timer = setInterval(() => void load(), 4000);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [load]);
  async function start() {
    setBusy("start");
    setError("");
    try {
      setSetup(await action<Setup>("/api/remote-setup/start", {}));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  if (!setup) return null;
  const [label, tone] = setupText[setup.status];
  // Neu hinzugekommene Schritte (nach einem Update) sollen sich nachholen lassen.
  const missing = setup.steps.some((step) => step.status !== "completed");
  const done = setup.status === "completed" && !missing;
  const ready = setup.status === "completed";
  return (
    <section className="managed-services remote-setup" aria-label="Zugriff von unterwegs">
      <SectionHeading
        title="Zugriff von unterwegs"
        description="Jellyfin mit geschützter Anmeldung (Authentik, zweiter Faktor) über eine HTTPS-Adresse. Alle anderen Dienste bleiben im eigenen Netz."
        actions={<StatusBadge tone={tone}>{label}</StatusBadge>}
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {setup.status !== "idle" && (
        <ol className="remote-setup-steps">
          {setup.steps.map((step) => (
            <li key={step.id} data-status={step.status}>
              <span aria-hidden="true">{stepMark[step.status] || "·"}</span> {step.label}
            </li>
          ))}
        </ol>
      )}
      {setup.error && (
        <p className="error" role="alert">
          {setup.error}
        </p>
      )}
      {!done && auto && setup.status === "idle" && (
        <p>Startet von selbst, sobald die Installation oben abgeschlossen ist.</p>
      )}
      {!done && !(auto && setup.status === "idle") && (
        <div className="couchdeck-actions">
          <button className="primary" disabled={setup.running || !!busy} onClick={() => void start()}>
            {setup.status === "idle"
              ? "In einem Schritt einrichten"
              : ready
                ? "Fehlende Schritte nachholen"
                : "Erneut versuchen / fortsetzen"}
          </button>
          <span>Dauert einige Minuten. Jellyfin startet dabei einmal kurz neu.</span>
        </div>
      )}
      {ready && setup.result?.routes && (
        <p>
          Jellyfin-Adresse:{" "}
          <a href={setup.result.routes[0]?.loginUrl || setup.result.routes[0]?.url} target="_blank" rel="noreferrer">
            {setup.result.routes[0]?.url}
          </a>{" "}
          – derzeit nur im Tailnet erreichbar.
        </p>
      )}
      {ready && (
        <p>
          Zuschauer einladen und verwalten: <a href={viewHref("Verwaltung", "people")}>Personen → Zuschauer</a>
        </p>
      )}
      {invitation && (
        <div className="remote-setup-invitation" role="status">
          <b>Einladung für „{invitation.username}“ – wird nur jetzt angezeigt.</b>
          <p>Schick der Person diese drei Angaben. Beim ersten Anmelden richtet sie ihren zweiten Faktor selbst ein.</p>
          <dl>
            <dt>Adresse</dt><dd><code>{invitation.loginUrl}</code></dd>
            <dt>Benutzername</dt><dd><code>{invitation.username}</code></dd>
            <dt>Startpasswort</dt><dd><code>{invitation.password}</code></dd>
          </dl>
          <button onClick={() => void navigator.clipboard?.writeText(
            `Jellyfin: ${invitation.loginUrl}\nBenutzername: ${invitation.username}\nPasswort: ${invitation.password}`)}>
            Kopieren
          </button>
          <button onClick={() => {
            setInvitation(null);
            // Danach liegt das Startpasswort auch am Server nicht mehr vor.
            void action("/api/remote-setup/acknowledge", {}).catch(() => {});
          }}>
            Notiert – ausblenden
          </button>
        </div>
      )}
    </section>
  );
}
