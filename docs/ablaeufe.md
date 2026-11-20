# Abläufe im Alltag

Kurz und der Reihe nach: was wann wo zu tun ist. `<server>` ist die Adresse deines
Servers im Heimnetz, `<server>.<tailnet>.ts.net` seine Tailscale-Adresse.


## Navigation (ab Phase 7.0b)

StackPilot ist nach Aufgaben gegliedert: **Zuhause**, **Medien** (Entdecken, Musik),
**Anfragen** (Meine Anfragen, Freigabe je Zuschauer), **Downloads**, **Personen**
(Zuschauer), **Qualität & Quellen** (Medienprofile, Quellen), **Speicher** (Aufräumen),
**Couchdeck** und **System** (Apps & Container, Updates & Sicherungen, Zugriff & Netzwerk,
VPN & Ausfallsperre, Verbindungen, Diagnose, Auftrags- und Änderungsverlauf, Über
StackPilot, Stack konfigurieren). Alte Lesezeichen (`#/verwaltung/…`) leiten weiter.


### Zuhause: Braucht Aufmerksamkeit (ab 7.2c)
Die Startseite listet, was gerade zu tun ist – jeweils mit Knopf direkt auf die passende
Seite: wartende Freigaben, Downloads mit Problemen, angehaltenes qBittorrent, Auffälligkeiten
des Docker-Wächters, Speicher, VPN, Verbindungen, Quellen. Dieselben Punkte erscheinen als
Hinweis oben rechts, sobald sie neu auftauchen. Der Zähler des Docker-Wächters beginnt bei
jedem Neustart des Wächters neu.
## Zuschauer

### Jemanden einladen
1. StackPilot → **Personen → Zuschauer** (je Zuschauer eine Karte; der Fernzugriff selbst
   wird einmalig unter **System → Zugriff & Netzwerk** eingerichtet).
2. Benutzernamen eintippen (3–32 Zeichen, Kleinbuchstaben, Ziffern, `-`, `_`) → **Einladen**.
3. Angezeigt werden einmalig Adresse, Benutzername und Startpasswort → **Kopieren** und der
   Person schicken → **Notiert – ausblenden**. Das Passwort ist danach nirgends mehr gespeichert.

### Erste Anmeldung (macht die eingeladene Person)
1. Die Adresse `https://<server>.<tailnet>.ts.net/sso/OID/start/stackpilot` öffnen.
2. Benutzername und Startpasswort eingeben.
3. Eine Authenticator-App (z. B. Aegis, Google Authenticator) mit dem angezeigten QR-Code
   verbinden und den Code eingeben. Direkt danach wird einmal ein neuer Code verlangt.
4. Zugriff bestätigen → die Person ist in Jellyfin angemeldet.

### Fernseher, Handy, Tablet anmelden (Quick Connect)
1. In der App (Jellyfin, Streamyfin, …) als Server `https://<server>.<tailnet>.ts.net`
   eintragen – **ohne** Pfad.
2. **Quick Connect** wählen; die App zeigt einen sechsstelligen Code.
3. Im Browser, in dem die Person angemeldet ist: Profilbild → **Quick Connect** → Code eingeben.
4. Das Gerät bleibt angemeldet, bis es abgemeldet oder widerrufen wird. Benutzername und
   Passwort direkt in der App funktionieren für Zuschauer absichtlich nicht.

Im Heimnetz geht auch `http://<server>:8096` + Quick Connect, dann aber nur zu Hause.

### Jemand hat das Handy mit der Authenticator-App verloren
**Neu einladen** auf der Karte des Zuschauers → mit **OK** bestätigen → neues Startpasswort,
zweiter Faktor wird neu eingerichtet. Bereits angemeldete Fernseher und Tablets bleiben angemeldet.

### Ein Gerät abmelden (verloren, verkauft)
**Personen → Zuschauer** → auf der Karte **Geräte** aufklappen → **Abmelden** → **OK**. Die App
muss sich danach neu anmelden (Quick Connect). Sind auf dem Gerät weitere Zuschauer angemeldet,
nennt die Rückfrage sie – sie werden mit abgemeldet. Geräte von Administratorkonten sind geschützt.

### Altersfreigabe
**Personen → Zuschauer** → auf der Karte **Altersfreigabe** (z. B. „bis FSK 12“) wählen, bei
Bedarf **Filme und Serien ohne Altersangabe ausblenden** → **Speichern**. Jellyfin wendet das
sofort an, auch auf schon angemeldeten Geräten; die Einstellung bleibt bei späteren
Anmeldungen erhalten. Nur für Zuschauer, die sich schon einmal angemeldet haben.

