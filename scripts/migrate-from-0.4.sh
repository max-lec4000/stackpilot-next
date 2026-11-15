#!/bin/bash
# Umstellung eines Servers mit dem früheren StackPilot 0.4 auf diese Fassung.
#
#   sudo bash scripts/migrate-from-0.4.sh [--data /pfad/zum/datenordner] [--yes]
#
# Was dieses Skript macht (in dieser Reihenfolge, jeweils mit Ausgabe):
#   1. Zeigt, was es gefunden hat, und fragt nach (außer mit --yes).
#   2. Beendet den alten StackPilot-Prozess.
#   3. Stoppt und entfernt die Container des alten Stacks (Medien, Authentik, Schutz).
#      Es werden keine Volumes und keine Dateien gelöscht.
#   4. Benennt den alten Konfigurationsordner um (<daten>-appdata → <daten>-appdata-alt-<datum>).
#   5. Nimmt die beiden alten Tailscale-Adressen (443, 8443) zurück, falls sie auf den alten
#      Stack zeigen.
#   6. Installiert die neue Fassung (install.sh).
#
# Was bleibt: der Medienordner mit allen Filmen/Serien/Downloads, der alte StackPilot-Ordner
# samt Tresor, der umbenannte Konfigurationsordner, Couchdecks Einstellungen.
# Was danach neu entsteht: Konten, Jellyfin-Verlauf, Quellen, Anfragen, Authentik.
#
# Danach im Browser: Einrichtung starten, denselben Datenpfad angeben und
# „Vorhandenen Medienordner übernehmen“ ankreuzen.
#
# Zurück zum alten Stand (solange die neue Einrichtung den Medienordner noch nicht
# übernommen hat): siehe die Datei ZURUECK.txt im umbenannten Konfigurationsordner.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "Bitte mit sudo ausführen."; exit 1; fi
SRC="$(cd "$(dirname "$0")/.." && pwd)"
ADMIN="${SUDO_USER:-}"
[ -n "$ADMIN" ] && [ "$ADMIN" != root ] || { echo "Bitte mit sudo aus dem normalen Benutzerkonto starten."; exit 1; }
ADMIN_HOME="$(getent passwd "$ADMIN" | cut -d: -f6)"
DATA="$ADMIN_HOME/stackpilot-data"
OLD="$ADMIN_HOME/stackpilot"
YES=no
while [ $# -gt 0 ]; do
  case "$1" in
    --data) DATA="${2:-}"; shift ;;
    --old) OLD="${2:-}"; shift ;;
    --yes) YES=yes ;;
    *) echo "Unbekannte Option: $1"; exit 1 ;;
  esac
  shift
done
DATA="${DATA%/}"
APPDATA="$DATA-appdata"
STAMP="$(date +%Y%m%d-%H%M%S)"
KEEP="$APPDATA-alt-$STAMP"

[ -d "$DATA/media" ] || { echo "Kein Medienordner unter $DATA/media gefunden. Mit --data angeben."; exit 1; }
EXTRA="$(ls -A "$DATA" | grep -vxE 'media|downloads|\.stackpilot-owner(\.previous.*)?\.json|lost\+found' || true)"
if [ -n "$EXTRA" ]; then
  echo "Im Datenordner liegen Einträge, die die Übernahme später ablehnt:"; echo "$EXTRA" | sed 's/^/  /'
  echo "Bitte zuerst woanders hin verschieben."; exit 1
fi

# Container des alten Stacks: genau die vier bekannten Compose-Projekte.
mapfile -t CONTAINERS < <(docker ps -a --format '{{.ID}} {{.Label "com.docker.compose.project"}} {{.Names}}' \
  | awk '$2 == "stackpilot" || $2 ~ /^sp-(identity|media|oidc)-[0-9a-f]+$/ { print $1 " " $3 }')
mapfile -t NETWORKS < <(docker network ls --format '{{.Name}}' | grep -E '^(stackpilot|sp-(identity|media|oidc)-[0-9a-f]+)_' || true)

