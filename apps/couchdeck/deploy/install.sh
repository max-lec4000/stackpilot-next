#!/bin/bash
# Couchdeck – Installation auf dem Server (einmalig, mit sudo ausführen)
#
#   Direkt von GitHub:   git clone https://github.com/max-lec4000/couchdeck.git && sudo bash couchdeck/deploy/install.sh
#   Vom Entwicklungsrechner (deploy/push.sh):   sudo bash ~/couchdeck-staging/deploy/install.sh
#
# Was dieses Skript macht:
#   1. Pakete installieren: cage (Kiosk-Compositor), mpv, PipeWire, Avahi, Intel-VA-API, Laufzeit-Bibliotheken für Electron
#   2. Benutzer "couchdeck" anlegen (Gruppen video, render, input, audio – KEIN sudo, KEIN docker)
#   3. App nach /opt/couchdeck kopieren (Electron-Laufzeit wird bei Bedarf von github.com/electron
#      geladen – exakt die Version aus package.json, gegen die offizielle SHA-256-Prüfsumme geprüft)
#   4. Autologin von "couchdeck" auf tty1 → startet cage + Couchdeck im Vollbild
#   5. PipeWire so einrichten, dass AirPlay-Geräte (WiiM) als Audioausgang erscheinen
#
# Was es NICHT anfasst: Docker, stackpilot*, Jellyfin, *arr, Seerr, qBittorrent, Netzwerk, SSH.
# Rückgängig machen: sudo bash /opt/couchdeck/app/deploy/uninstall.sh
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "Bitte mit sudo ausführen."; exit 1; fi

SRC="$(cd "$(dirname "$0")/.." && pwd)"
APP_USER=couchdeck
PREFIX=/opt/couchdeck

echo "==> 1/5 Pakete installieren"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y --no-install-recommends \
  cage mpv \
  pipewire pipewire-audio pipewire-pulse wireplumber pulseaudio-utils libspa-0.2-modules libpipewire-0.3-modules \
  avahi-daemon libnss-mdns \
  intel-media-va-driver-non-free vainfo \
  bluez curl ca-certificates unzip qrencode \
  fonts-noto-core fonts-noto-color-emoji \
  libgtk-3-0t64 libnss3 libgbm1 libasound2t64 libxss1 libxtst6 libatk-bridge2.0-0t64 libcups2t64 \
  libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libpango-1.0-0 libcairo2 libsecret-1-0 \
  xwayland
systemctl enable --now avahi-daemon

echo "==> 2/5 Benutzer $APP_USER"
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash --comment "Couchdeck Kiosk" "$APP_USER"
  passwd -l "$APP_USER" >/dev/null   # kein Passwort-Login
fi
usermod -aG video,render,input,audio "$APP_USER"

# Übergabeordner für StackPilot: dort legt StackPilot Adressen und Zugänge ab
# (integration.json) und schaltet Couchdeck ein/aus (control/off). Zugriff hat nur die
# Gruppe couchdeck-link – Couchdeck selbst und der StackPilot-Benutzer.
LINK_USER="${STACKPILOT_USER:-}"
if [ -z "$LINK_USER" ] && [ -r /etc/stackpilot/install.env ]; then
  LINK_USER=$(sed -n 's/^STACKPILOT_USER=//p' /etc/stackpilot/install.env)
fi
groupadd -f couchdeck-link
usermod -aG couchdeck-link "$APP_USER"
if [ -n "$LINK_USER" ] && id "$LINK_USER" >/dev/null 2>&1; then usermod -aG couchdeck-link "$LINK_USER"; fi
install -d -o root -g couchdeck-link -m 2770 /var/lib/couchdeck /var/lib/couchdeck/control

echo "==> 3/5 App nach $PREFIX"
mkdir -p "$PREFIX"

# Electron-Laufzeit: mitgeliefert (push.sh) -> bereits installiert in passender Version -> herunterladen
ELECTRON_VERSION=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["devDependencies"]["electron"].lstrip("^~"))' "$SRC/package.json")
ELECTRON_DIR="$SRC/electron"
TMP_EL=""
if [ ! -x "$ELECTRON_DIR/electron" ]; then
  if [ -x "$PREFIX/electron/electron" ] && [ "$(cat "$PREFIX/electron/version" 2>/dev/null)" = "$ELECTRON_VERSION" ]; then
    echo "Electron $ELECTRON_VERSION ist bereits installiert."
    ELECTRON_DIR="$PREFIX/electron"
  else
    case "$(uname -m)" in
      x86_64) EL_ARCH=x64 ;; aarch64) EL_ARCH=arm64 ;; *) echo "Nicht unterstützte Architektur: $(uname -m)"; exit 1 ;;
    esac
    EL_ZIP="electron-v$ELECTRON_VERSION-linux-$EL_ARCH.zip"
    EL_URL="https://github.com/electron/electron/releases/download/v$ELECTRON_VERSION"
    TMP_EL=$(mktemp -d)
    echo "Lade Electron $ELECTRON_VERSION ($EL_ARCH) von github.com/electron …"
    curl -fsSL -o "$TMP_EL/$EL_ZIP" "$EL_URL/$EL_ZIP"
    curl -fsSL -o "$TMP_EL/SHASUMS256.txt" "$EL_URL/SHASUMS256.txt"
    WANT=$(awk -v f="$EL_ZIP" '{ n=$2; sub(/^\*/, "", n); if (n == f) print $1 }' "$TMP_EL/SHASUMS256.txt")
    HAVE=$(sha256sum "$TMP_EL/$EL_ZIP" | cut -d' ' -f1)
    if [ -z "$WANT" ] || [ "$WANT" != "$HAVE" ]; then
      echo "Electron: Prüfsumme stimmt NICHT – Abbruch, es wurde nichts verändert."
      rm -rf "$TMP_EL"; exit 1
    fi
    echo "Electron: Prüfsumme in Ordnung."
    unzip -q "$TMP_EL/$EL_ZIP" -d "$TMP_EL/electron"
    ELECTRON_DIR="$TMP_EL/electron"
  fi
