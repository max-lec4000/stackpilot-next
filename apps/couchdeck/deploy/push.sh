#!/bin/bash
# Kopiert App + Electron-Laufzeit nach <host>:~/couchdeck-staging (ohne sudo).
# Aufruf: ./deploy/push.sh [host]   (Standard: reatest)
set -euo pipefail
HOST="${1:-reatest}"
cd "$(dirname "$0")/.."
[ -x node_modules/electron/dist/electron ] || { echo "Erst 'npm install' ausführen"; exit 1; }
ssh "$HOST" 'rm -rf ~/couchdeck-staging.new && mkdir -p ~/couchdeck-staging.new'
tar -czf - package.json README.md src deploy \
  --transform 's,^,app/,' | ssh "$HOST" 'tar -xzf - -C ~/couchdeck-staging.new --strip-components=1'
tar -czf - -C node_modules/electron dist --transform 's,^dist,electron,' \
  | ssh "$HOST" 'tar -xzf - -C ~/couchdeck-staging.new'
ssh "$HOST" 'rm -rf ~/couchdeck-staging && mv ~/couchdeck-staging.new ~/couchdeck-staging && chmod +x ~/couchdeck-staging/deploy/*.sh ~/couchdeck-staging/deploy/couchdeck-session'
echo "Kopiert nach $HOST:~/couchdeck-staging"
