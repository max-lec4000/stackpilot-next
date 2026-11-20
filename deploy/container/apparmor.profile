# Verwaltet von StackPilot (deploy/container/apparmor.profile, Phase 7.7).
# Dockers Standardprofil („docker-default“) plus genau eine Erweiterung: D-Bus zum
# systemd-Manager, damit `systemctl start stackpilot-root@….service` aus dem Container geht.
# Was davon erlaubt ist, entscheidet weiterhin allein polkit (49-stackpilot.rules).
#include <tunables/global>

profile stackpilot-container flags=(attach_disconnected,mediate_deleted) {
  #include <abstractions/base>

  network,
  capability,
  file,
  umount,
  # Docker-Standard: Host-Kernel-Schnittstellen nicht beschreiben
  deny @{PROC}/* w,
  deny @{PROC}/{[^1-9],[^1-9][^0-9],[^1-9s][^0-9y][^0-9s],[^1-9][^0-9][^0-9][^0-9/]*}/** w,
  deny @{PROC}/sys/[^k]** w,
  deny @{PROC}/sys/kernel/{?,??,[^s][^h][^m]**} w,
  deny @{PROC}/sysrq-trigger rwklx,
  deny @{PROC}/kcore rwklx,
  deny mount,
  deny /sys/[^f]*/** wklx,
  deny /sys/f[^s]*/** wklx,
  deny /sys/fs/[^c]*/** wklx,
  deny /sys/fs/c[^g]*/** wklx,
  deny /sys/fs/cg[^r]*/** wklx,
  deny /sys/firmware/** rwklx,
  deny /sys/devices/virtual/powercap/** rwklx,
  deny /sys/kernel/security/** rwklx,
  ptrace (trace,read,tracedby,readby) peer=stackpilot-container,
  signal (receive) peer=unconfined,
  # runc/crun stellen „docker stop“ zu (wie in Dockers aktuellem Standardprofil)
  signal (receive) peer=runc,
  signal (receive) peer=crun,
  signal (send,receive) peer=stackpilot-container,

  # Einzige Erweiterung: Systembus nur zum systemd-Manager (und zum Bus selbst für die Anmeldung)
  dbus (send) bus=system path=/org/freedesktop/DBus interface=org.freedesktop.DBus peer=(name=org.freedesktop.DBus),
  dbus (send) bus=system peer=(name=org.freedesktop.systemd1),
  dbus (receive) bus=system,
}
