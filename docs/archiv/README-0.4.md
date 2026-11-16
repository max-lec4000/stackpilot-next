# StackPilot

Eine selbst gehostete Web-App, die Medienserver-Dienste gemeinsam auswählt,
installiert, einrichtet und verbindet. Erst Ubuntu Server testen, danach TrueNAS
SCALE mit eigenem Plattformadapter. Ein Server, ein Verwaltungsadministrator.

## Aktueller Stand

Ein **echter Installationspilot für Ubuntu Server 24.04 auf x86-64** ist vorhanden.
Die gemeinsame Installation dieser Apps ist funktional getestet:

| Dienst | Automatische Einrichtung |
| --- | --- |
| Jellyfin | Administrator, Sprache, Bibliotheken für Filme/Serien/Musik |
| Sonarr | Anmeldung, Serienpfad, qBittorrent-Verbindung |
| Radarr | Anmeldung, Filmpfad, qBittorrent-Verbindung |
| Lidarr | Anmeldung, Musikpfad, qBittorrent-Verbindung |
| Prowlarr | Anmeldung und Verbindungen zu ausgewählten ARR-Diensten |
| qBittorrent | Anmeldung, Downloadpfade und getrennte Kategorien |
| Bazarr | Geschützte Anmeldung, gemeinsamer Medienpfad, Sonarr-/Radarr-Verbindungen |
| Seerr | Jellyfin-Anmeldung, Bibliotheken, Sonarr-/Radarr-Verbindungen mit geprüftem Qualitätsprofil |
| Streamystats | Persistente Datenbank, Jellyfin-Anmeldung und eigener Gerätetoken des Jellyfin-Dienstkontos |

Alle gewählten freigegebenen Apps werden in **einem bestätigten Gesamtauftrag**
eingerichtet. Separate manuelle Dienstinstallationen sind nicht nötig. Ein
zusätzlicher interner API-Helfer wird im Plan ausgewiesen; er hat keinen
Docker-Socket und keine Medien-/Konfigurationsmounts. Öffentliche Webports gibt es
während des Bootstraps nicht. Erst nach Konto- und Verbindungsprüfung werden die
lokalen Ports freigegeben.

**Noch nicht freigegeben:** allgemeiner Jellyfin-Plugin-Katalog, GPU-Transcoding,
Übernahme fremder Installationen, vollständige Stack-Sicherung/-Wiederherstellung
und kontrollierte Containerupdates. Die Authentik-Sicherung mit isoliertem Test
und der geprüfte SSO-Plugin-Pfad sind separat implementiert.

Die Erstinstallation fügt keine Quellen oder Torrents hinzu. Quellen lassen sich
unter Verwaltung geführt testen und einrichten; bestätigte Medienanfragen können
über Seerr/ARR passende Downloads starten. Dateigrößenregeln sind für Filme als
native Radarr-Profile verfügbar; vorhandene Dateien werden nicht konvertiert.

Neu im Alltag: Betriebsübersicht mit konkreten Aufgaben und Speicherwarnungen,
Anfragen archivieren/abbrechen, Größenwahl vor einer Filmanfrage, lokaler
Änderungsverlauf und systemd-Nutzerdienst. Details:
[Alltag und Anfragen](docs/alltag-und-anfragen.md) · [Dauerbetrieb](docs/dauerbetrieb.md).

## Auf dem Ubuntu-Testserver starten

Voraussetzungen: Node.js gemäß `.nvmrc` (24), lokaler Docker-Socket für den
angemeldeten normalen Benutzer, Docker Compose, mindestens 10 GiB freier Platz
für den Pilot und neue beschreibbare Datenordner. StackPilot nicht mit `sudo`
starten. Vorhandene Installationen bleiben zunächst beobachtet.

```sh
cd ~/stackpilot
git pull --ff-only origin main
npm ci
npm run build
npm start
```

Einen bereits laufenden Server vorher mit Strg+C beenden. StackPilot bindet nur
an `127.0.0.1:5173`. Vom eigenen Rechner einen SSH-Tunnel aufbauen:

```sh
ssh -L 5173:127.0.0.1:5173 benutzer@medienserver
```

Im Browser **http://stackpilot.localhost:5173** öffnen. Moderne Browser lösen
`*.localhost` lokal auf. Aufrufe über `localhost:5173` werden dorthin umgeleitet.
Die eigene Hostbezeichnung verhindert, dass das StackPilot-Sitzungscookie an
andere lokale Medien-Weboberflächen gesendet wird.

Beim ersten Start den lokalen einmaligen Setupcode auf dem Server lesen:

```sh
cat ~/stackpilot/.stackpilot/bootstrap-token
```

Code nur im Setupformular verwenden, nicht in Git oder Chat kopieren. Dort einen
Verwaltungsbenutzer und ein Passwort mit mindestens zwölf Zeichen anlegen.
Danach ist die App nur angemeldet zugänglich. Der Code kann keinen vorhandenen
Administrator überschreiben.

## Den echten Stack einrichten

1. **Echter Installationspilot** wählen. Die Serverprüfung startet automatisch. Gewünschte Apps
   gemeinsam auswählen. **Alle freigegebenen Pilot-Apps wählen** nimmt die neun
   getesteten Apps. Die Auswahl ist in Jellyfin & Erweiterungen, ARR-Suite und
   qBittorrent & VPN gegliedert. Verwaltete Apps bleiben sichtbar ausgewählt und
   gesperrt; erkannte fremde Installationen müssen zunächst gezielt abgelöst werden. **Alle auswählen** nimmt den gesamten Katalog; nicht
   freigegebene Komponenten blockieren dann die echte Ausführung.
