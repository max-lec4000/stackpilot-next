import { useState } from "react";
import { action } from "./RetirementPanel";

/** Zugang zur Authentik-Verwaltung: einmal anzeigen, danach dort zweiten Faktor einrichten. */
export function AuthentikAdmin() {
  const [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [credentials, setCredentials] = useState<{ username: string; password: string; url: string } | null>(null);
  return (
    <div className="tile">
      <p>
        Die Authentik-Verwaltung ist nur am Server erreichbar. Vom eigenen Rechner aus:{" "}
        <code>ssh -N -L 19000:127.0.0.1:19000 &lt;benutzer&gt;@&lt;server&gt;</code>, dann{" "}
        <code>http://127.0.0.1:19000</code> öffnen. Beim ersten Anmelden eine Authenticator-App
        einrichten und unter Einstellungen → MFA-Geräte Wiederherstellungscodes erzeugen und
        offline aufheben.
      </p>
      <form
        className="couchdeck-actions"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            setCredentials(await action("/api/remote-access/identity/credentials", { password }));
            setTimeout(() => setCredentials(null), 60000);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setPassword("");
            setBusy(false);
          }
        }}
      >
        <label>
          StackPilot-Passwort{" "}
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <button disabled={busy || !password}>Zugang anzeigen</button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {credentials && (
        <p role="status">
          Benutzer <code>{credentials.username}</code> · Passwort <code>{credentials.password}</code>{" "}
          · wird nach einer Minute ausgeblendet.
        </p>
      )}
    </div>
  );
}
