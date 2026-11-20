#!/bin/bash
# StackPilot Root-Hilfe: die einzigen Aufträge, die die Web-App mit Root-Rechten auslösen darf.
#
# Aufruf nur über systemd:  systemctl start stackpilot-root@<auftrag>.service
# Erlaubt ist das dem StackPilot-Benutzer durch /etc/polkit-1/rules.d/49-stackpilot.rules.
# Diese Datei und alles, was sie aufruft, gehört root; es werden keine Eingaben aus der
# Web-App übernommen – nur der Auftragsname aus der festen Liste unten.
set -euo pipefail

APP=/opt/stackpilot/app
STACKPILOT_USER=""
# shellcheck disable=SC1091
[ -r /etc/stackpilot/install.env ] && . /etc/stackpilot/install.env
export STACKPILOT_USER

case "${1:-}" in
  couchdeck-install)
    COUCHDECK_YTDLP=no bash "$APP/apps/couchdeck/deploy/install.sh"
    ;;
  couchdeck-install-youtube)
    COUCHDECK_YTDLP=yes bash "$APP/apps/couchdeck/deploy/install.sh"
    ;;
  stackpilot-update)
    exec bash "$APP/deploy/update.sh"
    ;;
  docker-guard-enforce)
    # Nur verschärfen: Lockern geht ausschließlich mit sudo am Server.
    exec bash "$APP/deploy/docker-guard.sh" enforce
    ;;
  couchdeck-remove)
    bash "$APP/apps/couchdeck/deploy/uninstall.sh"
    ;;
  *)
    echo "Unbekannter Auftrag." >&2
    exit 64
    ;;
esac