2. Einen neuen direkten Unterordner eines vorhandenen beschreibbaren Pfads
   wählen, beispielsweise `/home/benutzer/stackpilot-data`. Daneben entsteht
   `/home/benutzer/stackpilot-data-appdata`. Keine vorhandenen Konfigurationen werden
   übernommen. Speicher, Rechte und echte Hardlinks werden geprüft.
3. Gewünschten persönlichen Benutzernamen, Sprache und Optionen wählen. Der
   Benutzername darf überall gleich sein; Passwörter/API-Schlüssel werden pro
   Dienst mit nativer Anmeldung getrennt erzeugt. Seerr und Streamystats nutzen
   Jellyfin; ein gemeinsames Login für alle Apps ist noch nicht implementiert.
4. Im Gesamtplan **Echten Installationsplan prüfen**, Änderungen und Images
   ansehen. qBittorrent setzt Mullvad voraus: Vor dem Downloadclient werden Tunnel und Ausfallsperre geprüft. Eine Freigabe ohne VPN gibt es nicht.
5. Den Plan ansehen, mit `OK` bestätigen und **Gesamten Stack wirklich installieren** wählen.
   Fortschritt, Pause und gezielte Wiederaufnahme sind dauerhaft gespeichert.
   Verlassen der Ansicht stoppt den Auftrag nicht.
6. Unter **Anwendungen** echte Container und geschützte Zugänge ansehen. Die
   Passwortanzeige verlangt erneut das StackPilot-Administratorpasswort und
   schließt nach 20 Sekunden. Unter **Verwaltung → Verbindungen** erneut funktional prüfen.

Für direkten Zugriff auf die Dienstoberflächen müssen auch deren Ports im
SSH-Tunnel weitergeleitet werden. Ein gemeinsamer Tunnel für alle Pilot-Apps:

```sh
ssh -L 5173:127.0.0.1:5173 -L 8096:127.0.0.1:8096 \
  -L 8989:127.0.0.1:8989 -L 7878:127.0.0.1:7878 \
  -L 8686:127.0.0.1:8686 -L 9696:127.0.0.1:9696 \
  -L 8080:127.0.0.1:8080 -L 6767:127.0.0.1:6767 \
  -L 5055:127.0.0.1:5055 -L 3000:127.0.0.1:3000 benutzer@medienserver
```

Die App verlinkt separate lokale Namen, beispielsweise
`http://jellyfin.localhost:8096`. Keine LAN-/Internetfreigabe und kein produktiver
TLS-Reverseproxy sind eingerichtet. Externe Indexer, echte Downloads und
Transcoding sind eigene noch ausstehende Funktionsprüfungen.

## Daten, Schlüssel und Wiederaufnahme

`.stackpilot/` ist dauerhafter privater Anwendungszustand, **kein Wegwerf-Cache**:
SQLite enthält Konten, Sitzungen, Pläne und Aufträge; Dienstgeheimnisse sind mit
AES-256-GCM verschlüsselt. `master.key` liegt getrennt mit privaten Dateirechten.
Passwörter des Administrators sind mit scrypt gehasht. Ohne Datenbank **und**
passenden Hauptschlüssel sind gespeicherte Dienstzugänge nicht wiederherstellbar.
Beides separat sicher aufbewahren. Keine Schlüssel nach Git hochladen.

Dienstkonfigurationen enthalten notwendige API-Schlüssel oder Passwort-Hashes
und sind entsprechend privat zu behandeln. Das Auftragsjournal ersetzt keine
Konfigurations-/Datenbanksicherung. Ein fehlender Hauptschlüssel wird nicht
stillschweigend ersetzt, wenn verschlüsselte Werte existieren.

Nach Prozessabbruch kann die Executor-Sperre bis zu 90 Sekunden auslaufen.
Anschließend gespeicherten Auftrag prüfen und fortsetzen. Bereits erfolgreiche
Schritte werden nicht erneut durchgeführt. Abbrechen/Beenden macht bestehende
Änderungen nicht rückgängig. Einen fehlgeschlagenen Stack über
seinen Auftrag fortsetzen; automatische Übernahme fremder Installationen und
Entfernung verwalteter Dienste sind noch nicht angeboten.

## Hinweise zu den Erweiterungen

Seerr und Streamystats melden dich mit deinem **Jellyfin-Benutzer und dessen
Passwort** an. StackPilot zeigt diesen tatsächlichen Zugang geschützt an.
Seerr erstellt einen eigenen Jellyfin-API-Schlüssel; Streamystats verwendet einen
eigenen Gerätezugang im Hintergrund. Diese Zugänge benötigen mit den geprüften
Dienstversionen weitreichende Jellyfin-Rechte. Zusätzliche eingeschränkte Rollen
werden nicht vorgetäuscht.

Bazarr erhält einen eigenen zufälligen Zugang und Sonarr-/Radarr-API-Schlüssel.
Es nutzt dieselben `/data/media`-Pfade. Untertitelanbieter, deren persönliche
Konten und gewünschte Untertitelprofile müssen noch bewusst eingerichtet werden;
es werden keine Untertitel automatisch heruntergeladen. Bazarr unterstützt
native Passwort-Hashes gemäß seiner eigenen Implementierung; StackPilot erzeugt
hierfür lange zufällige Dienstpasswörter.

