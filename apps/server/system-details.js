import os from "node:os";
import { statfs } from "node:fs/promises";
const servicePattern =
  /(^|[^a-z])(jellyfin|streamystats|sonarr|radarr|lidarr|prowlarr|bazarr|seerr|overseerr|jellyseerr|qbittorrent|gluetun)([^a-z]|$)/i;
export function parseSockets(text) {
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const parts = line.trim().split(/\s+/);
      return {
        protocol: parts[0],
        state: parts[1],
        address: parts[4],
        processes: [...line.matchAll(/\("([^"\n]+)",pid=(\d+)/g)].map((m) => ({
          name: m[1],
          pid: Number(m[2]),
        })),
      };
    })
    .filter((s) => ["tcp", "udp"].includes(s.protocol) && s.address);
}
export function serviceCandidates(text) {
  return text
    .trim()
    .split("\n")
    .map((l) => l.trim().replace(/^●\s*/, "").split(/\s+/))
    .filter((p) => p[0]?.endsWith(".service") && servicePattern.test(p[0]))
    .map((p) => ({ unit: p[0], load: p[1], active: p[2], sub: p[3] }));
}
function disks(items) {
  return items.map((d) => ({
    name: d.name,
    type: d.type,
    sizeBytes: Number(d.size),
    filesystem: d.fstype || null,
    mountpoints: d.mountpoints || [],
    rotational: d.rota === true || d.rota === 1,
    readOnly: d.ro === true || d.ro === 1,
    children: disks(d.children || []),
  }));
}
export async function systemDetails(run) {
  const tasks = [
    [
      "disks",
      "lsblk",
      [
        "--bytes",
        "--json",
        "--output",
        "NAME,TYPE,SIZE,FSTYPE,MOUNTPOINTS,ROTA,RO",
      ],
    ],
    ["gpu", "lspci", ["-mm"]],
    ["sockets", "ss", ["-H", "-lntup"]],
    [
      "services",
      "systemctl",
      [
        "list-units",
        "--all",
        "--type=service",
        "--no-legend",
        "--no-pager",
        "--plain",
      ],
    ],
    ["pools", "zpool", ["list", "-Hp", "-o", "name,size,alloc,free,health"]],
    [
      "datasets",
      "zfs",
      ["list", "-Hp", "-o", "name,type,used,available,mountpoint,readonly"],
    ],
    [
      "dockerRuntime",
      "docker",
      [
        "info",
        "--format",
        '{"storageDriver":{{json .Driver}},"architecture":{{json .Architecture}},"cgroupVersion":{{json .CgroupVersion}},"securityOptions":{{json .SecurityOptions}}}',
      ],
    ],
  ];
  const results = await Promise.all(
    tasks.map(async ([key, bin, args]) => [key, await run(bin, args)]),
  );
  const data = Object.fromEntries(results);
  const checks = Object.fromEntries(
    results.map(([key, r]) => [
      key,
      { available: r.ok, reason: r.ok ? null : r.reason },
    ]),
  );
  const json = (key, extract) => {
    try {
      return data[key].ok ? extract(JSON.parse(data[key].output)) : null;
    } catch {
      checks[key] = {
        available: false,
        reason: "Ausgabe konnte nicht ausgewertet werden.",
      };
      return null;
    }
  };
  return {
    kernel: os.release(),
    architecture: os.arch(),
    cpuModel: os.cpus()[0]?.model || null,
    memoryFreeBytes: os.freemem(),
    checks,
    disks: json("disks", (v) => disks(v.blockdevices || [])),
    gpu: data.gpu.ok
      ? data.gpu.output
          .trim()
          .split("\n")
          .filter((l) =>
            /"(VGA compatible controller|3D controller|Display controller)"/i.test(
              l,
            ),
          )
      : null,
    sockets: data.sockets.ok ? parseSockets(data.sockets.output) : null,
    services: data.services.ok ? serviceCandidates(data.services.output) : null,
    pools: data.pools.ok
      ? data.pools.output
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((l) => {
            const [name, size, allocated, free, health] = l.split("\t");
            return {
              name,
              sizeBytes: Number(size),
              allocatedBytes: Number(allocated),
              freeBytes: Number(free),
              health,
            };
          })
      : null,
    datasets: data.datasets.ok
      ? data.datasets.output
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((l) => {
            const [name, type, used, available, mountpoint, readonly] =
              l.split("\t");
            return {
              name,
              type,
              usedBytes: Number(used),
              availableBytes: Number(available),
              mountpoint,
              readonly,
            };
          })
      : null,
    dockerRuntime: json("dockerRuntime", (v) => ({
      storageDriver: v.storageDriver,
      architecture: v.architecture,
      cgroupVersion: v.cgroupVersion,
      securityOptions: v.securityOptions,
    })),
  };
}
export async function mountCapacity(target) {
  try {
    const s = await statfs(target);
    return { freeBytes: s.bavail * s.bsize, totalBytes: s.blocks * s.bsize };
  } catch {
    return { freeBytes: null, totalBytes: null };
  }
}
export function retirementCandidates(inventory) {
  return {
    containers: inventory.containers
      .filter((c) => c.component && !c.managed && c.project !== "stackpilot")
      .map((c) => ({
        id: c.ID,
        name: c.Names,
        component: c.component,
        state: c.State,
        ports: c.Ports,
        project: c.project || null,
        action: "review-stop-and-remove-container",
        preserveData: true,
      })),
    services: (inventory.details?.services || []).map((s) => ({
      ...s,
      action: "review-stop-and-disable-service",
      preserveData: true,
    })),
    note: "Erkennung ist ein Hinweis, keine Löschfreigabe. Eine alte Konfigurationsdatei allein belegt keinen Port. Laufende Container, Prozesse oder Dienste müssen zugeordnet werden. Daten bleiben standardmäßig erhalten.",
  };
}
