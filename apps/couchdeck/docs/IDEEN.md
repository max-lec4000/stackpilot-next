# Ideenliste

Gesammelte Ideen für spätere Ausbaustufen von Couchdeck.

## Musik (sobald die Musik-Bibliothek in Jellyfin existiert)

- **Richtiger Musik-Player** – Warteschlange, Zufallswiedergabe, Wiederholen (eins/alle),
  Albumcover groß auf dem Bildschirm, Künstler-/Albumseiten.
- **Songtexte** – synchron mitlaufende Lyrics über das freie LRCLIB (lrclib.net),
  Zeile für Zeile hervorgehoben.
- **Musik bei ausgeschaltetem Monitor** – Couchdeck bleibt aktiv, solange Musik läuft,
  auch wenn der Bildschirm aus ist; Steuerung per Controller (und später Handy-Fernbedienung).
  Passt gut zum WiiM als Ausgang.

## Player

- **Bild-im-Bild (Player minimieren)** – Während ein Film/Video läuft, den Player klein in eine
  Ecke schieben und nebenbei Medien durchsuchen, YouTube-Videos suchen oder Anfragen stellen.
  - *Warum nicht sofort:* cage zeigt jedes Fenster bildschirmfüllend und immer nur eines –
    ein kleines Videofenster über der Oberfläche geht damit nicht.
  - *Technik:* cage durch **sway** ersetzen (Ubuntu-Paket, gleiche wlroots-Basis; der Fix
    `WLR_DRM_NO_ATOMIC=1` gilt weiter). Oberfläche im Vollbild; mpv beim Minimieren als
    schwebendes Fenster unten rechts (~⅓ Breite, 16:9), beim Zurückholen wieder Vollbild –
    gesteuert von Couchdeck über die sway-IPC (`swaymsg`). `no_focus` für das mpv-Fenster,
    damit Tastatur/Maus bei der Oberfläche bleiben (Controller läuft ohnehin über evdev).
  - *Bedienung:* Im Player Kreuz ↑ (bisher frei) bzw. Menüeintrag „Minimieren“ und Knopf
    oben links; in der Oberfläche holt die Xbox-Taste das Video zurück, Klick aufs kleine
    Bild ebenso. Im kleinen Fenster blendet sich die Player-Leiste aus; Ecke umschaltbar.
  - *Zu beachten:* Installer + Startskript (`bash_profile`) anpassen; Abschalten bei
    Bildschirm aus, „Couchdeck ausschalten“ und die Bild-eingefroren-Selbstheilung neu
    testen. Neues Video im minimierten Zustand ersetzt das laufende (kurzer Hinweis).
  - *Einfachere Vorstufe (falls gewünscht):* Mini-Leiste ohne Bild – mpv schaltet die
    Videospur ab (`vid=no`), Ton läuft weiter, bestehende Musik-Leiste wird um Vorschaubild,
    ⤢ und Herkunftsfarbe erweitert; YouTube beim Zurückholen über die gekürzte Playlist neu
    laden; den Bild-hängt-Wächter währenddessen pausieren.
