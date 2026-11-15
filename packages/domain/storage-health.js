/** @param {{freeBytes?:number,totalBytes?:number}|null} storage */
export function storageHealth(storage) {
  const gib = 1024 ** 3;
  if (
    !storage ||
    !Number.isFinite(storage.freeBytes) ||
    !Number.isFinite(storage.totalBytes) ||
    storage.totalBytes <= 0 ||
    storage.freeBytes < 0
  )
    return {
      state: "unknown",
      reason: "Freier Speicher ist nicht bestätigt.",
      freeBytes: null,
      totalBytes: null,
    };
  const critical = Math.max(gib, Math.min(5 * gib, storage.totalBytes * 0.01)),
    warning = Math.max(5 * gib, Math.min(20 * gib, storage.totalBytes * 0.05));
  return {
    state:
      storage.freeBytes < critical
        ? "critical"
        : storage.freeBytes < warning
          ? "warning"
          : "ok",
    reason:
      storage.freeBytes < critical
        ? "Sehr wenig freier Speicher. Neue Medienanfragen sind bis zur Bereinigung gesperrt."
        : storage.freeBytes < warning
          ? "Der freie Speicher wird knapp. Vor größeren Downloads Platz prüfen."
          : "Ausreichend freier Speicher für den Betrieb; einzelne Downloads können größer sein.",
    freeBytes: storage.freeBytes,
    totalBytes: storage.totalBytes,
  };
}
