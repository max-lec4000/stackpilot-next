#!/bin/bash
# Kopiert dieses Repo (ohne .git/node_modules) nach ~/stackpilot in der Test-VM.
set -euo pipefail
cd "$(dirname "$0")/../.."
tar -cf - --exclude=.git --exclude=node_modules . | ssh -o BatchMode=yes -o ConnectTimeout=10 "${TESTVM_HOST:?TESTVM_HOST=benutzer@host setzen}" \
  "/snap/bin/lxc exec ${TESTVM_NAME:-sp-test} -T -- sudo -u ubuntu sh -c 'mkdir -p /home/ubuntu/stackpilot && tar -xf - -C /home/ubuntu/stackpilot'"
