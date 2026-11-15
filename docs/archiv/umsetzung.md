# Erste Umsetzungsschritte

Status: Grundgerüst, echte Diagnose, Altstack-Ablösung sowie ein ausführbarer
Neun-Dienste-Installationspilot mit Anmeldung/Tresor sind implementiert.
Die nachfolgenden Ausbauschritte bleiben Zielbild; die validierten Zwischenstände
am Ende dieses Dokuments beschreiben den tatsächlichen Umfang.
Die gemeinsame Auswahl mit einem Gesamtauftrag bleibt in jeder Ausbaustufe
erhalten; schrittweise Adapterentwicklung wird nicht zur Einzelinstallation im UI.

## 1. Grundlagen und Plattformgrenze klären

Zuerst Ubuntu-Server-Version und isoliertes Testsystem festlegen. Docker Engine,
Compose, Dateirechte, Speicherstruktur und vorhandene Dienste erfassen; benötigte
Hoständerungen explizit in den Plan aufnehmen. Ubuntu ist die erste echte
Integrationsplattform. Die genaue TrueNAS-SCALE-Version und deren unterstützte
Docker-/App-, Dataset- und ACL-Schnittstellen werden für die anschließende
Portierung separat geklärt. Die offene NAS-Version blockiert Ubuntu-Tests nicht.

Sites-Quellcode separat übernehmen und auf Abhängigkeiten, Lizenz, Assets und
simulierte Zustände prüfen, sofern verfügbar. Andernfalls Oberfläche anhand des
Konzepts neu aufbauen. Fehlender Export blockiert die Domänenmodellierung nicht.

Abnahme: dokumentierter Installationsweg mit Versionsgrenzen und Testsystem;
geklärte Herkunft der Oberfläche. Noch keine behauptete Serverkompatibilität.

## 2. Grundgerüst, Modelle und simulierter Gesamtvorgang

TypeScript-Grundgerüst, gepinnte Werkzeuge, Lockfile, Format-/Typprüfung und CI
anlegen. Gemeinsame Schemas für Inventar, Sollzustand, Bindings, Pläne und
Aufträge definieren. Deterministischen Planer und persistentes Auftragsjournal
mit simulierten Adaptern erstellen. Die sechs Ansichten und den siebenstufigen
Assistenten auf diese API aufsetzen; Simulation deutlich kennzeichnen.

Wizard um persönliche Konten, technische Identitäten und sichere Eingabe bzw.
Import der Mullvad/WireGuard-Konfiguration ergänzen. Pro Dienst unterstützte
Kontoanlage und Authentifizierung sichtbar machen.

Abnahme: Alle Komponenten gemeinsam wählbar, „Alle auswählen“ vorhanden, VPN
separat. Eine Bestätigung erzeugt genau einen Gesamtauftrag. Fehlende externe
Zugänge und Abhängigkeiten sind vor Start sichtbar. Tests decken Auswahl,
Konflikte, wiederholte Planung, doppelte Bestätigung, Neustart nach Abbruch und
unzulässige Änderungen an eingebundenen Diensten ab.

## 3. Erster echter vertikaler Ablauf auf isoliertem Testsystem

Leseinventar und begrenzten Executor zunächst auf Ubuntu Server implementieren. Zunächst Sonarr, Radarr und
qBittorrent gemeinsam bereitstellen, initialisieren und automatisch verbinden.
Damit werden mehrere Komponenten, API-Schlüssel, Kategorien und gemeinsame
Datenpfade in einem Auftrag geprüft. Jellyfin anschließend einschließlich
Bibliotheken ergänzen. Nicht implementierte Adapter bleiben im echten Modus
sichtbar als nicht unterstützt und blockieren einen entsprechenden Plan.

Abnahme: gemeinsame Installation ohne manuelle Dienstkonfiguration; APIs melden
die erwarteten Downloadclients und Pfade. Ein lizenzfreier Testdownload und
Import prüfen den tatsächlichen Datenfluss samt Hardlink, sofern unterstützt.
Fehlerinjektion zwischen Erstellung und Checkpoint erzeugt beim Fortsetzen
keine Duplikate. Testdateien werden ausschließlich im isolierten Testbereich
erzeugt und entfernt. Fremde Container und Daten bleiben unverändert.

## 4. Vollständigen Katalog und Einbindung ergänzen

Prowlarr, Lidarr, Bazarr, Seerr, Streamystats und ausgewählte Jellyfin-Plugins
mit gepinnten Versionen und Funktionstests ergänzen. Externe Voraussetzungen
erfassen. Bestehende Dienste zunächst nur lesen/überwachen, später begrenzte
Verbindungskonfiguration erlauben; vollständige Übernahme getrennt entwickeln.

Abnahme: Eine Gesamtauswahl erzeugt sämtliche möglichen erwarteten Verbindungen.
Fehlende Partner werden erklärt. Tests unterscheiden beobachtete, eingebundene
und verwaltete Dienste; manuelle Konfiguration bleibt ohne Freigabe erhalten.

