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

### Fortschritt 7.0a (19.11.2026)

- **Routen-Verzeichnis** `apps/server/routes.js`: Routen mit Methode, Pfad und Schutzstufe
  (`session`/`ok`/`password`), Stufe wird vor der Fachlogik erzwungen; GET braucht nie eine
  Bestätigung, doppelte Routen sind ausgeschlossen. Die Middleware fragt zuerst das
  Verzeichnis, sonst die bisherige Bedingungskette.
- **Umgezogen** (14 Routen): System → Updates (`domains/system/updates.routes.js`),
  Zugriff → VPN (`domains/access/vpn.routes.js`), Anfragen → Freigabe je Zuschauer
  (`domains/requests/viewer-requests.routes.js`). Fehlermeldungen unverändert; ein Test
  hält die Schutzstufen fest.
- **App-Adapter** `apps/server/adapters/`: `confirm.js` (schreiben und zurücklesen),
  `seerr.js` (Konten, Import aus Jellyfin, Rechte mit Bestätigung, Version). Die Freigabe je
  Zuschauer spricht Seerr nur noch darüber.
- Nachweise in sp-test: 344 Tests, native Seerr-Integration (Konto anlegen, Rechte,
  Freigabe), Oberflächenprüfung des Freigabe-Schalters.
- **Zugriff & Netzwerk umgezogen** (`domains/access/remote.routes.js`, 34 Routen): Tailnet,
  privates HTTPS, Schutz-Gateway, SSO, Authentik-Sicherungen, Administratoren, Geräte,
  Funnel, Streamyfin. Schutzstufe `password` jetzt ohne Zwang zu „OK“ (nur mit `confirm`),
  Datei-Antworten über `fileResponse`. Test hält fest: alles, was Zugang verändert,
  verlangt das Passwort. Nachweise in sp-test: 345 Tests; alle Ansichten HTTP 200;
  falsches Passwort abgelehnt; Streamyfin zurück/vorbereiten/aktivieren; Authentik-
  Sicherung angelegt und als Datei geladen (ohne Passwort abgelehnt); Seite „Externer
  Zugriff“ ohne Seiten- oder Schnittstellenfehler.
- **Downloads und Ausfallsperren-Test umgezogen** (`domains/downloads/downloads.routes.js`,
  `domains/access/safety.routes.js`, 6 Routen). Nachweise in sp-test: 346 Tests,
  Downloadliste/-status, Meldungen bei ungültiger Aktion und Entfernen ohne OK,
  vollständiger Ausfallsperren-Test über die neue Route („completed“), danach
  Downloadschutz „connected“.
- **Qualität & Quellen umgezogen** (`domains/quality/quality.routes.js`, 7 Routen:
  Größenregel, Suchquellen). Nachweise in sp-test: 347 Tests, Größenregel gelesen und
  unverändert gespeichert, OK-Pflicht wie bisher, Quellenliste mit 641 Typen. Nicht nativ
  geprüft: Detail/Test einer konkreten Quelle (in der VM ist keine eingerichtet).
  Titelbezogene Qualität (`/api/media/quality`, `/film-limit`) folgt mit Anfragen/Medien.
- **Anfragen und Medien umgezogen** (`domains/requests/requests.routes.js` 24 Routen,
  `domains/library/library.routes.js` 15 Routen, u. a. Cover als Bildantwort über
  `rawResponse`). 14 löschende, abbrechende, freigebende oder austauschende Aktionen sind
  im Verzeichnis als „OK“ deklariert (bisherige Meldungen). Nachweise in sp-test: 348
  Tests, Listen/Suche/Musik/Archiv/Cover über neue Routen, Bestätigungsmeldungen wie
  bisher, sieben betroffene Seiten im Browser fehlerfrei. Nicht nativ geprüft:
  anfragebezogene Ansichten (keine offene Anfrage in der VM; echte Anfrage hätte einen
  Download ausgelöst).
