#!/bin/bash
# StackPilot – Installation auf einem frischen Ubuntu Server 24.04 (einmalig, mit sudo).
#
#   git clone <repo> stackpilot && sudo bash stackpilot/install.sh
#
# Optionen:
#   --tailscale     Tailscale mitinstallieren (für HTTPS/Funnel; es geht auch ohne)
#   --user <name>   Benutzer, unter dem StackPilot läuft (Standard: wer sudo aufruft)
#
# Was dieses Skript macht:
#   1. Pakete: Docker mit Compose, curl, polkit (nur was fehlt)
#   2. Node.js in exakt der Version aus .nvmrc nach /opt/stackpilot/node
#      (von nodejs.org, gegen die veröffentlichte SHA-256-Prüfsumme geprüft)
#   3. StackPilot bauen und nach /opt/stackpilot/app kopieren (gehört root, die Web-App
#      kann ihren eigenen Code nicht verändern)
#   4. Systemdienst stackpilot.service – läuft als normaler Benutzer, startet beim Booten
#   5. Eng begrenzte Root-Hilfe: Der StackPilot-Benutzer darf genau die Aufträge aus
#      deploy/root-helper.sh starten (Couchdeck installieren/entfernen), sonst nichts
#   6. Tailscale (falls vorhanden): StackPilot darf Serve/Funnel ohne sudo einrichten
#
# Erneutes Ausführen aktualisiert eine bestehende Installation; Zustand und Daten bleiben.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "Bitte mit sudo ausführen."; exit 1; fi

SRC="$(cd "$(dirname "$0")" && pwd)"
PREFIX=/opt/stackpilot
STATE=/var/lib/stackpilot
ETC=/etc/stackpilot
ADMIN="${STACKPILOT_USER:-${SUDO_USER:-}}"
WITH_TAILSCALE=no

while [ $# -gt 0 ]; do
  case "$1" in
    --tailscale) WITH_TAILSCALE=yes ;;
    --user) ADMIN="${2:-}"; shift ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "Unbekannte Option: $1"; exit 1 ;;
  esac
  shift
done

# ---------- Vorprüfung ----------
if [ -z "$ADMIN" ] || [ "$ADMIN" = root ] || ! id "$ADMIN" >/dev/null 2>&1; then
  echo "StackPilot läuft als normaler Benutzer. Bitte mit sudo aus dessen Konto starten"
  echo "oder --user <name> angeben."
  exit 1
fi
. /etc/os-release
if [ "${ID:-}" != ubuntu ] || [ "${VERSION_ID:-}" != 24.04 ]; then
  if [ "${STACKPILOT_ALLOW_UNQUALIFIED_LINUX:-}" != 1 ]; then
    echo "Geprüft ist nur Ubuntu Server 24.04 (gefunden: ${PRETTY_NAME:-unbekannt})."
    exit 1
  fi
fi
case "$(uname -m)" in
  x86_64) NODE_ARCH=x64 ;;
  *) echo "Geprüft ist nur x86-64 (gefunden: $(uname -m))."; exit 1 ;;
esac
NODE_VERSION="$(tr -d ' \n\rv' < "$SRC/.nvmrc")"
case "$NODE_VERSION" in
  ''|*[!0-9.]*) echo "Ungültige Node-Version in .nvmrc."; exit 1 ;;
esac

echo "==> 1/6 Pakete"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y --no-install-recommends ca-certificates curl xz-utils polkitd git
if ! docker compose version >/dev/null 2>&1; then
  apt-get install -y docker.io docker-compose-v2
fi
systemctl enable --now docker
usermod -aG docker "$ADMIN"
# Gemeinsame Gruppe für die Übergabe an Couchdeck. Sie entsteht schon jetzt, damit der
# Dienst beim Start Mitglied ist – auch wenn Couchdeck erst später dazukommt.
groupadd -f couchdeck-link
usermod -aG couchdeck-link "$ADMIN"

echo "==> 2/6 Node.js $NODE_VERSION"
if [ "$("$PREFIX/node/bin/node" --version 2>/dev/null || true)" = "v$NODE_VERSION" ]; then
  echo "Bereits installiert."
