import { useState } from "react";
import { get, type Inventory } from "./ServerCheck";
type ServerReport = {
  schemaVersion: number;
  createdAt: string;
  privacy: { contains: string[]; excluded: string[]; sharing: string };
  inventory: Inventory;
};
export function ReportPanel({
  onInventory,
}: {
  onInventory: (v: Inventory) => void;
}) {
  const [report, setReport] = useState<ServerReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function generate() {
    setBusy(true);
    setError("");
    try {
      const result = await get<ServerReport>("/api/report");
      setReport(result);
      onInventory(result.inventory);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function download() {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2) + "\n"], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stackpilot-serverbericht-${report.createdAt.replace(/[:.]/g, "-")}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="tile report-panel">
      <div className="row">
        <div>
          <span className="eyebrow">DIAGNOSE ZUM MITNEHMEN</span>
          <h3>Serverbericht für die Weiterentwicklung</h3>
        </div>
        <button disabled={busy} onClick={generate}>
          {busy ? "Bericht wird erstellt …" : "Serverbericht erstellen"}
        </button>
      </div>
      <p>
        Hardware, Speicher, Container und Portbelegung als JSON. Keine
        Konfigurationsinhalte oder Umgebungsvariablen. Enthält Gerätenamen,
        lokale Adressen und Pfade; vor dem Teilen ansehen.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {report && (
        <>
          <details open>
            <summary>
              Berichtvorschau ·{" "}
              {new Date(report.createdAt).toLocaleString("de-AT")}
            </summary>
            <pre className="report-preview">
              {JSON.stringify(report, null, 2)}
            </pre>
          </details>
          <button className="primary" onClick={download}>
            JSON-Datei herunterladen
          </button>
          <p>
            Der vollständige Verbindungsbericht samt Entwicklungsupload ist
            unter Verwaltung → Externer Zugriff verfügbar. Du kannst geprüfte
            Berichte im privaten Repository unter dev-private/reports/ ablegen.
            Echte Geheimnisse gehören auch dort nicht in Git.
          </p>
        </>
      )}
      <p className="muted">
        Auf dem Server: <code>npm run report</code> speichert nur lokal in
        <code> reports/</code>. <code>npm run report:dev</code> erstellt den
        erweiterten Entwicklungsbericht und lädt ihn bei aktivierter
        Entwicklungspolicy nach GitHub in <code>dev-private/reports/</code>.
      </p>
    </div>
  );
}
