# Architekturvorschlag

Status: Zielarchitektur mit ausführbarem Ubuntu-Pilot. Vorhanden sind UI/Planer,
eine lokale Node-API, Administratoranmeldung, verschlüsselter Tresor, SQLite-Journal,
Altstack-Ablösung und neun echte Dienstadapter. Ergänzt sind VPN-Schutz, private
Authentik-/SSO-Vorbereitung, Authentik-Sicherung, Anfrageverwaltung, native
Filmgrößenregeln, Betriebsübersicht, Änderungsverlauf und systemd-Unit-Generierung.
Ein eigener Worker/Executor-Prozess, TrueNAS-Adapter sowie vollständige
Stack-Sicherungen und Containerupdates stehen weiter aus.
Fachliche Grundlage: [Konzept](konzept.md).

## Technische Basis

Der aktuelle Pilot verwendet die lokale Node-HTTP-API unter `apps/server` und
Polling mit begrenztem Cache. Fastify, eigener Worker und Server-Sent Events im
folgenden Abschnitt sind Zielarchitektur und noch nicht implementiert.

Vorgeschlagen ist ein TypeScript-Monorepository mit React/Vite für die Oberfläche,
Fastify für eine REST-API und einen separaten Worker-Prozess für dauerhafte
Aufträge. SQLite mit Migrationen speichert Sollzustand, Inventar, Pläne und
Auftragsfortschritt auf lokalem persistentem Speicher. Server-Sent Events
übertragen Fortschritt; nach erneutem Verbinden liefert die API den gespeicherten
Stand. Versionen und Paketmanager werden beim Anlegen des Grundgerüsts gepinnt.

Diese Basis hält den Betrieb auf einem Server klein und erlaubt gemeinsame
Schemas für UI, API und Planer. Der Worker arbeitet mit persistierten Aufträgen,
nicht mit einer Warteschlange nur im Arbeitsspeicher. Eine Datenbanktransaktion
kann Docker- und Dienständerungen nicht atomar machen.

| Bereich | Verantwortung |
| --- | --- |
| `apps/web` | Deutsche Oberfläche, Assistent, Gesamtplan, Fortschritt, Betrieb |
| `apps/api` | Administrator-Anmeldung, validierte Eingaben, Pläne, Inventar, Ereignisse |
| `apps/worker` | Auftragsausführung, Sperren, Wiederaufnahme, Funktionsprüfungen |
| `packages/domain` | Schemas, Komponentenmodell, Abhängigkeiten, Soll-/Ist-Vergleich |
| `packages/planner` | Deterministische Planung ohne Serveränderungen |
| `packages/adapters` | Plattform-, Docker- und Dienstadapter; austauschbare Simulation |

## Plattformzugriff und Rechte

StackPilot wird auf demselben Zielserver betrieben. Ein enger Executor bildet
die Grenze zu Docker und Plattformoperationen. Web/API bekommen keinen direkten
Docker-Socket. Der Executor akzeptiert nur validierte, vordefinierte Operationen
auf den freigegebenen Pfaden und den StackPilot zugeordneten Ressourcen; keine
beliebigen Shell-Befehle aus Webeingaben. Kommunikation erfolgt lokal und
authentifiziert. Docker-Zugriff ist als weitreichende Hostberechtigung zu behandeln;
eine solche Trennung allein beseitigt dieses Risiko nicht.

Zuerst wird ein Ubuntu-Adapter auf einer festgelegten Ubuntu-Server-Version
mit Docker Engine und Compose getestet. Für den späteren TrueNAS-Adapter muss
vor dessen Implementierung für die genaue SCALE-Version geklärt werden, ob und
wie ein eigenes Compose-Projekt unterstützt betrieben werden kann, wie es sich
mit der TrueNAS-App-Verwaltung verträgt und wie Dataset-/ACL-Änderungen über
unterstützte Schnittstellen erfolgen. Keine ungeprüften Eingriffe in vom System
verwaltete App-Verzeichnisse und keine Installation von Hostpaketen als Standard.
Ein Plattformadapter meldet Fähigkeiten und erklärt fehlende Unterstützung.
Die Fachlogik bleibt für Ubuntu und TrueNAS gemeinsam.