else
  TMP_NODE="$(mktemp -d)"
  NODE_TAR="node-v$NODE_VERSION-linux-$NODE_ARCH.tar.xz"
  NODE_URL="https://nodejs.org/dist/v$NODE_VERSION"
  curl -fsSL -o "$TMP_NODE/$NODE_TAR" "$NODE_URL/$NODE_TAR"
  curl -fsSL -o "$TMP_NODE/SHASUMS256.txt" "$NODE_URL/SHASUMS256.txt"
  WANT="$(awk -v f="$NODE_TAR" '$2 == f { print $1 }' "$TMP_NODE/SHASUMS256.txt")"
  HAVE="$(sha256sum "$TMP_NODE/$NODE_TAR" | cut -d' ' -f1)"
  if [ -z "$WANT" ] || [ "$WANT" != "$HAVE" ]; then
    rm -rf "$TMP_NODE"
    echo "Node.js: Prüfsumme stimmt NICHT – Abbruch, es wurde nichts installiert."
    exit 1
  fi
  mkdir -p "$PREFIX"
  rm -rf "$PREFIX/node.new"
  mkdir "$PREFIX/node.new"
  tar -xJf "$TMP_NODE/$NODE_TAR" -C "$PREFIX/node.new" --strip-components=1 --no-same-owner
  rm -rf "$TMP_NODE" "$PREFIX/node"
  mv "$PREFIX/node.new" "$PREFIX/node"
fi

echo "==> 3/6 StackPilot bauen"
# Gebaut wird als normaler Benutzer in einem Wegwerfordner; root führt keine Paketskripte aus.
BUILD="$(mktemp -d /var/tmp/stackpilot-build.XXXXXX)"
trap 'rm -rf "$BUILD"' EXIT
tar -C "$SRC" --exclude=.git --exclude=node_modules --exclude=.stackpilot \
  --exclude='apps/web/dist' -cf - . | tar -C "$BUILD" -xf -
chown -R "$ADMIN" "$BUILD"
ADMIN_HOME="$(getent passwd "$ADMIN" | cut -d: -f6)"
as_admin() {
  runuser -u "$ADMIN" -- env HOME="$ADMIN_HOME" PATH="$PREFIX/node/bin:/usr/bin:/bin" "$@"
}
( cd "$BUILD" && as_admin npm ci --no-audit --no-fund && as_admin npm run build )
[ -f "$BUILD/apps/web/dist/index.html" ] || { echo "Build fehlgeschlagen."; exit 1; }
# Zur Laufzeit braucht der Server nur Node selbst; die Build-Abhängigkeiten bleiben draußen.
rm -rf "$BUILD/node_modules" "$BUILD/apps/couchdeck/node_modules"
chown -R root:root "$BUILD"
chmod -R go-w "$BUILD"
chmod 755 "$BUILD"
WAS_ACTIVE=no
if systemctl is-active --quiet stackpilot.service; then
  WAS_ACTIVE=yes
  systemctl stop stackpilot.service
fi
rm -rf "$PREFIX/app.old"
[ -d "$PREFIX/app" ] && mv "$PREFIX/app" "$PREFIX/app.old"
mv "$BUILD" "$PREFIX/app"
trap - EXIT
rm -rf "$PREFIX/app.old"
chmod 755 "$PREFIX/app/deploy/root-helper.sh"
# Welcher Stand installiert ist (für die Update-Anzeige)
COMMIT="${STACKPILOT_COMMIT:-$(git -C "$SRC" rev-parse HEAD 2>/dev/null || true)}"
case "$COMMIT" in *[!0-9a-f]*|"") rm -f "$PREFIX/app/.stackpilot-commit" ;; *) echo "$COMMIT" > "$PREFIX/app/.stackpilot-commit" ;; esac

echo "==> 4/6 Systemdienst"
install -d -o "$ADMIN" -g "$ADMIN" -m 700 "$STATE"
install -d -m 755 "$ETC"
# Update-Quelle: dasselbe GitHub-Repository, aus dem diese Fassung stammt (überschreibbar).
REPO="${STACKPILOT_REPO:-$(git -C "$SRC" remote get-url origin 2>/dev/null || true)}"
REPO="${REPO:-https://github.com/max-lec4000/stackpilot-next.git}"
case "$REPO" in https://*) ;; *) REPO="https://github.com/max-lec4000/stackpilot-next.git" ;; esac
BRANCH="${STACKPILOT_BRANCH:-main}"
printf 'STACKPILOT_USER=%s\nSTACKPILOT_REPO=%s\nSTACKPILOT_BRANCH=%s\n' "$ADMIN" "$REPO" "$BRANCH" > "$ETC/install.env"
cat > /etc/systemd/system/stackpilot.service <<EOF
# Verwaltet von StackPilot (install.sh)
[Unit]
Description=StackPilot – Medienstack einrichten und verwalten
After=network-online.target docker.service
Wants=network-online.target
StartLimitIntervalSec=60
StartLimitBurst=3

