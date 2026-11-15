# Verbindungsprüfung und temporäre Entwicklungsberichte

Stand: 10. November 2026, Version 0.2.0. Diese Funktionen aktivieren keinen Funnel.

## Was automatisch geprüft und ergänzt wird

Unter **Verwaltung → Externer Zugriff** und im letzten Einrichtungsschritt:

- Die private HTTPS-Einrichtung verwaltet weiterhin ausschließlich Jellyfin auf
  443 → Loopback 19096 und Authentik-Login auf 8443 → Loopback 19080.
  Eine direkte verwaltete Jellyfin-Route kann gezielt ersetzt werden.
- Gesetzte Serve-Routen sind jetzt nur ein Teilnachweis. StackPilot prüft das
  OIDC-Discovery-Dokument über HTTPS vom Server und ruft den echten SSO-Einstieg
  am Jellyfin-Schutz-Gateway auf. Nur eine passende Weiterleitung zum erwarteten
  Authentik-Anmeldeendpunkt gilt als erfolgreicher Jellyfin-Verbindungsnachweis.
- Server HTTP 200 bei gleichzeitigem Fehler aus Jellyfin ist ausdrücklich ein
  blockierter Zustand. DNS, Verbindungsablehnung, TLS und OIDC werden soweit
  anhand begrenzter lokaler Daten unterscheidbar als Kategorien angezeigt.
  Rohlogs und vollständige Redirect-URLs werden niemals übertragen.
- Die Namensauflösung wird zusätzlich im tatsächlichen Jellyfin-Container
  gelesen. Ein fehlendes Diagnosewerkzeug wird als unbestätigt ausgewiesen.
- Eine leere Authentik-System-Basisadresse wird beim bestätigten HTTPS-Auftrag
  auf `https://<eigener-ts-host>:8443` ergänzt, sofern diese Authentik-Version
  das SystemSettings-Modell unterstützt. Abweichende Adressen bleiben erhalten
  und sperren den fertigen Einrichtungsstatus. Nicht unterstützte ältere Versionen
  werden gekennzeichnet, nicht per geratenem Datenbankschema verändert.

StackPilot eskaliert nicht selbst zu Root. Fehlende Tailscale-Schreibrechte
benötigen weiterhin eine lokale Administratoraktion. Das Lesen von Serve-Status
beweist diese Rechte nicht. Eine Host-/Container-Netzwerkabweichung führt nicht
zur pauschalen Änderung von Firewall, Host-DNS, Docker-Netzen, TLS-Prüfung oder
Containerrechten. Erst konkrete Befunde erlauben eine gezielte weitere Reparatur.
Persönliche MFA, Wiedergabe, Quick Connect und Gerätewiderruf bleiben Gerätetests.

## Umfang des Entwicklungsberichts

**Verbindung prüfen & Entwicklungsbericht** bietet Prüfung, JSON-Download und
bei aktivierter Entwicklungspolicy und lokaler Freigabe direkten GitHub-Upload.
Im Einrichtungsassistenten sind diese Werkzeuge über **Diagnose & Berichte öffnen**
erreichbar; zusätzlich unter **Verwaltung → Diagnose**. Der Bericht enthält:

- Das bisherige Serverinventar mit Hardware, Speicher, Mounts und Ports.
- Verwaltete Auswahl, Daten-/Appdata-Pfade, Ports und Auftragszustand.
- Tailscale-/Routenstatus und bekannte lokale Ziele; unbekannte Ziele werden
  lediglich als `other` gekennzeichnet.
- SSO-/Plugin-/Gateway-Nachweise, Basisadresszustand und aggregierte MFA-/
  Wiederherstellungszahlen für Administratoren und Zuschauer.
- Getrennte Host-/Jellyfin-Verbindungsprüfungen und aufgelöste Netzwerkadressen.
- Ausgewählte native ARR-Profilregeln, Rootfolder, aktivierte Downloadclients,
  Such-/RSS-Einstellungen und Gesundheitsfehlerzahl; Prowlarr-Quellstatus,
  qBittorrent-Speicher-/UPnP-Einstellungen und Seerr-Profilzuordnungen.

Das ist bewusst kein ungefilterter Export aller Dateien: keine Passwörter,
API-Schlüssel, Cookies, MFA-Secrets, Wiederherstellungscodes, Umgebungsvariablen,
Kontonamen, Medien-/Torrentlisten oder Rohlogs. Fehlerhafte/unlesbare Abschnitte
werden als unbestätigt markiert; andere Abschnitte bleiben nutzbar. Der Bericht
ist eine Momentaufnahme, kein Backup und keine Sicherheitsgarantie.

## GitHub-Upload während der Entwicklung

