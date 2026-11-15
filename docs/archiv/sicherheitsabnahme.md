# Externer Jellyfin-Zugriff: Umsetzung und Abnahme

Stand: 08.11.2026. Keine öffentliche Freigabe wurde aktiviert. Alle automatisierten
Prüfungen laufen in isolierten Cloud-Testinstanzen, nicht auf dem Ubuntu-Zielserver.

| Arbeitspaket | Implementiert / geprüft | Offen |
| --- | --- | --- |
| SSO-Plugin | Offizielles Archiv 4.0.0.4 mit SHA-256 geprüft; Laden, Controller und privater MFA-SSO-Ablauf unter Jellyfin 12.4.0 bestanden. Kein Microsoft-SDK. | Geführte Bereitstellung implementiert; Ausführung auf dem Zielserver steht aus. |
| Authentik-Sicherung | Verschlüsseltes Archiv mit eigener Passphrase; konsistenter Datenbankdump während kurzer Dienstpause; isolierter Wiederherstellungstest. | Sichere Kopie außerhalb des Servers und persönliche Aufbewahrung der Passphrase. Eine produktive Installation wird vom Test nicht ersetzt. |
| Anmeldung | Privater Jellyfin-SSO mit Authentik-MFA, signiertem ID-Token, Nonce, PKCE und Code-Replay-Schutz getestet; Administratorrichtlinien mit Vorschau lokal beschränkbar. | Abnahme am Zielserver einschließlich externem Proxy-Vertrauen. |
| Schutz-Gateway | Geführte Bereitstellung; unabhängige Sperre echter Administrator- und Nicht-SSO-Tokens, Passwort-/Reset-Sperren und Fortsetzung getestet. | Ausführung auf dem persönlichen Server und tatsächliche Geräte-/TLS-Abnahme. |
| Geräte | Tatsächlicher Jellyfin-Gerätewiderruf: altes Zuschauertoken wird danach abgewiesen. Administrationsgeräte bleiben geschützt. | Quick Connect samt Widerruf im Protokolltest bestanden; Wiedergabe mit den tatsächlichen Geräten bleibt offen. Authentik-Sitzungen separat in der privaten Verwaltung widerrufen. |
| Funnel | Frisch geprüfter Freigabeplan mit Zielports, privaten Diensten und verbleibenden Blockern. Keine Aktivierungsaktion bei fehlender Abnahme. | Tatsächliches öffentliches TLS, Proxy-Adressen, WebSockets, Wiedergabe, Rücknahme und Endgerätetests. |

## Sicherung bedienen

Unter Verwaltung → Externer Zugriff → **Authentik sichern & wiederherstellen**:

1. StackPilot-Passwort, eine separate Sicherungspassphrase (mindestens 16 Zeichen)
   und `OK` eingeben. Die Passphrase wird nicht gespeichert und darf nicht mit
   dem StackPilot-Passwort identisch sein.
2. Sicherung erstellen. Nur Authentik-Server und Worker werden kurz angehalten;
   die Datenbank bleibt für den konsistenten Dump erreichbar. Der Neustart wird
   auch bei einem Fehler versucht. Eine gespeicherte Wartungsmarkierung
   ermöglicht nach einer Unterbrechung **Lokalen Betrieb fortsetzen**.
3. Das verschlüsselte `.spbackup`-Archiv herunterladen und getrennt vom Server
   ablegen. Passphrase separat verwahren. Eine Sicherung nur auf derselben Platte
   ist kein Schutz gegen Serververlust.
4. Mit der Passphrase einen isolierten Wiederherstellungstest ausführen. Der Test
   stellt Daten und Schlüssel in einem eigenen Docker-Projekt ohne Hostports und
   ohne externes Netzwerk wieder her. Datenbankobjekte gehören dabei dem
   eingeschränkten Anwendungskonto. Erst nach Prüfung und Entfernen der
   Testinstanz wird der Test als bestanden gespeichert.

Das Format verwendet AES-256-GCM und scrypt (N=131072, r=8, p=1), zufälliges Salt
und Nonce sowie komprimierte Nutzdaten. Manipulierte Archive, falsche Passphrasen,
Links, Pfadtraversal, fehlende Dateien und abweichende Schutzkonfiguration werden
abgewiesen. Die Sicherung umfasst Authentik-Konfiguration, Datenbank, private
Schlüssel und die Dateien der Authentik-Daten-/Medienablage. Medienbibliotheken,
Jellyfin und der übrige Stack benötigen eigene Sicherungen.

Aktuelle Größenbegrenzung: 80 MiB Quelldaten einschließlich Datenbankdump und
128 MiB Formatgrenze. Größere Daten werden mit Fehlermeldung abgewiesen, niemals
still ausgelassen. Archive liegen privat unter `identity-backups`; temporäre
Testwiederherstellungen unter `identity-restore-*`. Beide sind von Git ausgeschlossen.
Ein fehlgeschlagenes Aufräumen wird als Fehler angezeigt; private Dateien bleiben
zur lokalen Prüfung erhalten.

