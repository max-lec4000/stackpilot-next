export function searchTargets(command, kind, arrId) {
  if (!Number.isSafeInteger(arrId) || arrId < 1) return false;
  const name = command.name || command.body?.name;
  if (kind === "movie")
    return (
      name === "MoviesSearch" &&
      Array.isArray(command.body?.movieIds) &&
      command.body.movieIds.includes(arrId)
    );
  return (
    ["SeriesSearch", "SeasonSearch", "EpisodeSearch"].includes(name) &&
    command.body?.seriesId === arrId
  );
}

export function activeSearch(command, kind, arrId) {
  return (
    ["queued", "started"].includes(command.status) &&
    searchTargets(command, kind, arrId)
  );
}
