# Temporäre Entwicklungsdaten – nur im privaten Repository

Dieser Ordner ist für die gemeinsame Entwicklungsphase bestimmt und soll vor
einer Veröffentlichung oder Weitergabe des Repositorys wieder entfernt werden.

- `reports/`: bewusst geteilte, von StackPilot erzeugte JSON-Serverberichte.
- Alle anderen Dateien und Unterordner sind standardmäßig durch `.gitignore`
  ausgeschlossen. Das ist eine Hilfe gegen versehentliches Hinzufügen, kein Tresor.
- Passwörter, API-Schlüssel, VPN-/WireGuard-Schlüssel, `.env`-Dateien, rohe Logs,
  Datenbanken und vollständige Dienstkonfigurationen gehören **nicht in Git**.
  Auch JSON-Dateien mit solchen Inhalten gehören nicht nach `reports/`.

## Auf dem tatsächlichen Testserver erzeugen und teilen

```sh
npm run report:dev
```

Dies erstellt den erweiterten Bericht zunächst nur lokal. Ein Upload benötigt
sowohl die aktivierte `report-policy.json` als auch eine ausdrückliche Freigabe
auf dieser Installation. Freigeben und einen Bericht hochladen:

```sh
npm run report:dev -- --enable-upload
```

Die Freigabe kann auch unter **Verwaltung → Diagnose → Entwicklungsberichte mit
GitHub teilen** gesetzt werden. Danach lädt `npm run report:dev` ausschließlich
die erzeugte JSON-Datei hoch. Der lokale Arbeitsbaum und vorgemerkte Dateien
bleiben unverändert. Die lokale Freigabe widerrufen:

```sh
npm run report:dev -- --disable-upload
```

Unabhängig von der Freigabe nur lokal:

```sh
npm run report:dev -- --local
```

Ein Bericht aus einer Cloud-Entwicklungsmaschine beschreibt diese Maschine und
ersetzt keinen Bericht des Ubuntu-Testservers. Private GitHub-Repositories sind
für die bewusst geteilten Diagnoseinformationen hier vorgesehen. Ein Wechsel
auf öffentlich erfordert vorherige Prüfung.

## Zum Ende der Entwicklungsphase

Den Ordner mit `git rm -r dev-private` entfernen und die Änderung committen.
**Die früheren Dateien bleiben dabei in der Git-Historie.** Falls auch historische
Serverinformationen entfernt werden sollen, muss vor einer Veröffentlichung die
Historie gesondert bereinigt oder ein neues sauberes Repository erstellt werden.
Ein History-Rewrite ist hier nicht automatisch vorgesehen. Versehentlich
committete Geheimnisse müssen zusätzlich widerrufen/rotiert werden.

Nach dem Entfernen dieses Ordners weiter `npm run report` verwenden; dessen
Berichte bleiben lokal im ignorierten Verzeichnis `reports/`.

## Erweiterte Diagnose

`npm run report:dev` erstellt den erweiterten Konfigurations-/Verbindungsbericht
und lädt ihn nur bei aktiver Policy und lokaler Freigabe in das private Repository hoch.
`npm run report:dev -- --local` speichert ausschließlich lokal. Die Policy lässt
sich jederzeit deaktivieren/löschen. Keine Geheimnisse oder Rohlogs werden
exportiert. [Details](../docs/archiv/diagnose-und-entwicklung.md).
