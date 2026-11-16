# Abläufe im Alltag

Kurz und der Reihe nach: was wann wo zu tun ist. `<server>` ist die Adresse deines
Servers im Heimnetz, `<server>.<tailnet>.ts.net` seine Tailscale-Adresse.

## Zuschauer

### Jemanden einladen
1. StackPilot → **Verwaltung → Externer Zugriff → Zugriff von unterwegs → Zuschauer**.
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
**Neu einladen** beim Zuschauer → neues Startpasswort, zweiter Faktor wird neu
eingerichtet. Bereits angemeldete Fernseher und Tablets bleiben angemeldet.

### Ein Gerät abmelden (verloren, verkauft)
Jellyfin im Heimnetz als Admin öffnen → **Dashboard → Geräte** → Gerät löschen.

### Zuschauer entfernen
**Entfernen** beim Zuschauer: Konto in Authentik deaktiviert, Sitzungen beendet. Die
angemeldeten Geräte zusätzlich in Jellyfin unter **Dashboard → Geräte** löschen.

## Couchdeck (Bildschirm am Server)

- Starten/Schließen: StackPilot → **Anwendungen → Couchdeck**, oder im Couchdeck-Menü
  „Ausschalten“; wieder an durch Controller einschalten oder Bildschirm aus/an.
- Läuft nur, wenn ein Bildschirm angeschlossen und eingeschaltet ist.
- Neu verbinden (z. B. nach Neuinstallation von Jellyfin): **Verbindung erneuern**.
- Aktualisieren: erscheint als Knopf, wenn eine neuere Couchdeck-Version mitgeliefert wird.

## Verwaltung

### Admin-Arbeiten in den Diensten
StackPilot → **Anwendungen** → Dienst öffnen. Zugangsdaten: **Details → Zugang anzeigen**
(verlangt das StackPilot-Passwort). Das Jellyfin-Admin-Konto funktioniert nur im
Heimnetz, nicht über die HTTPS-Adresse.

### StackPilot aktualisieren
**Verwaltung → Sicherungen & Updates → Neue Version prüfen → Installieren**. StackPilot startet kurz neu,
Medien-Container laufen weiter.

### Dienstschlüssel erneuern

Unter **Anwendungen → Dienst → Details → API-Schlüssel erneuern** das
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

Unter **Anwendungen → Jellyfin → Details** lässt sich der Dienstzugang
für Couchdeck, Seerr oder Streamystats einzeln erneuern. StackPilot
prüft zuerst den neuen Zugang beim Dienst und widerruft anschließend
den bisher dort verwendeten Token. Der Streamystats-Schritt gilt
für das integrierte und geprüfte StackPilot-Image. Ein laufendes
Couchdeck startet nach seiner eigenen Token-Erneuerung neu.

### Zugriff von unterwegs
- Einrichten: im Assistenten „Von unterwegs“ wählen oder später unter
  **Verwaltung → Externer Zugriff → In einem Schritt einrichten**.
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
- VPN-Test: **Verwaltung → VPN & Ausfallsperre → Prüfauftrag starten**.
- Neue Quelle (Indexer): **Verwaltung → Quellen** → Anbieter wählen → testen → speichern.

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

Öffne unter **Anwendungen → Bazarr → Details** den Bereich
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

Unter **Verwaltung → Sicherungen & Updates → Container-Updates und
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
**Verwaltung → Sicherungen & Updates → StackPilot-Tresor sichern**
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
angeboten. Für eine bestehende Installation öffne **Verwaltung → Externer
Zugriff → Zuschauer → Wiederherstellungscodes für Zuschauer
aktivieren** und bestätige mit dem StackPilot-Administratorpasswort.
Zuschauer ohne eingerichteten Wiederherstellungsfaktor bekommen nach
erfolgreicher Anmeldung mit zweitem Faktor acht einmal verwendbare Codes
angezeigt. Sie sollten die Codes privat und getrennt vom Gerät mit ihrer
Authenticator-App aufbewahren. Bestehende Codes bleiben gültig.

## Zuschauer anmelden und eigenes Passwort wählen

In einer bestehenden Installation öffnest du unter **Verwaltung → Externer
Zugriff → Zuschauer** einmalig **Zuschauer-Anmeldung aktualisieren**.
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

1. Öffne **Verwaltung → Externer Zugriff → Zuschauer → Zuschauerprofile**.
2. Erstelle ein Profil mit einem Namen und den erlaubten Jellyfin-Bibliotheken.
   Zur Auswahl stehen die Bibliotheken, die beim Einrichten von SSO freigegeben wurden.
3. Wähle beim Konto das Profil aus und klicke auf **Profil zuweisen**.
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
