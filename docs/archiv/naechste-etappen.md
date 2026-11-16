# Nächste Etappen

## 1. Sicherer Alltag und aufgeräumte Oberfläche (umgesetzt)

- Downloads nur mit geschütztem VPN-Netzwerk; keine neue Ohne-VPN-Freigabe.
- Alte ungeschützte verwaltete Downloadclients anhalten und eine kontrollierte VPN-Umstellung ermöglichen.
- VPN-Zustand auch ohne geöffneten Browser überwachen.
- Nach abgeschlossener Einrichtung die Betriebsübersicht öffnen.
- Technische Diagnose, Installation und alte Aufträge unter Verwaltung bündeln.
- Warme dunkle Farbwelt mit Creme, Apricot, Salbei und Flieder.
- Erste echte Aktivitäten aus Jellyfin, ARR und qBittorrent anzeigen; unbekannt von leer unterscheiden.

## 2. Medien und Quellen (erste Umsetzung vorhanden)

- Suche, Details, Cover und Anfragen für Filme/Staffeln über Seerr.
- Torrent-Quellen aus dem Prowlarr-Katalog testen, speichern und aktivieren/deaktivieren.
- Anfragefortschritt anhand Medien-IDs und Download-Hashes verfolgen.
- Einzelne Downloads pausieren, geschützt fortsetzen und ohne Dateilöschung entfernen.
- Gespeicherter VPN-Ausfalltest mit dauerhafter Verriegelung und Wiederaufnahme.

Zur Abnahme auf Ubuntu: echter VPN-Ausfall, Wiederverbindung, Neustart, eigene
Indexer-Zugänge und ein bewusst gewählter vollständiger Medienlauf.
Noch offen: besondere Quellenformulare/Captcha,
Downloadprioritäten und eine längere Anfragehistorie mit Filterung.

## 3. Verlässlicher Betrieb

- Verständliche Problemursachen mit gezielten Reparaturen.
- Konsistente Sicherungen und geprüfte Wiederherstellung vor Updates.
- Speicherplanung, Benachrichtigungen und Wartungsfenster.
- Familienrollen, Jellyfin-Plugins und Hardwarebeschleunigung.

## Später

Musikanfragen, Bibliotheksbereinigung und weitere Server. Keine dieser Funktionen
wird in der Oberfläche als fertig oder erfolgreich simuliert ausgegeben.

## Weitere bestätigte Erweiterungen

- Umgesetzt: Anfragen abbrechen und archivieren; laufende Downloads separat behandeln und Dateien behalten.
- Jellyfin-Zuschauerkonten ohne Administratorrechte mit Bibliotheks-, Alters- und Downloadrechten.
- Einladungen, Anfragerechte und eingeschränkte Zuschauerrollen.
- Versionsgeprüfte Anfrageintegration in Jellyfin.
- Portable Musikbibliothek unter einem unabhängigen Musikordner; vorhandene Dateien zunächst nur einlesen.
- Musik-Tags, Cover und Duplikate mit Vorschau prüfen; keine ungefragten Dateiänderungen.
- Album-/Interpretenwünsche, exportierbare Wiedergabelisten und später ein Musikserverwechsel.
- Verfügbarkeitsbenachrichtigungen, Veröffentlichungskalender und Speicherübersicht je Bibliothek.
- Bereinigte Diagnoseexporte und nachvollziehbare Änderungen an Konten, Quellen und Anfragen.

Abgesehen von den als umgesetzt markierten Punkten sind diese Erweiterungen weiter offen.

Weitere vorhandene Funktionen: Quellenbearbeitung mit erneutem Test und
Konfigurationssicherung, Qualitätsprofile pro Film/Serie samt optionalem
Seerr-Standard, separates 1080p-Profil ohne Remux und nachvollziehbare Importdiagnose.
Die konkrete Importabnahme mit echten Mediendateien auf dem Zielserver steht aus.

### Vorgemerkt: externer Jellyfin-Zugriff

Optionaler Bereich „Externer Zugriff“ mit Tailscale Funnel, Verbindungsprüfung und
gezielter Deaktivierung. Zuerst unabhängig einrichten und testen. Funnel ist ein
öffentlicher HTTPS-Zugang und erzwingt selbst keine MFA- oder Gerätecode-Anmeldung
für Jellyfin-Besucher. Ein vorgeschalteter Zugriffsschutz muss ausdrücklich geplant
und mit Jellyfin-Clients getestet werden. StackPilot und ARR-/Download-Oberflächen
bleiben privat; keine automatische Veröffentlichung.

Der lesende Vorbereitungsbereich ist inzwischen vorhanden. Die konkrete öffentliche
SSO-/MFA- und Client-Abnahme ist in [externer-zugriff.md](externer-zugriff.md) beschrieben
und steht noch aus.


Die lokale Authentik-Vorbereitung, Sicherheitsstatus, verschlüsselte Sicherung,
isolierter Restore-Test, Administrator-Vorschau und Gerätewiderruf sind vorhanden.
Die private Verbindung von Jellyfin 12.4.0 mit SSO-Auth 4.0.0.4 und Authentik ist
jetzt mit MFA, begrenzten Bibliotheksrechten, gesperrter Passwortanmeldung, Quick
Connect und Gerätewiderruf in isolierten realen Diensten geprüft. Es wird kein
Microsoft-SDK installiert. Der private Konfigurationsdialog ist implementiert.

