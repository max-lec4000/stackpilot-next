import { useEffect, useState } from "react";
import { get } from "./ServerCheck";
import { action } from "./RetirementPanel";
type Backup = {
  id: string;
  createdAt: string;
  bytes: number;
  restore: { status: string; message?: string };
};
export function IdentityBackups() {
  const [items, setItems] = useState<Backup[]>([]),
    [resume, setResume] = useState(false),
    [password, setPassword] = useState(""),
    [passphrase, setPassphrase] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  async function refresh() {
    const data = await get<{
      backups: Backup[];
      maintenance: { needsResume: boolean };
    }>("/api/remote-access/backups");
    setItems(data.backups);
    setResume(data.maintenance.needsResume);
  }
  useEffect(() => {
    void refresh().catch(() => {});
  }, []);
  useEffect(() => {
    const hide = () => {
      if (document.visibilityState === "hidden") {
        setPassword("");
        setPassphrase("");
        setConfirmation("");
      }
    };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, []);
  async function run(kind: string, id?: string) {
    setBusy(kind);
    setError("");
    setMessage("");
    try {
      if (kind === "download") {
        const session = await get<{ token: string }>("/api/session");
        const response = await fetch("/api/remote-access/backup/download", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-StackPilot-Token": session.token,
          },
          body: JSON.stringify({ id, password }),
        });
        if (!response.ok) {
          if (response.status === 401)
            window.dispatchEvent(new Event("stackpilot:auth-required"));
          const data = await response.json();
          throw Error(data.error || "Download fehlgeschlagen.");
        }
        const url = URL.createObjectURL(await response.blob());
        const a = document.createElement("a");
        a.href = url;
        a.download = `stackpilot-identity-${id}.spbackup`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        setMessage(
          "Verschlüsselte Sicherung heruntergeladen. Datei und Passphrase getrennt vom Server aufbewahren.",
        );
      } else {
        await action("/api/remote-access/backup/" + kind, {
          id,
          password,
          passphrase,
          confirmation,
        });
        setMessage(
          kind === "test"
            ? "Isolierter Wiederherstellungstest bestanden."
            : kind === "resume"
              ? "Lokaler Start angefordert. Sicherheitsstand erneut prüfen."
              : "Verschlüsselte Sicherung erstellt. Lade sie jetzt auf ein anderes Gerät herunter.",
        );
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      await refresh().catch(() => {});
    } finally {
      setPassword("");
      setPassphrase("");
      setConfirmation("");
      setBusy("");
    }
  }
  return (
    <div className="tile">
      <h3>Authentik sichern &amp; wiederherstellen</h3>
      <p>
        Konfiguration, Datenbank, MFA-Daten und private Schlüssel werden mit
        einer eigenen Passphrase verschlüsselt. Authentik wird für die Sicherung
        kurz angehalten; Jellyfin läuft weiter. Die Passphrase wird nicht
        gespeichert.
      </p>
      <label>
        StackPilot-Passwort für Sicherungen
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <label>
        Sicherungspassphrase · mindestens 16 Zeichen
        <input
          type="password"
          autoComplete="off"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
        />
      </label>
      <label>
        Sicherung oder Test mit OK bestätigen
        <input
          value={confirmation}
          autoComplete="off"
          placeholder="OK"
          onChange={(e) => setConfirmation(e.target.value)}
        />
      </label>
      <button
        className="primary"
        disabled={
          !!busy || !password || passphrase.length < 16 || confirmation !== "OK"
        }
        onClick={() => void run("create")}
      >
        Verschlüsselte Sicherung erstellen
      </button>
      {resume && (
        <p className="notice">
          Authentik wurde für eine Sicherung angehalten oder sein Neustart ist
          noch nicht bestätigt.{" "}
          <button
            disabled={!!busy || !password || confirmation !== "OK"}
            onClick={() => void run("resume")}
          >
            Lokalen Betrieb fortsetzen
          </button>
        </p>
      )}
      {busy && (
        <p role="status">
          {busy === "test"
            ? "Wiederherstellung in getrennten Containern läuft. Das kann mehrere Minuten dauern."
            : busy === "create"
              ? "Sicherung läuft. Authentik wird anschließend wieder gestartet."
              : "Wird ausgeführt …"}
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      <ul className="connection-list">
        {items.map((b) => (
          <li key={b.id}>
            <div>
              <strong>{new Date(b.createdAt).toLocaleString("de-AT")}</strong>
              <p>
                {(b.bytes / 1024 / 1024).toFixed(1)} MiB · Wiederherstellung:{" "}
                {b.restore.status === "passed"
                  ? "geprüft"
                  : b.restore.status === "failed"
                    ? "nicht bestätigt"
                    : b.restore.status === "running"
                      ? "läuft oder wurde unterbrochen"
                      : "noch ungeprüft"}
              </p>
              <button
                disabled={!!busy || !password}
                onClick={() => void run("download", b.id)}
              >
                Verschlüsselt herunterladen
              </button>{" "}
              <button
                disabled={
                  !!busy ||
                  !password ||
                  passphrase.length < 16 ||
                  confirmation !== "OK"
                }
                onClick={() => void run("test", b.id)}
              >
                Wiederherstellung isoliert testen
              </button>
              {b.restore.message && <p>{b.restore.message}</p>}
            </div>
          </li>
        ))}
      </ul>
      <p className="muted">
        Der Test ersetzt keine laufende Installation. Er stellt die Sicherung
        ohne öffentliche Ports in separaten Containern wieder her. Eine Kopie
        nur auf demselben Server schützt nicht vor Serververlust. Unterstützte
        Sicherungsgröße: 128 MiB verschlüsseltes Archiv; zu große Daten werden
        abgewiesen und nicht still ausgelassen.
      </p>
    </div>
  );
}