## 5. VPN, Hardware und Betrieb absichern

Gluetun/Mullvad schon im ersten Ubuntu-Pilot mit gewünschtem VPN integrieren;
VPN als Schutzvoraussetzung vor echten Downloads prüfen. Ausfalltests einschließlich Neustarts
und DNS durchführen. GPU-Fähigkeiten prüfen und Transcoding auf Testhardware
validieren. Sicherungs-/Wiederherstellungsablauf, bewusst gestartete Updates und
Entfernung mit Datenerhalt umsetzen. Dieselbe Planungslogik für spätere
Erweiterungen verwenden.

Abnahme: Bei VPN-Ausfall kein ungeschützter qBittorrent-Verkehr. Ein fehlgeschlagenes
Backup verhindert das Update. Wiederherstellung stellt Konfiguration und
Datenbanken konsistent wieder her. Entfernen behält Daten standardmäßig.

## Prüfstrategie und Freigabegrenzen

- Domänentests: Planabhängigkeiten, Eigentumsmodi, Drift, sichere Pfade und
  Konflikte; ohne Docker ausführbar.
- Integrationstests: echte Dienst-APIs gegen festgelegte Images, Wiederaufnahme
  und Journalpersistenz; isolierte Container und temporäre Daten.
- Oberflächentests: gemeinsamer Assistent, Gesamtplan, ein Auftrag,
  Teilfehler und Wiederaufnahme; Simulation und echte Ergebnisse unterscheiden.
- Plattformtests: genaue SCALE-Version, ACLs/Datasets, Hardlinks, GPU und VPN;
  erfordern einen passenden Testserver. Zuerst Ubuntu qualifizieren, danach TrueNAS.

Als erster Implementierungsauftrag eignet sich Schritt 2. Der genaue
TrueNAS-Versionsstand kann parallel geklärt werden; Schritt 3 startet auf Ubuntu.
Die NAS-Qualifizierung folgt anschließend mit eigenem Plattformadapter. Weder ein erfolgreicher UI-Test noch eine Docker-Simulation
ersetzt die Plattform- und VPN-Ausfallprüfungen.


## Priorität für den ersten nutzbaren Pilot

Der erste Pilot soll gemeinsame Auswahl, vollständige Grundkonfiguration,
automatische Verbindungen, persönliche/technische Konten und optional Mullvad
in einem Vorgang auf Ubuntu demonstrieren. SSO für alle Apps ist kein
Abnahmekriterium, solange die Dienste es nicht einheitlich unterstützen.
Abnahmekriterien sind stattdessen sichere automatische Kontoanlage, keine
Passwortwiederverwendung als Standard, transparente verbleibende Anmeldeschritte
und Schutz der Zugangsdaten. VPN-Ausfallprüfung ist bei gewähltem VPN Pflicht
vor Freigabe des Downloadbetriebs; sie wird nicht bis zum späteren Ausbau vertagt.


## Bereits validierter Zwischenstand

Die lesende API funktioniert im Entwicklungsmodus und über `npm start` mit dem
gebauten Frontend. Unit-/Dateisystemtests prüfen Erkennung, Fehlerzustände,
Systempfadschutz und Ablehnung fremder Ursprünge bzw. schreibender HTTP-Methoden.
Ein separater echter Docker-Integrationstest prüft Containererkennung,
Compose-Projekt und lesenden Mount ohne Export von Umgebungsgeheimnissen.
Browserprüfungen decken Gesamtauswahl, VPN-Auswahl, Simulation, Wiederaufnahme,
Host-/Speicherabfragen, Hauptnavigation und mobile Breite ab.

Diese Validierung läuft auf dem Cloud-Linux-System, nicht auf dem persönlichen
Ubuntu-Testserver und nicht auf TrueNAS. Die API liest lokal und nutzt CLI-Werkzeuge;
sie ist ein Zwischenstand vor der geplanten eigenständigen API-/Worker-Architektur.


## Ausführbarer Zwischenstand: Altstack-Ablösung

Ein lokaler, eng begrenzter Docker-Executor und ein persistentes SQLite-Journal
setzen bestätigte Ablösepläne um. Die alte Konfiguration wird nicht übernommen.
Erlaubte Änderungen sind Docker-Neustartregel deaktivieren, konkrete Container
stoppen und ohne Volumelöschung entfernen. Eigene neue Projektressourcen sind
unter `stackpilot` reserviert und nicht als Altstack auswählbar.

Die Oberfläche bietet Planvorschau, typisierte Bestätigung, Autostart-Erklärung,
Fortschritt, Pause und Wiederaufnahme. Tests prüfen Drift, Namespace-Abhängigkeiten,
Doppelklick/Idempotenz, Prozessneustart und den realen Erhalt von Volume-Inhalten.
Eine persistierte Installationsvorprüfung nennt reale Blocker; die unten
beschriebenen Dienstadapter ergänzen die bestätigte echte Installation.

