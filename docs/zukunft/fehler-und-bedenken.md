# Fehler und Bedenken

## Erkenntnisse aus der Erprobung

- Tailscale-Ping beweist keinen erlaubten TCP-Zugriff.
- Eine falsche Zieladresse in der Tailnet-Regel kann bei korrektem Server-Setup
  Gerätezugriffe verhindern.
- Ein HTTP-Erfolg auf dem Host beweist keine Erreichbarkeit aus einem Container.
- Eine SSO-Weiterleitung beweist keine vollständige MFA-Anmeldung oder Wiedergabe.
- Ein fehlender Zertifikatsparameter älterer Tailscale-Versionen darf nicht als
  fehlende Berechtigung ausgegeben werden.
- Fehlerdetails müssen auch ohne erfolgreich gestarteten Container erhalten bleiben.
- Geänderte manuelle Dateien und fremde Container dürfen nicht still übernommen werden.

## In 0.2.0 berücksichtigt

- Lange Verwaltungsseiten verdecken wichtige Aktionen und Abhängigkeiten.
- Die gewählte Verwaltungskachel ist visuell nicht deutlich genug.
- Wechsel zwischen Einrichtungsschritten darf keine Geheimnisse dauerhaft speichern
  und laufende Aufträge nicht unterbrechen.
- Unbekannte Prüfwerte müssen als unbekannt erkennbar bleiben.

## Weiterhin offen

Gerätezugriff, tatsächliche MFA und Wiedergabe brauchen Nachweise im Zielnetz.
Eine Vorlage repariert keine fremden Tailnet-Regeln automatisch. Root-Rechte für
Zertifikate können von der App nicht selbst vergeben werden. UI-Navigation und
gespeicherte Konfiguration dürfen diese Grenzen nicht als erledigt darstellen.
