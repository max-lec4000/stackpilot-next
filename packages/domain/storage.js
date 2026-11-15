/** Mounts suitable as user-selectable persistent storage bases; no writes.
 * @template {{target:string,type:string,options?:string}} T
 * @param {T[]} mounts
 * @returns {T[]}
 */
export function storageCandidates(mounts) {
  const types = new Set([
    "ext4",
    "ext3",
    "ext2",
    "xfs",
    "btrfs",
    "zfs",
    "nfs",
    "nfs4",
    "cifs",
    "exfat",
    "fuseblk",
  ]);
  const protectedRoots = [
    "/boot",
    "/proc",
    "/sys",
    "/dev",
    "/run",
    "/var/lib/docker",
    "/var/lib/containerd",
  ];
  return mounts
    .filter(
      (m) =>
        types.has(m.type) &&
        !String(m.options || "")
          .split(",")
          .includes("ro") &&
        !protectedRoots.some(
          (p) => m.target === p || m.target.startsWith(p + "/"),
        ),
    )
    .filter((m, i, all) => all.findIndex((x) => x.target === m.target) === i);
}
export function dataPathForMount(target) {
  return target === "/"
    ? "/srv/stackpilot/data"
    : `${target.replace(/\/$/, "")}/stackpilot/data`;
}