- **Alle übrigen Routen umgezogen:** Personen (`domains/people`), Couchdeck
  (`domains/couchdeck`), Einrichtung/Ablösung (`domains/system/setup.routes.js`) und System
  (`domains/system/system.routes.js`: Katalog, Stack, Inventar/Bericht, Aufträge, Verläufe,
  Hinweise, verwaltete Apps, Schlüsselwechsel, Zugangsdaten, Tresor, Entwicklungsbericht).
  In `middleware.js` (von ~1000 auf ~500 Zeilen) bleiben nur Anmeldung, Sitzung, Couchdecks
  lokaler Medienzugang und die Größen-/Ortsprüfung für Tresor-Wiederherstellungen.
  Das Verzeichnis prüft „OK“ jetzt vor dem Passwort (keine verbrauchten Passwortversuche).
  Ein Test baut das gesamte Verzeichnis (≥150 Routen, keine Doppelungen, alle GET ohne
  Bestätigung) und hält die 27 Passwort-Routen fest. Nachweise in sp-test: 349 Tests; alle
  Lese-Routen 200; Meldungen wie bisher; echter Sonarr-Schlüsselwechsel und
  Tresor-Sicherung über die neuen Routen; alle Seiten im Browser ohne Fehler.
- **Weitere App-Adapter** (`adapters/arr.js`, `qbittorrent.js`, `jellyfin.js`,
  `authentik.js`), je mit einem umgestellten Nutzer: Radarr-Profilzuweisung der
  Filmgrenze (zurückgelesen), Download-Aktionen (Anhalten/Fortsetzen/Entfernen jetzt mit
  Bestätigung durch qBittorrent), Jellyfin-Anwendungsschlüssel beim Seerr-Tokenwechsel,
  gemeinsamer Authentik-Skriptlauf für Zuschauer und Systemeinstellungen. Übrige direkte
  App-Aufrufe (~400) ziehen mit 7.1–7.4 bereichsweise um.
- **Gefundener Fehler behoben:** Nach einer Authentik-Sicherung (und „lokal fortsetzen“)
  zeigte das Identitäts-Gateway auf eine veraltete interne Adresse des Authentik-Servers –
  die Zuschauer-Anmeldung brach ab (Discovery 404), bis das Gateway neu startete. Jetzt
  lädt StackPilot das Gateway nach jedem Authentik-Start neu (`startAuthentication`).
  Nachweis in sp-test: Fehler nachgestellt und behoben, neue Sicherung → Gateway-Prozesse
  1 s nach dem Server neu, Anmeldung mit MFA erfolgreich.
- **Oberflächen-Bausteine** (`apps/web/src/ui.tsx`): `ConfirmBar` (Frage, „OK“ fokussiert,
  „Abbrechen“, Fehler direkt darunter) und `useAction` (läuft/Fehler/Meldung). Umgestellt:
  StackPilot-Update, Container-Wartung, Sammel-Updates, VPN-Umstellung und Config
  entfernen. Fünf Stellen mit Browser-`window.confirm` (Downloads, Qualität, Folgen,
  Einrichtung) ziehen mit ihren Bereichen in 7.1–7.4 um. Nachweise in sp-test: Typprüfung,
  Build, 355 Tests, Dialoge im Browser (Fokus, Abbrechen setzt zurück, keine Fehler).
- **7.0a abgeschlossen.**

### Fortschritt 7.0b (20.11.2026)

- **Zielnavigation umgesetzt** (`apps/web/src/navigation.ts`): neun Bereiche in der
  Seitenleiste, Unterseiten als Reiter, Brotkrumen „Zuhause / Bereich / Unterseite“,
  Adressen `#/<bereich>/<unterseite>`. Jede Unterseite zeigt eine bestehende Ansicht
  (Bausteine unverändert, `navigate(view, area)` funktioniert weiter). Neu als eigene
  Seiten: Anfragen → Freigabe je Zuschauer, Personen → Zuschauer, Couchdeck. Die
  Netztrennungs-Meldung steht jetzt unter System → Apps & Container. Alte Adressen leiten
  weiter.