Die geführte Plugin-Bereitstellung mit Digestprüfung und deaktivierten
Plugin-Updates, ein fortsetzbarer lokaler Schutzauftrag sowie die unabhängige
Sitzungsprüfung gegen Administrator- und Nicht-SSO-Tokens sind implementiert.
Die private Serve-Steuerung setzt ausschließlich die beiden vorgesehenen
HTTPS-Routen und berücksichtigt Teilabbrüche ohne Reset.

Auf dem persönlichen Server wurden diese Änderungen noch nicht ausgeführt.
Als nutzerabhängige Schritte bleiben die tatsächliche Einrichtung im lokalen
StackPilot, Zuschauerkonten/MFA, private Anmeldung und Gerätetests. Danach folgen
öffentliche TLS-/Client-Abnahme und eine ausdrücklich freigegebene Funnel-Aktion.
Sicherungen sind auf Nutzerwunsch für diesen Schritt vertagt; ein produktiver
Ersatzserver-Import bleibt offen. Siehe
[sicherheitsabnahme.md](sicherheitsabnahme.md).


## Umgesetzt: Alltag und dauerhafter Start

Betriebsübersicht mit konkreten Aufgaben, Speicherwarnung und Sperre neuer
Anfragen bei kritischem Platzmangel; SQLite-Archiv, überprüfter Anfrageabbruch
mit Wiederaufnahme und bewusster Verwerfung; Größenwahl vor Filmanfragen sowie
nativer Radarr-Größenstandard; Änderungsverlauf ohne Secrets; begrenzte gemeinsame
Abfragen und vollständige ARR-Warteschlangen; Hardlinkprüfung pro gewählter
importierender App; systemd-Nutzerdienst-Vorbereitung und geordnetes Beenden.

Details und Prüfgrenzen: [Alltag](alltag-und-anfragen.md),
[Dauerbetrieb](dauerbetrieb.md). Die zentrale Seerr-Dienstanmeldung wurde nicht
in persönliche Familienkonten umgewandelt. Hintergrundintegrationen verwenden
weiterhin getrennte Tokens desselben Jellyfin-Dienstkontos. Eigene Konten mit
minimalen Berechtigungen sind noch kein fertiggestelltes Migrationspaket.

Weiter offen als Entwicklung: gemeinsame Worker-/Executor-Grenze, vollständige
Stack-Wiederherstellung und darauf aufbauende Updates, Rollen/Einladungen,
Benachrichtigungen, Downloadprioritäten/Zeitpläne, allgemeine Plugin-Verwaltung,
Musikpflege und erweiterte Quellenformulare. Zielserver-/Nutzerangaben benötigen
insbesondere GPU/Treiber, TrueNAS-Version, Kontenrechte, Anbieterzugänge und die
persönliche MFA-/Geräte-/Funnel-Abnahme. Sicherungen bleiben für die persönliche
Testphase wie gewünscht zurückgestellt.

## 9. November: Verbindungsdiagnose und Entwicklungsberichte

Die private HTTPS-Einrichtung prüft jetzt zusätzlich den tatsächlichen SSO-Weg
von Jellyfin zu Authentik; gesetzte Serve-Routen reichen nicht mehr als Erfolg.
Eine fehlende unterstützte Authentik-Basisadresse wird gezielt ergänzt,
abweichende Werte bleiben sichtbar gesperrt. Bereinigte Konfigurationsberichte
sind herunterladbar und während der Entwicklung ins autorisierte private
GitHub-Repository übertragbar. Details: [Diagnose und Entwicklung](diagnose-und-entwicklung.md).

Der konkrete Host-erfolgreich/Container-abgewiesen-Netzwerkfehler ist ohne den
neuen Bericht vom persönlichen Server noch nicht abschließend lokalisiert.
Es wird deshalb keine geraten pauschale Firewall-/DNS-Reparatur ausgeführt.

Die gezielte Reparatur ergänzt inzwischen bei Host-Erfolg/Container-Ablehnung
einen internen HTTPS-OIDC-Dienst ohne Hostport, mit Tailscale-Zertifikat und
automatischer Erneuerung. Echte Container-/TLS-/Wiederaufnahmetests sind vorhanden.
Die Zertifikatsberechtigung und der erfolgreiche SSO-Einstieg auf medienserver müssen
nach Aktualisierung bestätigt werden; es wurde nichts direkt am Zielserver geändert.

### Reparatur des Zertifikatsablaufs

Unbekannte `--min-validity`-Optionen älterer Tailscale-Clients erhalten einen engen
Legacy-Retry, ohne die Zertifikatsprüfung oder Mindestgültigkeit abzuschalten.
Fehlerursache und Schritt bleiben im Bericht erhalten. Bestehende eigene Aufträge
können ausdrücklich fortgesetzt und gestoppte/fehlende Hilfsdienste nach Prüfung
wiederhergestellt werden. Eine tatsächlich fehlende lokale Zertifikatsberechtigung
benötigt weiterhin eine bewusste lokale Administratorfreigabe; die App erteilt sich
keine Root-Rechte. Persönliche Anmeldung und Zielserver-Abnahme bleiben offen.
