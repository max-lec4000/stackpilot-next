# Phase 7.0 · Konzept: Apps zentral über StackPilot verwalten

Stand: 19.11.2026, **mit Max abgestimmt** (Entscheidungen in Abschnitt 7). Noch keine Umsetzung. Grundlage ist der
Code-Stand `main` nach StackPilot 0.5.0 / Couchdeck 0.2.10.

## 1. Ausgangslage

**Oberfläche.** Sieben Hauptansichten: Übersicht, Medien entdecken, Meine Anfragen,
Downloads, Anwendungen, Verwaltung, Stack konfigurieren. „Verwaltung“ allein hat zwölf
Bereiche (Medienbestand, Musikbibliothek, Externer Zugriff, Quellen, Medienprofile,
Verbindungen, VPN & Ausfallsperre, Sicherungen & Updates, Diagnose, Auftragsverlauf,
Änderungsverlauf, Über StackPilot). 47 Oberflächen-Bausteine.

**Server.** Rund 126 Module flach in `apps/server` und `apps/server/identity`, ein
zentraler Router (`middleware.js`, ~1000 Zeilen, ~156 Routen) mit eingestreuten
Sicherheitsstufen (Sitzung, CSRF, Passwort). App-Zugriffe laufen über `service-api.js`
(`Services`) und viele Einzelmodule, die direkt App-APIs ansprechen.

**Was dabei auffällt.**
- Funktionen liegen dort, wo die Technik liegt, nicht wo man sie sucht: Zuschauer und
  ihr Freigabe-Schalter unter „Externer Zugriff“, das Freigeben einzelner Anfragen unter
  „Meine Anfragen“, Container-Updates unter „Anwendungen“ *und* „Sicherungen & Updates“,
  VPN-Configs unter „VPN & Ausfallsperre“, Couchdeck unter „Anwendungen“.
- Jede neue Funktion verlängert den Router und baut eigene App-Aufrufe, Bestätigungen und
  Rücklese-Prüfungen. Das ist sicher, aber schwer zu überblicken.
- Die Sicherheitsmuster sind gut (Vorschau, „OK“, Auftragssperre, Rücklesen,
  Änderungsverlauf), aber pro Funktion neu geschrieben.

## 2. Leitlinien

1. **Aufgaben statt Apps.** Die Oberfläche ordnet nach dem, was man tun will (Anfragen
   freigeben, Download reparieren, Zuschauer verwalten), nicht nach Seerr, Sonarr usw.
2. **Die App bleibt die Quelle der Wahrheit.** StackPilot liest die tatsächlichen Werte
   aus der App, schreibt über deren API und gilt eine Änderung erst nach dem Rücklesen als
   erledigt. Eigene Daten nur, wo die Apps nichts anbieten (z. B. Verlauf, Limits über
   Apps hinweg).
3. **Drei Stufen je Funktion.**
   - **Übernehmen:** vollständig in StackPilot (Alltag, z. B. Freigaben, Rechte).
   - **Geführt:** StackPilot zeigt Zustand und Ursache, bietet die passende Aktion mit
     Vorschau (z. B. Importfehler, „Warum passiert nichts?“).
   - **Expertenzugang:** seltene Spezialeinstellungen bleiben in der App; StackPilot
     verlinkt gezielt (nur im Tailnet) und zeigt an, was dort zu tun ist.
4. **Ein Sicherheitsmuster für alles.** Vorschau → „OK/Abbrechen“ → Ausführung unter
   Auftragssperre → Rücklesen → Eintrag im Änderungsverlauf. Passwort nur für
   Sicherheitsrelevantes (Fernzugriff, Funnel, Tresor, Zugangsdaten, Administratoren).
5. **Erst Struktur, dann Funktionen.** Neue Funktionen kommen erst, wenn Router,
   App-Anbindung und Navigation dafür vorbereitet sind – sonst wächst das heutige Problem.

## 3. Zielnavigation (Vorschlag)

| Bereich | Inhalt | Roadmap |
|---|---|---|
| **Zuhause** | Zustand aller Dienste, Hinweise „Warum passiert nichts?“, Benachrichtigungen, offene Freigaben | 7.2, 7.5 |
| **Medien** | Entdecken, Bestand, Bibliotheken und Scans, Metadaten korrigieren, laufende Wiedergaben | 7.4 |
| **Anfragen** | Wartende freigeben/ablehnen (einzeln, gesammelt, mit Begründung), Limits, Verlauf | 7.1 |
| **Downloads** | Warteschlange, manuelle Suche mit Treffern, Importprobleme, Überwachung, Zeitpläne, Seeding | 7.2 |
| **Personen** | Zuschauer und Rechte (Film/Serie, Bibliotheken, Altersfreigaben), Geräte, MFA/Passwort-Wiederherstellung, Einladungen | 7.1 |
| **Qualität & Quellen** | Qualitäts- und Größenprofile, Sprachen, Suchquellen, Untertitel | 7.3 |
| **Speicher** | Belegung, Aufräumen (Ersatzversionen, Verwaistes, Duplikate), Papierkorb, Speicherorte/NAS | 7.4, Phase 3 |
| **Couchdeck** | Status, Audioziel, Tontest, Verbindungen, Neustart, Diagnose, Update | 7.6 |
| **System** | Apps & Container, Updates, Sicherungen und Wiederherstellung, Zugriff & Netzwerk (Tailnet, Funnel, VPN je Dienst), Diagnose, Verläufe | 7.5, 7.7 |

