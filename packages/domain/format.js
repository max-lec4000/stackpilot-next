export function formatBytes(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    return "—";
  if (value === 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"],
    index = Math.min(
      units.length - 1,
      Math.max(0, Math.floor(Math.log(value) / Math.log(1024))),
    );
  return (
    (value / 1024 ** index).toLocaleString("de-AT", {
      maximumFractionDigits: index === 0 ? 0 : 1,
    }) +
    " " +
    units[index]
  );
}
