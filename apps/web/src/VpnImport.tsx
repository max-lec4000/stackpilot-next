import { useState } from "react";
import { action } from "./RetirementPanel";
export function VpnImport({
  profileId,
  onImported,
}: {
  profileId: string;
  onImported: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [summary, setSummary] = useState("");
  return (
    <div className="notice">
      <b>Mullvad-WireGuard geschützt importieren</b>
      <p>
        Erstelle in deinem Mullvad-Konto eine WireGuard-Konfiguration für Linux.
        Wähle die .conf-Datei hier aus. Eine Kontonummer allein genügt nicht.
        Der private Schlüssel wird verschlüsselt gespeichert und nicht in
        Serverberichte aufgenommen.
      </p>
      <label>
        WireGuard-Datei (.conf)
        <input
          type="file"
          accept=".conf,text/plain"
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setBusy(true);
            setError("");
            try {
              if (file.size > 6000)
                throw new Error("Datei zu groß (höchstens 6 KB).");
              const result = await action<{
                id: string;
                endpoint: string;
                address: string;
              }>("/api/vpn/import", { config: await file.text() });
              onImported(result.id);
              setSummary(`Erfolgreich importiert: ${file.name} · ${result.endpoint} · ${result.address}`);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      <p role="status">
        {busy
          ? "Import läuft …"
          : profileId
            ? `Verschlüsseltes Profil vorhanden. ${summary}`
            : "Noch kein Profil importiert."}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p>
        Vor dem Start von qBittorrent prüft StackPilot den Mullvad-Ausgang und
        stoppt den Tunnel kontrolliert für einen Ausfallsperrentest. IPv6 bleibt
        im VPN-Netzwerk deaktiviert. Bei Fehlern startet qBittorrent nicht ohne
        VPN.
      </p>
    </div>
  );
}