Streamystats verwendet das All-in-One-Image mit PostgreSQL. Datenbank- und
Sitzungsgeheimnisse werden über eine private Datei eingebunden und stehen nicht
in Compose-Umgebungsvariablen. Das Datenbankverzeichnis gehört im Container dem
PostgreSQL-Benutzer; seine Hostrechte werden nicht pauschal für andere geöffnet.
Seerr benötigt ausgehenden Internetzugriff auf seine Metadatenanbieter. Externe
Metadaten, echte Medienanfragen/-Downloads, Statistiken aus realer Wiedergabe und
Untertitelanbieter sind von den lokalen Konto-/Verbindungstests getrennt.

## Später Apps ergänzen

Derselbe Assistent lädt die letzte verwaltete Auswahl. Installierte Apps bleiben
markiert; zusätzliche freigegebene Apps auswählen und den Erweiterungsplan prüfen.
Der Plan nennt erhaltene und neue Dienste. Bestätigt wird mit
`OK`. Vorhandene Containerdefinitionen, Images, Konten, Daten
und manuelle Diensteinstellungen bleiben erhalten. Nur neue Dienste werden
initialisiert und fehlende StackPilot-Verbindungen ergänzt. Vor Änderungen an
Verbindungslisten werden deren API-Daten im verschlüsselten Tresor gesichert.
Das ist keine vollständige Konfigurations-/Datenbanksicherung.

Ein veralteter oder konkurrierender Plan wird abgewiesen. Der vorherige Auftrag
muss abgeschlossen sein. Entfernen, Umzug, Umbenennen und fremde Installationen
übernehmen sind keine Erweiterung; solche Änderungen bleiben blockiert.

## Mullvad/WireGuard und Ausfallsperre

Unter **Optionen** Mullvad aktivieren und eine im Mullvad-Konto erzeugte
**WireGuard-Konfiguration für Linux (.conf)** auswählen. Der Import akzeptiert
nur ein Interface und einen Peer, keine Skripte. IPv4-Endpunkt und /32-Tunneladresse
werden benötigt. IPv6 wird im VPN-Netzwerk absichtlich deaktiviert; DNS geht
über Gluetun auf Loopback, nicht über den Hostresolver. Importierte DNS-Angaben
werden durch diesen festen DNS-Weg ersetzt.

Der private Schlüssel liegt verschlüsselt im Tresor. Für Gluetun werden private
Dateien mit Modus 0600 im eigenen Konfigurationsordner bereitgestellt. Schlüssel
stehen weder in Compose-Umgebungsvariablen noch in Plänen, Prozessargumenten oder
Berichten. Die Gluetun-Steuerung ist nur im VPN-Netzwerk auf Loopback erreichbar
und zusätzlich mit einem eigenen Schlüssel geschützt.

Vor dem Downloadclient starten ausschließlich Gluetun und ein Prüfcontainer im
selben Netzwerk-Namespace. StackPilot prüft den Mullvad-Ausgang über HTTPS,
stoppt den Tunnel kontrolliert und prüft, dass direkte TCP-Verbindungen,
UDP-DNS und HTTPS blockiert sind. Danach muss der Mullvad-Ausgang erneut
bestätigt werden. Erst dann startet qBittorrent, zusätzlich an `tun0` gebunden.
Die Firewall bleibt aktiv; einen automatischen Rückfall ohne VPN gibt es nicht.
Webzugriff auf qBittorrent bleibt nach erfolgreicher Prüfung lokal auf Port 8080.
Mullvad bietet keine eingehende Portweiterleitung.

Auch ein bereits von StackPilot eingerichteter qBittorrent kann nachträglich
auf VPN umgestellt werden. Der Plan nennt die Unterbrechung; die Bestätigung
lautet `OK`. Einstellungen werden verschlüsselt gesichert, der alte
Container gezielt gestoppt/entfernt und mit denselben Daten im VPN-Netzwerk neu
erstellt. Bei Fehlern bleibt er gestoppt. Den Auftrag fortsetzen; keinen zweiten
Stack anlegen. Ein Profilwechsel oder Abschalten eines bestehenden VPNs ist
noch kein freigegebener Vorgang.

**Prüfgrenze:** Der echte Mullvad-Tunnel konnte in der Cloud ohne TUN-Gerät und
Mullvad-Schlüssel nicht getestet werden. Implementiert und lokal getestet sind
Import, Geheimnisschutz, Compose-Netzwerkmodell und die Startsperre bei fehlendem
Ausfallsperrennachweis. Die echten Tunneltests laufen zwingend auf dem Zielserver.
Das ist ein experimenteller Pilot, keine Zusage umfassender Leak-Freiheit für
alle Protokolle, Neustarts oder Host-Firewalländerungen.

## Vorhandene Installationen ablösen

Die Serverprüfung erkennt Container, Compose-Projekte, Mounts und TCP-/UDP-Ports.
Unter **Alten Medienstack gezielt ablösen** einen konkreten Plan prüfen, externen
Autostart berücksichtigen und ausdrücklich bestätigen. Nur bekannte Dienste mit
nachgewiesenen Konfigurationsmounts werden berücksichtigt. Unbekannte Prozesse,
SSH und Netzwerkdienste bleiben unberührt.

Der Executor deaktiviert Docker-Neustarts, stoppt konkrete Container und entfernt
sie ohne `--force` und ohne Volumelöschung. `docker stop` wartet 30 Sekunden und
kann danach einen nicht reagierenden Prozess beenden. Daten bleiben erhalten;
kein automatischer Rollback oder Konfigurationsbackup. Alte Compose-Dateien und
externe Controller werden nicht geändert. Keine pauschalen Prune-/Kill-Befehle.