Der Test startet vorübergehend vier zusätzliche Container und benötigt dafür
freien Arbeitsspeicher. Beim Schließen des Browser-Tabs läuft eine aktive Prüfung
serverseitig weiter. Nach einem Abbruch des Serverprozesses kann eine private
`sp-restore-*`-Testinstanz zurückbleiben. Vor einem erneuten Test muss sie lokal
geprüft und gezielt aufgeräumt werden; bestehende Produktionsdienste dürfen dabei
nicht entfernt werden. Der Status „läuft oder wurde unterbrochen“ bestätigt
keinen erfolgreichen Wiederherstellungstest.

Der Test ist keine Schaltfläche zum Überschreiben einer produktiven Installation.
Eine vollständige Migration auf einen Ersatzserver benötigt weiterhin einen
geprüften Importweg und passende StackPilot-Zustandsdaten.

## Administratoren und Geräte

**Konten und Geräte prüfen** lädt den tatsächlichen Jellyfin-Zustand. Eine
Vorschau nennt die noch extern berechtigten Administratoren. Nach erneuter
StackPilot-Passwortprüfung und `OK` ändert StackPilot ausschließlich deren
Fernzugriffsrecht; eine geänderte Vorschau muss neu geprüft werden. Vorherige
Richtlinien werden im verschlüsselten Vault gespeichert. Die Netzwerkoption für
allgemeinen Jellyfin-Fernzugriff wird dadurch nicht automatisch eingeschaltet.

Bei Geräten wird die tatsächliche Zuordnung aus `LastUserId` verwendet.
`/Devices?userId=…` beschreibt in Jellyfin zugängliche Geräte und ist kein
verlässlicher Eigentumsnachweis. Geteilte Geräte mit Administrator-Anmeldung
und unbekannte Kontozuordnungen bleiben geschützt. Zugangstokens gelangen nicht
in die Geräteübersicht. **Gerät abmelden** widerruft alle Jellyfin-Anmeldungen
auf dem ausgewählten Gerät und prüft anschließend, dass es verschwunden ist.

Quick-Connect-Codes dürfen ausschließlich aus einer bereits per MFA angemeldeten
Jellyfin-Sitzung bestätigt werden. StackPilot gibt keine Geräte mit seinem
technischen Administratorkonto frei. Ein Gerätecode ist selbst keine MFA.

## Freigabeplan

Geplant sind genau zwei HTTPS-Zugänge:

- `https://<gerät>.ts.net` → zusätzlich geschütztes Jellyfin-Gateway (Ziel erst nach aktueller Dienstprüfung; kein direkter Backend-Port).
- `https://<gerät>.ts.net:8443` → eingeschränktes Authentik-Login-Gateway auf dem
  lokalen Port 19080, ausschließlich auf Loopback gebunden.

Port 19000 (Authentik-Verwaltung), StackPilot, ARR-Dienste, Downloadclient und
Datenbank bleiben privat. Vorhandene Tailscale-Routen werden nicht zurückgesetzt.
Der Plan zeigt Blocker statt ausführbarer Freigabebefehle, solange SSO,
MFA-/Recovery-Einrichtung, Wiederherstellung und tatsächliche externe Client-Abnahme
nicht bestätigt sind. Diese Version enthält keine öffentliche Aktivierungsaktion.

## Reproduzierbare Prüfungen

- `npm test` und `npm run build`.
- `npm run test:identity`: reale Authentik-Installation, MFA, Logout/Cookie-Replay,
  Netzwerkabweichung, verschlüsselte Sicherung und isolierte Wiederherstellung.
- `npm run test:remote-security`: reale Jellyfin-12.4.0-Instanz, Administrator-
  Richtlinien, tatsächlicher Gerätewiderruf und abgewiesenes altes Zuschauertoken.
- `npm run test:identity:browser`: zusätzlich vollständiger Browser-OIDC-Ablauf.
  Dafür wird ein bereits vorhandenes Browser-Testwerkzeug verwendet; es wird
  nichts automatisch heruntergeladen. Bei extern installiertem Playwright kann
  `STACKPILOT_PLAYWRIGHT_MODULE` auf dessen vorhandene `index.mjs` zeigen;
  `CHROMIUM_PATH` wählt einen bereits installierten Chromium aus.

