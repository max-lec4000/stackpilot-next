# Leitlinie: einfache, geführte Einrichtung

Nutzerergänzung vom 10. November 2026. Gilt für bestehende und neue Funktionen.

- Alle unterstützten Funktionen im Wizard verständlich auffindbar und konfigurierbar.
- Wenige Klicks und möglichst wenig technisches Vorwissen voraussetzen.
- Sichere Standardwerte vorgeben und ihre Wirkung in Alltagssprache erklären.
- Nur nötige Fragen stellen; nach Möglichkeit vorhandene Daten zuverlässig auslesen.
- Abhängigkeiten automatisch berücksichtigen und nur den nächsten sinnvollen
  Schritt zeigen. Keine endlosen Formulare, parallel sichtbaren technischen Listen
  oder wiederholten Konfigurationen.
- Einfache Auswahl zuerst; technische Details gezielt unter „Erweitert“ öffnen.
- Prüfen und Konfigurieren übernehmen, soweit Dienste eindeutig zugeordnet sind.
  Fremde Einstellungen und vorhandene Dateien nicht ungefragt überschreiben.
- Fortschritt, Wiederaufnahme, Fehlerursache und konkrete nächste Aktion zeigen.
- Sicherheitsbestätigungen an tatsächliche Eingriffe binden. Persönliche MFA und
  Gerätezulassung nicht durch bloßes Weiterklicken als bestanden markieren.
- Befehle und manuelles Editieren von JSON nur als begründete Ausweichlösung.
- Neue CLI-Werkzeuge sind technische Grundlagen; sie ersetzen keinen verständlichen
  geführten Bedienweg im Produkt.

## Aktuelles Arbeitspaket: Jellyfin über Funnel

Der Nutzer möchte im nächsten Prompt die sichere, einfache und nutzerfreundliche
Erreichbarkeit von Jellyfin über Funnel fertigstellen. Der geführte
Freigabe-/Rücknahmeablauf wird nun implementiert; ohne ausdrückliche Bestätigung
im Produkt bleibt die öffentliche Freigabe aus.

Dabei insbesondere den vollständigen Weg von der ersten Einrichtung bis zu
Browser-/TV-/Mobil-Anmeldung prüfen und unnötige manuelle Schritte beseitigen.
StackPilot-Verwaltung, ARR und Downloadclient bleiben außerhalb der Freigabe.