## Serverberichte für die Entwicklung

In der App Berichtvorschau und JSON-Download verwenden oder auf dem Testserver:

```sh
npm run report       # nur lokal in reports/
npm run report:dev   # erweiterter Bericht; Upload nur mit Policy und lokaler Freigabe
npm run report:dev -- --local  # erweiterter Bericht nur lokal
npm run report:dev -- --enable-upload  # Upload für diese Installation freigeben
npm run report:dev -- --disable-upload # lokale Uploadfreigabe widerrufen
npm start -- --report
```

Berichte enthalten Gerätenamen, lokale Adressen und Pfade, aber keine bewusst
abgefragten Passwörter, vollständigen Konfigurationsdateien oder Umgebungsvariablen.
Der erweiterte Bericht enthält ausgewählte nicht geheime Konfigurationswerte. Vor dem
Teilen ansehen. Der Entwicklungsordner ist für das private Repository vorgesehen;
Details zum gezielten Commit und späteren Entfernen stehen in
[dev-private/README.md](dev-private/README.md). Ordnerlöschung entfernt keine
Dateien aus der Git-Historie. Echte Schlüssel gehören auch dort nicht hin.

## Alltag nach der Einrichtung

Nach abgeschlossener Einrichtung öffnet sich die Übersicht. Sie zeigt echte
Jellyfin-Geräte und Wiedergaben, getrennte Warteschlangenzähler aus Sonarr,
Radarr und Lidarr sowie qBittorrent-Transfers. Nicht erreichbare Dienste werden
als unbekannt angezeigt, nicht als leere Warteschlange. Unter **Downloads** stehen
Fortschritt, Geschwindigkeit und der zuletzt geprüfte VPN-Zustand. Die Abfragen
liefern keine Geräte-IP-Adressen, Tracker-Zugänge, Dateipfade oder API-Schlüssel.

Installation und Erweiterungen liegen unter **Verwaltung → Apps & VPN einrichten**.
Serverberichte und technische Docker-/Portdetails sind unter **Diagnose** bei Bedarf
aufklappbar. Abgeschlossene Installationsschritte stehen im Auftragsverlauf.

Ein serverseitiger Wächter prüft alle 30 Sekunden den Mullvad-Ausgang und die
Containerzuordnung, auch ohne offenen Browser. Bei fehlendem Nachweis hält er aktive
Torrents an; falls die API oder Zuordnung nicht vertrauenswürdig ist, stoppt er nur
den eindeutig zugeordneten Downloadcontainer und sperrt dessen automatischen Neustart.
Ein alter verwalteter Client ohne VPN wird ebenfalls angehalten; Daten bleiben
bestehen und die kontrollierte VPN-Umstellung bleibt möglich. **Geschützt fortsetzen**
prüft das VPN erneut und startet ausschließlich vom Wächter angehaltene Torrents.
Manuell pausierte Torrents bleiben pausiert.

Gluetun-Firewall, gemeinsamer Netzwerk-Namespace und Tunnelbindung bleiben der
unmittelbare Netzwerkschutz; der periodische Wächter ist eine zusätzliche Prüfung.
Außerhalb StackPilot manuell veränderte oder fremde Container werden nicht übernommen.
Die neue Überwachung ist mit simulierten VPN-Ausfällen getestet; ein erneuter echter
Tunnel-Ausfalltest auf dem Zielserver steht noch aus.

Unter **Medien entdecken** Filme und Serien über Seerr suchen, Details und Cover
ansehen und Filme oder einzelne Staffeln anfragen. Bereits verfügbare Medien und
angefragte Staffeln werden markiert. Eine Anfrage setzt einen fertig eingerichteten
Stack, den passenden ARR-Dienst, qBittorrent und einen frischen VPN-Nachweis voraus.
Es gelten die in Seerr eingerichteten Standardserver und Qualitätsprofile.

**Meine Anfragen** zeigt die 50 neuesten Anfragen mit Suche, Download, Import und
Verfügbarkeit. Die Zuordnung nutzt TMDB-/TVDB-IDs und Torrent-Hashes, keine
Titelvermutungen. Fortschritt wird alle 30 Sekunden abgefragt; nicht erreichbare
Dienste werden sichtbar. Ausstehende Freigaben, abgelehnte Anfragen und Fehler
bleiben als eigene Zustände erhalten. Die Warteschlangenabfrage berücksichtigt
zunächst höchstens 250 Einträge je ARR-Dienst.

Unter **Verwaltung → Quellen** Anbieter aus dem Torrent-Katalog von Prowlarr wählen,
Zugangsdaten eingeben und testen. Erst danach wird die geprüfte Konfiguration
bewusst gespeichert. Ein geprüfter Entwurf ist zehn Minuten gültig und liegt nur
verschlüsselt serverseitig; der Browser erhält keine Zugangsdaten zurück.
Bestehende Quellen lassen sich testen sowie aktivieren/deaktivieren. Ihre übrigen
Einstellungen werden erhalten. Besondere Anbieter mit Captcha oder speziellen
Einrichtungsfeldern werden vorerst direkt in Prowlarr eingerichtet. Prowlarr
synchronisiert Quellen über die vorhandenen Verbindungen an die ARR-Apps;
qBittorrent erhält deren ausgewählte Downloads.

