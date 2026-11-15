// Guidance is a next check, never a claim about an unobserved root cause.
export function problemGuidance(message) {
  const text = String(message || "").slice(0, 1000);
  if (/VPN|Mullvad|WireGuard/i.test(text)) return { title: "Downloadschutz prüfen", next: "VPN-Zustand und Ausfallsperre prüfen. Anschließend geschützt fortsetzen.", target: "#/verwaltung/safety" };
  if (/anderer Auftrag|Sperre|Auftrag.*läuft/i.test(text)) return { title: "Ein Auftrag benötigt Aufmerksamkeit", next: "Im Auftragsverlauf nachsehen, ob eine Aktion läuft oder fortgesetzt werden muss.", target: "#/verwaltung/history" };
  if (/Speicher|Platzmangel|Platz.*knapp/i.test(text)) return { title: "Speicherbedingungen prüfen", next: "Verfügbaren Platz am konfigurierten Medienpfad prüfen.", target: "#/verwaltung/diagnosis" };
  if (/Einrichtung.*abschließen|noch nicht eingerichtet/i.test(text)) return { title: "Einrichtung prüfen", next: "Den gespeicherten Einrichtungsstand öffnen und fehlende Schritte abschließen.", target: "#/einrichten" };
  if (/Quelle|Indexer|Prowlarr/i.test(text)) return { title: "Quellenverbindung prüfen", next: "Die betroffene Quelle testen und ihren Zustand sowie die ARR-Verbindung prüfen.", target: "#/verwaltung/sources" };
  return { title: "Aktion konnte nicht abgeschlossen werden", next: "Erneut prüfen. Bleibt der Fehler bestehen, unter Diagnose den aktuellen Zustand nachsehen.", target: "#/verwaltung/diagnosis" };
}