fi

rm -rf "$PREFIX/app.new" "$PREFIX/electron.new"
mkdir -p "$PREFIX/app.new"
cp -a "$SRC/package.json" "$SRC/src" "$SRC/deploy" "$PREFIX/app.new/"
cp -a "$ELECTRON_DIR" "$PREFIX/electron.new"
[ -n "$TMP_EL" ] && rm -rf "$TMP_EL"
rm -rf "$PREFIX/app" "$PREFIX/electron"
mv "$PREFIX/app.new" "$PREFIX/app"
mv "$PREFIX/electron.new" "$PREFIX/electron"
chown -R root:root "$PREFIX"
chmod 4755 "$PREFIX/electron/chrome-sandbox"   # Chromium-Sandbox braucht setuid
install -m 755 "$SRC/deploy/couchdeck-session" "$PREFIX/couchdeck-session"

echo "==> 4/5 Autologin auf tty1"
mkdir -p /etc/systemd/system/getty@tty1.service.d
cat > /etc/systemd/system/getty@tty1.service.d/couchdeck-autologin.conf <<EOF
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin $APP_USER --noclear %I \$TERM
EOF
HOME_DIR=$(getent passwd "$APP_USER" | cut -d: -f6)
# Log nach /var/log/couchdeck: Gruppe adm (Admins) darf lesen
install -d -o "$APP_USER" -g adm -m 2750 /var/log/couchdeck
install -o "$APP_USER" -g "$APP_USER" -m 644 "$SRC/deploy/bash_profile" "$HOME_DIR/.bash_profile"

echo "==> 5/5 PipeWire: AirPlay-Ausgänge"
install -d -o "$APP_USER" -g "$APP_USER" "$HOME_DIR/.config" "$HOME_DIR/.config/pipewire" "$HOME_DIR/.config/pipewire/pipewire.conf.d"
install -o "$APP_USER" -g "$APP_USER" -m 644 "$SRC/deploy/pipewire-raop.conf" "$HOME_DIR/.config/pipewire/pipewire.conf.d/50-couchdeck-raop.conf"

echo "==> YouTube (optional)"
bash "$SRC/deploy/install-ytdlp.sh" || echo "yt-dlp: Installation fehlgeschlagen – YouTube bleibt aus, Rest geht weiter."

echo "==> Bluetooth: Xbox-Controller-Unterstützung (ERTM aus)"
# Ältere Xbox-One-S-Controller (Bluetooth classic) brechen sonst die HID-Verbindung ab.
echo "options bluetooth disable_ertm=Y" > /etc/modprobe.d/couchdeck-bluetooth.conf
echo Y > /sys/module/bluetooth/parameters/disable_ertm 2>/dev/null || true

systemctl daemon-reload

# PipeWire des Couchdeck-Benutzers neu starten, damit geänderte Audio-Einstellungen greifen
if systemctl is-active --quiet "user@$(id -u "$APP_USER").service"; then
  systemctl --user --machine="$APP_USER@.host" restart pipewire.service pipewire-pulse.service wireplumber.service 2>/dev/null \
    && echo "PipeWire von $APP_USER neu gestartet." || echo "Hinweis: PipeWire konnte nicht neu gestartet werden."
fi
echo
if pgrep -u "$APP_USER" -x cage >/dev/null; then
  echo "Couchdeck läuft bereits – wird mit der neuen Version neu gestartet."
  systemctl restart getty@tty1
  echo "Fertig."
else
  # Erster Start ohne Handgriff – außer jemand arbeitet gerade an der Konsole tty1.
  TTY_USER=$(who | awk '$2 == "tty1" { print $1; exit }')
  if [ -z "$TTY_USER" ] || [ "$TTY_USER" = "$APP_USER" ]; then
    systemctl restart getty@tty1
    echo "Fertig. Couchdeck startet jetzt auf dem Bildschirm (sofern einer angeschlossen ist)."
  else
    echo "Fertig. An der Konsole ist gerade $TTY_USER angemeldet – Couchdeck startet nach dem"
    echo "Abmelden dort, mit  sudo systemctl restart getty@tty1  oder beim nächsten Neustart."
  fi
fi