[Service]
Type=simple
User=$ADMIN
WorkingDirectory=$PREFIX/app
ExecStart=$PREFIX/node/bin/node apps/server/start.js
Environment=STACKPILOT_STATE_DIR=$STATE
Environment=NODE_ENV=production
# Oberfläche und Dienste im Heimnetz und Tailnet erreichbar (nur am Server: 127.0.0.1)
Environment=STACKPILOT_BIND=${STACKPILOT_BIND:-0.0.0.0}
Environment=PATH=$PREFIX/node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
UMask=0077
NoNewPrivileges=yes
Restart=on-failure
RestartSec=5
TimeoutStopSec=250
KillMode=mixed

[Install]
WantedBy=multi-user.target
EOF

echo "==> 5/6 Begrenzte Root-Hilfe"
cat > /etc/systemd/system/stackpilot-root@.service <<EOF
# Verwaltet von StackPilot (install.sh). Führt genau einen vordefinierten Auftrag aus.
[Unit]
Description=StackPilot Root-Hilfe (%i)

[Service]
Type=oneshot
ExecStart=$PREFIX/app/deploy/root-helper.sh %i
EOF
# Der StackPilot-Benutzer darf ausschließlich diese Aufträge starten. Welche es gibt,
# steht in deploy/root-helper.sh – die Datei gehört root.
cat > /etc/polkit-1/rules.d/49-stackpilot.rules <<EOF
// Verwaltet von StackPilot (install.sh)
polkit.addRule(function (action, subject) {
  if (action.id !== "org.freedesktop.systemd1.manage-units" || subject.user !== "$ADMIN") return;
  var unit = action.lookup("unit");
  var verb = action.lookup("verb");
  if (verb === "start" &&
      /^stackpilot-root@(couchdeck-install|couchdeck-install-youtube|couchdeck-remove|stackpilot-update)\\.service\$/.test(unit)) {
    return polkit.Result.YES;
  }
});
EOF
chmod 644 /etc/polkit-1/rules.d/49-stackpilot.rules
systemctl daemon-reload

echo "==> 6/6 Tailscale"
if [ "$WITH_TAILSCALE" = yes ] && ! command -v tailscale >/dev/null; then
  CODENAME="${VERSION_CODENAME:-noble}"
  curl -fsSL "https://pkgs.tailscale.com/stable/ubuntu/$CODENAME.noarmor.gpg" \
    -o /usr/share/keyrings/tailscale-archive-keyring.gpg
  curl -fsSL "https://pkgs.tailscale.com/stable/ubuntu/$CODENAME.tailscale-keyring.list" \
    -o /etc/apt/sources.list.d/tailscale.list
  apt-get update -q
  apt-get install -y tailscale
fi
if command -v tailscale >/dev/null; then
  if tailscale set --operator="$ADMIN" 2>/dev/null; then
    echo "Tailscale: $ADMIN darf Serve/Funnel einrichten."
  else
    echo "Tailscale ist installiert, aber noch nicht angemeldet. Danach erneut:"
    echo "  sudo tailscale up --operator=$ADMIN"
  fi
else
  echo "Nicht installiert – übersprungen. Nachholen mit: sudo bash install.sh --tailscale"
fi

systemctl enable stackpilot.service >/dev/null
systemctl restart stackpilot.service
sleep 2
echo
if systemctl is-active --quiet stackpilot.service; then
  echo "StackPilot läuft.$( [ "$WAS_ACTIVE" = yes ] && echo ' (aktualisiert)')"
  LAN_IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1)}' | head -1)"
  echo "Im Browser öffnen:  http://${LAN_IP:-<Adresse-dieses-Servers>}:5173"
  # Den Setupcode nur zeigen, solange noch kein Administrator angelegt ist.
  if curl -fsS --max-time 5 http://127.0.0.1:5173/api/auth/status 2>/dev/null \
      | grep -q '"configured":false' && [ -f "$STATE/bootstrap-token" ]; then
    echo "Einmaliger Setupcode für die erste Anmeldung:  $(cat "$STATE/bootstrap-token")"
  fi
  echo "Protokoll:  journalctl -u stackpilot -n 50 --no-pager"
else
  echo "StackPilot ist nicht gestartet. Bitte prüfen:  journalctl -u stackpilot -n 50 --no-pager"
  exit 1
fi