## Zentrale Datenmodelle

- `ServerInventory`: Plattformversion, Docker-Fähigkeiten, Ports, Speicher,
  Mountgrenzen, Rechte, GPU und gefundene Dienste; Zeitpunkt der Erhebung.
- `StackSpec`: gewünschte Komponenten, Versionen, Speicherzuordnung, Profile,
  VPN-Auswahl und Referenzen auf Geheimnisse.
- `ServiceBinding`: Dienstadresse, Version und Eigentumsmodus `observed`,
  `connected` oder `managed`. Einbindung erteilt keine Übernahmeberechtigung.
- `ConnectionSpec`: Quelle, Ziel, Zweck und getrennte Konfigurationsberechtigung.
- `Plan`: unveränderliche Revision mit Inventargrundlage, Änderungen,
  Abhängigkeiten, Konflikten, Prüfungen und erforderlichen Freigaben.
- `Operation` / `Step`: Status, Versuche, Prüfergebnis, Zeitpunkt, Ressourcen-IDs
  und Fortschrittsereignisse; Geheimnisse werden nicht in Ereignissen gespeichert.
- `BackupManifest`: Dienste, Image-Digests, Konfigurationsrevisionen,
  Sicherungsdateien, Prüfsummen und Wiederherstellungsvoraussetzungen.

## Ein Plan, ein Auftrag

Die Mehrfachauswahl erzeugt eine `StackSpec`. Der Planer löst daraus einen
Abhängigkeitsgraphen und zeigt alle Installationen, Verbindungen, Datenpfade,
Rechteänderungen und externen Voraussetzungen gemeinsam an. „Alle auswählen“
wählt den Dienstkatalog; VPN und kostenpflichtige/externe Zugänge bleiben
ausdrückliche Einstellungen. Fehlende Abhängigkeiten werden sichtbar aufgelöst,
niemals still installiert oder als erfolgreich verbunden dargestellt.

Die Bestätigung der Planrevision erzeugt einen Auftrag. Vor Ausführung wird
relevante Drift erneut geprüft. Ein veralteter Plan muss neu erzeugt und erneut
bestätigt werden. Pro Server darf nur ein verändernder Auftrag laufen.

Ablauf: Vorprüfung → Ressourcen vorbereiten → Container starten → Bereitschaft
prüfen → Dienstzugänge initialisieren → Verbindungen konfigurieren → funktional
prüfen. Unabhängige Schritte dürfen begrenzt parallel laufen; abhängige Schritte
warten auf erfolgreiche Voraussetzungen.

Jeder Schritt prüft vor einer Änderung den tatsächlichen Zustand. Nach einem
Abbruch zwischen externer Änderung und lokalem Checkpoint erkennt der nächste
Versuch die vorhandene Ressource wieder. Labels, stabile Ressourcen-IDs und
Sollzustandsvergleiche verhindern doppelte Container oder Zugangseinträge.
Statuswerte unterscheiden wartend, laufend, erfolgreich, fehlgeschlagen,
blockiert und übersprungen. Ein Neustart gleicht laufende Schritte mit dem
Istzustand ab und bietet gezielte Wiederaufnahme. Teilfehler bleiben sichtbar;
kein pauschales Löschen als vermeintlicher Rollback.

## Dienstadapter und automatische Verbindungen

Adapter kapseln versionsabhängige Initialisierung, API-Zugänge,
Konfigurationsvergleich, Bereitschaft und Funktionsprüfung. Ein versionierter
Katalog nennt Image-Digest, unterstützte Plattformen, Ports, Volumes,
Abhängigkeiten und bekannte API-Fähigkeiten. Keine unkontrollierten `latest`-Updates.

Geplante Verbindungen, jeweils nur bei passenden ausgewählten/eingebundenen Diensten:

| Verbindung | Zweck |
| --- | --- |
| Prowlarr → Sonarr/Radarr/Lidarr | Indexer synchronisieren |
| Sonarr/Radarr/Lidarr → qBittorrent | Downloadclient und Kategorien einrichten |
| Bazarr → Sonarr/Radarr | Medien- und Untertitelzuordnung |
| Seerr → Jellyfin, Sonarr/Radarr | Anmeldung/Medienabgleich und Anfragen |
| Streamystats → Jellyfin | Aktivitätsdaten |
| Jellyfin → Bibliotheken/Plugins | Medienpfade und kompatible ausgewählte Plugins |

Konkrete API-Unterstützung ist pro gepinnter Dienstversion zu testen. Ein
eingebundener Fremddienst bleibt zunächst unverändert. Benötigt eine Verbindung
dort Schreibzugriff, verlangt der Plan eine ausdrückliche, begrenzte Erlaubnis
und zeigt den Konfigurationsunterschied. Das ist keine vollständige Übernahme.

## Speicher und Rechte

Beispiel: Ein gemeinsames Daten-Dataset wird als `/data` eingebunden, darunter
`/data/downloads/{incomplete,complete}` und `/data/media/{movies,tv,music}`.
Downloadclient und Importdienste verwenden dieselbe Zuordnung; Jellyfin erhält
Medien nach Möglichkeit nur lesend. Dienstkonfigurationen liegen separat.

Gleiche Pfadnamen garantieren keine Hardlinks: Downloads und Zielmedien müssen
auf demselben Dateisystem liegen und innerhalb eines geeigneten gemeinsamen
Mounts erreichbar sein. Verschachtelte ZFS-Datasets bleiben eigene Grenzen.
Die Vorprüfung erkennt Mount-/Dataset-Grenzen und prüft einen Hardlink mit
temporären Dateien in ausdrücklich freigegebenen Prüfverzeichnissen. Nicht
mögliche Hardlinks führen zu einem erklärten Konflikt oder einer bewusst
gewählten Kopierstrategie. Keine automatische Dataset-Verschiebung.

UID/GID und TrueNAS-ACLs werden geprüft; keine pauschalen rekursiven `chmod`-,
`chown`- oder ACL-Resets. Änderungen bleiben auf bestätigte Pfade begrenzt.

## VPN und Hardware

Im VPN-Modus teilt qBittorrent ausschließlich Gluetuns Netzwerk-Namespace.
Gluetuns Firewall muss Verkehr auch bei Tunnelverlust sperren; ein Healthcheck
oder `depends_on` allein genügt nicht. Kein automatischer Wechsel zum direkten
Netzwerk. Nur nötige lokale Verwaltungszugänge werden freigegeben. Mullvad-Zugang
und unterstützte WireGuard-Konfiguration werden separat eingerichtet.

Tests müssen Tunnelabbruch, DNS-Verkehr, Containerneustart und Hostneustart
abdecken und nachweisen, dass keine ungeschützten Downloads möglich sind.
Hardwarebeschleunigung wird erst nach GPU-/Treiberprüfung gezielt freigegeben;
kein pauschal privilegierter Jellyfin-Container.

## Sicherheit, Sicherungen und Betrieb

Ein einmaliger Bootstrap richtet den Verwaltungsadministrator ein. Passwörter
werden mit einem geeigneten Passwort-Hash gespeichert; Sitzungen nutzen sichere
Cookies, Ablauf und CSRF-Schutz. Der lokale Zugriff erfordert eine bewusste
Bindeadresse und einen dokumentierten TLS-Weg. Keine offene Administrations-API.

Dienstgeheimnisse werden kryptographisch erzeugt bzw. dienstgerecht initialisiert,
verschlüsselt persistent gespeichert und in UI/Logs maskiert. Der Hauptschlüssel
liegt getrennt von der Datenbank mit eingeschränkten Dateirechten; Sicherung und
Wiederherstellung dieses Schlüssels müssen mitgeplant werden. Keine Geheimnisse
in Git, Planexporten oder Compose-Ausgaben.

