import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, stat, statfs, access, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  systemDetails,
  mountCapacity,
  retirementCandidates,
} from "./system-details.js";
const execute = promisify(execFile);
export async function command(binary, args) {
  try {
    const { stdout } = await execute(binary, args, {
      timeout: 8000,
      maxBuffer: 2 * 1024 * 1024,
      encoding: "utf8",
      env: { ...process.env, LC_ALL: "C" },
    });
    return { ok: true, output: stdout };
  } catch (e) {
    return {
      ok: false,
      reason:
        e.code === "ENOENT"
          ? "Nicht installiert"
          : e.killed
            ? "Zeitlimit überschritten"
            : "Nicht erreichbar oder keine Berechtigung",
    };
  }
}
export function parseLines(text) {
  return text.trim()
    ? text
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
    : [];
}
export function classifyContainer(c) {
  const names = [
    "jellyfin",
    "streamystats",
    "sonarr",
    "radarr",
    "lidarr",
    "prowlarr",
    "bazarr",
    "seerr",
    "qbittorrent",
    "gluetun",
  ];
  const haystack = `${c.Names} ${c.Image}`.toLowerCase();
  return {
    ...c,
    component:
      names.find((n) =>
        new RegExp(`(^|[^a-z])${n}([^a-z]|$)`).test(haystack),
      ) || null,
    mode: "observed",
  };
}
export function safeSource(value) {
  return typeof value === "string"
    ? value.replace(/(?:[^/@:\s]+:[^/@\s]+)@/g, "[redacted]@")
    : value;
}
export function flattenMounts(nodes) {
  return nodes.flatMap((n) => [
    {
      target: n.target,
      source: safeSource(n.source),
      type: n.fstype,
      options: String(n.options || "")
        .split(",")
        .filter((o) =>
          ["rw", "ro", "noexec", "nosuid", "nodev", "relatime"].includes(o),
        )
        .join(","),
    },
    ...flattenMounts(n.children || []),
  ]);
}
export async function inventory(run = command) {
  const [release, docker, compose, containers, mounts, ports, details] =
    await Promise.all([
      readFile("/etc/os-release", "utf8").catch(() => ""),
      run("docker", ["version", "--format", "{{.Server.Version}}"]),
      run("docker", ["compose", "version", "--short"]),
      run("docker", ["ps", "-a", "--no-trunc", "--format", "{{json .}}"]),
      run("findmnt", ["--json", "--output", "TARGET,SOURCE,FSTYPE,OPTIONS"]),
      run("ss", ["-H", "-ltn"]),
      systemDetails(run),
    ]);
  const issues = [];
  let list = [];
  let mountList = [];
  let listening = [];
  let containerScanComplete = false;
  try {
    if (containers.ok) {
      list = parseLines(containers.output).map((c) =>
        classifyContainer({
          ID: c.ID,
          Names: c.Names,
          Image: c.Image,
          State: c.State,
          Status: c.Status,
          Ports: c.Ports,
        }),
      );
      containerScanComplete = true;
    } else issues.push(`Containerliste: ${containers.reason}`);
  } catch {
    issues.push("Containerliste konnte nicht ausgewertet werden.");
  }
  try {
    if (mounts.ok)
      mountList = flattenMounts(
        JSON.parse(mounts.output).filesystems || [],
      ).filter(
        (m) =>
          ![
            "proc",
            "sysfs",
            "devtmpfs",
            "devpts",
            "cgroup2",
            "mqueue",
            "securityfs",
            "debugfs",
            "tracefs",
            "configfs",
            "fusectl",
            "pstore",
            "bpf",
            "hugetlbfs",
          ].includes(m.type),
      );
    else issues.push(`Mountpunkte: ${mounts.reason}`);
  } catch {
    issues.push("Mountpunkte konnten nicht ausgewertet werden.");
  }
  if (ports.ok) {
    listening = [
      ...new Set(
        ports.output
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((l) => l.trim().split(/\s+/)[3])
          .filter(Boolean),
      ),
    ];
  } else issues.push(`Portprüfung: ${ports.reason}`);
  // Docker can publish ports using NAT without a socket visible to ss.
  for (const c of list) {
    for (const match of String(c.Ports || "").matchAll(
      /:(\d+)(?:-(\d+))?->\d+(?:-\d+)?\/tcp/g,
    )) {
      const first = Number(match[1]);
      const last = match[2] ? Number(match[2]) : first;
      for (let port = first; port <= Math.min(last, first + 127); port++)
        listening.push(`docker:${port}`);
    }
  }
  listening = [...new Set(listening)];
  if (list.length) {
    const ids = list
      .slice(0, 100)
      .map((c) => c.ID)
      .filter((id) => /^[a-f0-9]{12,64}$/.test(id));
    if (ids.length) {
      const details = await run("docker", [
        "inspect",
        "--format",
        '{"id":{{json .Id}},"mounts":{{json .Mounts}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"managed":{{json (index .Config.Labels "io.stackpilot.managed")}}}',
        ...ids,
      ]);
      if (details.ok) {
        try {
          const byId = new Map(
            parseLines(details.output).map((d) => [d.id, d]),
          );
          list = list.map((c) => ({
            ...c,
            project: byId.get(c.ID)?.project || null,
            managed: byId.get(c.ID)?.managed === "true",
            mounts: (byId.get(c.ID)?.mounts || []).map((m) => ({
              type: m.Type,
              source: m.Source,
              destination: m.Destination,
              writable: m.RW,
            })),
          }));
        } catch {
          issues.push(
            "Container-Speicherpfade konnten nicht ausgewertet werden.",
          );
        }
      } else issues.push(`Container-Speicherpfade: ${details.reason}`);
    }
    if (list.length > 100)
      issues.push(
        "Speicherpfade werden nur für die ersten 100 Container ermittelt.",
      );
  }
  mountList = await Promise.all(
    mountList
      .slice(0, 100)
      .map(async (m) => ({ ...m, ...(await mountCapacity(m.target)) })),
  );
  const result = {
    observedAt: new Date().toISOString(),
    host: os.hostname(),
    platform: os.platform(),
    release: release.match(/^PRETTY_NAME="?([^"\n]+)/m)?.[1] || os.type(),
    cpuCount: os.availableParallelism(),
    memoryBytes: os.totalmem(),
    docker: {
      available: docker.ok,
      version: docker.ok ? docker.output.trim() : null,
      reason: docker.ok ? null : docker.reason,
    },
    compose: {
      available: compose.ok,
      version: compose.ok ? compose.output.trim() : null,
      reason: compose.ok ? null : compose.reason,
    },
    details,
    containerScanComplete,
    containers: list,
    mounts: mountList,
    listening,
    issues,
    limitations: [
      "Nur der Rechner, auf dem StackPilot läuft, wird geprüft.",
      "Keine vollständige Erkennung ausgeschalteter Nicht-Docker-Installationen oder beliebiger alter Konfigurationsordner.",
      "Keine vollständige Übernahme, ACL-, GPU-Treiber- oder Hardlink-Funktionsprüfung.",
      "Prozesszuordnung ist ohne zusätzliche Rechte möglicherweise unvollständig. Keine automatische Bereinigung.",
      "Docker-Befehle verwenden den aktiven Docker-Kontext; ein entfernter Daemon kann abweichende Speicherpfade haben.",
    ],
  };
  return { ...result, retirement: retirementCandidates(result) };
}
export function validatePath(value) {
  return (
    typeof value === "string" &&
    value.length <= 1024 &&
    /^\/[a-zA-Z0-9_./-]+$/.test(value) &&
    !value.split("/").includes("..") &&
    value !== "/" &&
    ![
      "/proc",
      "/sys",
      "/dev",
      "/etc",
      "/boot",
      "/run",
      "/usr",
      "/bin",
      "/sbin",
      "/lib",
      "/lib64",
      "/var/lib/docker",
      "/var/lib/containerd",
    ].some((p) => value === p || value.startsWith(p + "/"))
  );
}
export async function inspectPath(value) {
  if (!validatePath(value))
    throw new Error(
      "Ungültiger Datenpfad. Verwende einen eigenen absoluten Pfad außerhalb der Systemverzeichnisse.",
    );
  let current = value;
  let exists = true;
  for (;;) {
    try {
      await stat(current);
      break;
    } catch (e) {
      if (e.code !== "ENOENT") throw new Error("Pfad ist nicht zugänglich.");
      exists = false;
      const parent = path.dirname(current);
      if (parent === current)
        throw new Error("Kein zugängliches übergeordnetes Verzeichnis.");
      current = parent;
    }
  }
  const actual = await realpath(current);
  if (actual !== "/" && !validatePath(actual))
    throw new Error("Pfad verweist auf ein geschütztes Systemverzeichnis.");
  const [info, fs] = await Promise.all([stat(current), statfs(current)]);
  if (!info.isDirectory())
    throw new Error("Pfad oder übergeordnetes Element ist kein Verzeichnis.");
  let writable = true;
  try {
    await access(current, constants.W_OK | constants.X_OK);
  } catch {
    writable = false;
  }
  return {
    requested: value,
    exists,
    existingParent: current,
    resolvedParent: actual,
    writable,
    freeBytes: fs.bavail * fs.bsize,
    totalBytes: fs.blocks * fs.bsize,
    device: info.dev,
    uid: info.uid,
    gid: info.gid,
    mode: (info.mode & 0o777).toString(8),
    message: exists
      ? "Verzeichnis vorhanden. Inhalte werden nicht gelesen oder verändert."
      : "Verzeichnis fehlt. Es wird durch diese Prüfung nicht angelegt.",
    hardlinks:
      "Nicht funktional geprüft. Gleiche Dateisystem-ID ist nur eine Voraussetzung.",
  };
}
