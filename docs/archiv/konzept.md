# Abgestimmtes Produktkonzept

Stand: 7. November 2026. Diese Anforderungen sind die fachliche Ausgangsbasis;
technische Vorschläge stehen separat in [Architektur](architektur.md).

## Ziel und Umfang

Selbst gehostete Web-App für zunächst einen Server und einen
Verwaltungsadministrator. Entwicklung und erste echte Tests erfolgen auf Ubuntu
Server, danach folgt die Qualifizierung auf TrueNAS SCALE. Zugriff zunächst lokal. Installation, Konfiguration, automatische Verknüpfung,
Verwaltung und Überwachung erfolgen über StackPilot.

Die Auswahl aller gewünschten Komponenten erfolgt gemeinsam, einschließlich
„Alle auswählen“. Danach startet **ein Gesamtvorgang**. Nutzer müssen die
Dienste weder einzeln installieren noch deren interne API-Verbindungen manuell
einrichten. Spätere Erweiterungen verwenden denselben Auswahlassistenten.

## Komponenten

| Komponente | Aufgabe / Auswahl |
| --- | --- |
| Jellyfin | Medienserver mit ausgewählten Plugins |
| Streamystats | Statistiken für Jellyfin |
| Sonarr | Serienverwaltung |
| Radarr | Filmverwaltung |
| Lidarr | Musikverwaltung |
| Prowlarr | Indexerverwaltung |
| Bazarr | Untertitelverwaltung |
| Seerr | Medienanfragen |
| qBittorrent | Downloads |
| Gluetun mit Mullvad | Für qBittorrent verpflichtender VPN-Schutz; ohne Downloadclient nicht erforderlich |

Externe Konten, Zugangsdaten und Indexer können nicht automatisch erfunden
werden. Notwendige Eingaben werden gesammelt und im Gesamtplan ausgewiesen.
Die genaue Plugin-Auswahl und kompatible Dienstversionen sind noch festzulegen.

## Einrichtungsassistent

1. Server und vorhandene Dienste prüfen.
2. Komponenten gemeinsam auswählen.
3. Speicher, Datasets und Rechte festlegen.
4. Administrator und externe Zugänge konfigurieren.
5. VPN, Hardwarebeschleunigung, Sprache und Qualität einstellen.
6. Gesamtplan mit Änderungen und Verbindungen anzeigen.
7. Alles gemeinsam installieren und funktional prüfen.

## Verbindliche Regeln

- Konsistente Containerpfade; Hardlinks und TrueNAS-Dataset-Grenzen beachten.
- Interne Dienstzugänge und API-Schlüssel automatisch erzeugen beziehungsweise
  über die unterstützte Erstinitialisierung des Dienstes beziehen.
- VPN wird separat aktiviert. Bei VPN-Ausfall darf qBittorrent keinen
  ungeschützten Internetzugang erhalten.
- Vorhandene Dienste zunächst einbinden und überwachen. Vollständige Übernahme
  ist eine spätere, ausdrücklich gewählte Aktion.
- Bestehende Daten und manuelle Einstellungen nicht ungefragt überschreiben.
- Unterbrochene Einrichtung gezielt fortsetzen.
- Updates bewusst starten und vorher Konfiguration sowie Datenbanken sichern.
- Beim Entfernen eines Dienstes dessen Daten standardmäßig behalten.

## Ansichten

Übersicht, Anwendungen, Stack konfigurieren, Verbindungen,
Sicherungen & Updates, Einstellungen.

## Vorhandener Prototyp und offene Grundlagen

