# Jellyfin über Tailscale vorbereiten

Stand: 0.2.0, private Einrichtung; keine automatische öffentliche Freigabe.
Unter **Verwaltung → Externer Zugriff** führt StackPilot durch acht einzeln
aufrufbare Schritte: Ausgangslage, Authentik, Konten & MFA, Jellyfin schützen,
SSO verbinden, Privates HTTPS, Eigene Geräte und Öffentlich planen.

Nur der gewählte Schritt ist geöffnet. Voraussetzungen sind direkt aufrufbar;
Zurück und Weiter ändern keine Konfiguration. Gespeicherte Konfiguration,
frische Verbindungsprüfung und persönliche Geräteabnahme bleiben getrennt.
Diagnose ist gezielt über **Diagnose & Berichte öffnen** erreichbar.

StackPilot liest Tailscale-Status, Serve-Routen und die Konfiguration des
verwalteten Jellyfin. Aktuelle Serveradressen werden für die gezielte
Geräteregel angezeigt; rohe Tailscale-Netzpläne, Kontonamen und API-Tokens
werden nicht an den Browser gegeben.

## Ziel und Grenzen

- Nur der geprüfte lokale Jellyfin-Webport ist ein mögliches Proxy-Ziel.
- StackPilot, ARR-Suite und Downloadclient bleiben außerhalb der Freigabe.
- Serve ist nur im Tailnet erreichbar. Tailscale-Konto-MFA und Gerätefreigabe
  ersetzen dabei nicht Jellyfins eigene Konten.
- Funnel ist öffentlich und vererbt den Besuchern keine Tailscale-Konto-MFA.
- Vorhandene abweichende Routen werden angezeigt, niemals pauschal zurückgesetzt.
- Die bestätigte Einrichtung kann genau zwei private Serve-Routen zum
  Jellyfin-Schutz-Gateway und Authentik-Login setzen. Sie aktiviert keinen Funnel.

## Vorgesehener öffentlicher Anmeldeweg

Der vorbereitete Weg für Browser und unterstützte native Jellyfin-Clients:

1. Versionsgeprüftes Jellyfin-Plugin SSO-Auth mit OIDC.
2. Identitätsanbieter mit tatsächlich erzwungener MFA, etwa Authentik mit einem
   verbindlichen MFA-Anmeldeflow. Der Identitätsanbieter muss für externe Browser
   erreichbar sein; diese notwendige Authentifizierung ist zusätzlich zum
   Jellyfin-Zugang zu planen. Kein allgemeiner Proxy auf StackPilot.
3. Neue, separate Zuschauer als SSO-Konten ohne Administratorrechte. Kein
   bekannter lokaler Passwortzugang als alternativer Weg am MFA-Flow vorbei.
4. Ein unterstützter TV-/Handy-Client zeigt seinen Quick-Connect-Code; die
   Freigabe erfolgt in der per SSO/MFA angemeldeten Browsersitzung.
5. Gerätesitzungen lassen sich widerrufen. Ein Gerätecode allein ist kein
   zweiter Faktor; bestehende Sitzungstokens bleiben eigenständige Zugänge.

Das SSO-Plugin dokumentiert Web- und Quick-Connect-Clients, nicht beliebige native
Clients. Im geprüften Quellstand verwendet es Jellyfin 10.11.0 / .NET 9. Vor einer
Installation sind Release, Integrität und die tatsächlich eingesetzte Jellyfin-
Version abzugleichen. Ein konfigurierter `defaultProvider` kann wieder einen
anderen Anmeldeweg eröffnen. Bestehende lokale Konten dürfen deshalb nicht als
SSO-only behandelt werden, nur weil das Plugin installiert ist.

## Abnahme vor Funnel

- Ein Browser muss über den Identitätsanbieter MFA nachweisen.
- Die konkreten TV-/Handy-Apps müssen Quick Connect unterstützen und erfolgreich
  zugelassen werden. Nicht unterstützte Apps benötigen einen gesonderten Weg,
  zum Beispiel privaten Tailscale-Zugriff, oder bleiben extern gesperrt.
- Direkte Anmeldung per Benutzername/Passwort darf den Schutz nicht umgehen.
- Administratoren und technische Konten bleiben lokal. Ihre Jellyfin-Richtlinien
  müssen effektiven externen Zugriff tatsächlich ablehnen.
