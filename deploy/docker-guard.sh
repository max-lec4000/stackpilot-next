#!/bin/bash
# Docker-Wächter einrichten und umschalten (root). Siehe apps/docker-guard/README.md.
#
#   sudo /opt/stackpilot/app/deploy/docker-guard.sh status
#   sudo /opt/stackpilot/app/deploy/docker-guard.sh observe   # nur beobachten (Standard)
#   sudo /opt/stackpilot/app/deploy/docker-guard.sh enforce   # sperren
#   sudo /opt/stackpilot/app/deploy/docker-guard.sh off       # ausschalten (Docker direkt)
#   ... apply [--no-restart]   # gespeicherten Modus neu anwenden (install.sh)
#
# observe/enforce: StackPilot spricht Docker nur über den Wächter an. Bei enforce verliert der
# StackPilot-Benutzer außerdem die Gruppe „docker“ – sonst könnte er den Wächter umgehen.
# Das betrifft auch Anmeldungen dieses Kontos: „docker …“ geht dann nur noch mit sudo.
# Aus StackPilot heraus ist nur „enforce“ möglich (Root-Hilfe); lockern nur hier mit sudo.
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then echo "Bitte mit sudo ausführen."; exit 1; fi

PREFIX=/opt/stackpilot
STATE=/var/lib/stackpilot
CONF=/etc/stackpilot/docker-guard.json
UNIT=/etc/systemd/system/stackpilot-docker-guard.service
DROPIN_DIR=/etc/systemd/system/stackpilot.service.d
DROPIN=$DROPIN_DIR/docker-guard.conf
SOCK=/run/stackpilot-docker-guard/docker.sock
GROUP=stackpilot-docker
STACKPILOT_USER=""
# shellcheck disable=SC1091
[ -r /etc/stackpilot/install.env ] && . /etc/stackpilot/install.env
USER_NAME="$STACKPILOT_USER"

saved_mode() {
  # none = noch nie eingerichtet; ein unlesbarer Modus zählt als „sperren“
  [ -f "$CONF" ] || { echo none; return; }
  python3 -c 'import json,sys; m=json.load(open(sys.argv[1])).get("mode"); print(m if m in ("observe","enforce","off") else "enforce")' "$CONF" 2>/dev/null || echo enforce
}
in_group() { id -nG "$USER_NAME" 2>/dev/null | tr ' ' '\n' | grep -qx "$1"; }

write_conf() {
  python3 - "$CONF" "$1" "$SOCK" "$GROUP" "$STATE" <<'EOF'
import json, os, sys
path, mode, sock, group, state = sys.argv[1:]
tmp = path + ".tmp"
with open(tmp, "w") as f:
    json.dump({"listen": sock, "upstream": "/var/run/docker.sock", "mode": mode, "group": group,
               "roots": [state], "rootsFile": state + "/docker-guard-roots.json"}, f, indent=2)
os.chmod(tmp, 0o644)
os.replace(tmp, path)
EOF
}

write_units() {
  cat > "$UNIT" <<EOF
# Verwaltet von StackPilot (deploy/docker-guard.sh)
[Unit]
Description=StackPilot Docker-Wächter
After=docker.service
Wants=docker.service

[Service]
Type=simple
User=root
Group=$GROUP
ExecStart=$PREFIX/node/bin/node $PREFIX/app/apps/docker-guard/guard.js $CONF
ExecStartPost=/bin/sh -c 'for i in \$(seq 50); do [ -S $SOCK ] && exit 0; sleep 0.1; done; exit 1'
RuntimeDirectory=stackpilot-docker-guard
RuntimeDirectoryMode=0750
# Ordner bleibt bei Neustarts erhalten – der StackPilot-Container hat ihn eingebunden
RuntimeDirectoryPreserve=yes
Restart=always
RestartSec=2
UMask=0077
NoNewPrivileges=yes
CapabilityBoundingSet=CAP_CHOWN CAP_DAC_READ_SEARCH
ProtectSystem=strict
ProtectHome=read-only
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
ProtectControlGroups=yes
ProtectClock=yes
ProtectHostname=yes
RestrictAddressFamilies=AF_UNIX
RestrictNamespaces=yes
RestrictRealtime=yes
RestrictSUIDSGID=yes
LockPersonality=yes
SystemCallArchitectures=native
IPAddressDeny=any

[Install]
WantedBy=multi-user.target
EOF
  install -d -m 755 "$DROPIN_DIR"
  cat > "$DROPIN" <<EOF
# Verwaltet von StackPilot (deploy/docker-guard.sh): Docker nur über den Wächter
[Unit]
After=stackpilot-docker-guard.service
Wants=stackpilot-docker-guard.service

[Service]
Environment=STACKPILOT_DOCKER_HOST=unix://$SOCK
EOF
}