### Zuschauer entfernen
**Entfernen** auf der Karte des Zuschauers → mit **OK** bestätigen: Konto in Authentik
deaktiviert, Authentik-Sitzungen beendet. Bereits angemeldete Jellyfin-Apps bleiben
angemeldet – deshalb vorher auf derselben Karte unter **Geräte** abmelden.

## Couchdeck (Bildschirm am Server)

- Starten/Schließen: StackPilot → **Couchdeck**, oder im Couchdeck-Menü
  „Ausschalten“; wieder an durch Controller einschalten oder Bildschirm aus/an.
- Läuft nur, wenn ein Bildschirm angeschlossen und eingeschaltet ist.
- Neu verbinden (z. B. nach Neuinstallation von Jellyfin): **Verbindung erneuern**.
- Aktualisieren: erscheint als Knopf, wenn eine neuere Couchdeck-Version mitgeliefert wird.
- YouTube verlangt eine Bestätigung: Couchdeck wechselt zuerst selbst zwischen IPv4 und
  IPv6. Sind beide gesperrt, erscheint ein Dialog mit großem QR-Code und den Auswegen
  **Über VPN versuchen** (bei VPN im Stack, 6 Stunden über den Tunnel, StackPilot leitet
  über `vpn-probe` weiter) und als letzte Möglichkeit **Bei YouTube anmelden**
  (Kreuz = nächstes Feld, A = bestätigen, Y = Tastatur, ☰ = fertig). An-/Abmelden auch
  unter Einstellungen → YouTube.

## Verwaltung

### Admin-Arbeiten in den Diensten
StackPilot → **Anwendungen** → Dienst öffnen. Zugangsdaten: **Details → Zugang anzeigen**
(verlangt das StackPilot-Passwort). Das Jellyfin-Admin-Konto funktioniert nur im
Heimnetz, nicht über die HTTPS-Adresse.

### StackPilot aktualisieren
**System → Updates & Sicherungen → Neue Version prüfen → Installieren**. StackPilot startet kurz neu,
Medien-Container laufen weiter.

### Docker-Wächter
StackPilot spricht Docker nur über den Docker-Wächter an (eigener Dienst
`stackpilot-docker-guard`). Er lässt nur die nötigen Aufrufe durch; neue Container dürfen nur
die Datenordner des Stacks einbinden. Anzeige: **System → Updates & Sicherungen →
Docker-Wächter** (Modus, Zahl der Aufrufe, letzte Verstöße, erlaubte Ordner).

- Nach Installation oder Update steht er auf **Beobachten**: Er protokolliert nur, was er
  sperren würde. Erst wenn dort über einige Tage – mit Updates, Wartung und Sicherungen –
  „0 wären gesperrt worden“ steht, **Jetzt sperren** drücken. StackPilot startet dabei neu,
  und das Serverkonto von StackPilot verliert die Gruppe `docker` (`docker …` dort dann nur
  noch mit `sudo`).
- Lockern oder ausschalten geht nur am Server:
  `sudo /opt/stackpilot/app/deploy/docker-guard.sh observe` bzw. `off`; Zustand:
  `… docker-guard.sh status`. Ein ausgeschalteter Wächter bleibt auch nach Updates aus.
- Die Zähler beginnen nach jedem Neustart des Wächters neu; Verstöße stehen zusätzlich im
  Journal: `journalctl -u stackpilot-docker-guard`.

### Dienstschlüssel erneuern

Unter **System → Apps & Container → Dienst → Details → API-Schlüssel erneuern** das
StackPilot-Administratorpasswort eingeben. Die Aktion steht für Bazarr,
Lidarr, Sonarr, Radarr, Prowlarr und Seerr zur Verfügung. Lidarr, Sonarr,
Radarr und Prowlarr starten beim Wechsel kurz neu.

StackPilot aktualisiert bei Lidarr die verwaltete Prowlarr-Verbindung.
Bei Sonarr und Radarr übernimmt es den Schlüssel für die zugeordneten
Verbindungen in Prowlarr, Seerr und Bazarr. Bei Prowlarr aktualisiert
StackPilot die zugeordneten Indexer in Sonarr, Radarr und Lidarr.
Seerrs eigener Wechsel aktualisiert auch eine ältere, per Schlüssel
verbundene Couchdeck-Installation. Persönliche Seerr-Sitzungen werden
weiterverwendet. Für Schlüssel aus der Seerr-Umgebungsvariable
`API_KEY` ist die Installationskonfiguration maßgeblich.

Meldet StackPilot einen unterbrochenen Wechsel, dieselbe Aktion
erneut ausführen. Externe Verbraucher müssen den neuen Schlüssel
separat erhalten.

