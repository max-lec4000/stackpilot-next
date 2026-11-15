#!/bin/bash
# YouTube-Unterstützung: yt-dlp nach /opt/couchdeck/bin installieren oder aktualisieren.
# Wird von install.sh aufgerufen und fragt vorher nach. Quelle: offizielle GitHub-Releases
# von yt-dlp; die Datei wird gegen die dort veröffentlichte SHA-256-Prüfsumme geprüft.
#
#   sudo bash /opt/couchdeck/app/deploy/install-ytdlp.sh          (fragt nach)
#   sudo COUCHDECK_YTDLP=yes bash …/install-ytdlp.sh               (ohne Rückfrage)
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then echo "Bitte mit sudo ausführen."; exit 1; fi

BIN_DIR=/opt/couchdeck/bin
BIN="$BIN_DIR/yt-dlp"
BASE=https://github.com/yt-dlp/yt-dlp/releases/latest/download

# yt-dlp braucht für YouTube eine JavaScript-Laufzeit: Electron dient als Node (kein Extra-Download)
install -d -m 755 "$BIN_DIR"
cat > "$BIN_DIR/node" <<'EOF'
#!/bin/sh
ELECTRON_RUN_AS_NODE=1 exec /opt/couchdeck/electron/electron "$@"
EOF
chmod 755 "$BIN_DIR/node"

if [ -x "$BIN" ]; then
  QUESTION="yt-dlp ist installiert ($("$BIN" --version 2>/dev/null || echo '?')). Auf die neueste Version aktualisieren? [j/N] "
else
  QUESTION="YouTube in Couchdeck: yt-dlp von github.com/yt-dlp installieren? [j/N] "
fi

ANSWER="${COUCHDECK_YTDLP:-}"
if [ -z "$ANSWER" ]; then
  if [ -t 0 ]; then read -r -p "$QUESTION" ANSWER; else ANSWER=no; fi
fi
case "$ANSWER" in
  j|J|ja|Ja|y|Y|yes) ;;
  *) echo "yt-dlp: übersprungen."; exit 0 ;;
esac

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
echo "yt-dlp: lade neueste Version …"
curl -fsSL -o "$TMP/yt-dlp_linux" "$BASE/yt-dlp_linux"
curl -fsSL -o "$TMP/SHA2-256SUMS" "$BASE/SHA2-256SUMS"
( cd "$TMP" && grep ' yt-dlp_linux$' SHA2-256SUMS | sha256sum -c --status - ) \
  || { echo "yt-dlp: Prüfsumme stimmt NICHT – nichts installiert."; exit 1; }
install -m 755 "$TMP/yt-dlp_linux" "$BIN"
echo "yt-dlp: installiert ($("$BIN" --version))."
