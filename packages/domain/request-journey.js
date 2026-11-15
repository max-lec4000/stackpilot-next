const steps = [
  ["requested", "Angefragt"],
  ["search", "Suche"],
  ["download", "Download"],
  ["import", "Import"],
  ["available", "Verfügbar"],
];
/** @param {string} state @param {number|null} [progress] */
export function requestJourney(state, progress = null) {
  const at = {
    pending: 0,
    declined: 0,
    waiting: 1,
    "search-queued": 1,
    searching: 1,
    queued: 2,
    paused: 2,
    downloading: 2,
    attention: 2,
    importing: 3,
    "library-sync": 3,
    available: 4,
  }[state];
  const problem = ["failed", "unknown", "attention"].includes(state);
  const reason =
    {
      pending: "Die Anfrage wartet auf Freigabe.",
      waiting:
        "Die Anfrage wurde angenommen. Ein passender Download ist noch nicht nachgewiesen.",
      "search-queued": "Die Suche wartet in der ARR-Warteschlange.",
      searching: "Die ARR-App sucht nach passenden Veröffentlichungen.",
      queued: "Der Download wartet auf einen freien Platz.",
      paused: "Der Download ist angehalten.",
      downloading: "Der Download läuft.",
      attention: "Die ARR-App meldet ein Problem. Importdiagnose öffnen.",
      importing:
        "Der Download ist fertig; die ARR-App muss die Datei importieren.",
      "library-sync":
        "ARR meldet eine importierte Datei. Jellyfin und Seerr müssen die Verfügbarkeit noch bestätigen.",
      available: "Das Medium ist verfügbar.",
      declined: "Die Anfrage wurde abgelehnt.",
      failed: "Die Anfrage ist fehlgeschlagen. Diagnose öffnen.",
      unknown: "Der aktuelle Zustand konnte nicht bestätigt werden.",
    }[state] || "Status noch nicht bestätigt.";
  return {
    state,
    reason,
    problem,
    progress,
    steps: steps.map(([id, label], i) => ({
      id,
      label,
      state:
        at === undefined
          ? "unknown"
          : i < at
            ? "done"
            : i === at
              ? state === "available"
                ? "done"
                : "current"
              : "pending",
    })),
  };
}
