// Shared reads are short-lived and bounded; successful mutations invalidate them.
export class LiveCache {
  constructor(ttl = 10000) {
    this.ttl = ttl;
    this.values = new Map();
    this.pending = new Map();
    this.generation = 0;
  }
  clear() {
    this.generation++;
    this.values.clear();
    this.pending.clear();
  }
  read(key, load) {
    const entry = this.values.get(key);
    if (entry && Date.now() - entry.at < this.ttl)
      return Promise.resolve(entry.value);
    if (this.pending.has(key)) return this.pending.get(key);
    const generation = this.generation;
    const p = Promise.resolve()
      .then(load)
      .then((value) => {
        if (generation === this.generation) {
          this.values.set(key, { at: Date.now(), value });
          if (this.values.size > 100)
            this.values.delete(this.values.keys().next().value);
        }
        return value;
      })
      .finally(() => {
        if (this.pending.get(key) === p) this.pending.delete(key);
      });
    this.pending.set(key, p);
    return p;
  }
}
export async function allArrQueue(s, service) {
  const rows = [];
  for (let page = 1; page <= 500; page++) {
    const result = await s.arr(
      service,
      `/queue?page=${page}&pageSize=250&includeSeries=true&includeMovie=true&includeUnknownSeriesItems=false`,
    );
    if (!Array.isArray(result?.records))
      throw Error("ARR-Warteschlange ist ungültig.");
    rows.push(...result.records);
    if (
      Number.isInteger(result.totalRecords)
        ? rows.length >= result.totalRecords
        : result.records.length < 250
    )
      return rows;
  }
  throw Error("ARR-Warteschlange überschreitet die unterstützte Größe.");
}
export async function requestPage(
  s,
  { page, pageSize, filter, type, excluded },
) {
  const query = `sort=added&sortDirection=desc&filter=${filter}&mediaType=${type}`;
  if (!excluded.size)
    return s.additional.seerr(
      `/request?take=${pageSize}&skip=${(page - 1) * pageSize}&${query}`,
    );
  const rows = [];
  let complete = false;
  for (let offset = 0; offset < 20000; offset += 100) {
    const r = await s.additional.seerr(
      `/request?take=100&skip=${offset}&${query}`,
    );
    if (!Array.isArray(r.results)) throw Error("Anfragenliste ist ungültig.");
    rows.push(...r.results);
    if (
      Number.isInteger(r.pageInfo?.results)
        ? offset + r.results.length >= r.pageInfo.results
        : r.results.length < 100
    ) {
      complete = true;
      break;
    }
    if (!r.results.length) throw Error("Unvollständige Anfragenliste.");
  }
  if (!complete) throw Error("Anfragenliste zu groß. Filter enger wählen.");
  const visible = rows.filter((r) => {
    if (!excluded.has(r.id)) return true;
    if (typeof excluded.get !== "function") return false;
    const entry = excluded.get(r.id);
    return (
      Number(r.media?.tmdbId) !== entry.mediaId ||
      r.media?.mediaType !== entry.type ||
      r.createdAt !== entry.createdAt
    );
  });
  return {
    results: visible.slice((page - 1) * pageSize, page * pageSize),
    pageInfo: { results: visible.length },
  };
}