- Nachweise in sp-test: Typprüfung, Build; alle 21 Unterseiten im Browser mit richtigen
  Brotkrumen, ohne Seiten- oder Schnittstellenfehler; acht alte Adressen leiten richtig um;
  altes Testskript mit alter Adresse besteht.
- Bekannt/offen: Personen zeigt vorerst den bisherigen Bereich „Zugriff von unterwegs“ mit
  Zuschauern (Trennung in 7.1); System hat zehn Reiter (ggf. bündeln); Server-Hinweise
  verlinken noch alte Adressen (werden umgeleitet).

### Fortschritt 7.0c – Container-Probe (20.11.2026)

**Docker-Wächter** (`apps/docker-guard/`, Prototyp): kleiner Node-Dienst als root auf dem
Host, Unix-Socket für StackPilot, reicht nur erlaubte Docker-API-Aufrufe an den echten Socket
weiter. Modus `observe` (nur protokollieren) oder `enforce` (Verstöße mit 403 ablehnen).

- Erlaubnisliste nach Methode und Pfad (Container, Exec, Images ziehen, Netzwerke, Volumes,
  Ereignisse). Gesperrt sind u. a. Build, Plugins, Swarm, Secrets, `docker cp`, Commit.
- Inhaltsprüfung neuer Container: nicht privilegiert, keine Host-Namensräume (Netz, PID, IPC,
  UTS, Userns, Cgroupns), nur Rechte aus fester Liste (NET_ADMIN, CHOWN, DAC_OVERRIDE,
  FOWNER, SETUID, SETGID), nur `/dev/net/tun` als Gerät, keine GPU-/Geräteregeln,
  `VolumesFrom`, fremde Laufzeiten, `CgroupParent` oder abgeschaltete Schutzprofile.
  Einbindungen nur unter den erlaubten Ordnern (Zustand, App-Daten, Medien), Pfade wie Docker
  bereinigt (`..`) **und** mit aufgelösten Verknüpfungen geprüft; nie der Docker-Socket.
  Benannte Volumes mit Host-Ordner (`type=none,o=bind,device=…`, auch inline im Mount) nur
  innerhalb der erlaubten Ordner, nur der lokale Treiber. Netzwerke nur als Bridge.
  `exec` nicht privilegiert.
- StackPilot nutzt den Wächter über `STACKPILOT_DOCKER_HOST` (nur Unix-Socket erlaubt). Alle
  Docker-Aufrufe laufen jetzt über diesen einen Zugang – auch die Systemübersicht, die vorher
  den Standard-Socket direkt nahm.
- Fehler im Wächter gefunden und behoben: `docker run` hing, weil die Kopfzeilen der
  `/wait`-Antwort erst mit dem Inhalt (beim Containerende) weitergingen; `exec` hing, weil
  der Inhalt der Upgrade-Anfrage erst nach dem Umschalten kam.

**Nachweise in sp-test** (Wächter auf dem Host, StackPilot einmal als Host-Dienst, einmal als
Container):

| Prüfung | Ergebnis |
|---|---|
| Beobachten: Start, Ansichten, Zuschauer-Anmeldung, Schutztest, Streamyfin zurück/vor | 4693 Aufrufe, 0 Verstöße |
| Sperren: Neustart, Streamyfin zurück/vor, Schutztest | 1348 Aufrufe, 0 gesperrt, alles erfolgreich |
| StackPilot **im Container** (ohne Socket, nur Wächter): Ansichten, Streamyfin zurück/vor, Schutztest, Tailscale-Status, Couchdeck-Status | 1236 Aufrufe, 0 gesperrt, keine Fehler im Log |
| Angriffe über den Wächter: privilegiert, `/` bzw. `/etc` einbinden, Docker-Socket, Host-PID/-Netz, SYS_ADMIN, `/dev/sda`, privilegiertes exec, Plugins, Swarm, Build, Verknüpfung nach `/`, `../../../etc`, Bind-Volume auf `/`, Volume-Optionen im Mount, macvlan, VolumesFrom | alle abgelehnt |
| Erlaubtes bleibt: Einbindung unter Daten-Ordner, normales Volume, normales exec | erlaubt |
| Nach der Härtung erneut: Streamyfin zurück/vor, Schutztest | 1120 Aufrufe, 0 gesperrt |

