# Betrieb und Nachweise

- Reale Messwerte und Simulation klar unterscheiden.
- Laufende Aufträge überleben Ansichtswechsel; Wiederaufnahme prüft frischen Zustand.
- UI-Fortschritt ist kein Sicherheitsnachweis und darf keine Prüfung selbst bestätigen.
- Fachliche Tests für Regelvorlagen, Zustandsauswertung und Reparaturpfade.
- Browserprüfung für Schrittnavigation, aktive Auswahl, Geheimnisbehandlung,
  schmale Ansichten und Tastaturbedienung.
- Persönliche Geräte, Tailscale-Policy und öffentliche Freigabe benötigen weiterhin
  die Prüfung im tatsächlichen Netz.

Die Überarbeitung ist mit Fachtests, Produktionsbuild, isoliertem Git-Upload,
Produktions-HTTP-Server und Browserprüfungen belegt. Die Browserdaten simulieren
Dienste; sie bestätigen keine persönliche Tailscale-Policy. Die Produktionsprüfung
testet authentifizierte APIs ohne Docker-Zugriff, einschließlich gesperrtem Upload
ohne lokale Zustimmung. Geräte-/MFA-Abnahme bleibt separat.