- Proxy-Vertrauen und weitergeleitete Client-Adressen müssen am echten externen
  Zugriff geprüft werden; keine pauschale Freigabe aller Proxies/IP-Netze.
- Keine alternative direkte Portfreigabe, kein UPnP; Jellyfin bleibt hostseitig
  an Loopback gebunden. TLS, WebSockets, Wiedergabe und Spulen extern testen.
- Nach einem Widerruf müssen verlorene Gerätesitzungen tatsächlich unbrauchbar
  sein. Rücknahme der gezielten Jellyfin-Freigabe testen.

Die Statusprüfung bestätigt diese Abnahme nicht. Authentik, geprüftes Plugin,
Schutz-Gateway und private SSO-Verbindung lassen sich inzwischen gezielt
einrichten. Öffentliche Freigabe bleibt bis zur getrennten Abnahme gesperrt.

Quellen zur weiteren Umsetzung:

- https://tailscale.com/kb/1312/serve
- https://tailscale.com/kb/1223/funnel
- https://jellyfin.org/docs/general/server/quick-connect/
- https://github.com/9p4/jellyfin-plugin-sso
- https://github.com/tailscale/tailscale/blob/main/ipn/serve.go

## Gewünschte Geräte und erster Abnahmeplan

| Plattform | Geplanter Client | Dokumentationsstand / noch zu prüfen |
| --- | --- | --- |
| Samsung Tizen | Jellyfin-App | Version des mitgelieferten Jellyfin-Web-Builds und Quick Connect am TV prüfen. Tizen wird in der herangezogenen offiziellen Quick-Connect-Tabelle nicht separat aufgeführt. Keine Zusage ohne Gerätetest. |
| Android | Jellyfin Android | Quick-Connect-Anmeldung und Gerätefreigabe offiziell dokumentiert; App-Version und Ablauf testen. |
| iPadOS | Jellyfin Mobile oder Swiftfin | Beide iOS-Clients dokumentieren Quick Connect; konkrete installierte App und Version aufnehmen. |
| Ubuntu | Browser oder Jellyfin Media Player | Web und Media Player unterstützen laut Dokumentation Quick Connect; Browser-SSO zusätzlich testen. Jellyfin MPV Shim unterstützt laut dieser Tabelle kein Quick Connect. |

Für jede installierte App: Einmal mit MFA im Browser anmelden, einen neuen
Gerätecode freigeben, Wiedergabe/Spulen prüfen, Passwort-Bypass ablehnen und die
Gerätesitzung widerrufen. Die Clientliste ist ein Abnahmeplan, kein Nachweis bereits
funktionierender öffentlicher Zugriffe.

Dokumentationsgrundlage:
https://github.com/jellyfin/jellyfin.org/blob/master/docs/general/server/quick-connect.md


## Lokale Authentik-Einrichtung in StackPilot

Unter **Verwaltung → Externer Zugriff → Authentik** lässt sich
zunächst eine private Konfiguration vorbereiten und anschließend mit `OK` ein
Installationsauftrag starten. Voraussetzung ist ein abgeschlossener verwalteter
Medienstack und eine eindeutige, noch nicht öffentliche Tailscale-Konfiguration.
Ein unterbrochener Auftrag kann gezielt fortgesetzt werden. Geänderte
Konfigurationsdateien werden nicht überschrieben; ihre Prüfsummen müssen stimmen.

Vier Container laufen mit festgelegten Image-Digests, ohne Root, ohne zusätzliche
Capabilities und ohne Docker-Socket: PostgreSQL, Authentik-Server, Worker und
Login-Gateway. Das Datenbankkonto der Anwendung hat keine Superuser- oder
Rollenerstellungsrechte. Die interne Verbindung ist ein isoliertes Docker-Netz.
Nur das Gateway besitzt eine zusätzliche Netzwerkverbindung und veröffentlicht
zwei Ports, beide ausschließlich auf `127.0.0.1`:

- `19000`: private Authentik-Verwaltung und erstmalige MFA-Einrichtung.
- `19080`: eingeschränkter Login-Endpunkt für die spätere öffentliche Freigabe.
  Verwaltungsseiten, Benutzer- und Tokenverwaltung sowie private Anmeldeflows
  werden dort abgewiesen. Das ist derzeit nur lokal erreichbar.

