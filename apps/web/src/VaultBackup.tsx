import { useEffect, useState } from "react";
import { action } from "./RetirementPanel";
import { get } from "./ServerCheck";

export function VaultBackup() {
  const [local, setLocal] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    void get<{ local: boolean }>("/api/vault-backup").then((result) => setLocal(result.local))
      .catch((error: Error) => setError(error.message));
  }, []);
  return <div className="tile">
    <h3>StackPilot-Tresor sichern</h3>
    <p>Enthält StackPilots Datenbank und Hauptschlüssel verschlüsselt. Die Dienst-Datenbanken und Medien werden separat gesichert.</p>
    {local === false && <p>Öffne StackPilot am Server oder über einen SSH-Tunnel, damit die Sicherungspassphrase geschützt übertragen wird.</p>}
    {local && <form onSubmit={async (event) => {
      event.preventDefault();
      setError("");
      setMessage("");
      if (passphrase !== repeat) { setError("Die Sicherungspassphrasen stimmen nicht überein."); return; }
      setBusy(true);
      try {
        const { token } = await get<{ token: string }>("/api/session");
        const response = await fetch("/api/vault-backup", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-StackPilot-Token": token },
          body: JSON.stringify({ password, passphrase }),
        });
        if (!response.ok) {
          if (response.status === 401) window.dispatchEvent(new Event("stackpilot:auth-required"));
          throw Error((await response.json()).error || "Die Sicherung konnte nicht geladen werden.");
        }
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement("a");
        link.href = url;
        link.download = `stackpilot-tresor-${new Date().toISOString().slice(0, 10)}.spvault`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        setMessage("Verschlüsselte Tresor-Sicherung heruntergeladen. Datei und Passphrase getrennt aufbewahren.");
      } catch (error) {
        setError((error as Error).message);
      } finally {
        setPassword("");
        setPassphrase("");
        setRepeat("");
        setBusy(false);
      }
    }}>
      <label>StackPilot-Administratorpasswort<input required type="password" autoComplete="current-password"
        value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} /></label>
      <label>Sicherungspassphrase (mindestens 16 Zeichen)<input required type="password" autoComplete="new-password" minLength={16}
        value={passphrase} onChange={(event) => setPassphrase(event.target.value)} disabled={busy} /></label>
      <label>Sicherungspassphrase wiederholen<input required type="password" autoComplete="new-password"
        value={repeat} onChange={(event) => setRepeat(event.target.value)} disabled={busy} /></label>
      <button disabled={busy}>{busy ? "Tresor wird gesichert …" : "Verschlüsselte Tresor-Sicherung laden"}</button>
    </form>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
    {local && <VaultRestore />}
  </div>;
}


function VaultRestore() {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  return <details>
    <summary>Tresor-Sicherung in einen neuen Ordner wiederherstellen</summary>
    <p>StackPilot prüft die Sicherung und legt die wiederhergestellten Dateien in einem privaten Ordner auf dem Server ab. Für die spätere Übernahme des Tresors muss StackPilot gestoppt werden.</p>
    <form onSubmit={async (event) => {
      event.preventDefault();
      if (!file) return;
      setError("");
      setMessage("");
      setBusy(true);
      try {
        if (file.size > 128 * 1024 * 1024) throw Error("Die Sicherung darf höchstens 128 MiB groß sein.");
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",", 2)[1]);
          reader.onerror = () => reject(Error("Die Sicherung konnte nicht gelesen werden."));
          reader.readAsDataURL(file);
        });
        const result = await action<{ entries: number; directory: string }>("/api/vault-backup/restore", {
          archive: data, password, passphrase,
        });
        setMessage(`${result.entries} Tresoreinträge geprüft. Dateien liegen auf dem Server unter ${result.directory}.`);
      } catch (error) {
        setError((error as Error).message);
      } finally {
        setPassword("");
        setPassphrase("");
        setBusy(false);
      }
    }}>
      <label>Tresor-Sicherung <input required type="file" accept=".spvault" disabled={busy}
        onChange={(event) => setFile(event.target.files?.[0] || null)} /></label>
      <label>Administratorpasswort für Wiederherstellung <input required type="password" autoComplete="current-password"
        value={password} disabled={busy} onChange={(event) => setPassword(event.target.value)} /></label>
      <label>Passphrase des Archivs <input required type="password" autoComplete="off" minLength={16}
        value={passphrase} disabled={busy} onChange={(event) => setPassphrase(event.target.value)} /></label>
      <button disabled={busy || !file}>Sicherung wiederherstellen</button>
    </form>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
  </details>;
}
