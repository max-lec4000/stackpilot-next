#!/bin/bash
# Couchdeck entfernen: Autologin zurücksetzen, App und Benutzer löschen.
# Installierte Pakete (cage, mpv, pipewire, avahi …) bleiben; bei Bedarf selbst entfernen.
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then echo "Bitte mit sudo ausführen."; exit 1; fi

rm -f /etc/systemd/system/getty@tty1.service.d/couchdeck-autologin.conf
rmdir /etc/systemd/system/getty@tty1.service.d 2>/dev/null || true
systemctl daemon-reload
# Erst die Sitzung vollständig beenden (auch PipeWire & Co.), sonst verweigert userdel.
if id couchdeck >/dev/null 2>&1; then
  loginctl terminate-user couchdeck 2>/dev/null || true
  pkill -u couchdeck 2>/dev/null || true
  for _ in 1 2 3 4 5; do pgrep -u couchdeck >/dev/null || break; sleep 1; done
  pkill -KILL -u couchdeck 2>/dev/null || true
  sleep 1
  userdel -r couchdeck 2>/dev/null || echo "Hinweis: Benutzer couchdeck konnte nicht entfernt werden."
fi
rm -rf /opt/couchdeck /var/lib/couchdeck
rm -f /etc/modprobe.d/couchdeck-bluetooth.conf
systemctl restart getty@tty1
echo "Couchdeck entfernt."
