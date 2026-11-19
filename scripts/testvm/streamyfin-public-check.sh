#!/bin/bash
# Prüft die öffentlich erreichbaren Streamyfin-/Jellyfin-Routen des Schutz-Gateways von außen.
# Ohne Zugangsdaten: erlaubt muss nur die enge Seerr-Teilmenge sein, alles andere gesperrt.
#
#   scripts/testvm/streamyfin-public-check.sh https://<host>              (z. B. über das Tailnet)
#   scripts/testvm/streamyfin-public-check.sh https://<host> <öffentliche-IP>   (über das Internet)
set -u
BASE="$1"; IP="${2:-}"
HOST="${BASE#https://}"; HOST="${HOST%%/*}"
CURL=(curl -s -o /dev/null -w "%{http_code}" --max-time 15)
[ -n "$IP" ] && CURL+=(--resolve "$HOST:443:$IP")
fail=0
check() { # Beschreibung, erwartete Codes (Regex), Methode, Pfad, [weitere curl-Argumente]
  local name="$1" want="$2" method="$3" path="$4"; shift 4
  local code; code=$("${CURL[@]}" -X "$method" "$@" "$BASE$path")
  if [[ "$code" =~ ^($want)$ ]]; then echo "OK   $name → $code"; else echo "FEHL $name → $code (erwartet $want)"; fail=1; fi
}
J=(-H "Content-Type: application/json" --data '{}')
echo "== Erlaubt (Streamyfin-Teilmenge)"
check "Seerr-Status"                          "200"         GET  /seerr/api/v1/status
check "Seerr öffentliche Einstellungen"       "200"         GET  /seerr/api/v1/settings/public
check "Suche ohne Sitzung (Seerr verlangt Anmeldung)" "401|403" GET "/seerr/api/v1/search?query=test"
check "Anfrage ohne Sitzung"                  "401|403"     POST /seerr/api/v1/request "${J[@]}"
echo "== Gesperrt"
check "Seerr-Weboberfläche"                   "404"         GET  /seerr/
check "Seerr-Verwaltung (settings/main)"      "404"         GET  /seerr/api/v1/settings/main
check "Benutzerliste"                         "404"         GET  /seerr/api/v1/user
check "Lokale Passwort-Anmeldung"             "404"         POST /seerr/api/v1/auth/local "${J[@]}"
check "Jellyfin-Passwort-Anmeldung über Seerr" "404"        POST /seerr/api/v1/auth/jellyfin "${J[@]}"
check "Bildproxy"                             "404"         GET  /seerr/imageproxy/tmdb/t/p/w300/x.jpg
check "Passwortwechsel"                       "404"         POST /seerr/api/v1/user/1/settings/password "${J[@]}"
check "Rechteänderung"                        "404"         POST /seerr/api/v1/user/1/settings/permissions "${J[@]}"
check "Erlaubte Route mit API-Schlüssel"      "403"         GET  /seerr/api/v1/status -H "X-Api-Key: test"
check "Pfadtrick ../"                         "400|404"     GET  /seerr/api/v1/status/../settings/main --path-as-is
check "Pfadtrick %2e%2e"                      "400|404"     GET  /seerr/api/v1/status/%2e%2e/settings/main --path-as-is
check "Pfadtrick doppelter Schrägstrich"      "400|404"     GET  //seerr/api/v1/settings/main --path-as-is
check "Jellyfin-Passwortanmeldung"            "401|403|404" POST /Users/AuthenticateByName "${J[@]}"
check "Jellyfin-Startup-Assistent"            "401|403|404" GET  /Startup/Configuration
echo "== Grenze für Schreibzugriffe (30/min, Puffer 20)"
codes=""; for _ in $(seq 30); do codes+="$("${CURL[@]}" -X POST "${J[@]}" "$BASE/seerr/api/v1/request") "; done
n429=$(grep -o "429" <<<"$codes" | wc -l)
if [ "$n429" -ge 5 ]; then echo "OK   30 schnelle POST → $n429× 429"; else echo "FEHL 30 schnelle POST → nur $n429× 429"; fail=1; fi
[ $fail = 0 ] && echo "STREAMYFIN_PUBLIC_CHECK_CONFIRMED" || echo "STREAMYFIN_PUBLIC_CHECK_FAILED"
