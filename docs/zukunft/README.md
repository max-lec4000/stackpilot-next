# Pläne für die Zukunft

Stand: StackPilot 0.5.0. Ein Eintrag hier ist ein Vorhaben, keine Zusage und keine
Freigabe für Änderungen an einem laufenden Server.

## Offene Arbeiten

### Phase 3 · Abnahmen mit offenen Voraussetzungen

- **Direkte YouTube-Wiedergabe in Couchdeck.** In der Test-VM verlangte auch
  der offizielle Webplayer ohne Anmeldung eine Bot-Bestätigung. Der
  veröffentlichte QR-Code in Couchdeck öffnet das Video auf einem anderen
  Gerät. Die direkte Wiedergabe steht weiter aus.
- **Geschütztes Jellyfin mit einer neueren Version prüfen.** Der veröffentlichte
  Rückweg wurde mit zwei offiziellen Image-Referenzen derselben Version
  12.4.0 geprüft. Den Wechsel, die geschützte Authentik-Anmeldung und die
  Rückkehr mit einer neueren stabilen Version abnehmen, sobald sie verfügbar
  ist.
- **Streamyfin öffentlich über HTTPS prüfen.** Für eine Freigabe über
  Funnel stehen ein offizielles Seerr-Image mit den Sicherheitskorrekturen
  und eine eigene Prüfung der öffentlichen Routen aus.

### Weitere Wartung

- Sicherheitsprüfung nach Änderungen an Gateway, Tailscale, Sitzungen,
  Containerrechten oder Images fortführen. Die erste vollständige Prüfung
  ist dokumentiert.

## Umgesetzt oder entschieden

- Streamyfin funktioniert mit Seerr 3.5.2 über das private HTTPS-Gateway
  im Tailnet. Quick Connect verwendet das Jellyfin-Konto. Das Gateway
  blockiert API-Schlüssel, Bildproxy, Passwort- und Rechteänderungen.
  Aktivierung und Rollback sind in der Test-VM geprüft.

- Schlüsselwechsel für Bazarr, Lidarr, Sonarr, Radarr, Prowlarr und
  Seerr. Unterstützte verwaltete Verbraucher übernehmen den neuen
  Schlüssel. Die Jellyfin-Dienstzugänge für Couchdeck, Seerr und
  Streamystats können einzeln erneuert werden.

- Phase 1: Couchdeck zeigt die Gesamtzahl regulärer Staffeln, kommende
  Folgen mit verfügbarem Ausstrahlungsdatum und den freien Medienplatz
  oben rechts im Kino. Die Anzeige im Servermenü bleibt verfügbar.
- Phase 2: Couchdeck bündelt eigene Serienanfragen und Staffeln aus
  offenen Anfragen in einem bestätigten Auswahl-Dialog. Teilfehler
  erscheinen einzeln. StackPilot zeigt die aktive Größenrate, die
  absolute Grenze und den Vergleich mit der vorhandenen Filmdatei.

- Sonarr auf dem Produktivserver mit dem bestehenden Schlüssel repariert.
  Import und Seerr-Verbindung geprüft.
- Wahlweise feste Filmgrößengrenze oder GiB/h-Standard in StackPilot. Fester
  Filmstandard in Couchdeck. Automatische Serienlimits in Sonarr und
  Filmobergrenzen für bereits erfasste Radarr-Filme mit Rückweg zum
  ursprünglichen Profil in der VM geprüft.
- Aufklappbare Staffeln, gezielte Einzelfolgensuche und Löschen eindeutig
  zugeordneter Folgendateien umgesetzt. Eigene offene Mehrstaffelanfragen
  lassen sich um eine Staffel kürzen. Bei genehmigten Staffeln gibt es
  getrennte Aktionen für Überwachung und laufende Pakettransfers.
- Qualitätswechsel nach Anfragestart bleibt in StackPilot. Eindeutig
  zugeordnete, noch unvollständige Filmtransfers sowie pausierte
  Staffelpakete können mit geprüftem Ersatz und ohne Löschen der
  bisherigen Download-Dateien ausgetauscht werden.
- StackPilot unterscheidet im Downloadstatus aktiven Upload, wartende
  Uploads und bereitstehende vollständige Torrents. Die Anzeige wurde gegen
  qBittorrents Zustand und Uploadrate geprüft.
- Beide Oberflächen zeigen belegten und gesamten Platz am Medienpfad.
  Couchdeck zeigt ihn derzeit im Servermenü. StackPilot verwendet
  unterschiedliche Symbole für „Anwendungen“ und „Stack konfigurieren“.
- Verwaltetes Couchdeck unterstützt ab 0.2.3 persönliche Seerr-Sitzungen
  ohne Admin-Schlüssel in der Übergabedatei nach erneuter Verknüpfung.
  Der Ablauf wurde in der VM mit dem Wohnzimmer-Konto geprüft.
- Verschlüsselte Tresor-Sicherung, isolierte Wiederherstellung und Übernahme
  per Serverbefehl mit Rückweg sind veröffentlicht. Container-Rollback für
  Sonarr, Radarr, Lidarr, Prowlarr, Bazarr und Seerr ist umgesetzt. Der
  Rückweg für geschütztes Jellyfin ist separat geprüft.
- Einmalige MFA, Wiederherstellungscodes, Passkeys, eigene Passwortwahl und
  Zuschauerprofile umgesetzt und in der Test-VM geprüft. Persönliche
  Abnahme auf Fernseher und iPad bleibt eine spätere Aufgabe.
- Vereinbart sind YouTube-Tests mit Testdaten, wenn keine echte Wiedergabe
  nötig ist. Echte Wiedergabe nur gezielt bei Änderungen daran. Für das
  private Tailnet ist keine zusätzliche Firewall geplant. Reguläre
  Authentik-Zustimmungen laufen nicht ab.

## Testumfang

- Zuerst in der Test-VM prüfen. Bei Änderungen an Installations-, Update-
  oder Migrationspfaden eine Neuinstallation und ein Update mit vorhandenem
  Zustand prüfen.
- YouTube-Video nur bei Änderungen an Anbindung, Wiedergabe oder Spulen und
  zur gezielten Diagnose abrufen. Bei einer Bot-Meldung den Abruf beenden
  und den Befund dokumentieren.

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

- Gästeprofile mit Ablaufdatum für ausdrücklich befristete Zugänge.
- Speicherwarnung früher und deutlicher (Systemplatte und Medienplatte getrennt).
- Hardwarebeschleunigung in Jellyfin nach Geräteprüfung.
- Ältere Ideen und Konzepte der Version 0.4: siehe die übrigen Dateien in diesem Ordner.