Heutige Bereiche ziehen um, alte Links leiten weiter:

| Heute | Künftig |
|---|---|
| Medien entdecken, Medienbestand, Musikbibliothek | Medien |
| Meine Anfragen (+ Freigabe-Schalter aus „Externer Zugriff“) | Anfragen |
| Downloads | Downloads |
| Externer Zugriff → Zuschauer | Personen |
| Externer Zugriff (Gateway, Funnel, Streamyfin), VPN & Ausfallsperre | System → Zugriff & Netzwerk |
| Medienprofile, Quellen | Qualität & Quellen |
| Anwendungen (Couchdeck) | Couchdeck |
| Anwendungen, Sicherungen & Updates, Verbindungen, Diagnose, Verläufe, Über | System |
| Stack konfigurieren | System → Apps & Container (Assistent bleibt erreichbar) |

## 4. Aufbau im Server

- **Domänen statt flacher Liste:** `apps/server/domains/<bereich>/` je Bereich der
  Zielnavigation (people, requests, downloads, quality, library, storage, couchdeck,
  system, access) mit eigener Routenliste und Logik.
- **Routen-Verzeichnis statt Router-Datei:** Jede Route wird deklariert mit Methode, Pfad,
  Schutzstufe (`sitzung`, `ok`, `passwort`), Auftragssperre ja/nein, Änderungsverlauf ja/nein.
  Der gemeinsame Rahmen erzwingt die Stufen; `middleware.js` schrumpft auf Anmeldung,
  CSRF und das Einhängen der Domänen.
- **App-Adapter:** `apps/server/adapters/<app>.js` (Jellyfin, Seerr, Sonarr, Radarr,
  Lidarr, Prowlarr, Bazarr, qBittorrent, Authentik) mit benannten Methoden statt freier
  API-Pfade, Versions- und Fähigkeitserkennung, übersetzten Fehlermeldungen und einer
  gemeinsamen Hilfe „schreiben und zurücklesen“. Domänen sprechen nur Adapter an.
- **Einheitliche Bausteine:** Aufträge mit Fortschritt (vorhanden: `operations`),
  Benachrichtigungen (vorhanden), Änderungsverlauf (vorhanden) als gemeinsame Dienste.
- **Oberfläche:** gemeinsame Bausteine für Vorschau-Bestätigung, Rücklese-Status,
  Ursachen-Anzeige und Listen mit Sammelaktionen.

Der Umbau erfolgt schrittweise ohne Funktionsänderung: zuerst Routen-Verzeichnis und
Adapter für bestehende Funktionen, dann Navigation mit Weiterleitungen, jeweils mit den
vorhandenen Tests und einer VM-Abnahme.

## 5. Container-Architektur (früh festlegen, 7.7)

| Teil | Möglichkeit | Einschätzung |
|---|---|---|
| StackPilot | Container **mit** Docker-Socket | Abgelehnt: Socket = volle Root-Macht im Container. |
| StackPilot | Container **ohne** Socket + kleiner Docker-Wächter auf dem Host mit fester Erlaubnisliste (heutige Root-Hilfe als Vorbild) | **Empfohlen.** Gleiche Rechte wie heute, sauber getrennt, eigenes Update/Rollback möglich. |
| Tailscale | eigener Container mit Host-Netz | Kein Sicherheitsgewinn, Serve/Funnel hängen am Host. **Empfehlung: auf dem Host lassen.** |
| Couchdeck | Container mit Bildschirm, GPU, Controller, Audio | Machbar, aber viele Gerätefreigaben (Wayland/cage, DRM, evdev, PipeWire, VA-API) – im Container kaum sicherer als heute. **Empfehlung: zuerst Machbarkeitsprobe in der VM, Entscheidung danach.** |

Bis zur Entscheidung gilt für neue Funktionen: keine neuen direkten Host-Aufrufe aus der
Fachlogik, sondern über die bestehende Root-Hilfe bzw. den späteren Wächter.

## 6. Reihenfolge

1. **7.0a Struktur:** Routen-Verzeichnis, App-Adapter, gemeinsame Oberflächen-Bausteine –
   ohne neue Funktionen, alle Tests grün, VM-Abnahme.
2. **7.0b Navigation:** Zielbereiche mit Weiterleitungen der alten Links.
3. **7.0c Container-Probe:** StackPilot-Container ohne Socket mit Docker-Wächter in der VM;
   Couchdeck-Machbarkeit; danach Entscheidung.
4. **7.1** Personen, Rechte und Anfragen → **7.2** Downloads und Ursachen → **7.3** Qualität
   und Quellen → **7.4/7.5** Medien, Speicher, Sicherung und Wiederherstellung →
   **7.6/7.7** Couchdeck und Container-Umzug.

## 7. Entscheidungen (19.11.2026)

- **Zielnavigation:** wie in Abschnitt 3 – neun Bereiche nach Aufgaben, alte Links leiten
  weiter, Umbau zuerst ohne Funktionsänderung.
- **Expertenzugang:** bleibt für Seltenes – gezielte Links in die App-Oberflächen, nur im
  Tailnet.
- **Zuschauer-Oberfläche:** aktuell nein, vielleicht später. StackPilot bleibt vorerst
  Verwaltung; Rollen so anlegen, dass eine spätere Zuschaueransicht nicht verbaut wird.
- **Container:** StackPilot als Container ohne Docker-Socket mit kleinem Docker-Wächter auf
  dem Host; Tailscale bleibt auf dem Host; Couchdeck erst nach Machbarkeitsprobe entscheiden.
