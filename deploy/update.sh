#!/bin/bash
# StackPilot von GitHub aktualisieren. Läuft als root über die Root-Hilfe
# (systemctl start stackpilot-root@stackpilot-update.service), ausgelöst aus der Oberfläche.
#
# 1. Quellstand aus dem hinterlegten Repository frisch holen (/etc/stackpilot/install.env)
# 2. Zustandsformat prüfen: nur rückwärtskompatible Versionen werden installiert
# 3. install.sh der neuen Fassung ausführen (baut, ersetzt /opt/stackpilot/app, startet neu)
# Fortschritt steht in /var/lib/stackpilot-update/status.json (für die Oberfläche lesbar).
set -euo pipefail
umask 022
ENV=/etc/stackpilot/install.env
STATE_DIR=/var/lib/stackpilot-update
install -d -m 755 "$STATE_DIR"
status() {
  python3 -c 'import json,sys; json.dump({"state":sys.argv[1],"phase":sys.argv[2],"message":sys.argv[3],"target":sys.argv[4]}, open(sys.argv[5],"w"))' \
    "$1" "$2" "${3:-}" "${TARGET:-}" "$STATE_DIR/status.json.tmp"
  chmod 644 "$STATE_DIR/status.json.tmp"
  mv "$STATE_DIR/status.json.tmp" "$STATE_DIR/status.json"
}
TARGET=""
WORK=""
trap 'rc=$?; [ -n "$WORK" ] && rm -rf "$WORK"; [ $rc -eq 0 ] || status failed "Update fehlgeschlagen" "Es wurde nichts ersetzt, solange der Fehler vor der Installation lag. Details: journalctl -u stackpilot-root@stackpilot-update -n 60"' EXIT

# shellcheck disable=SC1090
. "$ENV"
: "${STACKPILOT_REPO:?Keine Update-Quelle}" "${STACKPILOT_USER:?Kein StackPilot-Benutzer}"
BRANCH="${STACKPILOT_BRANCH:-main}"
case "$STACKPILOT_REPO" in https://*) ;; *) echo "Nur HTTPS-Quellen sind erlaubt."; exit 1 ;; esac

status running "Neue Version wird geladen"
WORK="$(mktemp -d /var/tmp/stackpilot-update.XXXXXX)"
GIT_TERMINAL_PROMPT=0 git clone --quiet --depth 1 --branch "$BRANCH" "$STACKPILOT_REPO" "$WORK/src"
TARGET="$(git -C "$WORK/src" rev-parse HEAD)"

status running "Zustandsformat wird geprüft"
schema() { python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("stackpilotStateSchema"))' "$1"; }
if [ "$(schema /opt/stackpilot/app/package.json)" != "$(schema "$WORK/src/package.json")" ]; then
  status failed "Nicht installiert" "Die neue Version braucht ein anderes Zustandsformat. Bitte zuerst eine Sicherung anlegen und gezielt migrieren."
  trap - EXIT; rm -rf "$WORK"; exit 1
fi

status running "Wird gebaut und installiert – StackPilot startet gleich neu"
STACKPILOT_USER="$STACKPILOT_USER" STACKPILOT_REPO="$STACKPILOT_REPO" STACKPILOT_BRANCH="$BRANCH" \
  STACKPILOT_COMMIT="$TARGET" bash "$WORK/src/install.sh"
status completed "Aktualisiert" "Neue Version ${TARGET:0:7} läuft."