Der [Sites-Prototyp](https://stackpilot-media-hub.caringbutton1.chatgpt.site)
ist laut Projektbeschreibung deutschsprachig, dunkel und klickbar. Er simuliert
Einrichtung und Betrieb; echte Docker-/Serveranbindung fehlt. Sein Quellcode
muss separat übernommen werden, alternativ wird die Oberfläche anhand dieses
Konzepts neu aufgebaut. Eine Übernahme ist noch nicht erfolgt.

Offen sind insbesondere die genaue TrueNAS-SCALE-Version, der unterstützte
Bereitstellungsweg für StackPilot, Hardware/GPU, vorhandene Datasets und ACLs,
bereits laufende Dienste sowie konkrete Jellyfin-Plugins. Diese Punkte hindern
die Modellierung und Simulation nicht, begrenzen aber Aussagen über echte
Plattformkompatibilität.

## Präzisierung: mühelose Einrichtung und Zugänge

Höchste Priorität ist das mühelose gemeinsame Installieren und Einrichten der
Apps. Sichere Vorgaben übernehmen technische Entscheidungen; der Wizard fragt
nur notwendige Angaben ab und bietet erweiterte Optionen bei Bedarf.

VPN wird schon im Installationswizard ausgewählt. Für Mullvad soll bevorzugt
eine WireGuard-Konfiguration sicher importiert oder über geführte Felder erfasst
werden. Erforderliche Felder hängen von der unterstützten Gluetun-Version ab;
Private Key, Tunneladresse und nötige Server-/DNS-Einstellungen werden geprüft.
Eine Mullvad-Kontonummer allein ist keine fertige WireGuard-Konfiguration.
Geheimnisse erscheinen weder im Gesamtplan noch in Protokollen im Klartext.
Verbindungsprüfung und Ausfallsperre gehören zum gemeinsamen Auftrag.

Notwendige Anwendungskonten werden, soweit vom Dienst unterstützt, automatisch
angelegt. Gewünscht ist möglichst derselbe sichtbare Benutzername und möglichst
nur eine Anmeldung beim Öffnen der Dienstoberflächen. Echte gemeinsame Anmeldung
(SSO) ist dienstabhängig und noch keine garantierte Fähigkeit aller Komponenten.
Gleiche Benutzernamen bedeuten weder SSO noch die Wiederverwendung eines Passworts.
Standard sind getrennte zufällige Dienstpasswörter; StackPilot bietet geschützte
Zugangsverwaltung für notwendige direkte Anmeldungen. Bestehende Konten werden
nicht ungefragt verändert. Fehlende Automatisierung wird vor Beginn erklärt.

Technische Hintergrundkonten/API-Schlüssel werden getrennt vom persönlichen
Administrator und mit minimalen Rechten eingerichtet, soweit der Dienst das
unterstützt. Host-/Containeridentitäten für Dateirechte sind davon getrennt;
es werden nicht pauschal interaktive Linux-Benutzer pro Anwendung erstellt.

## Zusätzliche Verbesserungsvorschläge

Diese Vorschläge sind noch keine implementierten Funktionen:

- Empfohlene Vorauswahl und verständliche Profile für Sprache, Qualität und
  Ressourcen, danach alle Details vor dem gemeinsamen Start prüfbar.
- Bedarfsabhängige Wizard-Felder mit sofortiger Zugangsprüfung; keine mehrfachen
  Eingaben derselben Information. Optionale Angaben später ergänzbar.
- Abschlussbericht mit geprüften Verbindungen, Dienstzugängen und verständlichen
  nächsten Schritten; Fehler mit konkreter Abhilfe und gezieltem Fortsetzen.
- Sichtbarer Sicherheitsstatus: offene Ports, VPN-Schutz, Sicherungsalter,
  veraltete Komponenten und begrenzte Berechtigungen.
- Transparente Herkunft: öffentliche Änderungslisten, versionierter Dienstkatalog,
  nachvollziehbare Releases und dokumentierter Umgang mit Sicherheitsmeldungen.
- Keine Telemetrie als Standard; Supportexport nur bewusst und vorab einsehbar,
  mit Maskierung von Zugangsdaten und persönlichen Informationen.
- Wiederherstellungsset mit verschlüsselter Konfiguration und dokumentierter
  Schlüsselaufbewahrung, damit ein Serverausfall nicht zur Neueinrichtung zwingt.


## Aktueller Ubuntu-Testserver: Diagnose und Altinstallationen

Der Gerätename in der Seitenleiste stammt vom geprüften Rechner. Ein lokaler
JSON-Serverbericht ist per CLI, optional beim App-Start und per App-Knopf mit
Vorschau/Download verfügbar. Er dient der technischen Weiterentwicklung;
keine automatische Veröffentlichung von Serverdetails auf GitHub.

Für diesen Testserver werden alte Medien-App-Installationen nicht mehr benötigt.
Sie sollen vor einer echten Neuinstallation gezielt abgelöst werden. Das ist
keine Freigabe zur pauschalen Datenlöschung oder zum Stoppen beliebiger anderer
Dienste. Ein späterer bestätigter Bereinigungsplan nennt Container/Dienste,
Portbelegung und Neustartmechanismen; Konfigurations- und Mediendaten bleiben
standardmäßig erhalten. Die App zeigt die Kandidaten und bietet inzwischen einen ausdrücklich
bestätigten, fortsetzbaren Ablöseauftrag für bekannte Docker-Mediendienste.
systemd-Dienste und externe Controller werden weiterhin nicht automatisch verändert.


## Umsetzungsstand des echten Piloten

Die fachlichen Anforderungen oben bleiben das Zielbild. Der freigegebene erste
Installationspfad umfasst derzeit Jellyfin, Streamystats, Sonarr, Radarr, Lidarr,
Prowlarr, Bazarr, Seerr und qBittorrent. qBittorrent darf nur mit VPN betrieben werden. Der experimentelle
Mullvad-Pfad importiert WireGuard geschützt und verlangt echte Tunnel- und
Ausfallsperrennachweise auf dem Zielserver vor dem Start des Downloadclients.
Diese echte VPN-Verbindung konnte in der Cloud nicht geprüft werden.
Die Apps werden gemeinsam eingerichtet und verbunden; getrennte Passwörter
werden durch StackPilot verwaltet. Bestehende verwaltete Stacks lassen sich über
denselben Assistenten erweitern. Die Erstinstallation verlangt neue Ordner;
fremde Konfigurationen werden nicht überschrieben oder übernommen. Übrige
Plugin-Installation, GPU, vollständige Sicherungen/Updates und TrueNAS bleiben offen.
