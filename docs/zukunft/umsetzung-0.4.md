# Umsetzung nach 0.3.0

Dieser Arbeitsplan übernimmt die bestätigte Liste. „Offen“ bedeutet nicht
„braucht Nutzereingabe“: Die Arbeitspakete werden nach Abhängigkeiten umgesetzt.

| Paket | Umsetzung | Persönlicher Nachweis / Voraussetzung |
| --- | --- | --- |
| SSH-/Medienregeln klar trennen | umgesetzt | aktuelle Tailnet-Policy bleibt extern |
| Ansichten und Filter merken | umgesetzt | keiner |
| Downloadsuche über gesamten Client, Prioritäten | umgesetzt | echte Transfers separat testen |
| Lokale Hinweise und Benachrichtigungen | umgesetzt | externe Zustellkanäle erst nach Konfiguration |
| Übergreifende Suche und direkte Medienwege | umgesetzt, keine vollständige Archivsuche | vorhandene Dienstkonfiguration |
| Dashboard-Auswahl, Symbole, Zugänglichkeit | umgesetzt, Browserregression bestanden | persönliche Geräte separat |
| Systemzustand, Auftragssicherheit und effizientere Aktualisierung | offen | Neustart/VPN-Ausfall am Zielserver |
| Sicherer Code-Updateablauf mit Rückweg | implementiert und isoliert getestet | Installation des Nutzerdiensts, echter Update-/Rückwegnachweis |
| Vollständige Stack-Sicherung und Wiederherstellung | Archiv-/Kaltstopp-Grundlagen getestet; Bedienweg/Worker offen | Ausführung/Zielablage separat bestätigen |
| Rollen, Zuschauer und Einladungen | offen | persönliche Konten/MFA bleiben beim Nutzer |
| Portabler Musikbestand und Pflegevorschau | Bestand, Export und lesende Tagprüfung umgesetzt; Mehrfachpflege offen | Musikpfad/Berechtigungen aus Konfiguration |
| Geprüfte Plugin-Verwaltung und Jellyfin-Anfrageintegration | offen | Client-/Versionskompatibilität nachweisen |
| Öffentliche Funnel-Steuerung mit Rücknahme | geführte Aktivierung, Rücknahme und wiederkehrende Prüfung implementiert; isoliert getestet | echte öffentliche Abnahme über Mobilfunk; Smart-TV später |
| Zeitpläne, Kalender, Bereinigung, weitere Server | offen | individuelle Anbieter/Serverdaten |

Keine Veröffentlichung, externe Nachricht oder Änderung am persönlichen Server
folgt allein aus einem gelesenen Status. Tests verwenden isolierte Daten.

Alle Funktionen sollen nach den [Wizard-Leitlinien](wizard-leitlinien.md)
übersichtlich, mit wenigen Klicks und möglichst ohne technisches Vorwissen
konfigurierbar sein. Technische CLI-Grundlagen allein gelten nicht als fertiger
nutzerfreundlicher Einrichtungsweg.

Zwischenstand: 235 Fachtests und Build bestanden; Browserregression einschließlich
Funnel-Bestätigung und Rücknahme mit API-Fixtures bestanden.
Version 0.4.0 wird mit diesen geprüften Funktionen veröffentlicht. Unvollständige
Stack-Sicherungsintegration bleibt als nicht ausführbarer Entwurf dokumentiert.
Funnel-Bedienweg und Grenzen: [Anleitung](../funnel.md).
