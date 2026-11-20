# Docker-Wächter

Kleiner Dienst auf dem Host (root), über den StackPilot Docker anspricht – statt direkt über
den Docker-Socket, der root-gleiche Rechte gibt. Er lässt nur die Aufrufe durch, die StackPilot
braucht, und prüft neue Container, Volumes und Netzwerke (siehe `policy.js`).

- Dienst `stackpilot-docker-guard.service`, Socket `/run/stackpilot-docker-guard/docker.sock`
  (Gruppe `stackpilot-docker`), Konfiguration `/etc/stackpilot/docker-guard.json` (gehört root).
- Modi: `observe` (nur protokollieren), `enforce` (sperren, StackPilot-Benutzer verliert die
  Gruppe `docker`), `off` (StackPilot spricht Docker wieder direkt an).
- Umschalten am Server: `sudo /opt/stackpilot/app/deploy/docker-guard.sh observe|enforce|off|status`.
  In StackPilot geht nur das Verschärfen (`enforce`) – lockern nur mit sudo.
- Erlaubte Ordner: fest der Zustandsordner, dazu die Datenordner, die StackPilot in
  `<Zustand>/docker-guard-roots.json` meldet; jeder gemeldete Ordner wird geprüft
  (`rootProblem`: keine Systemordner, keine Home-Ordner selbst, keine Verknüpfungen).
- Status für die Oberfläche: `GET /_stackpilot/guard` auf dem Socket.