Updates sind eigene bestätigte Aufträge: Konfiguration und Datenbanken
anwendungskonsistent sichern, Sicherung prüfen, ausgewählte Version ändern,
Migration/Bereitschaft/Verbindungen prüfen. Dateikopie einer laufenden Datenbank
ist keine verlässliche Sicherung. Wiederherstellung muss auch Datenbankmigrationen
berücksichtigen; ein altes Image allein ist kein sicherer Rückweg.
Medien sind nicht automatisch Teil der Konfigurationssicherung. Umfang, Ziel,
freier Platz und Aufbewahrung werden angezeigt; Wiederherstellung wird getestet.

Entfernung stoppt und entfernt standardmäßig nur zugeordnete Laufzeitressourcen.
Persistente Daten und Konfiguration bleiben erhalten. Datenlöschung ist eine
separate ausdrückliche Aktion. Monitoring trennt Erreichbarkeit, Bereitschaft und
funktionierende Verbindungen; ein laufender Container allein bedeutet keinen
gesunden Dienst.

## Konten, gemeinsame Anmeldung und Wizard-Geheimnisse

Ein Konto-Adapter meldet pro gepinnter Dienstversion, ob Initialisierung,
Benutzeranlage, Rollen, API-Schlüssel und SSO unterstützt sind. Der Plan enthält
die anzulegenden persönlichen und technischen Identitäten samt Rechten, ohne
Passwörter. Bootstrap-Administrationsrechte werden nur eingesetzt, wo erforderlich;
Integrationen verwenden danach möglichst eigene eingeschränkte Identitäten.
Nicht unterstützte Rechtebegrenzungen bleiben als Einschränkung sichtbar.

SSO ist eine gesonderte spätere Integrationsoption über unterstützte
Authentifizierungsverfahren. Ein vorgeschaltetes Anmeldeportal allein meldet
nicht automatisch in jeder App an. Native Anmeldung darf nicht pauschal
deaktiviert werden: direkte Ports, APIs und mobile Clients könnten die vorgeschaltete
Anmeldung umgehen oder andere Authentifizierungswege benötigen. Direkte
Dienstzugänge behalten daher eigenständige Geheimnisse und eine geprüfte
Netzwerkbegrenzung. Gleiche persönliche Benutzernamen sind möglich, soweit die
Dienste sie akzeptieren; Gleichsetzung mit Host-UIDs wird vermieden.

Der Wizard speichert VPN-Konfigurationen und andere Zugangsdaten nur über die
Geheimnisverwaltung. Importierte Dateien werden wie Geheimnisse behandelt;
Diagnoseausgaben, Fehlermeldungen, temporäre Dateien und Backups werden ebenfalls
berücksichtigt. Verbindungsprüfungen dürfen keine kostenpflichtigen Konten oder
neuen WireGuard-Geräte ohne ausdrücklichen Auftrag erzeugen. Für Mullvad werden
unterstützte WireGuard-Parameter und deren Import zunächst gegen die gepinnte
Gluetun-Version verifiziert; keine ungeprüfte Zusage automatischer Kontoanmeldung.


## Implementierter Pilot und bewusste Grenzen

Der aktuelle Backend-Worker läuft asynchron im Node-Serverprozess und verwendet
persistierte Schritte plus SQLite-Lease. Nach Prozessabbruch erfolgt keine
ungeprüfte automatische Fortsetzung. Konten, Pläne, Jobzustand und Geheimnisse
bleiben in `.stackpilot/`; Secrets sind AES-GCM-verschlüsselt und an ihren Namen
gebunden. Der Hauptschlüssel liegt außerhalb der Datenbank. HTTP-APIs benötigen
eine Administrator-Sitzung; Mutationen zusätzlich Origin, JSON und Sitzungstoken.
Die Erstregistrierung benötigt einen lokalen Setupcode. Die App bleibt auf
Loopback/SSH beschränkt. `stackpilot.localhost` und getrennte Dienst-Hostnamen
verhindern die Weitergabe des StackPilot-Cookies an lokale Medienoberflächen.

