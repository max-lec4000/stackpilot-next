#!/bin/bash
# Unterbau für die Test-VM – einmalig auf dem Host (z. B. medienserver) mit sudo ausführen.
#
#   sudo bash host-setup.sh
#
# Was dieses Skript macht:
#   1. Legt in der Volume-Gruppe ein eigenes, fest begrenztes Volume an (Standard 45 GB).
#      Die Test-VM kann dadurch nie den Platz des laufenden Systems aufbrauchen.
#   2. Installiert LXD (snap), falls es fehlt.
#   3. Richtet darin einen Speicherpool auf genau diesem Volume und ein VM-Profil ein.
#      Die VM hängt per macvlan direkt im Heimnetz (eigene Adresse vom Router) –
#      es wird KEINE Netzwerkbrücke angelegt und KEINE Firewall-Regel verändert.
#
# Was es NICHT anfasst: Docker, laufende Container, den StackPilot-Ordner, Mediendaten,
# Tailscale, das Wurzel-Dateisystem.
#
# Rückgängig machen:  sudo bash host-setup.sh --remove
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "Bitte mit sudo ausführen."; exit 1; fi

VG="${VG:-ubuntu-vg}"
LV="${LV:-stackpilot-testvm}"
SIZE="${SIZE:-45G}"
POOL="${POOL:-sptest}"
PROFILE="${PROFILE:-sptest}"
ADMIN="${SUDO_USER:-}"
LXC=/snap/bin/lxc

if [ "${1:-}" = "--remove" ]; then
  if [ -x "$LXC" ]; then
    for vm in $("$LXC" list --format csv -c n 2>/dev/null); do
      if "$LXC" config show "$vm" 2>/dev/null | grep -q "^- $PROFILE\$"; then
        echo "Entferne VM $vm"; "$LXC" delete --force "$vm"
      fi
    done
    "$LXC" profile delete "$PROFILE" 2>/dev/null || true
    "$LXC" storage delete "$POOL" 2>/dev/null || true
  fi
  if lvs "$VG/$LV" >/dev/null 2>&1; then lvremove -y "$VG/$LV"; fi
  echo "Test-Unterbau entfernt. LXD selbst bleibt installiert (bei Bedarf: sudo snap remove lxd)."
  exit 0
fi

PARENT="${PARENT:-$(ip -4 route show default | awk '{print $5; exit}')}"
[ -n "$PARENT" ] || { echo "Netzwerkschnittstelle nicht gefunden. Mit PARENT=<name> angeben."; exit 1; }
[ -e /dev/kvm ] || { echo "/dev/kvm fehlt – Virtualisierung im BIOS einschalten."; exit 1; }

echo "==> 1/3 Eigenes Volume $VG/$LV ($SIZE)"
if lvs "$VG/$LV" >/dev/null 2>&1; then
  echo "Volume existiert bereits."
else
  lvcreate -y -L "$SIZE" -n "$LV" "$VG"
fi

echo "==> 2/3 LXD"
if [ ! -x "$LXC" ]; then
  command -v snap >/dev/null || { apt-get update -q; apt-get install -y snapd; }
  snap install lxd
fi
/snap/bin/lxd waitready --timeout 180
[ -n "$ADMIN" ] && usermod -aG lxd "$ADMIN"

echo "==> 3/3 Speicherpool und VM-Profil"
if ! "$LXC" storage show "$POOL" >/dev/null 2>&1; then
  "$LXC" storage create "$POOL" btrfs source="/dev/$VG/$LV"
fi
if ! "$LXC" profile show "$PROFILE" >/dev/null 2>&1; then
  "$LXC" profile create "$PROFILE"
  "$LXC" profile device add "$PROFILE" root disk path=/ pool="$POOL" size=40GiB
  "$LXC" profile device add "$PROFILE" eth0 nic nictype=macvlan parent="$PARENT"
  "$LXC" profile set "$PROFILE" limits.cpu=4 limits.memory=6GiB
fi

echo
echo "Fertig. Die VM selbst wird ohne sudo angelegt:"
echo "  lxc launch ubuntu:24.04 sp-test --vm --profile $PROFILE"