Nicht geprüft: VPN-Wechsel (VM hat nur eine Config; nutzt dieselben Compose-Aufrufe wie die
geprüften Abläufe), vollständige Erstinstallation und App-Updates über den Wächter (vor
einem Umzug im Beobachtungsmodus nachholen).

**Container-Prototyp** (`scripts/testvm/container-probe.sh`): Ubuntu 24.04 mit Git, OpenSSL,
iproute2, util-linux, systemd-Client, Docker-CLI/Compose und tailscale; Host-Netz (Tailnet,
lokale Weiterleitungen wie 127.0.0.1:4417), Benutzer 1000, schreibgeschütztes Dateisystem, alle
Rechte entzogen, `no-new-privileges`. Daten unter **denselben Pfaden** wie auf dem Host
(Compose-Einbindungen löst der Docker-Dienst auf dem Host auf). Was im Container fehlt:

1. **systemctl** (Couchdeck starten/stoppen, StackPilot-Update, Root-Hilfe-Aufträge): Über den
   D-Bus-Socket kommt die Anfrage an, aber Dockers AppArmor-Standardprofil sperrt D-Bus.
   Ohne das Profil entscheidet polkit wie auf dem Host (unbekannte Aufträge und
   `docker restart` abgelehnt). Lösung für 7.7: eigenes AppArmor-Profil (Docker-Standard plus
   nur D-Bus zu `org.freedesktop.systemd1`) – polkit bleibt die einzige Regelstelle. Alternative:
   kleine Host-Brücke mit festen Aufträgen.
2. **Pfade/Umgebung:** `HOME` muss der Host-Pfad sein (sonst falscher Datenpfad-Vorschlag);
   Einhängepunkte und `ss`/`findmnt` zeigen die Sicht des Containers – Speicher- und
   Port-Diagnose müssen dafür über den Wächter bzw. Host-Angaben laufen.
3. **Wächter selbst** muss als Host-Dienst installiert werden (systemd-Einheit, Gruppe für den
   Socket, erlaubte Ordner aus dem Stack-Plan, Update zusammen mit StackPilot).

Restrisiken des Wächters: Eine Verknüpfung könnte zwischen Prüfung und Anlegen getauscht
werden (StackPilot gehört der Daten-Ordner); Container dürfen weiterhin beliebige Abbilder
ziehen und NET_ADMIN bekommen (Gluetun). Gegenüber heute (StackPilot-Benutzer in der Gruppe
`docker` = root-gleich) ist es trotzdem eine deutliche Einschränkung.

**Couchdeck – Einschätzung:** Couchdeck braucht den Bildschirm als Kiosk (cage auf tty1 mit
Autologin, DRM-Master über logind), GPU mit VA-API (`/dev/dri`), Controller mit Hotplug
(`/dev/input`, udev), PipeWire mit AirPlay-Ausgabe (Avahi über D-Bus) und Bluetooth-Einstellungen
des Hosts. Im Container hieße das: tty-, DRM-, input- und udev-Zugriff plus eigener Seat-Dienst –
der Container wäre kaum enger als der heutige eigene Benutzer `couchdeck` (ohne sudo, ohne
docker). Der YouTube-Token-Dienst läuft bereits als stark abgeschotteter systemd-Dienst.
**Empfehlung: Couchdeck bleibt nativ**; Installation und Updates weiter über die Root-Hilfe.

**Entscheidungsvorschlag:** (a) Docker-Wächter weiterentwickeln und schon **vor** dem
Container-Umzug auf dem Host einsetzen (erst beobachten, dann sperren) – das bringt den
Sicherheitsgewinn ohne Umzug; (b) StackPilot-Container in 7.7 mit eigenem AppArmor-Profil für
systemctl; (c) Tailscale und Couchdeck bleiben auf dem Host.