Der echte Installer übernimmt nur neue Daten-/Konfigurationsordner und feste
Images aus `packages/catalog/services.json`. Image-Referenzen werden in den
unveränderlichen Plan übernommen. Eigene Ressourcen tragen Projekt- und Planlabels.
Während des Bootstraps sind keine Dienst-Webports veröffentlicht. Eine separate
Node-API-Brücke im privaten Compose-Netz führt ausschließlich vom Backend erzeugte
Dienstanfragen aus; sie besitzt weder Docker-Socket noch Datenmounts. Anfrage-
Geheimnisse gehen per stdin über Docker exec, nicht als Prozessargumente.

Vor Veröffentlichung erfolgen Login-, Bibliotheks-, Pfad- und Verbindungstests.
Danach werden die Container mit lokalen Portbindungen erneut abgeglichen und
noch einmal geprüft. Innere Service-DNS-Namen werden additiv in NO_PROXY erfasst,
ohne externe Proxy-/TLS-Prüfung zu deaktivieren. Fehlermeldungen aus Dienst-APIs
werden um bekannte erzeugte Geheimnisse bereinigt.

Neun Adapter sind freigegeben: Jellyfin, Streamystats, Sonarr, Radarr, Lidarr,
Prowlarr, Bazarr, Seerr und qBittorrent. Gemeinsamer Benutzername ist möglich; getrennte zufällige Passwörter
und Dienst-API-Schlüssel sind Standard. ARR-API-Schlüssel besitzen die vom Dienst
angebotenen weitreichenden Rechte; granulare Hintergrundrollen werden nicht
vorgetäuscht. SSO, Indexer-Zugänge, Medien-Downloads, Plugin-Installation, GPU und
VPN sind kein Bestandteil der bisher bestandenen Funktionsprüfung.


## Erweiterungspläne und VPN-Pilot

Eine Stack-Identität (`rootId`) bleibt über unveränderliche Planrevisionen erhalten.
`basePlanId` bindet eine Erweiterung an den letzten abgeschlossenen Auftrag;
`existing` und `added` trennen erhaltene und neu zu initialisierende Dienste.
Container-/Netzwerklabels, Datenmarker und Tresorzugänge verwenden die stabile
Identität. Alte Pläne ohne rootId verwenden ihre ursprüngliche Plan-ID.
Definitionen vorhandener Compose-Dienste werden eingefroren übernommen; ein
Bootstrap mit `--no-recreate` lässt bestehende Container weiterlaufen. Veraltete
Bestätigungen und unvollständige vorherige Aufträge werden abgewiesen.

VPN-Pläne referenzieren ausschließlich ein verschlüsseltes Profil. WireGuard-
und Steuerdateien liegen mit 0600 in einem eigenen Dienstordner. Gluetun erhält
NET_ADMIN und genau das TUN-Gerät. qBittorrent und ein Node-Prüfcontainer teilen
Gluetuns Namespace ohne eigene Netzanbindung; ihre Resolverdatei zeigt auf
127.0.0.1. Nur Gluetun veröffentlicht den lokalen qBittorrent-Webport. Die
Steuer-API ist nicht veröffentlicht. IPv6 ist in diesem Namespace deaktiviert.
Runtimevalidierung prüft Namespace-ID, Capabilities, Geräte, Mounts und lokale
Ports; Gegenproben stoppen den Tunnel vor Start von qBittorrent.

Eine nachträgliche VPN-Umstellung ist eine ausdrücklich angezeigte Unterbrechung
mit gezieltem Containerersatz, nicht das Zurücksetzen des Datenordners. Gesicherte
API-Einstellungen/Verbindungslisten sind verschlüsselte Rückverfolgungsdaten,
kein Ersatz für vollständige konsistente Datenbanksicherungen. Der Cloud-Test
verifiziert keine echte Mullvad-Verbindung; diese ist eine Runtime-Startbedingung
auf dem Zielserver.