apply() {
  local mode="$1" restart="$2"
  [ -n "$USER_NAME" ] && id "$USER_NAME" >/dev/null 2>&1 || { echo "StackPilot-Benutzer unbekannt (/etc/stackpilot/install.env)."; exit 1; }
  case "$mode" in
    off)
      systemctl disable --now stackpilot-docker-guard.service 2>/dev/null || true
      rm -f "$DROPIN"
      usermod -aG docker "$USER_NAME"
      write_conf off   # „aus“ merken, damit ein Update ihn nicht wieder einschaltet
      ;;
    observe|enforce)
      [ -f "$PREFIX/app/apps/docker-guard/guard.js" ] || { echo "Wächter fehlt in $PREFIX/app – StackPilot zuerst aktualisieren."; exit 1; }
      groupadd -f "$GROUP"
      usermod -aG "$GROUP" "$USER_NAME"
      write_conf "$mode"
      write_units
      if [ "$mode" = enforce ]; then
        in_group docker && gpasswd -d "$USER_NAME" docker >/dev/null
      else
        usermod -aG docker "$USER_NAME"   # Rückweg bleibt offen, solange nur beobachtet wird
      fi
      systemctl daemon-reload
      systemctl enable stackpilot-docker-guard.service >/dev/null
      systemctl restart stackpilot-docker-guard.service
      ;;
    *) echo "Unbekannter Modus: $mode"; exit 64 ;;
  esac
  systemctl daemon-reload
  if [ "$restart" = yes ] && systemctl is-enabled --quiet stackpilot.service 2>/dev/null; then
    systemctl reset-failed stackpilot.service 2>/dev/null || true
    systemctl restart stackpilot.service
  fi
  echo "Docker-Wächter: $(label "$mode")."
}

label() {
  case "$1" in
    observe) echo "beobachtet (protokolliert nur, sperrt nichts)" ;;
    enforce) echo "sperrt nicht erlaubte Docker-Aufrufe" ;;
    *) echo "aus – StackPilot spricht Docker direkt an" ;;
  esac
}

case "${1:-status}" in
  status)
    mode="$(saved_mode)"
    echo "Modus: $(label "$mode")"
    echo "Dienst: $(systemctl is-active stackpilot-docker-guard.service 2>/dev/null || true)"
    [ -n "$USER_NAME" ] && echo "Benutzer $USER_NAME in Gruppe docker: $(in_group docker && echo ja || echo nein)"
    echo "Letzte Verstöße:"; journalctl -u stackpilot-docker-guard -n 200 --no-pager -o cat 2>/dev/null | grep '^DENY' | tail -10 || true
    ;;
  observe|enforce|off) apply "$1" yes ;;
  apply)
    # Erstes Einrichten (auch beim Update): Standard „beobachten“, änderbar mit STACKPILOT_DOCKER_GUARD
    restart=yes; [ "${2:-}" = --no-restart ] && restart=no
    mode="$(saved_mode)"; [ "$mode" = none ] && mode="${STACKPILOT_DOCKER_GUARD:-observe}"
    apply "$mode" "$restart"
    ;;
  *) echo "Aufruf: $0 status|observe|enforce|off|apply [--no-restart]"; exit 64 ;;
esac
