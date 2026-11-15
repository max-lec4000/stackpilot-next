#!/bin/bash
# Test-VM auf "frisch" zurücksetzen: Stack, Daten, StackPilot-Zustand und Couchdeck löschen.
# LÖSCHT ALLES – läuft deshalb nur auf einer Maschine, die sich als Test-VM ausweist.
set -euo pipefail
case "$(hostname)" in sp-test*) ;; *) echo "Nur für die Test-VM (Hostname sp-test…)."; exit 1 ;; esac
[ -f "$HOME/.stackpilot-test/admin.json" ] || [ "${1:-}" = "--force" ] || { echo "Kein Testzustand gefunden."; exit 1; }
sudo systemctl stop stackpilot.service 2>/dev/null || true
# Die Test-VM gehört allein StackPilot: alle Container und deren Netze, auch Authentik & Schutz.
ids=$(docker ps -aq)
[ -z "$ids" ] || docker rm -f $ids >/dev/null
docker network prune -f >/dev/null
command -v tailscale >/dev/null && tailscale serve reset 2>/dev/null || true
sudo rm -rf "$HOME/stackpilot-data" "$HOME/stackpilot-data-appdata" /var/lib/stackpilot/* "$HOME/.stackpilot-test/admin.json"
if [ -d /opt/couchdeck ]; then sudo bash /opt/stackpilot/app/apps/couchdeck/deploy/uninstall.sh >/dev/null; fi
echo "Zurückgesetzt. Images bleiben für den nächsten Lauf im Cache."