## Zusätzliche Dienstadapter

`AdditionalServices` kapselt die versionsabhängigen APIs von Bazarr, Seerr und
Streamystats. Der gemeinsame Installer behält seine Bootstrap-, Prüfschritt- und
Wiederaufnahmesemantik. Bazarrs Konfigurationsseed wird nur in einem eigenen neuen
Dienstordner erzeugt; spätere Änderungen laufen gezielt über die API. Vorhandene
fremde Verbindungen, manuelle Seerr-Standardserver und Bibliotheksauswahlen werden
nicht überschrieben.

Seerr und Streamystats verwenden Jellyfin als persönliche Identität, daher zeigt
die geschützte Zugangsanzeige den Jellyfin-Zugang. Technische Tokens bleiben
getrennt. Streamystats benötigt einen Jellyfin-Administrations-Gerätezugang für
seine unterstützte Bootstrap-API; die weitreichenden Rechte bleiben eine sichtbare
Einschränkung. Sein AIO-Image erhält PostgreSQL-Daten auf einem eigenen Mount.
Sitzungs-/Datenbankgeheimnisse werden in einer privaten Laufzeitdatei aus dem Tresor
bereitgestellt und erst im Containerprozess geladen. Sie erscheinen nicht in
Docker-Config.Env oder Compose-Ausgaben.

## Betriebsübersicht und Downloadschutz

`ActivityMonitor` fragt nach validierter Containerzuordnung über die interne
API-Brücke Jellyfin-Sitzungen, ARR-Warteschlangen und qBittorrent-Transfers ab.
Die Antwort ist eine begrenzte Projektion ohne Tokens, IP-Adressen, Medienpfade
oder Tracker-Zugänge. Abfragen werden für zehn Sekunden zusammengefasst;
Fehler eines Dienstes werden als unbekannt dargestellt. Der Browser aktualisiert
sichtbare Ansichten alle 15 Sekunden.

`DownloadGuard` läuft serverseitig alle 30 Sekunden. Neue und alte gespeicherte
Ohne-VPN-Installationspläne sind für qBittorrent gesperrt. Der Wächter prüft
Zuordnung und Mullvad-Ausgang; bei fehlendem Nachweis hält er aktive Torrents
über die validierte API an. Ist diese nicht vertrauenswürdig/erreichbar, stoppt
er den eindeutig zugeordneten Downloadcontainer und deaktiviert dessen Neustart.
Fremde Container bleiben unangetastet. Eine laufende Executor-Sperre hat Vorrang.

Angehaltene Torrent-IDs und notwendige Alt-Konfigurationssicherungen liegen
verschlüsselt im bestehenden Tresor. Geschütztes Fortsetzen benötigt eine
angemeldete Sitzung mit CSRF-Prüfung, einen frischen VPN-Nachweis und erneute
Containerprüfung. Es startet keine zuvor manuell pausierten Torrents.
Die unmittelbare Ausfallsperre bleibt die Gluetun-Firewall im gemeinsamen
Netzwerk-Namespace; der Wächter ersetzt sie nicht.

Nach abgeschlossener Einrichtung ist die Betriebsübersicht der Einstieg.
Einrichtungsassistent, Diagnose und Auftragsverlauf werden unter Verwaltung
aufgerufen. Technische Rohdaten und abgeschlossene Schritte bleiben eingeklappt.

## Medien, Quellen und gespeicherte Schutztests

`MediaHub` validiert den aktuellen abgeschlossenen Stack und die API-Brücke vor
jeder Aktion. Schreibzugriffe nehmen dieselbe SQLite-Auftragssperre wie der
Installer. Seerr liefert Suche/Details/Anfragen; neue Anfragen werden erst nach
frischem VPN-Nachweis zugelassen und auf serverseitig gültige Medien-/Staffel-IDs
beschränkt. Anfragen werden über Medien-IDs mit ARR-Warteschlangen und über
Download-IDs mit qBittorrent korreliert. Metadatenabfragen laufen mit höchstens
vier gleichzeitigen Anfragen; Titel/Cover werden kurzzeitig begrenzt zwischengespeichert.

