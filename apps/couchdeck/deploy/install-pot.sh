#!/bin/bash
# YouTube ohne Anmeldung: PO-Token-Anbieter (bgutil-ytdlp-pot-provider) für yt-dlp.
# Erzeugt dieselben Echtheitsnachweise ("Proof of Origin") wie ein Browser. Das macht die
# Abrufe von Couchdeck unauffälliger und senkt das Risiko der Bot-Prüfung – eine Garantie ist
# es nicht (YouTube sperrt auch nach Internetadresse).
#
# Wird von install.sh aufgerufen, sobald yt-dlp vorhanden ist. Feste Version mit festen
# SHA-256-Prüfsummen; gebaut wird ohne Paket-Skripte (npm --ignore-scripts) als Benutzer
# couchdeck, ausgeführt als abgeschotteter systemd-Dienst, der nur auf 127.0.0.1/::1 lauscht.
# Braucht die Node-Laufzeit von StackPilot (/opt/stackpilot/node); ohne sie wird übersprungen.
#
#   sudo bash /opt/couchdeck/app/deploy/install-pot.sh
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then echo "Bitte mit sudo ausführen."; exit 1; fi

VERSION=2.0.2
SRC_SHA=1f2ae9ec39405b8e80397dfc2551f58deed09d8dff4b2b8fbc314df8e091c0a1
PLUGIN_SHA=a26b980bf6d8e8400d8f21445daa4d8381bf6183d20f0be309391f86b31e27ef
REPO=https://github.com/Brainicism/bgutil-ytdlp-pot-provider
PREFIX=/opt/couchdeck/pot
PLUGINS=/opt/couchdeck/yt-dlp-plugins
NODE_BIN=${COUCHDECK_POT_NODE_BIN:-/opt/stackpilot/node/bin}
UNIT=/etc/systemd/system/couchdeck-pot.service

if [ ! -x /opt/couchdeck/bin/yt-dlp ]; then echo "PO-Token-Anbieter: yt-dlp fehlt – übersprungen."; exit 0; fi
if [ ! -x "$NODE_BIN/node" ] || [ ! -x "$NODE_BIN/npm" ]; then
  echo "PO-Token-Anbieter: keine Node-Laufzeit unter $NODE_BIN – übersprungen."; exit 0
fi

CHANGED=no
if [ "$(cat "$PREFIX/version" 2>/dev/null)" != "$VERSION" ] || [ ! -f "$PLUGINS/bgutil-ytdlp-pot-provider.zip" ]; then
  TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
  chmod 711 "$TMP"   # Benutzer couchdeck muss in den Bauordner wechseln dürfen
  echo "PO-Token-Anbieter: lade Version $VERSION …"
  curl -fsSL -o "$TMP/src.tar.gz" "$REPO/archive/refs/tags/$VERSION.tar.gz"
  curl -fsSL -o "$TMP/plugin.zip" "$REPO/releases/download/$VERSION/bgutil-ytdlp-pot-provider.zip"
  echo "$SRC_SHA  $TMP/src.tar.gz" | sha256sum -c --status - \
    || { echo "PO-Token-Anbieter: Prüfsumme der Quellen stimmt NICHT – nichts installiert."; exit 1; }
  echo "$PLUGIN_SHA  $TMP/plugin.zip" | sha256sum -c --status - \
    || { echo "PO-Token-Anbieter: Prüfsumme des yt-dlp-Plugins stimmt NICHT – nichts installiert."; exit 1; }
  install -d -o couchdeck -g couchdeck -m 700 "$TMP/build"
  tar xzf "$TMP/src.tar.gz" -C "$TMP/build" --strip-components=1 --no-same-owner
  chown -R couchdeck:couchdeck "$TMP/build"
  # Bauen als unprivilegierter Benutzer, ohne Installationsskripte der Pakete
  runuser -u couchdeck -- env -i HOME="$TMP/build" PATH="$NODE_BIN:/usr/bin:/bin" \
    npm_config_cache="$TMP/build/.npm" npm_config_update_notifier=false \
    bash -c 'cd "$1/server" && npm ci --ignore-scripts --no-audit --no-fund --loglevel=error \
      && ./node_modules/.bin/tsc && npm prune --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error' _ "$TMP/build" \
    || { echo "PO-Token-Anbieter: Bauen fehlgeschlagen – nichts verändert."; exit 1; }
  [ -f "$TMP/build/server/build/main.js" ] || { echo "PO-Token-Anbieter: build/main.js fehlt – nichts verändert."; exit 1; }
  rm -rf "$PREFIX.new"; install -d -m 755 "$PREFIX.new"
  cp -a "$TMP/build/server/build" "$TMP/build/server/node_modules" "$TMP/build/server/package.json" "$PREFIX.new/"
  cp -a "$TMP/build/LICENSE" "$PREFIX.new/LICENSE"
  echo "$VERSION" > "$PREFIX.new/version"
  chown -R root:root "$PREFIX.new"; chmod -R go-w "$PREFIX.new"
  rm -rf "$PREFIX"; mv "$PREFIX.new" "$PREFIX"
  install -d -m 755 "$PLUGINS"
  install -m 644 "$TMP/plugin.zip" "$PLUGINS/bgutil-ytdlp-pot-provider.zip"
  CHANGED=yes
fi

cat > "$UNIT.new" <<EOF
[Unit]
Description=Couchdeck: YouTube-PO-Token-Anbieter (bgutil $VERSION, nur lokal)
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=$NODE_BIN/node $PREFIX/build/main.js --port 4416
WorkingDirectory=$PREFIX
Environment=NODE_ENV=production
Restart=on-failure
RestartSec=10
DynamicUser=yes
NoNewPrivileges=yes
CapabilityBoundingSet=
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
ProtectControlGroups=yes
ProtectClock=yes
ProtectHostname=yes
ProtectProc=invisible
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
RestrictNamespaces=yes
RestrictRealtime=yes
RestrictSUIDSGID=yes
LockPersonality=yes
SystemCallArchitectures=native
MemoryMax=768M
TasksMax=64

[Install]
WantedBy=multi-user.target
EOF
if ! cmp -s "$UNIT.new" "$UNIT"; then mv "$UNIT.new" "$UNIT"; CHANGED=yes; else rm -f "$UNIT.new"; fi
systemctl daemon-reload
systemctl enable couchdeck-pot.service >/dev/null 2>&1
if [ "$CHANGED" = yes ]; then systemctl restart couchdeck-pot.service; else systemctl start couchdeck-pot.service; fi
for _ in $(seq 20); do
  curl -fsS -o /dev/null http://127.0.0.1:4416/ping 2>/dev/null && { echo "PO-Token-Anbieter: läuft (Version $VERSION)."; exit 0; }
  sleep 1
done
echo "PO-Token-Anbieter: Dienst antwortet nicht – YouTube läuft trotzdem, nur ohne Token."