Unter **System → Apps & Container → Jellyfin → Details** lässt sich der Dienstzugang
für Couchdeck, Seerr oder Streamystats einzeln erneuern. StackPilot
prüft zuerst den neuen Zugang beim Dienst und widerruft anschließend
den bisher dort verwendeten Token. Der Streamystats-Schritt gilt
für das integrierte und geprüfte StackPilot-Image. Ein laufendes
Couchdeck startet nach seiner eigenen Token-Erneuerung neu.

### Zugriff von unterwegs
- Einrichten: im Assistenten „Von unterwegs“ wählen oder später unter
  **System → Zugriff & Netzwerk → In einem Schritt einrichten**.
- Öffentlich (ohne Tailscale): **Öffentlich über das Internet (Funnel)** – braucht das
  Funnel-Recht in der Tailscale-Policy, gesicherte Authentik-Verwaltung und eine geprüfte
  Sicherung. Abschalten geht dort jederzeit („privat behalten“).

### Authentik-Verwaltung (akadmin)
Vom eigenen Rechner: `ssh -N -L 19000:127.0.0.1:19000 <benutzer>@<server>`, dann
`http://127.0.0.1:19000`. Zugang zeigt StackPilot unter **Externer Zugriff →
Authentik-Verwaltung**.

## Sicherungen

### Authentik
**Externer Zugriff → Authentik sichern** → Sicherung mit eigener Passphrase erstellen →
herunterladen → **Wiederherstellung isoliert testen**.

### StackPilot-Tresor (alle Dienstzugänge, VPN-Profil, Zuschauerverwaltung)
Liegt in `/var/lib/stackpilot` (vor allem `state.sqlite` + `master.key`, nur zusammen
brauchbar). Kopie auf den eigenen Rechner – konsistent, ohne StackPilot anzuhalten:

```sh
ssh <server> 'set -e; T=$(mktemp -d); /opt/stackpilot/node/bin/node -e "const s=require(\"node:sqlite\");s.backup(new s.DatabaseSync(\"/var/lib/stackpilot/state.sqlite\",{readOnly:true}),process.argv[1])" $T/state.sqlite; tar -C /var/lib/stackpilot --exclude=./state.sqlite --exclude=./state.sqlite-journal -cf - . | tar -C $T -xf -; tar -C $T -czf - .; rm -rf $T' > stackpilot-tresor-$(date +%F).tar.gz
```

Die Datei enthält alle Geheimnisse **unverschlüsselt** → nur auf verschlüsseltem Datenträger
ablegen oder z. B. `gpg -c stackpilot-tresor-….tar.gz` und das Original löschen.

## Downloads und VPN
- Downloads laufen nur, wenn Mullvad und die Ausfallsperre nachgewiesen sind. Fällt das
  VPN aus, hält StackPilot die Torrents an; **Downloads → Geschützt fortsetzen** prüft neu.
  Hat die Ausfallsperre qBittorrent ganz angehalten, sagt die Downloads-Seite das oben und
  bietet **Geschützt fortsetzen** direkt an (startet qBittorrent nach erneuter VPN-Prüfung).
- **Downloads → Braucht Aufmerksamkeit**: hängende oder blockierte Downloads aus Radarr und
  Sonarr mit Ursache in Alltagssprache (z. B. „Keine Quellen“, „Nur ein Beispielvideo“,
  „Keine importierbaren Dateien“) und den Original-Meldungen zum Aufklappen.
  **Import erneut prüfen** lässt Radarr/Sonarr fertige Downloads neu ansehen (harmlos).
  **Anderen Treffer suchen** → **OK** (nur mit VPN): Download entfernen, Treffer sperren,
  automatisch Ersatz suchen – Dateien dieses Downloads werden gelöscht, schon Importiertes
  bleibt. Jeder Download in der Liste zeigt außerdem, zu welchem Film bzw. welcher Serie er gehört.
- **Downloads → Seeding und Geschwindigkeit**: Seedingziel (Verhältnis und/oder Stunden; leer =
  kein Ziel), danach **anhalten** oder **aus qBittorrent entfernen (Dateien bleiben)**;
  Download-/Upload-Limit in KiB/s (0 = unbegrenzt); **Zeitplan** zum Drosseln (Von/Bis,
  täglich/werktags/Wochenende, gedrosselte Werte). **Speichern** → Zusammenfassung → **OK**;
  StackPilot liest die Werte aus qBittorrent zurück. „Samt Dateien löschen“ gibt es absichtlich
  nicht – ein noch nicht übernommener Download wäre sonst weg.