Der Browser spricht die reale isolierte Authentik-Instanz über das eingeschränkte
Gateway an. HTTPS-Test-URLs werden auf Loopback-Antworten abgebildet. Das prüft
Anmeldung und Protokoll, bestätigt aber keinen echten öffentlichen TLS-Handshake
oder aktiven Funnel. Testkonten und TOTP-Schlüssel sind ausschließlich künstliche
Fixtures. Aegis auf dem persönlichen Gerät und Samsung Tizen, Android, iPadOS und
Ubuntu müssen anschließend am Zielserver geprüft werden.


## Neue private SSO-Abnahme

Unter Verwaltung → Externer Zugriff ist ein geprüfter Konfigurationsdialog mit
gezielter Bibliotheksauswahl vorhanden. Fremde Anbieter, manuelle Änderungen,
veraltete Vorschauen und unsichere Kontoverknüpfungen werden abgewiesen.
Unterbrochene Bestätigungen werden ohne erneutes Überschreiben fortgesetzt.

Der native Integrationstest prüft MFA, ausgewählte Bibliotheken, verweigerte
Selbstvergabe von Administratorrechten, abgewiesene direkte Passwörter,
OAuth-State-Replay, Quick Connect und den tatsächlichen Gerätewiderruf. Er zeigt
außerdem die unsichere leere Passwortanmeldung eines absichtlich ungeschützten
Kontos direkt am Backend und deren Sperre am zusätzlichen Gateway. Das Profil
setzt den expliziten InvalidAuthProvider; das verwaltete Gateway blockiert auch
alternative und kodierte Passwort-/Reset-Endpunkte. Beide Schutzebenen sind vor
öffentlichem Betrieb erforderlich. Die geführte Gateway-Bereitstellung ist inzwischen implementiert; sie wurde noch
nicht auf dem persönlichen Zielserver ausgeführt.

- `npm run test:sso-load`: offizielles Plugin unter Jellyfin 12.4.0 laden.
- `npm run test:sso`: reale isolierte Authentik-/Jellyfin-MFA-Verbindung samt
  Gateway-, Bibliotheks-, Konfigurations- und Geräteprüfungen.

Beide Tests verwenden ein lokal vorhandenes offizielles ZIP über
`STACKPILOT_SSO_ARCHIVE` (Standard `/tmp/stackpilot-sso-4.0.0.4.zip`) und prüfen
seinen festgelegten SHA-256. Das Jellyfin-Image muss bereits lokal vorliegen;
kein automatischer SDK- oder Plugin-Download. Der vollständige Test verwendet
bestehendes Playwright über `STACKPILOT_PLAYWRIGHT_MODULE` und vorhandenen Chromium.
Testzertifikate gelten ausschließlich innerhalb der isolierten Fixture; die
Zertifikatsprüfung wird nicht deaktiviert. Browser-HTTPS wird im Testadapter auf
lokale Dienste abgebildet. Das bestätigt keine öffentliche Funnel-Verbindung.

Die persönliche Sicherung ist für diese Entwicklungsphase auf Nutzerwunsch
vertagt. Die öffentliche Aktivierung bleibt weiterhin gesperrt.

## Geführte Bereitstellung und unabhängige Sitzungsprüfung

Die Bereitstellung des festgelegten Plugin-Releases und des lokalen Schutz-Gateways
ist nun als fortsetzbarer Auftrag implementiert. Der native Integrationstest prüft
Installation, gezielten Jellyfin-Neustart, Datei-/Update-Schutz, Containerrechte,
Loopback-Bindung, Passwortsperren und wiederholte Ausführung ohne Überschreiben.
`npm run test:jellyfin-protection` führt diesen Test isoliert aus.

Das Gateway besteht aus Nginx und einer internen, zustandslosen Sitzungsprüfung.
Jeder erkannte Benutzertoken wird von Jellyfin selbst geprüft. Nur aktive
SSO-Zuschauer ohne Administratorrechte und mit dem gesperrten Passwortanbieter
werden zugelassen. Echte Administratortokens im Header oder als URL-Parameter
werden unabhängig von Jellyfins lokaler Proxy-Einordnung verweigert. Fehler und
unklare Konten schließen den Zugang. Kein Administratorschlüssel wird dafür an das
Gateway gegeben; es gibt keinen Token-Cache. Konkrete Client-Kompatibilität,
WebSockets und Wiedergabe müssen trotzdem am Zielserver abgenommen werden.

Die private Serve-Steuerung ist implementiert und mit simuliertem Tailscale-Zustand
auf fremde/öffentliche Routen, veraltete Vorschauen, gezielte Änderungen und
Fortsetzung nach Teilabbruch geprüft. Sie führt keine Funnel-Aktivierung oder
pauschalen Reset aus. Es wurde kein persönlicher Tailscale-Zugang verändert.
Ein tatsächlicher privater TLS-Handshake und die Abnahme mit den persönlichen
Geräten sind noch offen. Anleitung: [externer-zugriff.md](externer-zugriff.md).