echo "Gefunden:"
echo "  Medienordner:        $DATA ($(du -sh "$DATA" 2>/dev/null | cut -f1)) – bleibt unverändert"
if [ -d "$APPDATA" ]; then echo "  Alte Konfiguration:  $APPDATA → wird umbenannt in $(basename "$KEEP")"; fi
echo "  Alte Container:      ${#CONTAINERS[@]} – werden gestoppt und entfernt (keine Dateien gelöscht)"
for c in "${CONTAINERS[@]}"; do echo "    ${c#* }"; done
[ -d "$OLD/.stackpilot" ] && echo "  Alter StackPilot:    $OLD – bleibt liegen (Tresor, alte Compose-Dateien)"
echo
echo "Danach laufen Jellyfin & Co. NICHT mehr, bis die neue Einrichtung im Browser durch ist."
echo "Wiedergabeverlauf, Konten, Quellen und Anfragen des alten Stacks gehen dabei verloren."
if [ "$YES" != yes ]; then
  read -r -p 'Jetzt umstellen? Zum Bestätigen "UMSTELLEN" eingeben: ' ANSWER
  [ "$ANSWER" = UMSTELLEN ] || { echo "Abgebrochen. Es wurde nichts verändert."; exit 1; }
fi

echo "==> 1/5 Alten StackPilot beenden"
runuser -u "$ADMIN" -- env XDG_RUNTIME_DIR="/run/user/$(id -u "$ADMIN")" systemctl --user disable --now stackpilot.service 2>/dev/null || true
pkill -TERM -u "$ADMIN" -f 'apps/server/start\.js' 2>/dev/null || true
for _ in $(seq 1 30); do pgrep -u "$ADMIN" -f 'apps/server/start\.js' >/dev/null || break; sleep 1; done
systemctl stop stackpilot.service 2>/dev/null || true

echo "==> 2/5 Alte Container stoppen und entfernen"
for c in "${CONTAINERS[@]}"; do
  id="${c%% *}"
  docker update --restart=no "$id" >/dev/null 2>&1 || true
  docker stop --time 60 "$id" >/dev/null
  docker rm "$id" >/dev/null
  echo "  entfernt: ${c#* }"
done
for n in "${NETWORKS[@]}"; do [ -n "$n" ] && docker network rm "$n" >/dev/null 2>&1 || true; done

echo "==> 3/5 Alte Konfiguration beiseitelegen"
if [ -d "$APPDATA" ]; then
  mv "$APPDATA" "$KEEP"
  {
    echo "Zurück zum alten Stack (nur solange die neue Einrichtung den Medienordner noch nicht übernommen hat):"
    echo "  sudo systemctl disable --now stackpilot.service"
    echo "  mv '$KEEP' '$APPDATA'"
    for f in "$OLD"/.stackpilot/deployments/*/compose.json "$OLD"/.stackpilot/identity-secrets/*/compose.json "$OLD"/.stackpilot/media-protection/*/compose.json; do
      [ -f "$f" ] && echo "  docker compose -f '$f' up -d"
    done
    echo "  cd '$OLD' && npm start"
    echo "Tailscale-Adressen danach in der alten Oberfläche unter Externer Zugriff wieder einrichten."
  } > "$KEEP/ZURUECK.txt"
  chown "$ADMIN" "$KEEP/ZURUECK.txt"
  echo "  $KEEP"
fi

echo "==> 4/5 Alte Tailscale-Adressen zurücknehmen"
if command -v tailscale >/dev/null; then
  STATUS="$(tailscale serve status 2>/dev/null || true)"
  if echo "$STATUS" | grep -q '127.0.0.1:19096'; then tailscale serve --https=443 off >/dev/null 2>&1 || true; echo "  443 zurückgenommen"; fi
  if echo "$STATUS" | grep -q '127.0.0.1:19080'; then tailscale serve --https=8443 off >/dev/null 2>&1 || true; echo "  8443 zurückgenommen"; fi
fi

echo "==> 5/5 Neue Fassung installieren"
STACKPILOT_USER="$ADMIN" bash "$SRC/install.sh"
echo
echo "Weiter im Browser: Einrichtung starten, Datenpfad  $DATA  angeben und"
echo "„Vorhandenen Medienordner übernehmen“ ankreuzen."