- VPN-Test: **System → VPN & Ausfallsperre → Prüfauftrag starten**.
- VPN je Dienst: **System → VPN & Ausfallsperre → VPN je Dienst**. Pro Dienst ein
  Auswahlmenü: **qBittorrent** (Gluetun) – Umstellen nach „OK“: neue Dateien, Gluetun/
  qBittorrent/vpn-probe neu erstellen, Mullvad-Ausgang und Ausfallsperre prüfen, sonst
  kommt die alte Config zurück (Downloads ruhen ca. 30 s bis 2 min). **YouTube in
  Couchdeck**: automatisch (alle freien Configs, wechselt bei Sperre), eine feste Config
  oder den qBittorrent-Tunnel mitnutzen. Eigener YouTube-Tunnel über wireproxy
  (WireGuard im Benutzerraum, nur lokaler Proxy mit Zugang). Die Config von qBittorrent
  steht für YouTube nicht zur Wahl – zwei Tunnel mit demselben Schlüssel stören sich.
- WireGuard-Configs: darunter mehrere `.conf` auf einmal importieren (Name aus dem
  Dateinamen) und nicht genutzte entfernen. Mullvad erzeugt je Geräteschlüssel Configs
  für viele Standorte; die Liste zeigt „Schlüssel 1, 2, …“. Configs mit dem Schlüssel von
  qBittorrent sind Standort-Alternativen für qBittorrent. Ein eigener YouTube-Tunnel
  braucht einen zweiten Schlüssel (im Mullvad-Konto neuen Schlüssel erzeugen, bis 5).
- Updates (StackPilot und Container) brauchen kein Passwort mehr: Zielversion prüfen,
  „OK“ oder „Abbrechen“.
- Neue Quelle (Indexer): **Qualität & Quellen → Quellen** → Anbieter wählen → testen → speichern.
- **Untertitel**: **Qualität & Quellen → Untertitel** → Sprachen ankreuzen (z. B. Deutsch,
  Englisch) → Anbieter wählen (ohne Konto: eingebettete Untertitel, Gestdown für Serien,
  YIFY für Filme; **OpenSubtitles.com** mit kostenlosem Konto hat die meisten deutschen) →
  optional „auch für vorhandene ohne Untertitelprofil“ → **Speichern** → **OK**. StackPilot
  legt in Bazarr ein eigenes Sprachprofil „StackPilot“ an und macht es zum Standard für neue
  Filme und Serien; andere Profile und Anbieter bleiben. Der Vorzustand wird einmalig gesichert.

## Neue App ins Projekt aufnehmen (Entwicklung)
1. Image mit Digest in `packages/catalog/services.json`.
2. Beziehungen in `packages/domain/apps.js` (`requires`, `linksTo`, `group`).
3. Adapter: Bereitschaft, Grundkonfiguration, Verbindungen; Partner-Adressen und
   -Schlüssel über `Services.linksFor(name)`.

## Stack konfigurieren und Umstellungen prüfen

Im Hauptmenü öffnet **Stack konfigurieren** den Assistenten. Wenn ein
bestehender Stack noch die gemeinsame Docker-Netzwerkstruktur nutzt, erscheint
auf der Übersichtsseite **Verwaltung** der Hinweis **Anstehende Umstellung**.
**Plan für Netztrennung öffnen** führt direkt zum Plan mit der gespeicherten
App-Auswahl. Dort kannst du den Plan prüfen und den Neustart der betroffenen
Container bestätigen. Anschließend verschwindet der Hinweis.

## Anmeldesperre in StackPilot

Nach fünf Fehlversuchen sperrt StackPilot weitere Versuche von derselben
Quell-IP für 15 Minuten. Ein erfolgreicher Versuch setzt den Zähler dieser
Adresse zurück. Das gilt auch für die erneute Passwortabfrage bei Aktionen
wie dem Anzeigen von Dienstzugängen.

Direkt verbundene Geräte mit unterschiedlichen IP-Adressen haben eigene
Zähler. Geräte hinter derselben sichtbaren Adresse teilen sich einen Zähler.
Das gilt auch für SSH-Tunnel, die sich jeweils über dieselbe Loopback-Adresse
mit StackPilot verbinden. Jellyfin und seine Geräteanmeldung laufen separat.

## Bazarr-API-Schlüssel erneuern

Öffne unter **System → Apps & Container → Bazarr → Details** den Bereich
**Bazarr-API-Schlüssel erneuern**. Gib dein StackPilot-Administratorpasswort ein
und bestätige den Wechsel. Die Erfolgsmeldung erscheint, sobald Bazarr den
neuen Schlüssel akzeptiert und den bisherigen ablehnt.