Vollständige Sicherungen, Rücknahme und systemd-Bereinigung fehlen. Die inzwischen
implementierte Administratoranmeldung ergänzt Sitzung, CSRF-Schutz und Setupcode.


## Ausführbarer Zwischenstand: gemeinsame Neuinstallation

Der Pilot unterstützt Ubuntu 24.04/x86-64 mit neuem Daten-/Konfigurationsordner.
Jellyfin, Sonarr, Radarr, Lidarr, Prowlarr und qBittorrent werden in einem Auftrag
installiert, initialisiert und verbunden. Echte Dateischreib-/Hardlinkprüfung,
Login- und API-Verbindungstests gehören zum Job. Webports werden nach internem
Bootstrap freigegeben und anschließend erneut geprüft. Festgelegte Image-Digests,
private Zustandsdateien, Administratoranmeldung und verschlüsselte Secrets sind
implementiert. Ein interner API-Helfer ist Teil des geprüften Compose-Plans.

Reguläre Tests prüfen unter anderem Authentifizierung, AEAD-Integrität, Verlust
des Hauptschlüssels, Cookie-Formate, redigierte Fehler, Rechte und Wiederholbarkeit.
Ein eigener Docker-Integrationstest durchläuft Erstinstallation und Erweiterung
auf neun Dienste einschließlich abschließender Prüfung und räumt den Teststack auf.
Ein Browserdurchlauf hat Erstregistrierung, Mehrfachauswahl, echte Bestätigung,
Auftragsfortschritt, geschützte Passwortanzeige, Cookie-Isolation und Logout geprüft.
Diese Cloud-Tests ersetzen keine direkte Validierung auf `reatest` oder TrueNAS.

Offen bleiben die übrigen Dienste, GPU, externe Indexer und vollständige
Sicherungen/Wiederherstellung und Updates. Der folgende Abschnitt beschreibt
die inzwischen implementierten Erweiterungs- und VPN-Piloten samt Prüfgrenzen.


## Erweiterungs- und WireGuard-Pilot

Implementiert: wiederverwendbarer Auswahlassistent für zusätzliche freigegebene
Apps, stabile Stack-Identität, eingefrorene bestehende Containerdefinitionen,
neue Dienstinitialisierung und additive Verbindungen. Der Docker-Test installiert
zuerst fünf Dienste und ergänzt Lidarr, Bazarr, Seerr und Streamystats; er prüft unveränderte Container-IDs und
Passwörter sowie die neuen Verbindungen und die Ablehnung veralteter Pläne.

Implementiert: restriktiver Mullvad-WireGuard-Import, verschlüsseltes Profil,
Gluetun-Namespace für qBittorrent, feste DNS-Führung und deaktiviertes IPv6,
kontrollierter Ausfalltest vor dem Downloadclient und nachträglicher VPN-Umbau.
Unit-/Ablauftests prüfen, dass ein fehlender Ausfallsperrennachweis weder den
Downloadclient startet noch Webports veröffentlicht. Der echte Mullvad-Lauf ist
ohne TUN-Gerät und Kundenschlüssel in der Cloud nicht nachgewiesen; er wird auf
dem Zielserver zwingend vor dem Downloadclient durchgeführt.

Weiter offen: Jellyfin-Plugins, Indexer-Zugänge,
GPU-Transcoding, konsistente Vollsicherung/Wiederherstellung, bewusst gestartete
Updates, Entfernen verwalteter Dienste mit Datenerhalt, Fremdübernahme und TrueNAS.


## Drei Auswahlgruppen und vollständiger Dienstkatalog

Die gemeinsame Auswahl ist in Jellyfin & Erweiterungen (Jellyfin, Streamystats,
Seerr), ARR-Suite (Sonarr, Radarr, Lidarr, Prowlarr, Bazarr) und qBittorrent & VPN
aufgeteilt. Es bleibt ein Gesamtauftrag. Verwaltete Apps sind markiert und gegen
Abwahl/Neuinstallation gesperrt. Fremde erkannte Installationen sind gesperrt und
werden ausdrücklich von verwalteten Apps unterschieden. Gruppenweise und globale
Auswahl erhalten installierte Apps; die mobile Ansicht ist im Browser geprüft.

Bazarr wird mit Form-Anmeldung, zufälligem Passwort, API-Schlüssel, einheitlichem
Medienmount und Sonarr/Radarr eingerichtet. Seerr verwendet Jellyfin-Anmeldung,
einen eigenen technischen API-Schlüssel und geprüfte ARR-Profile/Pfade.
Streamystats verwendet eine persistente AIO-Datenbank, geschützte Laufzeitgeheimnisse
und einen eigenen Jellyfin-Gerätetoken. Die Funktionsprüfung unterscheidet
konfigurierte Konten/Verbindungen von tatsächlicher Medienwiedergabe,
Metadatenanfragen, Untertitelbeschaffung und Downloads. Plugins sind weiterhin
keine freigegebene Installationsoption.
