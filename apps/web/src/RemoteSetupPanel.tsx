import { useCallback, useEffect, useRef, useState } from "react";
import { get } from "./ServerCheck";
import { action } from "./RetirementPanel";
import { ViewerProfiles } from "./ViewerProfiles";
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
type Viewer = { username: string; name: string; active: boolean; mfa: boolean; lastLogin: string | null; profileId: string | null; hasPasskey: boolean; passkeyPending: boolean };
type Invitation = { username: string; password: string; loginUrl: string };
type ViewerList = { loginUrl: string; viewers: Viewer[]; invitation?: Invitation; recoveryEnabled?: boolean; loginImproved?: boolean; passwordChoice?: boolean; addPasskeyReady?: boolean };
const stepMark: Record<string, string> = { completed: "✓", running: "…", failed: "✕", pending: "·" };
const setupText: Record<Setup["status"], [string, StatusTone]> = {
  idle: ["Noch nicht eingerichtet", "neutral"],
  running: ["Wird eingerichtet …", "info"],
  completed: ["Eingerichtet", "success"],
  failed: ["Fehlgeschlagen", "danger"],
  interrupted: ["Unterbrochen", "warning"],
};

/** Zugriff von unterwegs in einem Schritt, danach Zuschauer per Einladung. */
export function RemoteSetupPanel({ auto = false }: { auto?: boolean }) {
  const [setup, setSetup] = useState<Setup | null>(null),
    [list, setList] = useState<ViewerList | null>(null),
    [invitation, setInvitation] = useState<Invitation | null>(null),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const alive = useRef(true);
  const loadViewers = useCallback(async () => {
    try {
      const next = await get<ViewerList>("/api/viewers");
      if (alive.current) setList(next);
    } catch {
      /* Authentik noch nicht bereit */
    }
  }, []);
  const load = useCallback(async () => {
    try {
      const next = await get<Setup>("/api/remote-setup");
      if (!alive.current) return;
      // Einladung des ersten Zuschauers aus dem Einrichtungsauftrag: einmal anzeigen.
      const first = next.result?.invitation;
      if (first?.password)
        setInvitation((shown) => shown || { username: first.username, password: first.password!, loginUrl: first.loginUrl });
      setSetup((previous) => {
        if (next.status === "completed" && previous?.status !== "completed") void loadViewers();
        return next;
      });
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    }
  }, [loadViewers]);
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
  async function viewer(act: "invite" | "reset" | "remove" | "add-passkey" | "cancel-passkey", username: string) {
    setBusy(act + ":" + username);
    setError("");
    setInvitation(null);
    try {
      const next = await action<ViewerList>("/api/viewers/action", { action: act, name: username });
      setList(next);
      if (next.invitation) setInvitation(next.invitation);
      if (act === "invite") setName("");
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
        <>
          <h3>Zuschauer</h3>
          {list && <ViewerProfiles viewers={list.viewers} onChange={loadViewers} />}
          {(list?.loginImproved === false || list?.passwordChoice === false || list?.addPasskeyReady === false) && <details>
            <summary>Zuschauer-Anmeldung aktualisieren</summary>
            <p>Übernimmt den frisch bestätigten zweiten Faktor für die Jellyfin-Freigabe. Neue Zuschauer können ein eigenes Passwort wählen. Zuschauer mit bestehendem Konto können einen Passkey zusätzlich einrichten.</p>
            <form onSubmit={async (event) => {
              event.preventDefault();
              setError("");
              setBusy("login");
              try {
                setList(await action<ViewerList>("/api/viewers/action", { action: "improve-login", password: loginPassword }));
              } catch (error) {
                setError((error as Error).message);
              } finally {
                setLoginPassword("");
                setBusy("");
              }
            }}>
              <label>StackPilot-Administratorpasswort<input type="password" autoComplete="current-password" required
                value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} disabled={!!busy} /></label>
              <button disabled={!!busy}>Zuschauer-Anmeldung aktualisieren</button>
            </form>
          </details>}
          {list?.recoveryEnabled === false && <details>
            <summary>Wiederherstellungscodes für Zuschauer aktivieren</summary>
            <p>Nach der Anmeldung mit zweitem Faktor zeigt Authentik Zuschauern ohne Wiederherstellungscodes einmalig acht Codes an.</p>
            <form onSubmit={async (event) => {
              event.preventDefault();
              setError("");
              setBusy("recovery");
              try {
                setList(await action<ViewerList>("/api/viewers/action", { action: "enable-recovery", password: recoveryPassword }));
              } catch (error) {
                setError((error as Error).message);
              } finally {
                setRecoveryPassword("");
                setBusy("");
              }
            }}>
              <label>StackPilot-Administratorpasswort<input type="password" autoComplete="current-password" required
                value={recoveryPassword} onChange={(event) => setRecoveryPassword(event.target.value)} disabled={!!busy} /></label>
              <button disabled={!!busy}>Wiederherstellungscodes aktivieren</button>
            </form>
          </details>}
          {list?.recoveryEnabled === true && <p>Zuschauer erhalten Wiederherstellungscodes nach erfolgreicher Anmeldung mit zweitem Faktor.</p>}
          <form
            className="couchdeck-actions"
            onSubmit={(event) => {
              event.preventDefault();
              if (name.trim()) void viewer("invite", name);
            }}
          >
            <label>
              Benutzername{" "}
              <input
                value={name}
                placeholder="z. B. eltern"
                pattern="[a-zA-Z][a-zA-Z0-9_\-]{2,31}"
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <button className="primary" disabled={!!busy || !name.trim()}>
              Einladen
            </button>
          </form>
          {invitation && (
            <div className="remote-setup-invitation" role="status">
              <b>Einladung für „{invitation.username}“ – wird nur jetzt angezeigt.</b>
              <p>Schick der Person diese drei Angaben. Beim ersten Anmelden richtet sie ihren zweiten Faktor selbst ein.{list?.passwordChoice ? " Danach wählt sie ein eigenes Passwort." : ""}{list?.recoveryEnabled ? " Die Wiederherstellungscodes sollte sie an einem sicheren Ort aufbewahren." : ""}</p>
              <dl>
                <dt>Adresse</dt>
                <dd>
                  <code>{invitation.loginUrl}</code>
                </dd>
                <dt>Benutzername</dt>
                <dd>
                  <code>{invitation.username}</code>
                </dd>
                <dt>Startpasswort</dt>
                <dd>
                  <code>{invitation.password}</code>
                </dd>
              </dl>
              <button
                onClick={() =>
                  void navigator.clipboard?.writeText(
                    `Jellyfin: ${invitation.loginUrl}\nBenutzername: ${invitation.username}\nPasswort: ${invitation.password}`,
                  )
                }
              >
                Kopieren
              </button>
              <button
                onClick={() => {
                  setInvitation(null);
                  // Danach liegt das Startpasswort auch am Server nicht mehr vor.
                  void action("/api/remote-setup/acknowledge", {}).catch(() => {});
                }}
              >
                Notiert – ausblenden
              </button>
            </div>
          )}
          {list && list.viewers.length > 0 && (
            <ul className="remote-setup-viewers">
              {list.viewers.map((v) => (
                <li key={v.username}>
                  <b>{v.username}</b>{" "}
                  <StatusBadge tone={!v.active ? "neutral" : v.mfa ? "success" : "warning"}>
                    {!v.active ? "Entfernt" : v.mfa ? "Zweiter Faktor eingerichtet" : "Einladung offen"}
                  </StatusBadge>
                  {v.active && (
                    <span className="couchdeck-actions">
                      {v.hasPasskey && <span>Passkey eingerichtet</span>}
                      {list.addPasskeyReady && v.mfa && <>
                        {v.passkeyPending && <span>Passkey-Einrichtung beim nächsten Login im Browser</span>}
                        <button disabled={!!busy} onClick={() => void viewer(v.passkeyPending ? "cancel-passkey" : "add-passkey", v.username)}>
                          {v.passkeyPending ? "Passkey-Einrichtung abbrechen" : "Passkey hinzufügen"}
                        </button>
                      </>}
                      <button disabled={!!busy} onClick={() => void viewer("reset", v.username)}>
                        Neu einladen
                      </button>
                      <button disabled={!!busy} onClick={() => void viewer("remove", v.username)}>
                        Entfernen
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
