# Geschützter Jellyfin-Zugriff mit Funnel

Stand: 0.4.0. Öffentliche Erreichbarkeit am Zielserver ist
noch gesondert abzunehmen; die Cloud-Tests erzeugen keine echte Freigabe.

## Bedienweg

Unter **Verwaltung → Externer Zugriff** zuerst die privaten Schritte abschließen.
Zuschauer in Authentik ohne Administratorrechte der Gruppe stackpilot-viewers
zuordnen. Beim ersten erfolgreichen SSO-Login entsteht die Jellyfin-Identität
mit dem Präfix spv_. Keine parallelen Passwortkonten für diese Zuschauer anlegen.

Im letzten Schritt **Öffentlich freigeben** die Voraussetzungen prüfen.
Der Server prüft aktuell die zugehörigen Container/Gateways, das SSO-Profil,
Authentik-MFA und Wiederherstellungsfaktoren, Basisadresse, den tatsächlichen
SSO-Verbindungsweg, lokale Administratorbeschränkung, Quick Connect und einen
bestandenen isolierten Authentik-Wiederherstellungstest.

Danach persönlich bestätigen:

1. Browser-Anmeldung als Zuschauer über Authentik mit MFA, richtige Bibliotheken.
2. Anmeldung am Handy über Quick Connect aus genau dieser Zuschauersitzung.
3. Wiedergabe und Spulen.
4. Widerruf einer Test-Gerätesitzung und Ablehnung der alten Sitzung.
5. Offline gesicherte MFA-Wiederherstellungscodes.

Smart-TV ist vorerst keine Freigabevoraussetzung. Gerätecodes sind keine eigene
MFA: Der zweite Faktor schützt die Browseranmeldung, aus der das Gerät
freigegeben wird. Gerätesitzungen bleiben bis Ablauf oder Widerruf nutzbar.

Nach Passwortbestätigung veröffentlicht StackPilot die bestehende, geprüfte
Authentik-Anmelderoute auf HTTPS 8443 und dann das geschützte Jellyfin auf 443.
Andere Dienste, lokale Bindings, SSH-, Firewall- und Tailnet-Regeln werden nicht
verändert. Bereits vorhandene lokale Zugangswege bleiben erhalten; dies richtet
keine zusätzlichen LAN-Zugänge oder Portweiterleitungen am Router ein.

## Öffentlicher Test

Auf dem Handy WLAN und Tailscale vorübergehend ausschalten. Die angezeigte
Jellyfin-Adresse über Mobilfunk öffnen, als Zuschauer per MFA anmelden und
Wiedergabe/Spulen testen. Ein lokaler Tailscale-Status ist kein Nachweis, dass
dieser externe Test erfolgreich war.

Funnel muss in Tailscale für den Server zugelassen sein. Fehlende lokale
Berechtigungen werden angezeigt; StackPilot führt kein sudo aus und ändert
keine Tailnet-Policy. Ohne bestätigte Berechtigung wird der Auftrag nicht als
erfolgreich angezeigt. Funnel-Bandbreitenlimits können Streaming begrenzen.

## Abschaltung und Störungen

**Öffentlichen Zugriff abschalten · privat behalten** nimmt beide eigenen
Freigaben zurück und erhält bzw. ergänzt die zuvor geprüften privaten
HTTPS-Routen. Das funktioniert ohne laufende Authentik-/Jellyfin-Prüfung und
ohne Medien-Relay. Es benötigt weiterhin einen funktionierenden
StackPilot-Zustand, lokale Tailscale-Berechtigung und eine freie Auftragssperre.

Während StackPilot läuft, prüft es seine aktive Freigabe nach 30 Sekunden und
danach alle fünf Minuten erneut. Nicht bestätigte Sicherheitsvoraussetzungen
oder eine nur teilweise aktive Freigabe führen zur Rücknahme. Diese Prüfung
ist keine lückenlose Überwachung und läuft nicht bei gestoppter Webapp.

Fremde oder zwischenzeitlich ausgetauschte Routen werden nicht überschrieben.
Bei nicht bestätigter Rücknahme muss der lokale Tailscale-Status geprüft werden.
Kein globales Serve-Reset und keine automatische Lockerung von MFA, TLS,
Issuer- oder Passwortschutz.

## Entwicklungstests

Die Fachtests umfassen Aktivierungsreihenfolge, persönliche Bestätigungen,
Konfigurationskonflikte, fehlende MFA/Sicherung, Teilfehler, private Rücknahme
bei Ausfall und wiederkehrende Prüfung. Die API-Zugangstests erfassen die neuen
Routen. Build und Frontend-Smoke-Test prüfen die Bedienung,
Bestätigungssperren und Desktop-/Mobilansicht mit isolierten API-Fixtures.
Diese Tests ersetzen keine echte Funnel- oder Client-Abnahme.