Konfiguration, Daten und geheime Dateien liegen unter dem privaten
`identity-secrets`-Verzeichnis der StackPilot-Datenablage und sind von Git
ausgeschlossen. Geheimnisse werden zusätzlich im vorhandenen verschlüsselten
Vault gespeichert; eine private Ablage ist keine Datensicherung. Dateien mit
Zugangsdaten gehören auch in privaten Repositories nicht auf GitHub.

Erst nach erfolgreicher lokaler Prüfung erscheint die geschützte Anzeige des
anfänglichen `akadmin`-Zugangs. Sie verlangt erneut das StackPilot-Passwort und
blendet die Zugangsdaten nach einer Minute aus. Der private Administratorflow
verlangt die Einrichtung eines zweiten Faktors; TOTP kann beispielsweise in
Aegis hinterlegt werden. Die spätere Zuschaueranmeldung verweigert Zugang, wenn
noch kein zweiter Faktor eingerichtet ist. Zuschauer benötigen eine ausdrückliche
Gruppenzuordnung; Administratoren erhalten keine Freigabe für die Jellyfin-OIDC-App.

Die OIDC-Vorlage erlaubt nur den Authorization-Code-Flow, einen festen Callback
und kurzlebige Tokens. Passwort-, Client-Credentials- und Refresh-Token-Grant
sind nicht vorgesehen. Quick Connect bleibt eine Gerätefreigabe aus einer bereits
authentifizierten Sitzung und ersetzt selbst keine MFA.

**Noch offen vor Funnel:** Plugin-Bereitstellung auf dem Zielserver, geschütztes
Jellyfin-Gateway, tatsächliches Proxy-Vertrauen, externe Administrator-Sperre und
Tests mit Samsung Tizen, Android, iPadOS und Ubuntu. Die private Protokollabnahme
mit Jellyfin 12.4.0 ist bestanden; sie ersetzt diese Zielserver-Abnahme nicht.
Weder Serve noch Funnel werden durch die private SSO-Konfiguration aktiviert.

`npm run test:identity` führt einen separaten Docker-Integrationstest mit
wegwerfbaren Testkonten aus. Er verändert keine Tailscale-Routen und benötigt
zusätzlich zum laufenden Medienstack genügend RAM für die isolierte Testinstanz.

## Sicherheitsstand und Abmeldung

Nach der lokalen Einrichtung steht **Sicherheitsstand prüfen** zur Verfügung.
Die Prüfung liest den aktuellen Zustand statt einer gespeicherten Erfolgsmeldung:

- Private Dateien, Containerrechte, tatsächliche Loopback-Ports und Bereitschaft.
- Internes Docker-Netz einschließlich Subnetz und fester Adresse des vertrauten
  Gateways; zusätzliche Netze an Server oder Worker werden abgewiesen.
- Erreichbarkeit des Login-Dienstes und Sperre der Verwaltungsseiten am Gateway.
- Verpflichtende MFA-Regeln und bestätigte TOTP-/WebAuthn-Geräte für aktive
  Administratoren und Zuschauer der vorgesehenen Gruppe.
- Verbleibende Wiederherstellungscodes je Kontogruppe, ohne Codes, Gerätenamen,
  Kontonamen oder Sitzungstokens an den Browser zu übertragen.
- Vollständiger Authentik-Abmeldeflow mit einer User-Logout-Stage.

Null vorhandene Administratoren oder Zuschauer gelten nicht als erfolgreich
abgesichert. Wiederherstellungscodes allein zählen nicht als eingerichtetes
primäres MFA-Gerät. Die Anzeige bestätigt auch keine Offline-Kopie der Codes und
keinen vollständigen Wiederherstellungstest. Nach einer fehlgeschlagenen Prüfung
blendet die Oberfläche den vorherigen Ergebnisstand aus.

Neue Konfigurationen verwenden Sicherheitsvorlage v2. Deren Abmeldeflow beendet
die Authentik-Sitzung serverseitig. Der Integrationstest meldet einen Testnutzer
an, meldet ihn ab und versucht anschließend, die vorherige Sitzung erneut zu
verwenden. Die alte Sitzung muss abgewiesen werden. Bereits ausgegebene
Jellyfin-Gerätesitzungen oder OAuth-Tokens sind davon getrennt; die vollständige
anwendungsübergreifende Abmeldung und der Gerätewiderruf stehen weiterhin aus.

