import { readFile, mkdir, lstat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { RetirementEngine, localDocker, readContainers } from "./retirement.js";
import { inventory, inspectPath, command } from "./inventory.js";
import { deploymentReadiness } from "./deployment.js";
import { catalog } from "./catalog.js";
import {
  composeFor,
  prepareFiles,
  testHardlinks,
  inspectAdoption,
  networkLayout,
  serviceNetworks,
} from "./provision-files.js";
import { Services } from "./service-api.js";
import { probeVpn } from "./vpn.js";
import { randomUUID } from "node:crypto";
import { bindAddress } from "./access.js";
export function needsNetworkUpgrade(plan) {
  return plan.networkLayout !== networkLayout;
}

export class DeploymentEngine extends RetirementEngine {
  constructor(store, vault, options = {}) {
    super(store, options.docker || localDocker);
    this.vault = vault;
    this.inspectStorage = options.inspectStorage || inspectPath;
    this.project = options.project || "stackpilot";
    this.portOffset = options.portOffset || 0;
    // Wo die Weboberflächen der Dienste hören: nur am Server oder auch im Heimnetz/Tailnet.
    this.bind = options.bind || bindAddress();
    this.allowUnqualifiedLinux =
      options.allowUnqualifiedLinux ??
      process.env.STACKPILOT_ALLOW_UNQUALIFIED_LINUX === "1";
  }
  async tunAvailable() {
    try {
      return (await lstat("/dev/net/tun")).isCharacterDevice();
    } catch {
      return false;
    }
  }
  async host() {
    return inventory(async (binary, args) =>
      binary === "docker"
        ? this.docker(args)
            .then((output) => ({ ok: true, output }))
            .catch(() => ({
              ok: false,
              reason: "Lokaler Docker-Daemon nicht erreichbar.",
            }))
        : command(binary, args),
    );
  }
  current() {
    const job = this.store.latestDeployment();
    return job ? { job, plan: this.store.plan(job.planId) } : null;
  }
  async createPlan(spec) {
    const active = this.current();
    const base = active?.job.status === "completed" ? active.plan : null;
    if (base) await this.validate(base, true);

    const [host, storage, configStorage, containers] = await Promise.all([
      this.host(),
      this.inspectStorage(spec?.path),
      this.inspectStorage(spec?.path + "-appdata"),
      readContainers(this.docker),
    ]);
    const vpnProfileId =
      spec?.vpnProfileId || (base?.spec.vpn ? base.vpnProfileId : null);
    const vpnProfile =
      vpnProfileId && this.vault.get(`vpn-profile:${vpnProfileId}`);
    const result = deploymentReadiness(spec, host, storage, {
      allowUnqualifiedLinux: this.allowUnqualifiedLinux,
      vpnProfile: !!vpnProfile,
      existing: base?.spec.selected,
      ownedIds: base
        ? containers.filter((c) => c.project === base.project).map((c) => c.id)
        : [],
    });
    result.kind = "deployment";
    result.catalogVersion = catalog.version;
    result.project = base?.project || this.project;
    result.rootId = base?.rootId || base?.id || result.id;
    result.vpnProfileId = result.spec.vpn ? vpnProfileId : null;
    result.basePlanId = base?.id || null;
    result.existing = base?.spec.selected || [];
    result.added = result.spec.selected.filter(
      (n) => !result.existing.includes(n),
    );
    if (base) {
      if (active.job.status !== "completed")
        result.blockers.push("Vorhandenen Auftrag zuerst abschließen.");
      if (base.spec.selected.some((n) => !result.spec.selected.includes(n)))
        result.blockers.push(
          "Installierte Apps bleiben ausgewählt. Entfernen ist ein eigener Vorgang.",
        );
      for (const key of ["path", "username", "language", "quality"])
        if (result.spec[key] !== base.spec[key])
          result.blockers.push(
            "Bei Erweiterungen bleibt " + key + " unverändert.",
          );
      if (
        base.spec.vpn &&
        (!result.spec.vpn || vpnProfileId !== base.vpnProfileId)
      )
        result.blockers.push(
          "VPN-Abschaltung oder Profilwechsel ist kein Erweiterungsvorgang.",
        );
      if (
        !base.spec.vpn &&
        result.spec.vpn &&
        base.spec.selected.includes("qBittorrent")
      ) {
        result.vpnTransition = true;
        result.originalQbitId = containers.find(
          (c) => c.project === base.project && c.service === "qbittorrent",
        )?.id;
        result.warnings.push(
          "VPN-Umbau: qBittorrent wird nach Sicherung seiner Einstellungen gestoppt und mit denselben Daten ausschließlich im VPN-Netzwerk neu erstellt. Kein automatischer Rückfall ohne VPN.",
        );
      }
      // Ein eingerichtetes Couchdeck bleibt; Entfernen ist ein eigener Vorgang.
      if (base.spec.couchdeck) {
        result.spec.couchdeck = true;
        result.spec.couchdeckYoutube = !!base.spec.couchdeckYoutube;
      }
      result.addsCouchdeck = result.spec.couchdeck && !base.spec.couchdeck;
      // Ältere Stacks bekommen beim nächsten Plan die getrennten Netze.
      result.networkUpgrade = needsNetworkUpgrade(base);
      if (result.networkUpgrade)
        result.warnings.push(
          "Netze werden getrennt: Jellyfin kommt in ein eigenes Netz, ohne Zugang zu ARR-Diensten und Downloadclient. Die betroffenen Container (auch VPN und qBittorrent) werden dafür einmal neu erstellt; Daten und Einstellungen bleiben.",
        );
      if (!result.added.length && !result.vpnTransition && !result.addsCouchdeck && !result.networkUpgrade)
        result.blockers.push("Keine zusätzliche App ausgewählt.");
    }

    if (!base) result.addsCouchdeck = result.spec.couchdeck;
    if (result.addsCouchdeck && this.couchdeck) {
      const state = await this.couchdeck.status();
      if ((!state.installed || state.outdated) && !state.helper.available)
        result.blockers.push(
          "Couchdeck braucht die Root-Hilfe. StackPilot einmal mit „sudo bash install.sh“ einrichten oder Couchdeck abwählen.",
        );
      if (state.helper.running)
        result.blockers.push("Es läuft bereits ein Couchdeck-Auftrag.");
    }
    result.appdata = result.spec.path + "-appdata";
    for (const target of [result.spec.path, result.appdata]) {
      for (const protectedRoot of [process.cwd(), this.store.directory]) {
        const root = path.resolve(protectedRoot);
        if (target === root || target.startsWith(root + "/"))
          result.blockers.push(
            "Daten und Dienstkonfigurationen müssen außerhalb des StackPilot-Quellcodes und Zustandsordners liegen.",
          );
      }
    }
    result.networkLayout = networkLayout;
    result.uid = process.getuid();
    result.gid = process.getgid();
    // Erweiterungen behalten die Bindung des bestehenden Stacks.
    result.bind = base ? base.bind || "127.0.0.1" : this.bind;
    result.ports = Object.fromEntries(
      result.spec.selected.map((n) => [
        n,
        catalog.services[n].hostPort + this.portOffset,
      ]),
    );
    result.images = Object.fromEntries(
      [
        ...result.spec.selected,
        "ApiRelay",
        ...(result.spec.vpn ? ["Gluetun", "VpnProbe"] : []),
      ].map((n) => [n, base?.images[n] || catalog.services[n].image]),
    );
    if (result.spec.vpn) {
      if (!(await this.tunAvailable()))
        result.blockers.push("VPN benötigt /dev/net/tun auf dem Server.");
      result.warnings.push(
        "Mullvad wird vor qBittorrent mit HTTPS geprüft und der Tunnel für den Ausfallsperrentest kontrolliert unterbrochen. IPv6 bleibt im VPN-Netzwerk deaktiviert. Keine Portweiterleitung bei Mullvad.",
      );
    }
    result.expiresAt = new Date(Date.now() + 30 * 60000).toISOString();
    result.confirmation = "OK";
    // Übernahme: Der Medienordner eines früheren Stacks darf bestehen bleiben, wenn er nur
    // Medien und Downloads enthält. Die Dienstkonfiguration entsteht trotzdem immer neu.
    const adopting = !base && result.spec.adopt && storage.exists;
    if (adopting) {
      const adoption = await inspectAdoption(result.spec.path).catch(() => null);
      if (!adoption)
        result.blockers.push("Der vorhandene Medienordner ist nicht lesbar.");
      else if (adoption.unexpected.length)
        result.blockers.push(
          "Im Medienordner liegen unerwartete Einträge (" +
            adoption.unexpected.slice(0, 5).join(", ") +
            "). Übernommen werden nur die Ordner media und downloads.",
        );
      else {
        result.adoptedData = true;
        result.adoptedFrom = adoption.previous;
        result.warnings.push(
          "Vorhandener Medienordner wird übernommen: Filme, Serien und Musik bleiben unverändert und erscheinen nach dem ersten Bibliotheksscan in Jellyfin. Wiedergabeverlauf, Konten und Einstellungen des früheren Stacks werden nicht übernommen.",
        );
      }
    } else result.spec.adopt = false;
    if (!base && ((storage.exists && !result.adoptedData) || configStorage.exists))
      result.blockers.push(
        configStorage.exists && result.adoptedData
          ? `Der Konfigurationsordner ${result.spec.path}-appdata existiert bereits. Er gehört zum früheren Stack und muss vorher umbenannt werden; er wird nicht übernommen.`
          : "Daten- und Konfigurationsordner müssen neu sein – oder „Vorhandenen Medienordner übernehmen“ wählen. Vorhandene Inhalte werden nie überschrieben.",
      );
    if (
      !base &&
      ((result.adoptedData
        ? storage.existingParent !== result.spec.path
        : storage.existingParent !== path.dirname(result.spec.path)) ||
        configStorage.existingParent !== path.dirname(result.appdata) ||
        storage.resolvedParent !== storage.existingParent)
    )
      result.blockers.push(
        "Wähle einen neuen direkten Unterordner eines vorhandenen, aufgelösten Speicherpfads. Keine unbekannten Zwischenordner oder Symlinks.",
      );
    if (result.uid === 0)
      result.blockers.push(
        "StackPilot für diesen Pilot als normalen Benutzer mit Docker-Zugriff starten, nicht als root.",
      );
    const network = await this.network(result.project);
    if (network && !base)
      result.blockers.push(
        "Das Zielnetzwerk existiert bereits. Zugehörigen Auftrag prüfen, keine automatische Netzwerkübernahme.",
      );
    if (!base && containers.some((c) => c.project === result.project))
      result.blockers.push(
        "Ein StackPilot-Projekt ist bereits vorhanden. Den zugehörigen Auftrag fortsetzen; Erweiterung/Übernahme ist noch nicht freigegeben.",
      );
    result.warnings.push(
      "Alle Dienstpasswörter und API-Schlüssel werden getrennt erzeugt. Die Anzeige erfolgt erst nach erneuter Administrator-Bestätigung.",
      "Kein Indexer oder Torrent wird automatisch hinzugefügt. Qualität ist zunächst eine Empfehlung für spätere Medienanfragen.",
      result.bind === "0.0.0.0"
        ? "Die Weboberflächen der Dienste werden nach erfolgreicher Konten- und Verbindungsprüfung im Heimnetz und im Tailnet per HTTP erreichbar. Jeder Dienst behält seine eigene Anmeldung; ins Internet wird dadurch nichts freigegeben."
        : "Die Einrichtung veröffentlicht lokale Webports erst nach erfolgreicher Konten- und Verbindungsprüfung.",
      "Erweiterungen behalten vorhandene Konten und Konfigurationen. Automatische Updates und vollständige Sicherungen sind noch nicht freigegeben.",
    );
    if (base) {
      const previous =
        base.serviceDefinitions || composeFor(base, true).services;
      if (!base.serviceDefinitions) {
        // Legacy plans predate frozen Compose definitions. Preserve only their
        // non-secret proxy exclusions; never execute arbitrary manifest fields.
        const legacy = JSON.parse(
          await readFile(
            path.join(
              this.store.directory,
              "deployments",
              base.id,
              "compose.json",
            ),
            "utf8",
          ),
        );
        for (const [slug, definition] of Object.entries(previous)) {
          for (const key of ["NO_PROXY", "no_proxy"]) {
            const value = legacy.services?.[slug]?.environment?.[key];
            if (definition.environment && typeof value === "string")
              definition.environment[key] = value;
          }
        }
      }
      result.preservedServices = Object.fromEntries(
        Object.entries(previous).filter(
          ([slug]) => !(result.vpnTransition && slug === "qbittorrent"),
        ),
      );
      for (const name of result.added) {
        try {
          await lstat(path.join(result.appdata, catalog.services[name].slug));
          result.blockers.push(
            `${name}: Konfigurationsordner existiert bereits. Keine automatische Übernahme.`,
          );
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
        }
      }
    }
    result.serviceDefinitions = composeFor(result, true).services;
    result.executable = result.blockers.length === 0;
    result.steps = [
      {
        id: "prepare",
        label:
          "Neue Datenordner, Dienstgeheimnisse und Compose-Plan vorbereiten",
      },
      {
        id: "storage-test",
        label:
          "Schreibrechte und echte Hardlinks mit temporären Dateien prüfen",
      },
      ...result.added
        .concat("ApiRelay", ...(result.spec.vpn ? ["Gluetun", "VpnProbe"] : []))
        .map((n) => ({
          id: "pull:" + n,
          label: `${n}: festgelegtes Image laden`,
        })),
      ...(result.vpnTransition
        ? [
            {
              id: "vpn-quarantine",
              label:
                "qBittorrent-Einstellungen sichern und bisherigen Container gezielt stoppen",
            },
          ]
        : []),
      ...(result.spec.vpn
        ? [
            {
              id: "vpn-start",
              label:
                result.existing.includes("qBittorrent") && !result.vpnTransition
                  ? "Vorhandenen VPN-Schutz beibehalten"
                  : "Nur VPN und isolierten Prüfcontainer starten",
            },
            { id: "vpn-check", label: "Mullvad-Ausgang über HTTPS nachweisen" },
            ...(result.existing.includes("qBittorrent") && !result.vpnTransition
              ? []
              : [
                  {
                    id: "vpn-isolation",
                    label:
                      "Tunnel stoppen und Internet-Ausfallsperre funktional nachweisen",
                  },
                  {
                    id: "vpn-reconnect",
                    label: "Mullvad-Tunnel nach Ausfall erneut nachweisen",
                  },
                ]),
          ]
        : []),
      {
        id: "bootstrap",
        label: "Alle gewählten Container gemeinsam intern starten",
      },
      ...[
        ...new Set([
          ...result.added,
          ...(result.vpnTransition ? ["qBittorrent"] : []),
        ]),
      ].flatMap((n) => [
        { id: "ready:" + n, label: `${n}: echte Bereitschaft prüfen` },
        {
          id: "configure:" + n,
          label: `${n}: Konto und Grundkonfiguration einrichten`,
        },
      ]),
      {
        id: "connections",
        label: "Dienstverbindungen automatisch anlegen und testen",
      },
      {
        id: "verify",
        label: "Konten, Bibliotheken und Verbindungen funktional prüfen",
      },
      { id: "publish", label: "Geschützte lokale Webzugänge freigeben" },
      ...(result.addsCouchdeck
        ? [
            {
              id: "couchdeck-install",
              label: "Couchdeck auf dem Server installieren",
            },
          ]
        : []),
      ...(result.spec.couchdeck
        ? [
            {
              id: "couchdeck-link",
              label:
                "Couchdeck verbinden: Wohnzimmer-Konto, Adressen und Seerr-Zugang",
            },
          ]
        : []),
    ];
    return this.store.savePlan(result);
  }
  async network(project) {
    const names = (
      await this.docker([
        "network",
        "ls",
        "--filter",
        `name=^${project}_default$`,
        "--format",
        "{{.Name}}",
      ])
    )
      .trim()
      .split("\n");
    if (!names.includes(project + "_default")) return null;
    const text = await this.docker([
      "network",
      "inspect",
      project + "_default",
      "--format",
      '{"id":{{json .Id}},"project":{{json (index .Labels "com.docker.compose.project")}},"plan":{{json (index .Labels "io.stackpilot.plan")}}}',
    ]);
    return JSON.parse(text);
  }
  async validate(plan, allowOwn = false) {
    if (
      !plan ||
      plan.kind !== "deployment" ||
      plan.host !== os.hostname() ||
      plan.uid !== process.getuid() ||
      plan.catalogVersion !== catalog.version
    )
      throw new Error(
        "Installationsplan gehört nicht zu diesem Server oder Benutzer.",
      );
    if (plan.testPlatform && !this.allowUnqualifiedLinux)
      throw new Error(
        "Dieser Plan benötigt den ausdrücklich aktivierten Linux-Entwicklertestmodus.",
      );
    const release = (await readFile("/etc/os-release", "utf8")).match(
      /^PRETTY_NAME="?([^"\n]+)/m,
    )?.[1];
    if (release !== plan.release)
      throw new Error("Betriebssystem hat sich seit der Planung geändert.");
    const containers = await readContainers(this.docker);
    const own = containers.filter((c) => c.project === plan.project);
    const network = await this.network(plan.project);
    if (
      network &&
      (!allowOwn ||
        network.project !== plan.project ||
        network.plan !== (plan.rootId || plan.id))
    )
      throw new Error("Netzwerk gehört nicht zum bestätigten Plan.");
    const expectedServices = composeFor(plan, false).services;
    const legacyQbit = plan.vpnTransition
      ? composeFor(this.store.plan(plan.basePlanId), true).services.qbittorrent
      : null;
    for (const c of own) {
      const name = Object.keys(catalog.services).find(
        (n) => catalog.services[n].slug === c.service,
      );
      if (
        !allowOwn ||
        c.managedPlan !== (plan.rootId || plan.id) ||
        !name ||
        !plan.images[name] ||
        c.image !== plan.images[name]
      )
        throw new Error(
          "Unbekannte oder veränderte Container im Zielprojekt. Keine Übernahme.",
        );
    }
    for (const c of own) {
      for (const [port, bindings] of Object.entries(c.bindings)) {
        const name =
          c.service === "gluetun"
            ? "qBittorrent"
            : Object.keys(catalog.services).find(
                (n) => catalog.services[n].slug === c.service,
              );
        if (
          !name ||
          port !== catalog.services[name].port + "/tcp" ||
          (bindings || []).some(
            (b) =>
              b.HostIp !== (plan.bind || "127.0.0.1") ||
              Number(b.HostPort) !== plan.ports[name],
          )
        )
          throw new Error(
            "Unerwartete Portfreigabe im verwalteten Stack.",
          );
      }
      if (
        c.service === "gluetun" &&
        (!c.firewallOn ||
          c.capAdd.length !== 1 ||
          !c.capAdd.some(
            (cap) => cap === "NET_ADMIN" || cap === "CAP_NET_ADMIN",
          ) ||
          c.sysctls["net.ipv6.conf.all.disable_ipv6"] !== "1" ||
          c.devices.length !== 1 ||
          c.devices[0].PathOnHost !== "/dev/net/tun" ||
          c.devices[0].PathInContainer !== "/dev/net/tun")
      )
        throw new Error("VPN-Rechte oder IPv6-Sperre weichen vom Plan ab.");
      if (c.service !== "gluetun" && (c.capAdd.length || c.devices.length))
        throw new Error("Unerwartete zusätzliche Containerrechte.");
      const expected =
        legacyQbit && c.id === plan.originalQbitId
          ? legacyQbit
          : expectedServices[c.service];
      const namespace = expected.network_mode?.startsWith("service:");
      const gluetun = own.find((v) => v.service === "gluetun");
      // Erlaubte Netzaufteilungen: die des Plans, und während einer Umstellung auch noch
      // die alte (alles in "default"), bis die Container neu erstellt sind.
      const layouts = [serviceNetworks(plan, c.service)];
      if (plan.networkUpgrade) layouts.push(["default"]);
      const networkValid = namespace
        ? !!gluetun &&
          c.network === "container:" + gluetun.id &&
          c.networkNames.length === 0
        : layouts.some((names) => {
            const expectedNames = names.map((n) => plan.project + "_" + n).sort();
            return (
              [...expectedNames, network?.id].includes(c.network) &&
              JSON.stringify([...c.networkNames].sort()) === JSON.stringify(expectedNames)
            );
          });
      const mounts = (expected.volumes || []).map((value) => {
        const [source, destination, mode] = value.split(":");
        return { source, destination, writable: mode !== "ro" };
      });
      if (
        c.privileged ||
        !networkValid ||
        c.mounts.length !== mounts.length ||
        mounts.some(
          (m) =>
            !c.mounts.some(
              (actual) =>
                actual.type === "bind" &&
                actual.source === m.source &&
                actual.destination === m.destination &&
                actual.writable === m.writable,
            ),
        )
      )
        throw new Error(
          "Containerrechte, Netzwerk oder Speicherzuordnung weichen vom bestätigten Plan ab.",
        );
    }
    for (const target of [plan.spec.path, plan.appdata]) {
      try {
        const st = await lstat(target);
        if (!st.isDirectory() || st.isSymbolicLink())
          throw new Error("Zielpfad ist kein eigener Datenordner.");
        const data = JSON.parse(
          await readFile(path.join(target, ".stackpilot-owner.json"), "utf8"),
        );
        const own = data.planId === (plan.rootId || plan.id);
        // Bis zum Schritt "vorbereiten" trägt ein übernommener Medienordner noch die alte Marke.
        const adoptable =
          plan.adoptedData &&
          target === plan.spec.path &&
          data.planId === plan.adoptedFrom;
        if (!(allowOwn && own) && !adoptable)
          throw new Error(
            "Bestehender Datenordner gehört nicht zu diesem Plan.",
          );
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
    }
    return own;
  }
  async confirm(id, text) {
    const plan = this.store.plan(id);
    if (!plan || plan.kind !== "deployment")
      throw new Error("Installationsplan nicht gefunden.");
    const existing = this.store.operations().find((j) => j.planId === id);
    if (existing) return existing;
    if (
      !plan.executable ||
      Date.parse(plan.expiresAt) < Date.now() ||
      text !== plan.confirmation
    )
      throw new Error("Plan ist gesperrt, abgelaufen oder nicht bestätigt.");
    if (plan.spec.selected.includes("qBittorrent") && !plan.spec.vpn)
      throw new Error(
        "Downloads ohne VPN sind gesperrt. Einen neuen Plan mit VPN prüfen.",
      );
    if ((this.current()?.plan.id || null) !== (plan.basePlanId || null))
      throw new Error(
        "Stack hat sich seit der Planung geändert. Erneut prüfen.",
      );
    if (plan.spec.vpn && !(await this.tunAvailable()))
      throw new Error("VPN-TUN-Gerät fehlt. Erneut prüfen.");
    await this.validate(plan, !!plan.basePlanId);
    const fresh = deploymentReadiness(
      plan.spec,
      await this.host(),
      await this.inspectStorage(plan.spec.path),
      {
        allowUnqualifiedLinux: this.allowUnqualifiedLinux,
        vpnProfile: !!(
          plan.vpnProfileId &&
          this.vault.get(`vpn-profile:${plan.vpnProfileId}`)
        ),
        existing: plan.existing,
        ownedIds: plan.basePlanId
          ? (await readContainers(this.docker))
              .filter((c) => c.project === plan.project)
              .map((c) => c.id)
          : [],
      },
    );
    if (fresh.blockers.length)
      throw new Error(
        "Serverzustand hat sich geändert: " + fresh.blockers.join(" "),
      );
    const op = this.store.createOperation({
      id: randomUUID(),
      kind: "deployment",
      planId: id,
      project: plan.project,
      status: "queued",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      pauseRequested: false,
      error: null,
      checks: [],
      steps: plan.steps.map((s) => ({ ...s, status: "pending", attempts: 0 })),
    });
    void this.run(op.id).catch(() => {});
    return op;
  }
  async relay(plan) {
    const containers = await this.validate(plan, true);
    const relay = containers.find((c) => c.service === "api-relay");
    if (!relay) throw new Error("Interne API-Brücke fehlt.");
    return relay.id;
  }
  async vpnCheck(plan, action = "identity") {
    const containers = await this.validate(plan, true);
    const probe = containers.find((c) => c.service === "vpn-probe");
    const profile = this.vault.get(`vpn-profile:${plan.vpnProfileId}`);
    if (!probe || !profile)
      throw new Error("VPN-Prüfcontainer oder Profil fehlt.");
    const deadline = Date.now() + (action === "identity" ? 120000 : 1000);
    do {
      try {
        return await probeVpn(probe.id, profile.controlKey, action);
      } catch (e) {
        if (action !== "identity" || Date.now() >= deadline) throw e;
      }
      await new Promise((r) => setTimeout(r, 2000));
    } while (true);
  }
  async step(plan, step) {
    const manifest = path.join(this.store.directory, "deployments", plan.id);
    const compose = path.join(manifest, "compose.json");
    const bootstrap = path.join(manifest, "bootstrap.json");
    if (step.id === "prepare") {
      await prepareFiles(plan, this.vault, manifest);
      return;
    }
    if (step.id === "storage-test") return testHardlinks(plan);
    if (step.id.startsWith("pull:")) {
      const name = step.id.slice(5);
      try {
        await this.docker([
          "image",
          "inspect",
          plan.images[name],
          "--format",
          "{{.Id}}",
        ]);
        return;
      } catch {}
      await this.docker(["pull", plan.images[name]], { timeout: 300000 });
      return;
    }
    if (step.id === "vpn-quarantine") {
      const containers = await this.validate(plan, true);
      const qbit = containers.find((c) => c.service === "qbittorrent");
      if (!qbit) return;
      if (qbit.id !== plan.originalQbitId)
        throw new Error("qBittorrent wurde unerwartet ersetzt.");
      const prior = this.store.plan(plan.basePlanId);
      const relay = containers.find((c) => c.service === "api-relay");
      if (!relay) throw new Error("API-Brücke fehlt.");
      const snapshotKey = `snapshot:${plan.id}:qbittorrent-preferences`;
      if (!this.vault.get(snapshotKey)) {
        if (qbit.status === "running") {
          const old = new Services(prior, this.vault, relay.id);
          this.vault.set(snapshotKey, await old.qbit("/app/preferences"));
        } else {
          const { snapshotQbitConfig } = await import("./download-guard.js");
          await snapshotQbitConfig(
            this,
            prior,
            `snapshot:${plan.id}:qbittorrent-config`,
          );
        }
      }
      await this.docker(["update", "--restart=no", qbit.id]);
      await this.docker(["stop", "--time", "30", qbit.id], { timeout: 60000 });
      await this.docker(["rm", qbit.id]);
      return;
    }
    if (step.id === "vpn-start") {
      if (plan.existing.includes("qBittorrent") && !plan.vpnTransition) {
        // Already protected: do not interrupt its tunnel during an unrelated extension.
        return;
      }
      await this.docker(
        [
          "compose",
          "-f",
          bootstrap,
          "up",
          "-d",
          "--no-recreate",
          "--pull",
          "never",
          "gluetun",
          "vpn-probe",
        ],
        { timeout: 180000 },
      );
      return;
    }
    if (["vpn-check", "vpn-isolation", "vpn-reconnect"].includes(step.id)) {
      if (
        step.id === "vpn-isolation" &&
        plan.existing.includes("qBittorrent") &&
        !plan.vpnTransition
      )
        return;
      return [
        await this.vpnCheck(
          plan,
          step.id === "vpn-isolation" ? "isolation" : "identity",
        ),
      ];
    }
    if (step.id === "bootstrap") {
      await this.docker(["compose", "-f", bootstrap, "config", "--quiet"]);
      await this.docker(
        [
          "compose",
          "-f",
          bootstrap,
          "up",
          "-d",
          "--no-recreate",
          "--pull",
          "never",
        ],
        { timeout: 180000 },
      );
      return;
    }
    if (step.id === "couchdeck-install") {
      if (!this.couchdeck) throw new Error("Couchdeck-Steuerung fehlt.");
      return this.couchdeck.ensureInstalled(plan.spec.couchdeckYoutube);
    }
    if (step.id === "couchdeck-link") {
      if (!this.couchdeck) throw new Error("Couchdeck-Steuerung fehlt.");
      await this.couchdeck.linkWith({
        plan,
        s: new Services(plan, this.vault, await this.relay(plan)),
      });
      return;
    }
    const services = new Services(plan, this.vault, await this.relay(plan));
    if (step.id.startsWith("ready:")) return services.wait(step.id.slice(6));
    if (step.id.startsWith("configure:"))
      return services.configure(step.id.slice(10));
    if (step.id === "connections") return services.connect();
    if (step.id === "verify") {
      const checks = await services.verify();
      if (plan.spec.vpn) checks.push(await this.vpnCheck(plan));
      return checks;
    }
    if (step.id === "publish") {
      if (plan.spec.vpn) await this.vpnCheck(plan, "identity");
      await this.docker(
        ["compose", "-f", compose, "up", "-d", "--pull", "never"],
        { timeout: 180000 },
      );
      const published = new Services(plan, this.vault, await this.relay(plan));
      for (const name of plan.spec.selected) await published.wait(name);
      const checks = await published.verify();
      if (plan.spec.vpn) checks.push(await this.vpnCheck(plan));
      return checks;
    }
    throw new Error("Unbekannter Installationsschritt.");
  }
  async run(id) {
    if (this.running || !this.store.claim(this.owner)) return;
    this.running = true;
    let completedPlan = null;
    const timer = setInterval(() => this.store.claim(this.owner), 10000);
    try {
      let op = this.store.operation(id);
      if (!op || op.kind !== "deployment" || op.status !== "queued") return;
      const plan = this.store.plan(op.planId);
      if (plan.spec.selected.includes("qBittorrent") && !plan.spec.vpn)
        throw new Error(
          "Dieser alte Auftrag würde qBittorrent ohne VPN starten. Downloads sind gesperrt; VPN-Umstellung erforderlich.",
        );
      op.status = "running";
      this.store.saveOperation(op);
      await this.validate(plan, true);
      for (const initial of op.steps) {
        op = this.store.operation(id);
        if (!this.store.owns(this.owner))
          throw new Error("Executor-Sperre verloren.");
        if (op.pauseRequested) {
          op.status = "paused";
          this.store.saveOperation(op);
          return;
        }
        const step = op.steps.find((s) => s.id === initial.id);
        if (step.status === "completed") continue;
        await this.validate(plan, true);
        step.status = "running";
        step.attempts++;
        this.store.saveOperation(op);
        const result = await this.step(plan, step);
        if (!this.store.owns(this.owner))
          throw new Error("Executor-Sperre verloren.");
        op = this.store.operation(id);
        const updated = op.steps.find((s) => s.id === step.id);
        updated.status = "completed";
        if (Array.isArray(result)) op.checks = result;
        this.store.saveOperation(op);
      }
      op = this.store.operation(id);
      op.status = "completed";
      op.error = null;
      this.store.saveOperation(op);
      completedPlan = plan;
    } catch (e) {
      const op = this.store.operation(id);
      if (op && this.store.owns(this.owner)) {
        op.status = "failed";
        op.error = e.message;
        const failed = op.steps.find((s) => s.status === "running");
        if (failed) failed.status = "failed";
        this.store.saveOperation(op);
      }
    } finally {
      clearInterval(timer);
      this.store.release(this.owner);
      this.running = false;
      // Folgeauftrag (Zugriff von unterwegs) erst starten, wenn die Sperre frei ist.
      if (completedPlan) {
        try {
          this.onCompleted?.(completedPlan);
        } catch {}
      }
    }
  }
}
