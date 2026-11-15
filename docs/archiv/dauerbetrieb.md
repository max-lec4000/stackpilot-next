# StackPilot als systemd-Nutzerdienst

Der Dienst läuft als derselbe normale Benutzer wie die bisherige Installation.
Er bindet weiterhin ausschließlich an Loopback. Docker-Zugriff bleibt eine
weitreichende Hostberechtigung; der Dienst ist noch kein abgetrennter Executor.

## Einrichten

Im bestehenden Checkout zunächst den manuell gestarteten StackPilot-Prozess
regulär beenden. Mediencontainer bleiben davon unberührt.

```sh
cd ~/stackpilot
npm ci
npm run build
npm run service:print
npm run service:install
npm run service:status
```

Kein `sudo npm …`. Voraussetzung sind eine funktionierende systemd-Nutzersitzung,
Node.js 24 und Docker-Zugriff dieses Nutzers. Die Installation verweigert einen
belegten Port 5173, fremde Dienstdateien und symbolische Links am Dienstziel.
Sie schreibt `~/.config/systemd/user/stackpilot.service`, lädt systemd neu und
aktiviert/startet ausschließlich diesen Dienst. Eigene geänderte Dienstdateien
werden vor Aktualisierung als `.previous-<Zeitstempel>` gesichert.

Der bisherige Zustand bleibt erhalten: Standard ist weiterhin `.stackpilot` im
Checkout. Ein bereits gesetztes `STACKPILOT_STATE_DIR` wird als absoluter Pfad
übernommen. Der Dienst verwendet den absoluten Pfad des aktuellen Node-Programms.
Nach einem Node-/Checkout-Wechsel muss die Dienstdefinition geprüft und nach
regulärem Stop gegebenenfalls erneut installiert werden.

Für Start nach einem Neustart ohne interaktive Anmeldung muss Linger für den
Nutzer aktiviert sein, beispielsweise:

```sh
loginctl enable-linger max
```

Falls der Server dafür zusätzliche Rechte verlangt, muss dies lokal durch den
Administrator erfolgen. StackPilot erteilt sich keine zusätzlichen Berechtigungen.

## Bedienen und aktualisieren

```sh
npm run service:status
npm run service:stop
npm run service:restart
journalctl --user -u stackpilot.service -n 80 --no-pager
```

Für ein Code-Update den Dienst zuerst regulär stoppen, dann Quellstand,
Abhängigkeiten und Build aktualisieren und anschließend wieder starten:

```sh
npm run service:stop
git pull --ff-only origin main
npm ci
npm run build
systemctl --user start stackpilot.service
```

Das aktualisiert StackPilot-Code; es ist kein automatisches Update der
Mediencontainer oder ihrer Datenbanken.

Beim Beenden nimmt StackPilot keine neuen API-Anforderungen mehr an, beendet
seine regelmäßigen Prüfungen und fordert laufende Installations-/Ablöseaufträge
zum Pausieren auf. Auf aktive Sperren wird bis zu vier Minuten gewartet. Ein
noch aktiver Spezialauftrag kann danach unterbrochen bleiben und muss nach dem
Neustart gezielt fortgesetzt werden. Seine Sperre kann bis zu 90 Sekunden
nachlaufen. Es werden keine Mediencontainer automatisch heruntergefahren.
Gluetuns Netzwerkschutz bleibt vom StackPilot-Prozess unabhängig.

Die Unit-Generierung und der Produktionsserver mit SIGTERM sind in der Cloud
geprüft. Ein laufender systemd-Nutzermanager steht dort nicht zur Verfügung;
der tatsächliche Nutzerdienst und Neustart ohne Anmeldung sind auf Ubuntu
abzunehmen.
