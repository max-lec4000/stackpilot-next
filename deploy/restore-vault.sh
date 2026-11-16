#!/bin/bash
set -euo pipefail
if [[ $EUID != 0 || $# != 2 || ( $1 != apply && $1 != undo ) ]]; then
  echo "Aufruf: sudo bash /opt/stackpilot/app/deploy/restore-vault.sh {apply|undo} ORDNER" >&2
  exit 1
fi

exec 9>/run/lock/stackpilot-vault-restore.lock
flock -n 9 || { echo "Eine Tresor-Übernahme läuft bereits." >&2; exit 1; }
unit=stackpilot.service
user=$(systemctl show "$unit" -p User --value)
[[ -n $user && $user != root ]] || { echo "Kein StackPilot-Dienstbenutzer gefunden." >&2; exit 1; }
app=/opt/stackpilot/app
node=/opt/stackpilot/node/bin/node
restore() {
  runuser -u "$user" -- "$node" "$app/scripts/restore-vault-state.mjs" "$@"
}
start_and_check() {
  systemctl reset-failed "$unit" || return 1
  systemctl start "$unit" || return 1
  local result
  for (( local_attempt=0; local_attempt<20; local_attempt++ )); do
    if systemctl is-active --quiet "$unit" &&
        result=$(curl -fsS --max-time 2 -H 'Host: stackpilot.localhost:5173' http://127.0.0.1:5173/api/auth/status 2>/dev/null) &&
        printf '%s' "$result" | "$node" -e 'const s=JSON.parse(require("node:fs").readFileSync(0)); if(s.configured!==true) process.exit(1)' 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  return 1
}

systemctl stop "$unit"
if ! rollback=$(restore "$@"); then
  systemctl reset-failed "$unit"
  systemctl start "$unit"
  exit 1
fi
if start_and_check; then
  printf 'StackPilot läuft. Rückweg:\n  sudo bash %s/deploy/restore-vault.sh undo %s\n' "$app" "$rollback"
  exit 0
fi

systemctl stop "$unit"
if restore undo "$rollback" >/dev/null && start_and_check; then
  echo "StackPilot startete mit der Sicherung nicht. Der bisherige Tresor ist wieder aktiv." >&2
else
  printf 'StackPilot konnte nicht bestätigt werden. Sicherung des bisherigen Tresors unter %s\n' "$rollback" >&2
fi
exit 1
