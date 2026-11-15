#!/bin/bash
# Führt ein SHELL-SKRIPT von stdin als ubuntu in der Test-VM aus (über den Host).
# Nie Dateien hineinleiten – dafür gibt es vmsync.sh.   Aufruf:  vm.sh <<'EOS' … EOS
# Das Skript wird erst vollständig in eine Datei gelesen und dann ohne stdin ausgeführt;
# sonst verschluckt ein Befehl, der stdin liest, die folgenden Zeilen.
[ -t 0 ] && { echo "Skript über stdin erwartet"; exit 1; }
exec ssh -o BatchMode=yes -o ConnectTimeout=10 "${TESTVM_HOST:?TESTVM_HOST=benutzer@host setzen}" \
  "/snap/bin/lxc exec ${TESTVM_NAME:-sp-test} -T --cwd /home/ubuntu -- sudo -u ubuntu -H bash -c 'f=\$(mktemp) && cat > \"\$f\" && bash -l \"\$f\" </dev/null; s=\$?; rm -f \"\$f\"; exit \$s'"
