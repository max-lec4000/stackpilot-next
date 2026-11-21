import { ThemeToggle } from "./ThemeToggle";
import { NotificationInbox } from "./Notifications";
import { PublicAccessToggle } from "./PublicAccessToggle";
import { useEffect, useState, type ReactNode } from "react";
export function AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<{
    configured: boolean;
    authenticated: boolean;
    username?: string;
  } | null>(null);
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    try {
      const r = await fetch("/api/auth/status");
      if (!r.ok) throw new Error();
      setStatus(await r.json());
    } catch {
      setError(
        "StackPilot ist gerade nicht erreichbar. Prüfe, ob die App auf deinem Server läuft, und versuche es erneut.",
      );
    }
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    const refresh = () => {
      setPassword("");
      setCode("");
      void load();
    };
    window.addEventListener("stackpilot:auth-required", refresh);
    return () =>
      window.removeEventListener("stackpilot:auth-required", refresh);
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await fetch(
        status?.configured ? "/api/auth/login" : "/api/auth/setup",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password, code }),
        },
      );
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      setPassword("");
      setCode("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (status?.authenticated)
    return (
      <>
        <div className="account-bar">
          <ThemeToggle />
          <PublicAccessToggle />
          <NotificationInbox />
          <span>Angemeldet als {status.username}</span>
          <button
            onClick={async () => {
              const session = await (await fetch("/api/session")).json();
              await fetch("/api/auth/logout", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-StackPilot-Token": session.token,
                },
                body: "{}",
              });
              window.location.reload();
            }}
          >
            Abmelden
          </button>
        </div>
        {children}
      </>
    );
  return (
    <main className="login-page">
      <div className="login-theme">
        <ThemeToggle />
      </div>
      <form className="login-card" onSubmit={submit}>
        <span className="eyebrow">STACKPILOT · DEIN MEDIENZUHAUSE</span>
        <h1>
          {status?.configured ? "Willkommen zurück." : "Dein sicherer Start."}
        </h1>
        <p>
          {status?.configured
            ? "Melde dich mit deinem Verwaltungszugang an."
            : "Lege den einzigen Verwaltungsadministrator an. Der einmalige Setupcode liegt auf dem Server in .stackpilot/bootstrap-token. Er bleibt außerhalb von Git."}
        </p>
        {!status ? (
          <button type="button" onClick={load}>
            Verbindung erneut prüfen
          </button>
        ) : (
          <>
            <label>
              Benutzername
              <input
                required
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </label>
            <label>
              Passwort
              <input
                required
                minLength={status.configured ? 1 : 12}
                maxLength={256}
                type="password"
                autoComplete={
                  status.configured ? "current-password" : "new-password"
                }
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {!status.configured && (
              <label>
                Einmaliger lokaler Setupcode
                <input
                  required
                  autoComplete="off"
                  type="password"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </label>
            )}
            <button className="primary" disabled={busy} type="submit">
              {busy
                ? "Bitte warten …"
                : status.configured
                  ? "Anmelden"
                  : "Administrator anlegen"}
            </button>
          </>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <small>Erreichbar nur im eigenen Netz. Keine Telemetrie.</small>
      </form>
    </main>
  );
}
