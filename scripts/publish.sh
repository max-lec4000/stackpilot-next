#!/bin/bash
# Den aktuellen Stand ins öffentliche Repository übernehmen – als ein neuer Commit auf
# dessen Verlauf, ohne den privaten Entwicklungsverlauf mitzuschicken.
#   scripts/publish.sh "Kurze Beschreibung"
# Erwartet die Remotes "origin" (öffentlich) und "dev" (privat, voller Verlauf).
set -euo pipefail
cd "$(dirname "$0")/.."
MSG="${1:?Beschreibung angeben}"
[ -z "$(git status --porcelain)" ] || { echo "Erst committen."; exit 1; }
git push -q dev HEAD:main
git fetch -q origin main
TREE=$(git rev-parse HEAD^{tree})
if [ "$TREE" = "$(git rev-parse origin/main^{tree})" ]; then echo "Öffentlich ist schon aktuell."; exit 0; fi
# Vor dem Veröffentlichen: keine Schlüssel und keine eigenen privaten Angaben. Eigene
# Muster (Tailnet-Name, Heimnetz-Adressen …) stehen außerhalb des Repos, eins pro Zeile:
#   ~/.config/stackpilot/publish-private-patterns
PATTERNS="${HOME}/.config/stackpilot/publish-private-patterns"
if git ls-files -z | xargs -0 grep -lIE 'PrivateKey *= *[A-Za-z0-9+/]{40}|gh[pousr]_[A-Za-z0-9]{30,}|tskey-[a-z]+-[A-Za-z0-9]{10,}|BEGIN [A-Z ]*PRIVATE KEY' | grep .; then
  echo "Abbruch: mögliche Schlüssel in den genannten Dateien."; exit 1
fi
if [ -s "$PATTERNS" ] && git ls-files -z | xargs -0 grep -lIEf "$PATTERNS" | grep .; then
  echo "Abbruch: private Angaben in den genannten Dateien."; exit 1
fi
COMMIT=$(git commit-tree "$TREE" -p origin/main -m "$MSG")
git push -q origin "$COMMIT:refs/heads/main"
echo "Veröffentlicht: ${COMMIT:0:7}"
