# Couchdeck

Controller-first Vollbild-Oberfläche für Jellyfin auf einem headless Ubuntu-Server –
wie Steam Big Picture unter SteamOS, ohne Desktop-Umgebung.

- **Kein Desktop:** `cage` (Wayland-Kiosk) startet nach dem Boot nur Couchdeck auf tty1.
- **Wiedergabe mit mpv:** Direct Play mit Intel-VA-API, keine Transkodierung auf dem Server.
- **Fernstart:** Couchdeck erscheint in jeder Jellyfin-App unter „Abspielen auf …“.
- **Controller:** Xbox/PlayStation/generische Pads über evdev, auch während der Wiedergabe.
- **Audio:** AirPlay-Empfänger (z. B. WiiM) erscheinen automatisch als Ausgang.
- **Server-Status:** CPU, Temperatur, RAM, Speicher und ein Ping auf Jellyfin, Seerr, *arr und qBittorrent (nur lesend).

## Bereiche

Oben in der Mitte: **🎬 Kino** (blau) · **▶ YouTube** (rot) · **♪ Musik** (grün). Am oberen
Rand noch einmal ↑ drücken → die Leiste wird größer, ←/→ wechselt den Bereich, ↓ zurück.
Schneller: **LB / RB** (Schultertasten) wechseln den Bereich von überall (Tastatur: Bild↑ / Bild↓).

## YouTube

Über yt-dlp + mpv: keine Werbespots, Sponsor-Abschnitte (SponsorBlock) per Knopf
überspringbar, Steuerung wie bei Filmen. Kanäle und Playlists lassen sich mit ★ merken
und erscheinen dann auf der YouTube-Startseite („Neu von deinen Kanälen“, ohne Tippen).
yt-dlp wird beim Installieren nur nach Rückfrage von den offiziellen GitHub-Releases
geladen und gegen die SHA-256-Prüfsumme geprüft. SponsorBlock erhält nur einen
4-stelligen Hash-Anfang der Video-ID.

## Anfragen über Seerr

Unter **＋ Anfragen** auf der Startseite: Trends, Suche und „Meine Anfragen“. Filme oder
einzelne/alle fehlenden Staffeln lassen sich anfragen; Anfragen laufen im Namen des
Seerr-Benutzers, der zum angemeldeten Jellyfin-Benutzer gehört. Einmalig verbinden:

```bash
ssh -t reatest 'sudo bash /opt/couchdeck/app/deploy/set-seerr-key.sh'
```

Der API-Key steht in Seerr unter Einstellungen → Allgemein. Er wird nur in
`~couchdeck/.config/couchdeck/seerr.json` (Rechte 600) gespeichert; an Seerr wird nichts geändert.

## Bedienung

| Controller | Oberfläche | Während der Wiedergabe |
|---|---|---|
| Steuerkreuz | Navigieren | ← leiser · → lauter · ↓ Audioausgang · ↑ (frei) |
| Linker Stick | Navigieren | ← −10 s · → +30 s |
| A / Kreuz | Auswählen (Banner: abspielen) | Pause · Intro/Werbung überspringen |
| B / Kreis | Zurück · auf Startseite: nach oben, dann Bereichsleiste | Leiste zeigen · **2× beenden** |
| X / Quadrat | Kurzinfo zur Kachel (Tastatur: löschen) | Untertitel wechseln |
| Y / Dreieck | Suche im aktuellen Bereich (Tastatur: Leerzeichen) | Tonspur wechseln |
| LB / RB | Bereich wechseln (Kino · YouTube · Musik) | Vorherige / nächste Folge |
| A halten + Stick/LT/RT | – | schnell spulen: −2 min / +5 min |
| LT / RT | Springen: 6 Kacheln bzw. 3 Rasterzeilen | −10 s / +30 s |
| ☰ Start | Menü | Player-Menü |
| ⧉ View | Bereichsleiste | – |
| Xbox-Taste | Startseite des Bereichs · dort: Menü | Leiste zeigen · **2× beenden** |

Jeder Bereich merkt sich seine Position (auch beim Wechsel mit LB/RB). Unten rechts
stehen immer die Tasten, die gerade sinnvoll sind; die komplette Übersicht steht im
Menü unter **Tastenbelegung**. Läuft Musik (ohne Bild), erscheint unten links ein
Mini-Player – mit ↓ am unteren Rand erreichbar.

Tastatur: Pfeile, Enter, Esc/Backspace, F1 = Menü.

## Bildschirm-Automatik

Couchdeck läuft nur, solange ein Bildschirm angeschlossen und eingeschaltet ist
(irgendein Grafikausgang meldet „connected“). Ist er länger als 10 Sekunden weg,
beendet sich Couchdeck sauber (laufende Wiedergabe wird an Jellyfin gemeldet);
kommt er wieder, startet Couchdeck nach wenigen Sekunden neu. Anmeldung und
Einstellungen bleiben erhalten.