StackPilot speichert den neuen Schlüssel im Tresor. Externe Anwendungen
bekommen ihn bei Bedarf aus den Einstellungen von Bazarr. Bazarrs eigene
Anmeldung und seine Verbindungen zu Sonarr und Radarr bleiben erhalten.
Nach einem unterbrochenen Wechsel kannst du dieselbe Aktion erneut ausführen.

## Automatische Größenlimits für eine Serie

Öffne unter **Meine Anfragen** die Details der Serie und klappe
**Größenlimits für diese Serie** auf. Gib das gewünschte Limit pro
Folgenrelease, pro Staffelpaket oder für beides ein. Aktiviere **Auch
automatische Downloads in Sonarr begrenzen** und speichere. Sonarr nutzt
für diese Serie eine Kopie ihres bisherigen Profils mit den zusätzlichen
Größenregeln. Die bisherige Qualitätsreihenfolge und die Bewertung
zulässiger Treffer bleiben erhalten.

Die Grenzen betreffen die von Sonarr gemeldete Größe des gesamten
Releases. Bei einer Doppelfolge zählt die gemeinsame Größe. Laufende
Transfers werden nicht neu bewertet.

Entferne das Häkchen und speichere, um zum bisherigen Sonarr-Profil
zurückzukehren. Die Größenlimits für gezielte Downloads aus StackPilot
und Couchdeck bleiben dabei gespeichert. Leere beide Felder und
speichere, wenn du auch diese Limits entfernen möchtest. Wenn du für
die Serie ein anderes Qualitätsprofil auswählen willst, schalte das
automatische Limit zuerst aus. Danach kannst du es mit dem neuen
Profil wieder aktivieren.

## Mediencontainer aktualisieren und zurückwechseln

Unter **System → Updates & Sicherungen → Container-Updates und
Rückkehr** zeigt StackPilot für Sonarr, Radarr, Lidarr, Prowlarr, Bazarr
und Seerr abweichende, per Digest festgelegte Versionen aus dem
Dienstkatalog. **Update vorbereiten** und mit dem Administratorpasswort
bestätigen. StackPilot lädt bei Bedarf das Ziel-Image, stoppt den Dienst,
sichert dessen Konfigurationsordner und prüft den gestarteten Dienst.

Bei einem Prüffehler versucht StackPilot automatisch, zur bisherigen
Version samt Konfiguration zurückzukehren. Nach einem erfolgreichen
Update geht das auch per **Vorherige Version wiederherstellen**. Der
vor der Rückkehr aktuelle Konfigurationsordner bleibt als `after-update`
in der privaten Sicherung unter `<Appdata>/.stackpilot-container-backups/`
erhalten. Änderungen seit dem Update werden im laufenden Dienst durch
den vorherigen Stand ersetzt. Die Rückkehr ist an den aktuellen
Installationsplan gebunden und benötigt das bisherige lokale Docker-Image.
Bei einem abgebrochenen Wartungsvorgang lässt sich die Rückkehr hier erneut
anstoßen.

Bei geschütztem Jellyfin müssen beide Images für die Authentik-Anmeldung
abgenommen sein. StackPilot verlangt für den Wechsel die bestätigten privaten
HTTPS-Routen. Bei aktivem Funnel oder Streamyfin-Gateway bleibt die Wartung
gesperrt. Nach dem Start prüft StackPilot das Schutz-Gateway, die Sperre der
alternativen Anmeldewege und den SSO-Einstieg zu Authentik. Der Wechsel sichert
Jellyfins Konfiguration einschließlich seiner Datenbank. Medien bleiben
schreibgeschützt eingebunden. Eine neue Katalogversion erscheint erst zur
Auswahl, wenn deren Image mit der geschützten Anmeldung abgenommen wurde.

## StackPilot-Tresor verschlüsselt herunterladen

Öffne StackPilot direkt am Server oder über SSH. Beispielsweise leitet
`ssh -N -L 5174:127.0.0.1:5173 benutzer@server` den Browserzugriff über
`http://stackpilot.localhost:5174` an den Server. Im StackPilot-Menü
**System → Updates & Sicherungen → StackPilot-Tresor sichern**
das Administratorpasswort und eine eigene Sicherungspassphrase eingeben.
Die Datei endet auf `.spvault` und enthält eine konsistente Kopie von
`state.sqlite` und den dazugehörigen `master.key`. Medien und die
Konfigurationsordner der Dienste werden separat gesichert.

Die Passphrase getrennt aufbewahren. Auf dem Server oder einem anderen
Rechner mit Node.js 24 und einer StackPilot-Quellkopie lässt sich das
Archiv in einen neuen, privaten Ordner entpacken und prüfen. Im
StackPilot-Quellordner ausführen:

```bash
read -r -s -p 'Sicherungspassphrase: ' backup_phrase
printf '\n'
printf '%s\n' "$backup_phrase" | node scripts/verify-vault-backup.mjs ~/stackpilot-tresor-DATUM.spvault ~/tresor-wiederhergestellt
unset backup_phrase
```

Der Zielordner muss neu sein. Er enthält nach der Prüfung den
unverschlüsselten Hauptschlüssel und die Datenbank. Entschlüsselte
Prüfkopien privat behandeln und nach Gebrauch entfernen.

Für eine bestehende Installation in der Oberfläche **Tresor-Sicherung
in einen neuen Ordner wiederherstellen** wählen. Nach erfolgreicher
Prüfung den eingeblendeten `sudo bash /opt/stackpilot/app/deploy/restore-vault.sh
apply …`-Befehl am Server ausführen. Er stoppt StackPilot, übernimmt die
Datenbank und startet StackPilot wieder. Der bisherige Stand liegt in
einem privaten Ordner. Am Ende erscheint der passende Befehl für die
Rückkehr. StackPilot-Anmeldungen müssen anschließend erneuert werden.

Für die Übernahme müssen der aktuelle Hauptschlüssel und die aktuelle
Datenbank vorhanden sein. Die Sicherung muss zum abgeschlossenen
Installationsplan passen. Die App-Konfigurationen, Medien und Viewer-
Sitzungen in Jellyfin werden durch den Tresorwechsel nicht geändert.
Wenn nach der Sicherung Dienstschlüssel erneuert wurden, müssen Tresor
und betroffene Dienste aus zueinander passenden Sicherungen stammen.

## Wiederherstellungscodes für Zuschauer

Bei neu eingerichtetem Authentik werden Wiederherstellungscodes automatisch
angeboten. Für eine bestehende Installation öffne **Personen → Zuschauer → Anmeldung der Zuschauer aktualisieren
→ Wiederherstellungscodes aktivieren** und bestätige mit dem StackPilot-Administratorpasswort.
Zuschauer ohne eingerichteten Wiederherstellungsfaktor bekommen nach
erfolgreicher Anmeldung mit zweitem Faktor acht einmal verwendbare Codes
angezeigt. Sie sollten die Codes privat und getrennt vom Gerät mit ihrer
Authenticator-App aufbewahren. Bestehende Codes bleiben gültig.

## Zuschauer anmelden und eigenes Passwort wählen

In einer bestehenden Installation öffnest du unter **Personen → Zuschauer →
Anmeldung der Zuschauer aktualisieren** einmalig **Zuschauer-Anmeldung aktualisieren**.
Neue Authentik-Installationen verwenden den Ablauf automatisch.

1. Beim Einladen gibt StackPilot einen Benutzernamen und ein Startpasswort aus.
2. Der Zuschauer öffnet den Jellyfin-Anmeldelink und richtet bei Bedarf einen
   Passkey oder eine Authenticator-App ein. Passkeys verwenden die HTTPS-Adresse
   von Authentik und sind ein zweiter Faktor zusätzlich zum Passwort.
3. Nach bestätigter MFA wählt der Zuschauer beim ersten Login ein eigenes
   Passwort mit 12 bis 128 Zeichen. Bei einem späteren Login verwendet er
   dieses Passwort. Ein von StackPilot zurückgesetztes Konto durchläuft die
   Einrichtung erneut.

Ein frisch bestätigter zweiter Faktor gilt auch für die anschließende
Jellyfin-Freigabe derselben Anmeldung. Fehlt dieser Nachweis, fordert Authentik
MFA an. Bestehende Konten behalten ihr Passwort, bis sie ausdrücklich
zurückgesetzt werden.

### Bibliotheken pro Zuschauer freigeben

1. Öffne **Personen → Zuschauer → Bibliotheksprofile**.
2. Erstelle ein Profil mit einem Namen und den erlaubten Jellyfin-Bibliotheken.
   Zur Auswahl stehen die Bibliotheken, die beim Einrichten von SSO freigegeben wurden.
3. Wähle auf der Karte des Zuschauers unter **Bibliotheken** das Profil aus und klicke auf **Speichern**.
   Mit **Standardfreigabe** erhält das Konto wieder die ursprüngliche Bibliotheksauswahl.

StackPilot übernimmt die Freigabe für das gesamte Zuschauerkonto. Bereits
angemeldete Geräte können die Bibliotheken neu laden und weiter angemeldet
bleiben. Falls gerade eine Jellyfin-Anmeldung läuft, schließe sie vor dem
Profilwechsel ab und versuche die Zuweisung erneut. Unterbrochene
Zuweisungen lassen sich mit derselben Profilauswahl fortsetzen.

