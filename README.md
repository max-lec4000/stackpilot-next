# StackPilot

Ein Medienserver zum Selbsthosten, eingerichtet mit einem Befehl und einem kurzen
Assistenten im Browser: Jellyfin, Sonarr, Radarr, Lidarr, Prowlarr, Bazarr, Seerr,
Streamystats und qBittorrent (nur hinter Mullvad-VPN), dazu **Couchdeck** – eine
Controller-Oberfläche für den Bildschirm am Server – und auf Wunsch geschützter Zugriff
von unterwegs (Authentik mit zweitem Faktor, Tailscale HTTPS, optional öffentlich über
Tailscale Funnel).

Geprüft auf **Ubuntu Server 24.04 (x86-64)**. TrueNAS/HexOS ist geplant, aber noch
nicht unterstützt (siehe [Pläne](docs/zukunft/README.md)).

## Installieren

```sh
git clone https://github.com/max-lec4000/stackpilot-next.git stackpilot
sudo bash stackpilot/install.sh --tailscale
```

Mit sudo aus dem eigenen Benutzerkonto ausführen; StackPilot läuft danach als dieser
Benutzer. `--tailscale` ist nur für HTTPS und Zugriff von unterwegs nötig.

Der Befehl installiert Docker, Node.js (geprüfte Prüfsumme), baut StackPilot, richtet es
als Systemdienst ein und gibt am Ende die Adresse und einen einmaligen Setupcode aus.
Wiederholtes Ausführen aktualisiert eine bestehende Installation; Daten bleiben erhalten.

## Einrichten im Browser

`http://<adresse-des-servers>:5173` öffnen (im Heimnetz oder Tailnet), mit dem Setupcode
den Administrator anlegen und den Assistenten durchgehen:

1. **Server & Apps** – Serverprüfung läuft automatisch. Alle Apps sind vorausgewählt;
   Couchdeck (mit oder ohne YouTube) und „Von unterwegs“ samt erstem Zuschauer wählbar.
2. **Speicher & VPN** – Datenordner (oder vorhandenen Medienordner übernehmen),
   Mullvad-WireGuard-Datei hochladen, Sprache und Qualität.
3. **Plan** – alles prüfen und mit `OK` bestätigen.
4. **Einrichtung** – läuft auf dem Server weiter, auch wenn der Browser zu ist.

Danach entstehen automatisch:

- alle Dienste mit getrennten Passwörtern und Schlüsseln, untereinander verbunden,
- ein **Wohnzimmer-Konto** in Jellyfin, mit dem Couchdeck sofort angemeldet ist
  (inklusive Anfragen über Seerr, ohne Seerr-Admin-Schlüssel in Couchdeck),
- bei „Von unterwegs“: Authentik, Schutz-Gateway vor Jellyfin, SSO, HTTPS im Tailnet
  und eine Einladung für den ersten Zuschauer.

## Im Alltag

| Was | Wo |
| --- | --- |
| Dienste öffnen | **Anwendungen** – Links auf die Oberflächen im Heimnetz, Zugangsdaten geschützt anzeigbar |
| Couchdeck starten/schließen | **Anwendungen → Couchdeck** |
| Zuschauer einladen, neu einladen, entfernen | **Verwaltung → Externer Zugriff** |
| Öffentlich über Funnel | **Verwaltung → Externer Zugriff → Öffentlich über das Internet** |
| Filme/Serien suchen und anfragen | **Medien entdecken**, **Meine Anfragen** |
| StackPilot aktualisieren | **Verwaltung → Über** (holt die neue Version von GitHub) |

### Zuschauer

Einladen heißt: Namen eintippen, StackPilot zeigt einmalig Adresse, Benutzername und
Startpasswort. Beim ersten Anmelden richtet die Person eine Authenticator-App ein.
Fernseher und Handys melden sich per **Quick Connect** an: Code in der App, Freigabe im
Browser unter Profil → Quick Connect. Benutzername/Passwort direkt in der App
funktionieren für Zuschauer absichtlich nicht.

Adresse für Apps: `https://<server>.<tailnet>.ts.net` (ohne Pfad). Einstieg im Browser:
`https://<server>.<tailnet>.ts.net/sso/OID/start/stackpilot`.

### Funnel (öffentlich)

Voraussetzung in der Tailscale-Policy (Admin-Konsole → Access controls):

```json
"nodeAttrs": [
  { "target": ["<dein-tailscale-login>"], "attr": ["funnel"] },
],
```

Dazu einmalig: akadmin in Authentik mit zweitem Faktor und Wiederherstellungscodes
absichern, eine Authentik-Sicherung anlegen und den Wiederherstellungstest bestehen.
Den Rest (Fernzugriff in Jellyfin, Admins nur lokal) erledigt StackPilot.

## Sicherheit in Kürze

- StackPilot-Oberfläche und alle Dienste: HTTP nur im Heimnetz und Tailnet.
- Von außen erreichbar ist höchstens Jellyfin über das Schutz-Gateway: Passwortanmeldung
  und Administratoren sind dort gesperrt, Zuschauer kommen nur über Authentik mit
  zweitem Faktor herein.
- qBittorrent startet nur, wenn der Mullvad-Tunnel und die Ausfallsperre nachgewiesen
  sind; ein Wächter prüft das laufend.
- Geheimnisse liegen verschlüsselt in `/var/lib/stackpilot` (`state.sqlite` +
  `master.key`, beides zusammen sichern).
- Root-Rechte hat StackPilot nur für genau vier Aufträge (Couchdeck installieren,
  mit YouTube installieren, entfernen, StackPilot aktualisieren).

## Umstellen von StackPilot 0.4

```sh
sudo bash stackpilot/scripts/migrate-from-0.4.sh
```

Stoppt den alten Stack (keine Dateien gelöscht), legt die alte Konfiguration beiseite und
installiert diese Fassung. Danach im Assistenten „Vorhandenen Medienordner übernehmen“
wählen. Konten, Verlauf und Quellen entstehen neu.

## Entwicklung

```sh
npm ci && npm run build && npm test
```

Testen ohne den eigenen Server: `scripts/testvm/` legt eine Ubuntu-VM per LXD an
(`host-setup.sh`), `first-install.mjs` fährt eine komplette Einrichtung über die API.

- [Abläufe im Alltag](docs/ablaeufe.md) – Zuschauer, Geräte, Couchdeck, Sicherungen
- [Pläne für die Zukunft](docs/zukunft/README.md)
- [Changelog](CHANGELOG.md)
- [Dokumentation der Version 0.4](docs/archiv/README-0.4.md)
