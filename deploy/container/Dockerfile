# StackPilot-Laufzeit (Phase 7.7): nur Werkzeuge. Node.js und die App selbst kommen
# schreibgeschützt vom Host (/opt/stackpilot) – Updates von StackPilot ändern dieses Abbild
# deshalb nicht. Docker-CLI, Compose-Plugin und tailscale stammen vom Host (gleiche Version
# wie der Docker-Dienst); install.sh legt sie in den Bauordner.
ARG BASE=ubuntu:24.04@sha256:9c7f200c07e3d4a03e7249d2c16bf66a51120fb876aa2242cf31451412543289
FROM ${BASE}
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      ca-certificates git openssl iproute2 util-linux procps systemd \
 && rm -rf /var/lib/apt/lists/*
COPY bin/ /usr/local/bin/
COPY cli-plugins/ /usr/local/lib/docker/cli-plugins/
LABEL io.stackpilot.runtime="1"
