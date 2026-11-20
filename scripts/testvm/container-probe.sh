#!/bin/bash
# Phase 7.0c: StackPilot probeweise als Container in der Test-VM – ohne Docker-Socket, nur
# über den Docker-Wächter (apps/docker-guard). Nur für sp-test, nicht für einen echten Server.
#
#   TESTVM_HOST=… scripts/testvm/vm.sh < scripts/testvm/container-probe.sh     (starten)
#   zurück auf den Host-Dienst: docker rm -f sp-probe && sudo systemctl start stackpilot
#
# Voraussetzungen in der VM: Wächter läuft auf /run/sp-docker-guard.sock (Gruppe docker),
# Abbild sp-proto:test (Ubuntu 24.04 + git, openssl, iproute2, util-linux, systemd-Client,
# dazu Docker-CLI, Compose-Plugin und tailscale vom Host). Die App selbst kommt schreibgeschützt
# aus /opt/stackpilot (im echten Abbild wäre sie eingebaut).
set -u
[ "$(hostname)" = sp-test ] || { echo "Nur in sp-test."; exit 1; }
DG=$(getent group docker | cut -d: -f3); LG=$(getent group couchdeck-link | cut -d: -f3)
sudo systemctl stop stackpilot
docker rm -f sp-probe >/dev/null 2>&1
# Daten unter denselben Pfaden wie auf dem Host: Compose-Einbindungen löst der Docker-Dienst
# auf dem Host auf, nicht der Container.
docker run -d --name sp-probe --network host --user 1000:1000 --group-add "$DG" --group-add "$LG" \
  --read-only --tmpfs /tmp:rw,nosuid,size=64m --cap-drop ALL --security-opt no-new-privileges \
  -v /opt/stackpilot:/opt/stackpilot:ro -v /opt/couchdeck/app:/opt/couchdeck/app:ro -v /etc/stackpilot:/etc/stackpilot:ro \
  -v /var/lib/stackpilot:/var/lib/stackpilot -v /var/lib/couchdeck:/var/lib/couchdeck \
  -v /var/lib/stackpilot-update:/var/lib/stackpilot-update:ro \
  -v "$HOME/stackpilot-data:$HOME/stackpilot-data" -v "$HOME/stackpilot-data-appdata:$HOME/stackpilot-data-appdata" \
  -v /run/sp-docker-guard.sock:/run/sp-docker-guard.sock -v /var/run/tailscale/tailscaled.sock:/var/run/tailscale/tailscaled.sock \
  -e HOME="$HOME" -e STACKPILOT_STATE_DIR=/var/lib/stackpilot -e NODE_ENV=production -e STACKPILOT_BIND=0.0.0.0 \
  -e STACKPILOT_DOCKER_HOST=unix:///run/sp-docker-guard.sock -e PATH=/opt/stackpilot/node/bin:/usr/local/bin:/usr/bin:/bin \
  -w /opt/stackpilot/app --entrypoint /opt/stackpilot/node/bin/node sp-proto:test apps/server/start.js
sleep 8; docker ps --filter name=sp-probe --format '{{.Names}} {{.Status}}'
