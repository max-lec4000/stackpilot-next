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