Die enge Entwicklungspolicy liegt unter `dev-private/report-policy.json` und
begrenzt Uploads auf das private Repository `max-lec4000/stackpilot`, HTTPS und
den Branch `main`. Zusätzlich ist seit 0.2.0 auf jeder Installation eine eigene
lokale Freigabe erforderlich. Sie ist standardmäßig aus, auch wenn die Policy
im geklonten Repository aktiv ist. Die Freigabe wird ausschließlich in der
lokalen Zustandsdatenbank gespeichert. Das schützt andere Installationen davor,
versehentlich Diagnosedaten in das Entwicklungsrepository zu übertragen.

Unter **Verwaltung → Diagnose → Entwicklungsberichte mit GitHub teilen** lässt
sich die Freigabe erteilen und widerrufen. Policy deaktivieren oder löschen
beendet die Uploadfunktion ebenfalls. Der Bereich `dev-private/` ist temporär;
Löschen entfernt veröffentlichte Dateien nicht aus der Git-Historie.

Nach einem bestätigten privaten HTTPS-Auftrag wird bei aktiver Policy und lokaler
Freigabe ein Bericht versucht, auch bei blockiertem Verbindungsweg. Scheitert der Upload, wird keine
Einrichtung zurückgerollt und keine Upload-Erfolgsmeldung ausgegeben. Der Bericht
bleibt lokal unter `.stackpilot/development-reports/` bzw. dem gewählten
`STACKPILOT_STATE_DIR`. Ein fehlgeschlagener Einrichtungsaufruf behält seinen
ursprünglichen Fehler, selbst wenn die zusätzliche Diagnose ebenfalls scheitert.

Auf dem Zielserver:

```sh
npm run report:dev
```

Erstellt den erweiterten Bericht. Ohne lokale Freigabe bleibt er lokal; mit
Freigabe wird er nach `dev-private/reports/` hochgeladen. Freigeben und einen
Bericht hochladen:

```sh
npm run report:dev -- --enable-upload
```

Die lokale Freigabe widerrufen:

```sh
npm run report:dev -- --disable-upload
```

Unabhängig von der Freigabe nur lokal, ohne Upload:

```sh
npm run report:dev -- --local
```

Dafür muss der ausführende Nutzer bereits Git-Schreibzugriff auf das private
HTTPS-Repository besitzen. StackPilot fragt keine GitHub-Tokens im Browser ab
und legt keine neuen Zugangsdaten ab. Fehlende Git-Berechtigungen sind einmalig
lokal einzurichten; die vorhandene Authentifizierung wird verwendet.

Der Upload erzeugt mit separatem Git-Index einen Commit direkt auf dem aktuellen
entfernten `main`. Er nimmt ausschließlich die neu erzeugte JSON-Datei auf und
ändert weder Arbeitsbaum noch vorgemerkte Änderungen oder den lokalen Branch.
Kein `git add .`, kein Force-Push. Parallele Änderungen führen gegebenenfalls zu
abgewiesenem Push; eine erneute Berichtserstellung baut auf dem neuen Stand auf.
Ein späteres `git pull --ff-only` übernimmt auch die Bericht-Commits lokal.

## Prüfungen

`npm test`, `npm run build`, `npm run test:report-upload` und
`npm run test:runtime` decken Fehlerprojektion, fehlende/abweichende Basisadresse,
Host-erfolgreich/Jellyfin-fehlgeschlagen, Secret-Auslassung, isolierten echten
Git-Push sowie authentifizierte Bericht-API mit fehlender Docker-Anbindung ab.
Die Browserprüfung deckt Diagnose, Upload/Download, Bestätigung und schmale
Ansichten mit simulierten APIs ab. Authentiks versionsabhängiges SystemSettings-
Modell sowie die persönliche Tailscale-/Jellyfin-Verbindung benötigen weiterhin
den tatsächlichen Nachweis auf dem Zielserver; sie werden nicht durch einen
Cloud-Test als erledigt dargestellt.

## Gezielter interner HTTPS-Weg bei Tailscale-Rückverbindungsfehlern

Der Bericht vom 9. November, 20:52 Uhr Wien, bestätigt gleiche DNS-Auflösung am
Host und in Jellyfin, erfolgreiche Host-Verbindung und abgewiesene Verbindung
aus Jellyfin. Für genau diese Kombination kann der bestätigte private HTTPS-
Auftrag jetzt einen verwalteten OIDC-Backchannel ergänzen:

- Ein eigener gehärteter Nginx-Container ohne Hostport, ohne Root/Capabilities,
  mit schreibgeschütztem Dateisystem und festgelegtem Image-Digest.
- Ausschließlich das geprüfte Mediennetz und Authentiks geprüftes Ingress-Netz.
  Im Mediennetz erhält der Dienst den Alias des eigenen Tailscale-Hostnamens.
  Jellyfin muss deshalb nicht neu erstellt und sein SSO-Profil nicht umgestellt
  werden. Host-DNS, Firewall und öffentliche Routen bleiben unverändert.
- Echtes HTTPS auf Port 8443 mit einem durch `tailscale cert` angeforderten
  Zertifikat für genau diesen Hostnamen. Keine Ausnahme bei TLS, Issuer oder
  Token-Prüfung. Browser erreichen Authentik weiterhin über Tailscale Serve.