Unter **Downloads** lassen sich einzelne Torrents pausieren, nach erneuter
VPN-Prüfung fortsetzen und mit Bestätigung entfernen. Beim Entfernen bleiben die
Dateien immer erhalten. Manuelles Pausieren entfernt den Torrent aus der Liste für
das gemeinsame geschützte Fortsetzen.

## Schutztest auf dem Zielserver

Unter **Verwaltung → VPN & Ausfallsperre** mit `OK` einen gespeicherten Prüfauftrag
starten. Der Auftrag hält qBittorrent an und prüft Mullvad-Ausgang, kontrollierten
Tunnelausfall (TCP, UDP-DNS, HTTPS) und Wiederverbindung. Erst danach startet der
Client geschützt wieder; die Torrents bleiben bis zum bewussten Fortsetzen pausiert.
Bei einem Fehler oder Prozessabbruch verriegelt ein dauerhaft gespeicherter Zustand
die Downloadfreigabe. **Zustand prüfen und Test wiederholen** prüft alle Schritte neu.
Die Auftragssperre schützt vor gleichzeitiger Installation oder Downloadsteuerung.

Dieser Test unterbricht nur das Stack-VPN und den zugeordneten Downloadclient.
Er startet weder Docker noch den Server neu. Nach einem absichtlichen Neustart von
StackPilot zeigt der gespeicherte Auftrag seinen Stand; nach einem Serverneustart
müssen StackPilot gestartet und VPN/Apps erneut geprüft werden. Eine automatische
Systemdiensteinrichtung für StackPilot ist noch nicht enthalten.

In der Cloud sind Fehler und Wiederaufnahme mit Testadaptern sowie Prowlarr/Seerr
mit echten Containern geprüft. Ein echter Mullvad-Tunnel, reale Anbieterzugänge und
Live-Metadaten müssen auf dem Ubuntu-Zielserver abgenommen werden. Die Cloud hat
keinen Zugang zu diesem Server und keine Mullvad-Zugangsdaten. Covers werden nur
über eine feste TMDB-Bildadresse geladen; bei Ausfall bleibt ein Platzhalter.

Der weitere Ablauf steht in [Nächste Etappen](docs/naechste-etappen.md).

## Entwicklung und Prüfungen

```sh
npm run dev           # Entwicklungsserver; private Dateien werden nicht ausgeliefert
npm run build
npm test
npm run test:docker   # Erkennung, Ablösung mit Volume-Erhalt, VPN-Compose/Resolver
npm run test:install  # isolierte Erstinstallation mit anschließender Erweiterung auf acht Dienste ohne Downloadclient; lädt ggf. Images
```

Docker-Integrationstests nur auf einem isolierten Testhost durchführen und nicht
parallel gegeneinander starten. Sie räumen ausschließlich ihre eigenen eindeutig
benannten Container/Volumes/Testdateien auf. Der vollständige Installationslauf
prüft echte API-Konten, Pfade, Verbindungen und den Quellen-/Anfragezugriff.
Eine isolierte Torznab-Testquelle prüft Testen, Speichern und Deaktivieren ohne
Medien-Download. Echte Medien-Downloads und ein echter VPN-Tunnel sind nicht enthalten.
Der Dienstkatalog hält Images per Digest fest; es gibt keine stillen `latest`-
Updates. `npm audit` prüft Node-Abhängigkeiten, keine Container-Betriebssysteme.

Die Cloud-Tests laufen auf Linux/Docker, nicht direkt auf `medienserver`. Für solche
isolierten Entwicklungstests existiert ausdrücklich
`STACKPILOT_ALLOW_UNQUALIFIED_LINUX=1`; standardmäßig sind echte Installationen
außerhalb Ubuntu 24.04/x86-64 gesperrt. Das ersetzt keine Plattformqualifizierung.
TrueNAS bleibt bis zum eigenen Plattformadapter nicht freigegeben.

- [Abgestimmtes Konzept](docs/konzept.md)
- [Architektur](docs/architektur.md)
- [Umsetzung und Abnahmekriterien](docs/umsetzung.md)