Bestehende vorbereitete Konfigurationen bleiben unverändert, auch wenn eine
neuere Vorlage vorliegt. Fehlender Logout wird im Sicherheitsstatus als Blocker
angezeigt. Ein automatisches Überschreiben bestehender Authentik-Konfigurationen
oder ein stilles Umstellen bereits verwendeter Konten ist nicht vorgesehen.

## Private SSO-Verbindung: geprüfter Stand

Das offizielle SSO-Auth-Archiv 4.0.0.4 ist inzwischen verfügbar. Sein SHA-256 lautet
`c09f16ba31059a434ddd7f811e4f9608d4b4c4514cc80a5bf1ca33bee61e1107`.
Obwohl das Manifest Ziel-ABI 10.11.0.0 nennt, lädt das unveränderte Plugin unter
Jellyfin 12.4.0; seine Controller und der vollständige private Anmeldeweg wurden
mit realen isolierten Diensten getestet. Kein Microsoft-SDK wurde benötigt.

Die Standardkonfiguration darf nicht übernommen werden: Bei neu angelegten
SSO-Konten ließ sich mit leerem Passwort ein Jellyfin-Token erhalten. StackPilot
setzt deshalb ausdrücklich `Jellyfin.Server.Implementations.Users.InvalidAuthProvider`.
Zusätzlich muss vor jeder öffentlichen Freigabe ein vorgeschaltetes Gateway
Passwortanmeldung und Passwort-Reset sperren, auch während der Kontoanlage.
Das verwaltete Gateway besteht entsprechende Alias-/Encoding-Tests gegen ein
absichtlich ungeschütztes Testkonto; seine Ausführung auf dem Zielserver fehlt noch.
Quick Connect bleibt für die Gerätefreigabe erreichbar.

Der private Verbindungsdialog prüft den aktuellen Zustand, verlangt ausgewählte
Bibliotheken, erneute StackPilot-Anmeldung und `OK`. Er übernimmt keine fremden
Anbieter oder bestehenden Zuschauer mit dem reservierten Präfix `spv_`.
Manuelle Änderungen werden erkannt. Eine unterbrochene Bestätigung kann nur bei
exakt passender gespeicherter Konfiguration fortgesetzt werden. OIDC-Geheimnisse
werden ausschließlich serverseitig verwendet. Der Callback verwendet HTTPS ohne
explizites Standardport-Suffix; Zertifikatsprüfung bleibt eingeschaltet.

Vor der persönlichen Anmeldung einen separaten Authentik-Zuschauer ohne
Administratorrechte der Gruppe `stackpilot-viewers` zuordnen und privat MFA
einrichten. Das vorhandene Authentik-Administratorkonto ist kein Zuschauerkonto.
Backups wurden auf Wunsch für diese Entwicklungsphase zurückgestellt.

## Geführte Plugin- und Gateway-Bereitstellung

Unter **Verwaltung → Externer Zugriff → Jellyfin schützen**
stehen jetzt Vorschau, Einrichtung und gezieltes Fortsetzen zur Verfügung. Der
Auftrag läuft serverseitig weiter, während der Browser geschlossen werden kann.
Er benötigt die erneute StackPilot-Passwortprüfung und `OK`.

Der Auftrag lädt ausschließlich das festgelegte offizielle SSO-Archiv über HTTPS.
SHA-256 und Metadaten werden vor jedem Entpacken geprüft. Nur die vier bekannten,
größenbegrenzten Dateien werden geschrieben; ZIP-Pfade werden niemals verwendet.
Es werden keine SDKs oder neuen Entwicklungsabhängigkeiten installiert. Ein schon
manuell installiertes Plugin wird nicht still übernommen oder ersetzt.

Die Installation deaktiviert automatische Plugin-Updates. Die DLLs bleiben an
die geprüften Hashes gebunden. Jellyfins normale Metadaten-Normalisierung wird
akzeptiert, Änderungen an Version, ID, Assembly-Liste oder Updatefreigabe dagegen
nicht. Bereits vorhandene Dateien und Gateway-Konfigurationen werden nicht
überschrieben. Nach einer Unterbrechung wird ihr Zustand erneut verglichen.

Nur der eindeutig zugeordnete, laufende Jellyfin-Container wird bei einer neuen
Plugin-Installation neu gestartet. Medien und andere Dienste bleiben erhalten.
Das separate Schutzprojekt verwendet zwei Dienste ohne Root-Rechte, zusätzliche
Capabilities oder Docker-Socket:

- Nginx veröffentlicht ausschließlich `127.0.0.1:19096`.
- Die interne Sitzungsprüfung hat keinen Hostport und benötigt weder einen
  Administratorschlüssel noch einen Token-Cache. Sie lässt Jellyfin den aktuellen
  Token über `/Users/Me` prüfen und akzeptiert ausschließlich aktive SSO-Zuschauer
  mit `spv_`-Präfix und gesperrtem Passwortanbieter. Administratoren, kontolose
  API-Schlüssel, gewöhnliche lokale Konten und unklare Antworten werden abgewiesen.

Passwortanmeldung, Passwort-Reset und nicht benötigte SSO-Verwaltungsrouten sind
zusätzlich am Gateway gesperrt. WebSockets benötigen eine geprüfte Sitzung. Bei
Ausfall der Sitzungsprüfung wird der Zugang verweigert. Der Dienst protokolliert
keine Tokens; Nginx-Access- und HTTP-Fehlerlogs sind deaktiviert. Die aktuelle Prüfung kontrolliert
Dateihashes, Images, Benutzer, Rechte, Mounts, Netze und Loopback-Ports sowie die
Passwort- und Host-Sperren. Der native Test weist zusätzlich die unabhängige
Ablehnung echter Administratortokens im Header und als `ApiKey` nach.

Das ist noch keine öffentliche Geräte-/Proxy-Abnahme. Eine Authentik-Abmeldung
oder das Entfernen einer Gruppenzuordnung widerruft bestehende Jellyfin-Tokens
nicht automatisch; verlorene Geräte müssen in Jellyfin separat abgemeldet werden.

## Private HTTPS-Routen gemeinsam einrichten

Nach Schutz-Gateway und privater SSO-Konfiguration kann **Privates HTTPS im
Tailscale-Netz** genau zwei Serve-Routen einrichten:

1. HTTPS 443 → geschütztes Jellyfin auf `127.0.0.1:19096`.
2. HTTPS 8443 → eingeschränktes Authentik-Login auf `127.0.0.1:19080`.

Die Vorschau zeigt beide Ziele. Eine vorhandene direkte private Jellyfin-Route
kann dabei gezielt durch das Schutz-Gateway ersetzt werden. Fremde oder öffentliche
Routen, temporäre Serve-Konfigurationen und parallele Änderungen werden abgewiesen.
Es wird niemals `tailscale serve reset` oder ein Funnel-Befehl ausgeführt. Bei
einem Teilabbruch bleiben bestätigte private Routen bestehen; eine neue Vorschau
ergänzt nur die fehlende Route. Die vorherige Konfiguration liegt im privaten Vault.

Tailscale muss dem lokalen StackPilot-Prozess Serve-Berechtigungen und die
Zertifikatsbereitstellung erlauben. Diese Aktion bestätigt die lokale
Tailscale-Konfiguration, nicht den TLS-Handshake oder eine erfolgreiche Anmeldung
von einem persönlichen Gerät. Für Jellyfin zeigt die Oberfläche den direkten
SSO-Einstieg `/sso/OID/start/stackpilot`. Native Geräte werden anschließend mit
Quick Connect aus einer bereits mit MFA angemeldeten Zuschauersitzung freigegeben.

Funnel bleibt deaktiviert. Die getrennten Zuschauerkonten, persönliche MFA,
Gerätetests und die abschließende externe Abnahme benötigen weiterhin den Nutzer.

## Gerätezugriff gezielt eingrenzen

**Eigene Geräte** trennt den Servernachweis vom Zugriff eines Laptops, Handys
oder Fernsehers. Ein Tailscale-Pong bestätigt keinen Zugriff auf TCP 443/8443;
auch erfolgreiche Serverprüfungen bestätigen nicht den Gerätezugriff.
Eine aktive eingehende Tailscale-Sperre wird zusätzlich angezeigt.

Bei Bedarf entsteht eine Grant-Vorlage aus ausdrücklich eingegebenen
Geräteadressen und der aktuell erkannten Serveradresse. Sie erlaubt ausschließlich
TCP 443/8443. Es werden keine persönlichen Beispieladressen übernommen und keine
Tailscale-Regeln automatisch geändert. Vor dem Einfügen in die bestehende Policy
Ziel und Quellen prüfen; vorhandene Regeln beibehalten. Eine Vorlage ist kein
Nachweis der effektiv wirksamen Regeln.