- Nur Discovery, JWKS, Token und Userinfo werden zum verifizierten Login-Gateway
  weitergegeben. Verwaltungs- und sonstige Pfade antworten mit 404.
- Zertifikat und Schlüssel liegen ausschließlich unter dem privaten
  `identity-secrets/oidc-…`-Verzeichnis, außerhalb von Git und Berichten. Der
  Bericht enthält nur Nachweis, Ablaufdatum und Wartungszustand.
- Der laufende StackPilot-Server prüft nach Start und stündlich den eigenen
  Dienst; unter 14 Tagen Restgültigkeit fordert er ein Zertifikat mit mindestens
  14 Tagen Gültigkeit an. Die Erneuerung wird vor dem Reload geprüft. Ein
  unterbrochener eigener Zertifikatswechsel kann anhand gespeicherter alter/neuer
  Prüfsummen fortgesetzt werden. Fremde Dateiänderungen werden verweigert.

Ist der StackPilot-Benutzer nicht zur Zertifikatsanforderung berechtigt, bleibt
nur diese Reparatur blockiert. StackPilot führt kein sudo aus. Die Oberfläche
zeigt bei einem eindeutig klassifizierten Berechtigungsfehler eine engere,
einmalige lokale Freigabe für die tatsächlich verwendete Benutzer-ID:

```sh
sudo systemctl edit tailscaled
```

Im Editor ergänzen, bestehende Einträge beibehalten und eine bereits anderweitig
verwendete `TS_PERMIT_CERT_UID` zuerst prüfen (Beispiel UID 1000):

```ini
[Service]
Environment=TS_PERMIT_CERT_UID=1000
```

Danach `sudo systemctl restart tailscaled` aus einer lokalen oder LAN-Sitzung;
der Neustart unterbricht Tailscale kurz. Das erlaubt nur den Zertifikatsabruf
für diese lokale Benutzer-ID. Vollständige Operatorrechte sind dafür nicht nötig.
Es wird keine solche Änderung aus der App ausgeführt.

Tailscale 1.60–1.70 unterstützt `--min-validity` noch nicht. Nur wenn genau diese
Option ausdrücklich unbekannt ist, versucht StackPilot den Zertifikatsabruf
noch einmal ohne dieses Flag. Die zurückgegebenen Dateien müssen trotzdem zum
Host und zueinander passen und mindestens 14 Tage gültig sein. Berechtigungs-,
TLS-, Netzwerk- und andere Optionsfehler erhalten keinen solchen Fallback.
Ein abgewiesener Abruf wird nicht mehr pauschal als Rechteproblem bezeichnet.

Angefangene eigene Reparaturen können nach Bestätigung auch bei einem späteren
TLS-/DNS-/unbekannten Fehler fortgesetzt werden. Die enge Bedingung
Host-erfolgreich/Container-abgewiesen gilt weiter für die Erstellung eines neuen
Hilfsdienstes. Gestoppte/fehlende eigene Dienste werden nur bei ausdrücklicher
Reparatur aus geprüften Dateien gestartet; stündliche Wartung hebt einen Stop
nicht auf. Fremde Container oder manuelle Änderungen werden nicht übernommen.

Berichte und Oberfläche behalten `stage`, `lastFailure.code`, Zeit und feste
Fehlerhinweise auch bei fehlendem Container. Keine Rohfehlermeldungen oder
Zertifikatsinhalte werden dafür gespeichert oder übertragen. Die native Prüfung
deckt nun zusätzlich fehlgeschlagenen Abruf/Wiederaufnahme, explizites Starten,
gezieltes Neuerstellen und verweigerte Containerdrift ab.

Quellen zur Tailscale-Kompatibilität und Zertifikatsfreigabe:

- https://github.com/tailscale/tailscale/blob/v1.60.0/ipn/ipnserver/server.go
- https://github.com/tailscale/tailscale/blob/v1.90.0/ipn/localapi/cert.go
- https://github.com/tailscale/tailscale/blob/v1.72.0/cmd/tailscale/cli/cert.go

Der erfolgreiche Nachweis des Hilfsdienstes allein bestätigt noch keinen Login:
StackPilot ruft nach der Reparatur den tatsächlichen Jellyfin-SSO-Einstieg erneut
auf. Bleibt dieser fehlerhaft, bleibt die Einrichtung blockiert. Persönliche MFA,
Gerätewiedergabe und externe Abnahme bleiben zusätzlich erforderlich.

`npm run test:oidc-backchannel` prüft den echten gehärteten Container mit einem
synthetischen IdP, gültigem Test-CA-Vertrauen, abgewiesenem fremdem Zertifikat,
gesperrten Verwaltungspfaden, Idempotenz, unterbrochener Schlüsselerneuerung und
verweigerter manueller Änderung. Das ist kein Test gegen den persönlichen
Tailscale-Daemon und keine vollständige erneute Jellyfin-/Authentik-Abnahme.