### Einem bestehenden Konto einen Passkey hinzufügen

1. Bei einer bestehenden Installation bei Bedarf einmal **Zuschauer-Anmeldung aktualisieren**.
2. Beim aktiven Zuschauerkonto mit eingerichtetem zweiten Faktor auf **Passkey hinzufügen** klicken.
3. Die Person öffnet ihren üblichen Jellyfin-Anmeldelink im Browser und
   meldet sich mit ihrem bisherigen Passwort und zweiten Faktor an. Authentik
   bietet anschließend an, einen Passkey auf dem Gerät anzulegen.

Das Passwort, die bisherigen Faktoren und angemeldete Jellyfin-Geräte
bleiben erhalten. Die einmalige Aufforderung lässt sich bei Bedarf über
**Passkey-Einrichtung abbrechen** zurücknehmen.

## Gemeinsamer Filmstandard, Freigaben und Bibliotheksdateien

Unter **Qualität & Quellen → Medienprofile** werden die aktuellen Werte direkt geladen.
Der Größenstandard gilt für neue Standardanfragen aus StackPilot, Seerr,
Streamyfin und Couchdeck. Bereits vorhandene Dateien werden dadurch nicht ersetzt.
Ausdrücklich gewählte Einzelprofile bleiben eigene Vorgaben.

Bei einer festen GiB-Grenze verwendet Seerr das passende Radarr-Profil. Bei
GiB/h landen direkte Anfragen zuerst in „Größenprüfung ausstehend“: dessen
Pflichtfilter lässt keinen Treffer zu. StackPilot prüft die Laufzeit, bestätigt
die berechnete Grenze und startet erst danach die Suche. Ohne bestätigte Laufzeit
bleibt der Film gesperrt. Die Prüfung läuft alle 30 Sekunden. Änderungen an
nativen Regeln werden gemeldet; eigene Seerr-Profilregeln müssen vor einer
Übernahme geprüft werden. Ausstehende Laufzeitprüfungen zuerst klären, bevor der
Standard ausgeschaltet oder auf eine feste Grenze umgestellt wird.

Wartende Anfragen stehen oben unter **Anfragen → Meine Anfragen → Wartet auf deine Freigabe**
(mit Name der anfragenden Person). Einzelne oder mehrere (bis 25) ankreuzen → **Freigeben** oder
**Ablehnen** → mit **OK** bestätigen; beim Ablehnen ist eine Begründung möglich. Seerr kennt
keine Begründung – StackPilot zeigt sie bei der abgelehnten Anfrage unter **Details**. Einzeln
geht es auch über **Details → Anfrage freigeben** bzw. **Ablehnen …**. Klappt eine Anfrage
nicht, nennt die Meldung sie mit Grund; die übrigen werden trotzdem bearbeitet.
Auf der Karte unter **Personen → Zuschauer** (Schalter „Anfragen brauchen meine Freigabe“)
oder gesammelt unter **Anfragen → Freigabe je Zuschauer** hat jeder Zuschauer einen Schalter: an = neue Film- und Serienanfragen brauchen eine
Freigabe, aus = sie laufen automatisch (Seerr-Rechte Anfragen + automatische
Freigabe). Das betrifft neue Anfragen; bereits wartende Anfragen einzeln genehmigen.
Konten mit Verwaltungsrechten werden hier nicht verändert. Ist ein Schalter
gesperrt, steht der konkrete Grund darunter. Hat ein Zuschauer noch kein
Seerr-Konto, legt StackPilot es beim Ausschalten aus seinem Jellyfin-Zuschauerkonto
an (Seerr-Import) und prüft danach, dass es keine Verwaltungsrechte hat. Der
angezeigte Zuschauername wird automatisch dem verwalteten Jellyfin-Konto mit
Präfix `spv_` zugeordnet.

Couchdecks eigene feste Filmgrenze funktioniert auch bei Konten mit Freigabepflicht.
Die Anfrage wird zunächst mit der gewünschten Grenze ohne Freigabe vorbereitet
und dem persönlichen Zuschauer zugeordnet. Sie erscheint unter „Meine Anfragen“
als wartend. Die Freigabe in StackPilot behält diese Grenze bei, selbst wenn der
allgemeine Filmstandard größer ist. Bei erlaubter automatischer Freigabe wird sie
nach bestätigter Zuordnung automatisch genehmigt. Die Zuschauerrechte bleiben
unverändert; Couchdeck erhält keinen Seerr-Administratorschlüssel.