### Docker-Wächter einsatzfertig (20.11.2026)

- Eigener Dienst `stackpilot-docker-guard` (root, stark abgeschottet: nur Unix-Sockets,
  schreibgeschütztes System, nur CHOWN/DAC_READ_SEARCH), Socket
  `/run/stackpilot-docker-guard/docker.sock` für die Gruppe `stackpilot-docker`.
- `deploy/docker-guard.sh status|observe|enforce|off|apply`; `install.sh` (also auch jedes
  Update) richtet ihn ein: erstes Mal **beobachten**, danach bleibt der gespeicherte Modus
  (auch „aus“). Sperren: zusätzlich ohne Gruppe `docker` für den StackPilot-Benutzer.
- Verschärfen auch aus StackPilot (Root-Hilfe `docker-guard-enforce`, OK), lockern nur mit sudo.
- Erlaubte Ordner: Zustandsordner fest, dazu die Daten-/Konfigurationsordner aller
  Einrichtungen, die StackPilot in `docker-guard-roots.json` meldet; der Wächter prüft jeden
  (keine System- oder Home-Ordner selbst, nicht unter /var, /opt, /etc …, keine Verknüpfung).
- Anzeige unter System → Updates & Sicherungen → Docker-Wächter (Zähler, Verstöße, Ordner,
  „Jetzt sperren“).
- sp-test: Update-Weg über `install.sh` → beobachten (1764 Aufrufe, 0 Verstöße); Sperren
  über StackPilot (Root-Hilfe), Prozess ohne Gruppe docker, direkter Zugang verweigert,
  Angriff über den Wächter gesperrt; Abläufe im Sperrmodus (Streamyfin, Schutztest, Seerr
  zurück und wieder vor) mit 0 Sperrungen; erneutes Update behält „sperren“; „aus“ bleibt
  nach Update aus; Anzeige im Browser in beiden Modi. 363 Tests.
- Dabei gefunden und behoben (unabhängig vom Wächter): Seerr-Prüfung nach Wechsel gab
  sofort auf, während Seerr noch lud (jetzt bis zu 40 s Wiederholung); eine unterbrochene
  Rückkehr ließ sich nur bei Jellyfin fortsetzen (jetzt für alle Apps).

## 5. Container-Architektur (früh festlegen, 7.7)

| Teil | Möglichkeit | Einschätzung |
|---|---|---|
| StackPilot | Container **mit** Docker-Socket | Abgelehnt: Socket = volle Root-Macht im Container. |
| StackPilot | Container **ohne** Socket + kleiner Docker-Wächter auf dem Host mit fester Erlaubnisliste (heutige Root-Hilfe als Vorbild) | **Empfohlen.** Gleiche Rechte wie heute, sauber getrennt, eigenes Update/Rollback möglich. |
| Tailscale | eigener Container mit Host-Netz | Kein Sicherheitsgewinn, Serve/Funnel hängen am Host. **Empfehlung: auf dem Host lassen.** |
| Couchdeck | Container mit Bildschirm, GPU, Controller, Audio | Machbar, aber viele Gerätefreigaben (Wayland/cage, DRM, evdev, PipeWire, VA-API) – im Container kaum sicherer als heute. **Nach Probe 7.0c: bleibt nativ** (siehe Fortschritt 7.0c). |

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

## 8. Entscheidung nach der Probe 7.0c (20.11.2026)

- **Wächter zuerst:** Der Docker-Wächter bleibt immer auf dem Host. Er wird eingesetzt,
  solange StackPilot noch nativ läuft: erst im Beobachtungsmodus, nach unauffälligem
  Echtbetrieb (inkl. Updates und Erstinstallation) im Sperrmodus.
- **Container danach (7.7):** StackPilot zieht erst um, wenn der Wächter im Sperrmodus läuft;
  der Container bekommt nur den Wächter-Socket, systemctl über ein eigenes AppArmor-Profil.
- **Couchdeck und Tailscale bleiben nativ.**