`Sources` projiziert Prowlarr-Schemas ohne Geheimniswerte. Neue Konfigurationen
werden getestet und als zehn Minuten gültige, verschlüsselte Einmal-Entwürfe
abgelegt. Speichern prüft Planbindung, Ablauf und Namenskonflikte erneut.
Bestehende Quellen werden bei Schalteränderungen serverseitig neu gelesen,
verschlüsselt gesichert und mit unveränderten übrigen Feldern zurückgeschrieben.

`SafetyCheck` speichert den kontrollierten VPN-Test als eigene Auftragsart. Die
Sperre wird durch einen Heartbeat gehalten; vor dem Tunnelausfall wird qBittorrent
angehalten und automatischer Neustart deaktiviert. Ein verschlüsselter dauerhafter
Riegel verhindert die Downloadfreigabe nach Fehler oder Prozessabbruch. Bei einer
Wiederholung werden alle Prüfschritte neu ausgeführt. Erst nach Ausfallsperre,
Wiederverbindung und Client-Bereitschaft wird der Riegel aufgehoben; Downloads
bleiben pausiert und nur vorher aktive Hashes kommen für geschütztes Fortsetzen
infrage. Eine Server-/Docker-Neustartaktion wird nicht angeboten.

Alle neuen APIs erfordern die bestehende lokale Administratorsitzung;
Schreibzugriffe zusätzlich CSRF-Schutz. Downloadaktionen erlauben genau einen
Hash, keine Wildcards; Entfernen setzt immer `deleteFiles=false`. Cover akzeptieren
nur TMDB-Bildpfade, einen festen HTTPS-Host, keine Weiterleitungen und höchstens
2 MiB Bilddaten. Interne API-Tokens und Anbieterzugänge werden nicht an den Browser
weitergereicht.

### Quellenabfragen und Nachweis des Suchstatus

Katalog, eingerichtete Quellen und ARR-Verbindungen werden unabhängig abgefragt.
Ein Fehler in einer Teilabfrage blendet erfolgreiche Antworten nicht aus. Nicht
abfragbare Quellen werden als `null` mit einem sicheren Fehlercode zurückgegeben;
eine bestätigte leere Liste bleibt `[]`. Rohe Dienstfehlermeldungen werden dabei
nicht an den Browser weitergereicht. Optionale Null-Felder in Prowlarr-Schemas
werden normalisiert.

Nur für den lesenden Prowlarr-Anbieterkatalog ist die interne Antwortgrenze auf
16 MiB erhöht; andere Dienstantworten behalten ihre kleinere Grenze. Antworten
werden während des Lesens begrenzt. Der Docker-Test prüft große Kataloge,
Übergrößen und leere HTTP-204-Antworten.

Eine angenommene Medienanfrage ohne zugeordneten Download erhält den Zustand
`waiting` („Wartet auf passenden Download“). Das Fehlen eines Warteschlangeneintrags
beweist keine laufende Suche. Die zusätzliche Such- und Trefferdiagnose wird nur auf Wunsch geöffnet.

### Prowlarr-Feldtypen im Quellenformular

Cardigann-Hinweise vom Typ `info` sind schreibgeschützte Texte und blockieren den
Verbindungstest nicht. Markup aus Anbieterhinweisen wird in Text umgewandelt;
der Browser interpretiert kein Anbieter-HTML. Hilfe zu Eingabefeldern erscheint
unter dem jeweiligen Feld. Nur echte Sonderfelder wie Captchas benötigen weiterhin
den nativen Prowlarr-Dialog.