Die Oberfläche wurde anhand des Konzepts neu aufgebaut. Der frühere
[Sites-Prototyp](https://stackpilot-media-hub.caringbutton1.chatgpt.site) wurde
nicht als Quellcode importiert.

## Eine Anfrage wartet trotz eingerichteter Quelle

Eine neue Quelle löst nicht zwingend eine erneute Suche für alte Anfragen aus.
Unter **Meine Anfragen → Warum wartet die Anfrage?** werden Seerr-Zuordnung,
Überwachung in Radarr/Sonarr, dort aktivierte Quellen, Downloadclient, VPN und
laufende Suchaufträge geprüft. Der letzte im ARR-Verlauf ausgewählte Release
wird angezeigt, sofern er gemeldet wird.

**Jetzt erneut suchen** übergibt einen automatischen Suchauftrag an Radarr bzw.
an Sonarr für die angefragten Staffeln. Das kann passende Downloads starten.
Voraussetzungen sind eine freigegebene Anfrage, das überwachte Medium im richtigen
verwalteten Dienst, aktivierte Quellen, ein antwortender Downloadclient und ein
frischer Mullvad-Nachweis. Ein bereits laufender Auftrag wird nicht erneut gestartet.
Die in Seerr gewählte Serverzuordnung wird geprüft; fremde Server und separate
4K-Konfigurationen werden nicht versehentlich im Standarddienst gesucht.

**Treffer und Ablehnungen prüfen** fragt interaktiv Veröffentlichungen ab und
zeigt Quelle, Qualität, Größe, Seeder sowie zusammengefasste Ablehnungsgründe.
Diese Abfrage startet keinen Download und umgeht keine Qualitätsregeln.
API-Schlüssel, Download-URLs und Tracker-Zugänge bleiben serverseitig.
Eine Warteschlange für Suchaufträge ist vom laufenden Suchen und von der
Download-Warteschlange zu unterscheiden. Ein beendeter Suchauftrag ohne passenden
Download bleibt als wartende Anfrage sichtbar.

## Quellen bearbeiten und Qualität ändern

Unter **Verwaltung → Quellen → Bearbeiten** bestehende Anbieteroptionen oder
Zugänge ändern. Leere Zugangsfelder behalten gespeicherte Werte bei. Änderungen
werden getestet und erst danach mit **Geprüfte Änderungen speichern** übernommen.
Der Aktivierungszustand bleibt erhalten. Der vorherige Stand wird verschlüsselt
lokal gesichert; wurde die Quelle nach dem Test anderweitig verändert, muss sie
neu geladen und getestet werden. Zugangsdaten werden nicht an den Browser zurückgegeben.

Qualität gehört zum **Radarr-/Sonarr-Profil**, nicht zur Quelle. Bei einer Anfrage
öffnet **Qualität ändern** die tatsächlichen Dienstprofile und die erlaubten
Qualitäten. Die Option **1080p ohne Remux** erzeugt bei Bedarf ein separates
StackPilot-Profil aus der nativen Vorlage. Bestehende Profile werden nicht verändert.
1080p beschreibt die Auflösung, nicht eine feste Dateigröße; auch ein großer Remux
kann 1080p sein.

Vor dem Speichern zeigt die App die Änderung. Standardmäßig betrifft sie nur den
Film bzw. die gesamte Serie. Optional wird sie auch in Seerr als Standard für
zukünftige Anfragen desselben verwalteten Standardservers gesetzt. Bereits
heruntergeladene Dateien und laufende Torrents werden weder gelöscht noch
umgewandelt. Neue Profilregeln können die spätere Importbewertung beeinflussen.
Es wird kein neuer Suchauftrag gestartet; diesen bei Bedarf ausdrücklich separat
beauftragen. Ein teilweise fehlgeschlagener Standardwechsel wird sichtbar gemeldet.

## Download fertig, aber Film fehlt

**100 % und „Verteilt“ bestätigen den Download, nicht den Import.** Seeding sollte
den Import per Hardlink nicht verhindern. Unter **Meine Anfragen → Warum wartet
die Anfrage? → Nach dem Download** stehen jetzt:

- Zuordnung des Torrents über Download-IDs, ohne Titelvermutung.
- Verarbeitungsstatus abgeschlossener Downloads in der ARR-App.
- Importhindernisse und bereinigte native Warteschlangenmeldungen.
- Importnachweis aus Radarr und davon getrennt der Nachweis in Jellyfin über die TMDB-ID.
- **Import-Diagnose kopieren** für die gezielte Fehlersuche; API-Zugänge und Tracker-URLs werden ausgeblendet.

Ein bereits von Radarr importierter Film wird nicht wieder als suchend angezeigt,
nur weil Seerr die Verfügbarkeit noch nicht abgeglichen hat. Die Diagnose ändert
keine Dateirechte und erzwingt keinen Import. Rechte-, Pfad- oder Dateiformatfehler
werden erst nach einem konkreten Nachweis gezielt behoben. Eine große ARR-Warteschlange
wird zunächst nur bis 250 Einträge abgefragt; diese Einschränkung bleibt sichtbar.

## Bibliotheksabgleich und kompakte Medienlisten

Unter **Meine Anfragen** werden acht Einträge pro Seite angezeigt. Status- und
Medientypfilter werden direkt in Seerr angewendet; die Übersicht bleibt auch bei
mehr als 50 Anfragen durchblätterbar. **Details ansehen** öffnet Fortschritt,
Qualitätswechsel und Diagnose nur beim ausgewählten Medium. Downloads haben eine
eigene Seitennavigation und Filter. Wenn die Dienste die Werte liefern, erscheinen
Dateigröße sowie bereits heruntergeladene Bytes; fehlende Größen bleiben unbekannt.

Nach einem neu erkannten Filmimport fordert StackPilot automatisch einen
Jellyfin-Bibliotheksscan an. Der Hintergrunddienst prüft jede Minute; automatische
Scanversuche werden auf höchstens einen Versuch alle fünf Minuten begrenzt.
Erst nach dem bestätigten Jellyfin-Scan wird der Seerr-Abgleich gestartet.
Der Fortschritt bleibt lokal gespeichert und kann nach einem StackPilot-Neustart
weiter geprüft werden. **Bibliothek abgleichen** startet denselben Ablauf manuell.
Aktive Einrichtungs- und Wartungsaufträge haben Vorrang.

Die Filmübersicht prüft die tatsächliche Jellyfin-Verfügbarkeit anhand der TMDB-ID.
Ein erfolgreicher Scan allein bestätigt keine einzelne Datei. Wenn Jellyfin nicht
erreichbar ist, wird daraus kein Verfügbarkeitsnachweis abgeleitet. Serien werden
weiter über Seerr verfolgt; ein einzelnes gefundenes Serienobjekt bestätigt nicht
alle angefragten Episoden. Dieser Ablauf ändert keine Rechte, löscht keine Medien
und erzwingt keinen ARR-Import. Falls ein importierter Film weiterhin fehlt, unter
**Details ansehen → Warum wartet die Anfrage?** die Import-Diagnose prüfen.

## Helles und dunkles Design

Der Schalter oben links in der Kontoleiste wechselt zwischen dem bisherigen
Dark Mode und einem hellen Design mit kräftigen Violett-, Orange- und Grüntönen.
Die Auswahl wird ausschließlich in diesem Browser gespeichert; auch auf der
Anmeldeseite ist der Schalter verfügbar. Kontoleiste und Navigation bleiben beim
Scrollen fest. Auf kleinen Bildschirmen sitzt die Navigation unter der Kontoleiste;
ihre Menüpunkte lassen sich horizontal durchblättern.

## Filme und Download-Dateien löschen

Unter **Meine Anfragen → Details ansehen → Film löschen** wird zuerst eine
Löschvorschau erstellt. Sie zeigt Filmgröße und über Radarr-IDs zugeordnete Torrents.
Nach Eingabe von **OK** entfernt StackPilot den Film samt Bibliotheksdateien aus dem
verwalteten Radarr und die ausgewählte Anfrage aus Seerr. Andere Anfragen bleiben
erhalten; die gemeinsame Filmdatei ist danach auch für andere Zuschauer entfernt.
Es wird keine neue Suche gestartet. Vorher kann unter **Qualität ändern** ein
1080p-Profil ohne Remux auch als Standard für zukünftige Anfragen gesetzt werden;
eine feste Dateigröße wie 6 GB garantiert dieses Profil nicht.

Torrent-Dateien bleiben standardmäßig erhalten. Nur ausdrücklich ausgewählte
Downloads werden mit ihrem **gesamten Inhalt** gelöscht. Ein Torrent kann mehrere
Dateien enthalten. Unter **Downloads → Download-Dateien löschen** gibt es außerdem
eine separate Löschaktion mit ausdrücklicher Bestätigung; die bisherige Aktion
**Entfernen · Dateien behalten** behält ihre Bedeutung. Dort gelöschte Downloads
entfernen keine Bibliothekskopien und stoppen keine weiterhin überwachte Anfrage.

Hardlinks, andere Kopien und ein in Radarr konfigurierter Papierkorb können weiter
Speicher belegen. StackPilot umgeht diesen Papierkorb nicht und löscht keine
beliebigen Hostpfade. Vor Änderungen werden Dateizuordnung und Torrentpfade erneut
geprüft. Der bestätigte Fortschritt wird lokal verschlüsselt gespeichert. Bei
Teilproblemen denselben Löschbereich erneut öffnen und mit der gespeicherten
Auswahl fortsetzen. Ein neuer Stack-Plan oder geänderte Dateien verlangen eine neue
Prüfung. Jellyfin kann den Film bis zum nächsten Bibliotheksabgleich noch anzeigen.

Prüfung dieses Bereichs: `npm test` deckt Vorschau, Bestätigung, Dateibindung und
Teilfortsetzung ab; `npm run test:media-removal` startet einen isolierten Radarr-
Container und prüft die Ablehnung einer fehlenden Film-ID bei leerer Bibliothek.
Der tatsächliche Löschablauf mit Filmdatei und Torrents wird mit kontrollierten
API-Fixtures und im Browser geprüft; dabei werden keine Nutzerdateien gelöscht.

Nach einer bestätigten Filmlöschung prüft StackPilot bei Suche, Details und erneuter
Anfrage den aktuellen Radarr-Dateistatus statt allein dem Seerr-Status zu vertrauen.
Abgeschlossene Löschaufträge älterer Versionen werden dabei aus dem lokalen
verschlüsselten Journal übernommen. Bei fehlender Datei wird Seerr vor einer neuen
Anfrage auf den unterstützten Status `unknown` gesetzt; die zurückgegebene
Statusänderung muss bestätigt sein. Eine vorhandene neue Datei, eine laufende neue
Anfrage oder ein nicht prüfbarer Dateistatus verhindert einen doppelten Auftrag.

## Verifizierte Qualitätsänderungen und externer Zugriff

Qualitätsänderungen werden nach dem Schreiben aus Radarr/Sonarr zurückgelesen.
Das 1080p-Profil ohne Remux wird anhand seiner tatsächlich erlaubten Qualitäten
und deaktivierten Upgrades geprüft. Der Seerr-Standard wird separat zurückgelesen;
ein Teilfehler wird nicht als Erfolg für zukünftige Anfragen ausgegeben.

Eine erfolgreich bestätigte Auswahl wird pro Medium gespeichert und bei einer
späteren StackPilot-Neuanfrage ausdrücklich mit Profil- und Server-ID an Seerr
übergeben. Ein bestätigter Standard wird für weitere StackPilot-Anfragen ebenfalls
explizit verwendet. Fehlende/veränderte Profile oder ein inzwischen manuell
geänderter Standard führen zu einer erneuten Prüfung statt einem stillen Rückfall
auf das alte Profil. Laufende Torrents und vorhandene Dateien werden weder
umgewandelt noch gelöscht. Nach einem Profilwechsel wird keine Suche automatisch
neu gestartet. Ein 1080p-Encode kann weiterhin groß sein; dieses Profil enthält
keine feste 6-GB-Grenze.

Unter Meine Anfragen → Details → Qualität ändern stehen aktuelles Dienstprofil,
Seerr-Standard, ursprüngliche Anfragevorgabe und vorhandene Dateiqualität/-größe.
**Qualitätsdiagnose kopieren** exportiert diese Felder ohne Zugangsdaten.

Unter Verwaltung → Externer Zugriff gibt es jetzt eine lesende Vorbereitung für
Jellyfin und Tailscale. Vorhandene Freigaben werden auf ausschließlich Jellyfin
geprüft; MFA und Quick Connect werden nicht gleichgesetzt. Die konkrete
SSO-/Geräteanmeldung und deren erforderliche Abnahme stehen in
[docs/externer-zugriff.md](docs/externer-zugriff.md). Öffentlicher Funnel wird dadurch
noch nicht aktiviert.

Nach einem bestätigten Profilwechsel ohne importierte Datei lässt sich ausdrücklich
**Mit diesem Profil neu suchen** starten. Diese Aktion prüft Profil, freigegebene
Anfrage, Quellen, Downloadclient und VPN erneut; sie kann passende Downloads
starten. Der reine Speichervorgang startet weiterhin keine Suche. Bei abweichendem
Dienstprofil oder veränderten Remux-Regeln bleibt die Suche gesperrt.


Authentik lässt sich unter **Verwaltung → Externer Zugriff** separat lokal
vorbereiten und installieren. Der fortsetzbare Auftrag prüft Container,
MFA-Richtlinien und die Grenze zwischen Login und Verwaltung. Vier Container
verwenden feste Image-Digests und veröffentlichen ausschließlich Loopback-Ports.
Der Initialzugang ist erst nach erfolgreicher Einrichtung und erneuter
Administratorbestätigung sichtbar. `npm run test:identity` prüft die isolierte
Docker-Installation mit Testkonten. Details und noch offene Voraussetzungen:
[Authentik und externer Zugriff](docs/externer-zugriff.md#lokale-authentik-einrichtung-in-stackpilot).
Die Einrichtung aktiviert weder Serve noch Funnel. Das offizielle SSO-Plugin
4.0.0.4 wurde mit Jellyfin 12.4.0 in einer isolierten Instanz einschließlich
Authentik-MFA und Quick Connect getestet. Die Abnahme auf dem Zielserver bleibt offen.

Vorhanden sind verschlüsselte Authentik-Sicherungen mit
isoliertem Wiederherstellungstest, eine Vorschau zum lokalen Beschränken von
Jellyfin-Administratoren und geschützter Gerätewiderruf. Seit 0.4.0 ergänzt
der letzte geführte Schritt eine ausdrücklich bestätigte Funnel-Aktivierung
mit aktueller Sicherheitsprüfung und Rücknahme. Die genaue Abnahme und Grenzen
stehen in [Funnel](docs/funnel.md) und
[Sicherheitsabnahme](docs/sicherheitsabnahme.md).
Für die Umsetzung wird kein Microsoft-SDK installiert.


Unter **Verwaltung → Externer Zugriff → Jellyfin mit Authentik verbinden**
lässt sich jetzt eine private SSO-Konfiguration prüfen und mit ausgewählten
Bibliotheken einrichten. Voraussetzung ist das exakt versionsgeprüfte SSO-Plugin;
es lässt sich im vorgelagerten, ausdrücklich bestätigten Schutzauftrag bereitstellen.
Vorhandene fremde oder manuell geänderte Anbieter werden nicht überschrieben.
Client-Geheimnisse bleiben im serverseitigen Vault. Unterbrochene Bestätigungen
können ohne erneutes Überschreiben fortgesetzt werden.

Die zusätzliche Sperre öffentlicher Passwortzugänge ist als verwaltetes Gateway
implementiert und isoliert getestet. Die Ausführung und Geräteabnahme auf dem
Zielserver sind separat zu bestätigen; ohne erfüllte Voraussetzungen bleibt
die Aktivierung gesperrt. Details: [Funnel](docs/funnel.md).

Die geführte **Plugin- & Schutz-Gateway-Einrichtung** ist jetzt vorhanden. Sie
prüft das offizielle Archiv, deaktiviert automatische Plugin-Updates und startet
bei einer neuen Installation ausschließlich Jellyfin neu. Ein eigenes lokales
Gateway sperrt Passwörter und prüft jede erkannte Benutzersitzung unabhängig auf
SSO-Zuschauerrechte; Administratoren werden dort grundsätzlich abgewiesen.

Danach kann StackPilot die beiden **privaten HTTPS-Routen im Tailscale-Netz**
gezielt einrichten. Fremde oder öffentliche Routen bleiben unangetastet. Diese
Funktion aktiviert keinen Funnel und ersetzt keinen Gerätetest. Der Ablauf und
die verbleibenden Voraussetzungen stehen in
[Externer Zugriff](docs/externer-zugriff.md#geführte-plugin--und-gateway-bereitstellung).

Erweiterte SSO-/Konfigurationsdiagnose und temporärer GitHub-Berichtupload:
[Diagnose und Entwicklung](docs/diagnose-und-entwicklung.md).

## Aktuelle Version

Version **0.4.0**: geführte geschützte Funnel-Freigabe mit Rücknahme,
übergreifende Suche, Benachrichtigungen, gespeicherte Ansichten, Musikbestand
und kontrollierte Code-Updates. Die echte öffentliche Anmeldung muss am
Zielserver separat geprüft werden.
[Funnel-Anleitung](docs/funnel.md) ·
[Changelog](CHANGELOG.md) ·
[Zukunftspläne](docs/zukunft/README.md).
