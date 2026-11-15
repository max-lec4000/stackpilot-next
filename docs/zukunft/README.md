# Pläne für die Zukunft

Stand: StackPilot 0.5.0. Ein Eintrag hier ist ein Vorhaben, keine Zusage und keine
Freigabe für Änderungen an einem laufenden Server.

## Reihenfolge der Arbeiten

1. **Sonarr wieder erreichbar machen.** Wiederherstellung mit vorhandenem
   Schlüssel in der Test-VM erprobt und auf reatest durchgeführt. Sonarr-API,
   Verbindung aus Seerr und Importhistorie geprüft.
2. **Downloadprofile reparieren.** StackPilot kann für neue Filmanfragen eine feste
   GiB-Grenze oder eine laufzeitabhängige Grenze speichern. Offen sind die
   Bedienung in Couchdeck und geprüfte Regeln für Folgen oder Staffelpakete.
3. **Qualitätswechsel und Downloadstatus.** StackPilot kann eindeutig
   zugeordnete, unvollständige Film-Downloads mit einem neuen Profil ersetzen
   und die bisher geladenen Dateien behalten. In der VM mit Radarr,
   qBittorrent und lokalem Indexer geprüft. Serienpakete und Couchdeck bleiben offen.
4. **Staffeln und Folgen einzeln steuern.** StackPilot und das verwaltete
   Couchdeck können eine angefragte Staffel oder eine einzelne Folge suchen
   und eindeutig zugeordnete Folgendateien löschen. In Couchdeck gilt dies nur
   für eigene genehmigte Anfragen des verbundenen Wohnzimmer-Kontos.
   Einzelne Staffeln lassen sich aus eigenen noch offenen Seerr-Anfragen
   entfernen. Für genehmigte Staffeln kann StackPilot die Sonarr-Überwachung
   einzeln stoppen. Offen bleiben Staffelpakete im laufenden Transfer,
   Serien-Größenlimits sowie Größenprofil und Qualitätswechsel in Couchdeck.
5. **Streamyfin mit Seerr verbinden.** An den bestandenen Quick-Connect-Test mit Seerr
   3.5.2 anknüpfen. Die benötigten Seerr-Schnittstellen unter der Jellyfin-HTTPS-Adresse
   zugänglich machen, die Aktualisierung bestehender Installationen prüfen und in der
   echten App Anmeldung, Medienanfrage und abgewiesene Admin-Zugriffe testen.
6. **Couchdeck auf persönliche Seerr-Sitzungen umstellen.** Den Admin-Schlüssel aus
   verwalteten Couchdeck-Konfigurationen entfernen und vorhandene Installationen
   migrieren. Die Rechte für die eigenen Anfragen und die Staffel- und Folgenaktionen
   aus Schritt 4 erneut prüfen. Für Aktionen, die Seerr nur mit erweiterten Rechten
   zulässt, die Berechtigung gezielt serverseitig prüfen.
7. **Medienspeicher und Navigation verbessern.** In StackPilot und Couchdeck pro
   Medienlaufwerk „belegt von gesamt“ anzeigen. Gemeinsam genutzte Laufwerke nur
   einmal zählen. Getrennte Warnungen für Medien- und Systemlaufwerk ergänzen.
   „Anwendungen“ und „Stack konfigurieren“ erhalten unterschiedliche Symbole.
8. **Wartung absichern.** Container-Updates mit Sicherung, Funktionsprüfung und
   Rückkehr zur vorherigen Version anbieten. Danach verschlüsselte Tresor-Sicherung
   und geprüfte Wiederherstellung in der Oberfläche ergänzen. Anschließend die
   Schlüsselerneuerung auf weitere Dienste und deren Verbraucher ausweiten.
9. **Zuschauerkonten vereinfachen.** Doppelte Code-Abfrage beheben, danach
   Wiederherstellungscodes, Passkeys und eigene Passwortwahl prüfen. Anschließend
   Zuschauerprofile und die dazugehörigen Bibliotheksrechte ergänzen.
10. **Weitere Installationswege.** HTTPS mit eigener Domain und Reverse-Proxy ohne
    Tailscale umsetzen. Danach HexOS/TrueNAS SCALE mit vorhandenem Jellyfin und
    passendem Medienordnerschema prüfen. Zuletzt Hardwarebeschleunigung in Jellyfin
    mit passenden Testgeräten validieren.

### Testumfang

- Erst in der Test-VM. Bei Änderungen an Installations-, Update- oder Migrationspfaden
  jeweils Neuinstallation und Update mit vorhandener Konfiguration prüfen.