Basisadressen stammen aus den `indexerUrls` des gewählten Anbieters und werden
als Vorschläge und Voreinstellung angezeigt. Beim Test nutzt der Server dieselbe
Voreinstellung; andere nicht bearbeitete Felder behalten ihre nativen Null- und
Standardwerte. Anbieterfelder wie `apiurl` dürfen einen reinen Hostnamen verlangen;
StackPilot ergänzt dort kein Protokoll. Basisadressen werden weiterhin als HTTP(S)
validiert. Schreibgeschützte Hinweis- und versteckte Definitionsfelder können nicht
über vom Browser gelieferte Werte überschrieben werden.

### Anfrage-Diagnose und erneute Suche

`RequestDiagnostics` ordnet Seerr-Anfragen über TMDB-/TVDB-IDs dem verwalteten
Radarr/Sonarr zu und prüft die konfigurierte Seerr-Serveradresse. Sie liest
Quellen, Downloadclient, Dienststatus, Suchbefehle und Verlauf. Einzelne fehlende
Nachweise bleiben sichtbar. Native Fehlermeldungen mit möglichen Zugangsdaten
werden nicht als Treffer-Ablehnungsgründe weitergereicht; stattdessen erscheinen
verständliche Kategorien. Interaktive Trefferabfragen laufen nur auf explizite
Anforderung über eine Sitzung mit CSRF-Schutz.

Erneute automatische Suchen nutzen die bestehende Auftragssperre und einen
frischen VPN-Nachweis. Serverzuordnung, Anfragestatus, Überwachung, Quellen,
Dienststatus und Downloadclient werden vor dem Schreiben erneut geprüft. Filme
verwenden `MoviesSearch`, Serien nur `SeasonSearch` für angefragte Staffeln.
Aktive passende Befehle und ein kurzes Zeitfenster verhindern Doppelstarts.
Die Zuordnung und der letzte Auftrag werden im Tresor gespeichert. Die Übersicht
zeigt eine Suche nur, wenn ein passender nativer Befehl nachgewiesen wurde;
`queued` und `started` haben getrennte Anzeigetexte.

### Importnachweis, Quellenänderungen und Qualitätsprofile

`importStatus` korreliert native Warteschlangen-/Verlaufs-IDs mit Torrent-Hashes.
Downloadabschluss, Seeding, ARR-Dateinachweis und Jellyfin-Verfügbarkeit bleiben
getrennte Aussagen. Importmeldungen werden begrenzt, bekannte Geheimnisse und URLs
entfernt und ausschließlich als Text angezeigt. Der Jellyfin-Nachweis prüft die
Provider-ID der zurückgegebenen Filme; ein Treffer für eine fremde TMDB-ID zählt
nicht als Verfügbarkeit. Die Übersicht liest zusätzlich Radarrs Dateinachweis,
um importierte Filme bei verzögertem Seerr-Abgleich nicht als suchend darzustellen.

Quellenänderungen behalten unveränderte Geheimnisfelder und den Aktivierungszustand.
Ein getesteter Änderungsentwurf ist an den Stack und einen Fingerabdruck der
vorherigen Konfiguration gebunden. Vor dem PUT wird dieser erneut verglichen und
der Originalzustand verschlüsselt gesichert. Eine Änderung in einem externen
Prowlarr-Fenster zwischen letzter Prüfung und PUT kann ohne native ETags nicht
vollständig ausgeschlossen werden. Adressen mit Zugangsdaten in üblichen
Authentifizierungsparametern werden im Bearbeitungsformular ebenfalls ausgeblendet.

`QualitySettings` nutzt die validierte Seerr-/ARR-Zuordnung der Anfrage. Ein
Profilwechsel erhält Pfade, Tags, Überwachung und Mediendaten; die Originale werden
verschlüsselt gesichert. Das optionale 1080p-Profil wird neu aus der nativen
Qualitätsvorlage erstellt, bestehende Profile bleiben erhalten. Der optionale
Seerr-Standardwechsel wird getrennt bestätigt und ein Teilerfolg ehrlich gemeldet.
Alle Änderungen verwenden die globale Auftragssperre und CSRF-geschützte APIs.