**Menü → „⏻ Couchdeck ausschalten“** (mit Rückfrage) beendet die Oberfläche, der
Server läuft weiter. Wieder an: Controller aus- und einschalten (neu verbunden) oder
Bildschirm aus und wieder an.

## Aufbau

```
src/main/main.js      Fenster, IPC, Eingabe-Routing, Fernsteuerung
src/main/jellyfin.js  REST, Quick Connect, WebSocket-Sitzung
src/main/player.js    mpv über JSON-IPC, Warteschlange, Fortschrittsmeldungen, Segmente
src/main/gamepad.js   evdev-Leser für Gamepads/Fernbedienungen
src/main/system.js    PipeWire-Ausgänge, Server-Status, Dienst-Pings, Ein/Aus
src/renderer/         Oberfläche (HTML/CSS/JS, räumliche Navigation)
deploy/               Installation auf dem Server
```

Einstellungen: `~couchdeck/.config/couchdeck/config.json`
Log: `/var/log/couchdeck/session.log` (lesbar für Gruppe adm)

## Entwicklung

```bash
npm install
ssh -f -N -L 18096:127.0.0.1:8096 reatest       # Jellyfin des Servers lokal erreichbar machen
COUCHDECK_CONFIG_DIR=/tmp/cdcfg npm run dev      # Fenster-Modus; config.json dort mit jellyfinUrl http://127.0.0.1:18096
```

## Installation auf dem Server

Voraussetzung: Ubuntu Server 24.04 (x86-64 oder arm64) mit angeschlossenem Bildschirm.
Das Installationsskript bringt **alles Nötige** mit: Systempakete per `apt`, die
Electron-Laufzeit (exakt die Version aus `package.json`, von github.com/electron, gegen
die offizielle SHA-256-Prüfsumme geprüft) und – nur nach Rückfrage – yt-dlp für YouTube.

**Direkt von GitHub:**

```bash
git clone https://github.com/max-lec4000/couchdeck.git
sudo bash couchdeck/deploy/install.sh
```

Das Repository ist privat: Auf dem Server vorher anmelden (z. B. `gh auth login`) oder
mit einem Zugangstoken klonen.

**Update von GitHub:**

```bash
cd couchdeck && git pull && sudo bash deploy/install.sh
```

**Vom Entwicklungsrechner** (bringt Electron aus `node_modules` gleich mit):

```bash
./deploy/push.sh                                       # kopiert nach reatest:~/couchdeck-staging
ssh -t reatest 'sudo bash ~/couchdeck-staging/deploy/install.sh'
```

Läuft Couchdeck schon, startet das Skript es am Ende mit der neuen Version neu.

Entfernen: `sudo bash /opt/couchdeck/app/deploy/uninstall.sh`

## Klangprofile

Feste Klangeinstellungen statt dynamischem Nachregeln (kein „Pumpen“): Sprache anheben
(EQ im Sprachbereich, bei 5.1/7.1 zusätzlich lauterer Center-Kanal), Bass/Explosionen
absenken, Höhen, Dynamik (sanfter Kompressor mit langer Erholzeit, nur Spitzen) und Pegel,
am Ende ein Begrenzer gegen Übersteuern. Vorgegeben: Standard, Nacht, Dialog, Kino – alle
bearbeitbar; eigene Profile anlegen, umbenennen, löschen unter **Einstellungen → Ton →
Klangprofile**. Im Film wechselt **Player-Menü → Klangprofil** durch die Profile.

## Selbstheilung

Couchdeck überwacht sich selbst: Antwortet die Oberfläche 30 s nicht, wird sie neu geladen
(3× in 10 min → Neustart). Läuft sie, zeichnet aber 30 s lang kein neues Bild (eingefrorene
Anzeige), beendet sich Couchdeck und die Startschleife startet Anzeige + Oberfläche sofort neu.
Während ein Film läuft, wird die Bildprüfung ausgesetzt. Diagnose:
`COUCHDECK_WATCHDOG_DEBUG=1` protokolliert jeden Herzschlag.

YouTube, lange Videos: ffmpeg hängt bei YouTube-HLS, sobald es mehr als ein Segment weit
springen soll (5-h-Video ab 3:00 h: > 2,5 min ohne Bild). Couchdeck liefert mpv deshalb über
einen lokalen Dienst (nur 127.0.0.1) Playlists, die direkt beim Zielsegment beginnen –
Fortsetzen und weite Sprünge dauern so ~1–2,5 s, egal wie lang das Video ist.

YouTube: Steht das Bild, während der Ton weiterläuft (oder kommt nach 20 s beim Start/Spulen
kein Bild), startet Couchdeck den Player (mpv) neu, holt frische Stream-Adressen und spielt an
derselben Stelle weiter – höchstens zweimal pro Video. Nach einem solchen Hänger wird mpv vor
dem nächsten Video ohnehin frisch gestartet, damit ein hängender Stream nicht nachwirkt.

Weitere Ideen für später: [docs/IDEEN.md](docs/IDEEN.md)