- Bei YouTube-unabhängigen Änderungen reicht der Test der betroffenen Couchdeck-Funktion.
  YouTube-Oberfläche und Fehlerbehandlung bei Bedarf mit Testdaten prüfen. Ein echtes
  Video nur gezielt abspielen, wenn sich die YouTube-Anbindung, Wiedergabe oder das
  Spulen geändert hat oder ein konkreter YouTube-Fehler nachgestellt werden muss.
  Bei einer Bot-Schutz-Meldung den Testlauf beenden und den Befund festhalten.

Bewusst **nicht** geplant (Entscheidung): Firewall fürs Tailnet (nur eigene Geräte),
ablaufende Authentik-Zustimmung.

## Als Nächstes

### Seerr-Anfragen in Streamyfin (und Couchdeck) ohne Admin-Schlüssel

Streamyfin 0.55.2 kann Seerr per Quick Connect mit einer bestehenden Jellyfin-Sitzung
verbinden. In der Test-VM erhielt ein per Authentik angemeldeter Zuschauer mit
Seerr 3.5.1 und 3.5.2 eine eigene Seerr-Sitzung ohne Admin-Rechte. Für den Zugriff unterwegs
sollen ausschließlich die von Streamyfin benötigten Schnittstellen unter der
Jellyfin-Adresse erreichbar sein. Die Freigabe setzt einen gepatchten Seerr-Stand
voraus und muss mit der Client-App geprüft werden. Danach soll Couchdeck ebenfalls
mit Nutzersitzungen arbeiten und seinen Seerr-Admin-Schlüssel abgeben.

### Sicherheitsprüfung des gesamten Stacks

Kompletter Durchgang: Gateway-Regeln, Container-Rechte, offene Ports im Heimnetz,
Tailscale-Policy, Authentik-Flows, Sitzungs-Cookies bei HTTP im Heimnetz, Updates der
Container-Images.

## Später

### Zugang ohne Tailscale (eigene Domain)

Heute setzt der Zugriff von unterwegs eine `*.ts.net`-Adresse voraus (Tailscale Serve
bzw. Funnel). Vorgesehen: „Eigene Adresse“ – jemand stellt HTTPS und Erreichbarkeit
selbst bereit (eigener Reverse-Proxy, eigene Domain, Zertifikat). StackPilot richtet dann
Gateway, Authentik und SSO auf diese Adresse ein und prüft, dass nur Jellyfin und die
Anmeldung durchgereicht werden. Nötig: Hostname-Prüfung (`validateIdentityInput`)
öffnen, Weiterleitungsadresse und Proxy-Vertrauen konfigurierbar machen, Anleitung für
gängige Proxys (Caddy, nginx, Cloudflare Tunnel).

### HexOS / TrueNAS SCALE

Ziel: StackPilot auf HexOS installieren, auch wenn dort schon ein Jellyfin läuft, und die
Medien nach dem HexOS-Schema ablegen. Dafür fehlt:

1. **Ein Weg ohne Host-Installation**: TrueNAS ist ein Appliance-System; Pakete, eigene
   Systemdienste und Root-Hilfe passen dort nicht. StackPilot muss als Container bzw.
   eigene App mit Docker-Zugriff laufen, der Zustand auf einem Dataset.
2. **„Vorhandenes Jellyfin verbinden“** statt neu installieren: Adresse und Admin-Zugang
   angeben; StackPilot richtet Seerr, ARR-Dienste und optional den Schutz darum ein, ohne
   Jellyfin neu aufzusetzen.
3. **Frei wählbare Medienpfade** nach dem vorhandenen Schema (HexOS-Ordner). Für
   Hardlinks müssen Downloads und Medien im selben Dataset liegen.
4. Prüfen, wie sich ein eigenes Compose-Projekt mit der TrueNAS-App-Verwaltung verträgt.
5. Couchdeck bleibt auf TrueNAS außen vor (braucht Konsole und Systempakete) oder läuft
   auf einem anderen Gerät.

### Weitere Ideen

- Wiederherstellungscodes für Zuschauer direkt bei der ersten Anmeldung anzeigen
  (derzeit hilft „Neu einladen“).
- Passkeys als zweiter Faktor bei der Einladung.
- Zuschauer selbst ein Passwort wählen lassen (Registrierungsablauf in Authentik).
- Profile für Zuschauer (Kinder, Gast mit Ablaufdatum), eigene Bibliotheken je Profil.
- Speicherwarnung früher und deutlicher (Systemplatte und Medienplatte getrennt).
- Hardwarebeschleunigung in Jellyfin nach Geräteprüfung.
- Ältere Ideen und Konzepte der Version 0.4: siehe die übrigen Dateien in diesem Ordner.
