#!/bin/bash
# Seerr mit Couchdeck verbinden: API-Key verdeckt abfragen, prüfen und für den
# Couchdeck-Benutzer speichern (~couchdeck/.config/couchdeck/seerr.json, nur dort lesbar).
#
#   sudo bash /opt/couchdeck/app/deploy/set-seerr-key.sh
#
# Den API-Key findest du in Seerr unter Einstellungen → Allgemein → API-Schlüssel.
# An Seerr selbst wird nichts verändert.
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then echo "Bitte mit sudo ausführen."; exit 1; fi

APP_USER=couchdeck
URL="${SEERR_URL:-http://127.0.0.1:5055}"
HOME_DIR=$(getent passwd "$APP_USER" | cut -d: -f6)
DEST="$HOME_DIR/.config/couchdeck/seerr.json"

read -r -s -p "Seerr API-Key (Eingabe wird nicht angezeigt): " KEY; echo
KEY=$(printf '%s' "$KEY" | tr -d '[:space:]')
[ -n "$KEY" ] || { echo "Kein Key eingegeben."; exit 1; }

# Prüfen, ohne den Key in der Prozessliste zu zeigen (Header aus Datei)
HDR=$(mktemp); chmod 600 "$HDR"; trap 'rm -f "$HDR"' EXIT
printf 'X-Api-Key: %s\n' "$KEY" > "$HDR"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -H @"$HDR" "$URL/api/v1/auth/me" || true)
if [ "$CODE" != "200" ]; then
  echo "Seerr lehnt den Key ab (HTTP $CODE). Bitte prüfen und erneut versuchen."
  exit 1
fi

install -d -o "$APP_USER" -g "$APP_USER" -m 700 "$HOME_DIR/.config/couchdeck"
umask 077
python3 -c 'import json,sys; json.dump({"url": sys.argv[1], "apiKey": sys.stdin.read().strip()}, open(sys.argv[2], "w"))' "$URL" "$DEST" <<< "$KEY"
chown "$APP_USER:$APP_USER" "$DEST"
chmod 600 "$DEST"
echo "Seerr ist verbunden. In Couchdeck unter „＋ Anfragen“ verfügbar (kein Neustart nötig)."