Dafür legt StackPilot bei der ersten solchen Anfrage ein internes Seerr-Konto
„StackPilot Anfragevorbereitung“ an. Dieses Konto besitzt ausschließlich
Anfrage- und Profilauswahlrechte, keine Freigabe- oder Verwaltungsrechte.
Nicht manuell erweitern. Bei einem unterbrochenen Aufruf denselben Film mit derselben
Grenze erneut anfragen: StackPilot nimmt die Vorbereitung wieder auf. Eine noch
nicht zugeordnete Vorbereitung nicht in Seerr freigeben. In StackPilot bleibt ihre
Freigabe gesperrt, bis die Zuordnung bestätigt ist.

**Speicher → Aufräumen** zeigt auch Serien, deren Anfrage bereits entfernt
wurde. Serie, optional Staffel und anschließend eine Folge auswählen und die
betroffenen Dateien prüfen. Zugeordnete Downloads erscheinen separat und werden
nur bei ausdrücklicher Auswahl mitgelöscht. Gemeinsame Pakete mit weiteren Folgen
sind bei einer Teilauswahl gesperrt. „Überwachung beenden“ verhindert automatische
neue Suchen für die Auswahl. Die Löschung prüft den tatsächlichen Bibliothekspfad.
Andere Hardlinks, Kopien und ein nativer Papierkorb können weiter Platz belegen.
Filme werden weiterhin unter **Meine Anfragen → Film löschen** entfernt.
Das Entfernen eines Torrents oder Archivieren einer Anfrage löscht für sich keine
bereits importierten Bibliotheksdateien.

Bei einem vorhandenen Film oder einer einzelnen Folge zuerst das gewünschte
Qualitätsprofil speichern, dann **Passenden Ersatz suchen**. Nach Auswahl erstellt
StackPilot eine überprüfte Kopie der alten Datei und fordert den Ersatz an.
Die bisherige Datei bleibt bis zum nativen Import verfügbar. Ein Staffelpaket oder
eine Mehrfolgendatei wird nicht als Ersatz einer einzelnen Folge angenommen.
**Austauschstatus laden** zeigt den Fortschritt und den Sicherungspfad.
**Zur gesicherten Version zurückkehren** importiert die alte Kopie erneut und
prüft ihre Prüfsumme. Das gewählte Zielprofil bleibt dabei bestehen.

Sicherungen liegen unter `<Medienpfad>/.stackpilot-versions/<Vorgang>/` und werden
nicht automatisch entfernt. Dafür sowie für den neuen Download muss genügend
Platz vorhanden sein. Die Wiederherstellung entfernt den Ersatztransfer aus
qBittorrent, bewahrt dessen Dateien aber auf. Bei abweichenden Profilen, nicht
zuordenbaren Dateien oder Importfehlern den angezeigten Befund prüfen; die Sicherung
bleibt erhalten. Eine fehlende oder veränderte Sicherung wird nicht verwendet.


## StackPilot direkt im privaten Tailnet

Unter **System → Zugriff & Netzwerk → StackPilot im privaten Tailnet** auf
**Privaten StackPilot-Zugriff prüfen** klicken. Die Prüfung zeigt die Serveradresse
mit Port 5173 und eine IP-Adresse als Alternative zu MagicDNS. Die Installation
bindet StackPilot bereits an LAN und Tailnet; ein fehlendes Tailscale-Zugriffsrecht
kann trotzdem Verbindungen von anderen Geräten verhindern.

Die Tailscale-IP des eigenen Verwaltungsgeräts eintragen und **Passende
Zugriffsregel anzeigen** wählen. Den erzeugten Eintrag im bestehenden `grants`-Array
unter [Tailscale Access controls](https://login.tailscale.com/admin/acls) ergänzen.
Bestehende Regeln behalten. Die Vorlage erlaubt nur den angegebenen Geräten
TCP 5173 auf diesem Server, keine weiteren Dienstports und keine Öffentlichkeit.
Für zusätzliche eigene Geräte deren Tailscale-Adressen ergänzen.

Danach auf dem Verwaltungsgerät `http://<Tailscale-Gerätename>:5173` öffnen,
anmelden und die Prüfung wiederholen. Erst „Diese Anfrage erreicht StackPilot
bereits über das private Tailnet“ bestätigt den tatsächlichen Gerätezugriff.
Ein lokaler Selbsttest oder ein SSH-Tunnel wird nicht als solcher Nachweis gezählt.
Bei gesperrter Verbindungsannahme meldet die Oberfläche dies gesondert. Die
Zugriffsregeln werden nicht automatisch verändert. HTTP bleibt innerhalb des
verschlüsselten Tailscale-Verbindungswegs; Funnel und die Jellyfin-Freigaben werden
nicht verändert. Hintergrund zur gezielten Portfreigabe:
[Tailscale-Grants](https://tailscale.com/docs/features/access-control/grants).
