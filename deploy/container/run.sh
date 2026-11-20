#!/bin/bash
# StackPilot im Container starten (Phase 7.7). Aufruf nur durch stackpilot.service (root).
# Der Container bekommt keinen Docker-Socket, nur den Docker-Wächter; er läuft als
# StackPilot-Benutzer, schreibgeschützt, ohne Linux-Rechte, mit eigenem AppArmor-Profil.
# Daten liegen unter denselben Pfaden wie auf dem Host (Compose-Einbindungen löst der
# Docker-Dienst auf dem Host auf).
set -euo pipefail
PREFIX=/opt/stackpilot
STATE=/var/lib/stackpilot
IMAGE=stackpilot-runtime:local
# shellcheck disable=SC1091
. /etc/stackpilot/install.env
: "${STACKPILOT_USER:?}"
USER_UID=$(id -u "$STACKPILOT_USER"); USER_GID=$(id -g "$STACKPILOT_USER")
USER_HOME=$(getent passwd "$STACKPILOT_USER" | cut -d: -f6)
[ -d "$USER_HOME" ] || { echo "Heimordner von $STACKPILOT_USER fehlt."; exit 1; }
GUARD_DIR=/run/stackpilot-docker-guard
[ -S "$GUARD_DIR/docker.sock" ] || { echo "Docker-Wächter läuft nicht – Container-Modus braucht ihn."; exit 1; }

args=(run --rm --name stackpilot --init --network host
  --user "$USER_UID:$USER_GID" --read-only --tmpfs /tmp:rw,nosuid,nodev,size=128m
  --cap-drop ALL --security-opt no-new-privileges --security-opt apparmor=stackpilot-container
  --pids-limit 1024 --stop-timeout 240 --log-opt max-size=10m --log-opt max-file=2
  --label io.stackpilot.self=true)
for g in stackpilot-docker couchdeck-link; do
  gid=$(getent group "$g" | cut -d: -f3 || true); [ -n "$gid" ] && args+=(--group-add "$gid")
done
ro() { [ -e "$1" ] && args+=(-v "$1:$1:ro"); return 0; }
rw() { [ -e "$1" ] && args+=(-v "$1:$1"); return 0; }
ro "$PREFIX"; ro /opt/couchdeck/app; ro /etc/stackpilot; ro /var/lib/stackpilot-update
ro /etc/passwd; ro /etc/group; ro /etc/localtime; ro /etc/timezone
# /run/systemd/system: daran erkennt systemctl, dass systemd läuft (spricht dann per D-Bus)
ro /run/dbus; ro /run/systemd/system; ro "$GUARD_DIR"; ro /run/tailscale
rw "$STATE"; rw /var/lib/couchdeck; rw "$USER_HOME"
# Weitere Datenordner eines Stacks außerhalb des Heimordners (vom Wächter bekannt)
if [ -r "$STATE/docker-guard-roots.json" ]; then
  while IFS= read -r root; do
    case "$root" in /|/etc*|/usr*|/bin*|/sbin*|/lib*|/boot*|/proc*|/sys*|/dev*|/run*|/var/run*|"$USER_HOME"|"$USER_HOME"/*|"$STATE"|"$STATE"/*) continue ;; esac
    [ -d "$root" ] && [ ! -L "$root" ] && args+=(-v "$root:$root")
  done < <(python3 -c 'import json,sys; [print(p) for p in json.load(open(sys.argv[1])).get("roots", []) if isinstance(p, str) and p.startswith("/")]' "$STATE/docker-guard-roots.json" 2>/dev/null || true)
fi
args+=(-e HOME="$USER_HOME" -e USER="$STACKPILOT_USER" -e STACKPILOT_STATE_DIR="$STATE" -e NODE_ENV=production
  -e STACKPILOT_BIND="${STACKPILOT_BIND:-0.0.0.0}" -e STACKPILOT_CONTAINER=1
  -e STACKPILOT_DOCKER_HOST="unix://$GUARD_DIR/docker.sock"
  -e PATH="$PREFIX/node/bin:/usr/local/bin:/usr/bin:/bin"
  -w "$PREFIX/app" --entrypoint "$PREFIX/node/bin/node" "$IMAGE" apps/server/start.js)
exec /usr/bin/docker "${args[@]}"
