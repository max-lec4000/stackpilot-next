'use strict';
// Seerr-Client: Entdecken, Suchen, Details, Anfragen stellen und eigene Anfragen anzeigen.
// Zugang über den API-Key (X-Api-Key) aus seerr.json; Anfragen werden im Namen des
// Seerr-Benutzers gestellt, der zum angemeldeten Jellyfin-Benutzer gehört (nicht als Admin).
const fs = require('fs');
const path = require('path');
const config = require('./config');

const KEY_FILE = path.join(config.DIR, 'seerr.json');
const TMDB_IMG = 'https://image.tmdb.org/t/p/';
// Seerr-Berechtigungen (Bitmaske)
const REQ_PENDING = 1;

function readKeyFile() {
  try { return JSON.parse(fs.readFileSync(KEY_FILE, 'utf8')); } catch { return null; }
}

class Seerr {
  constructor(jf) {
    this.jf = jf;
    this.userCache = null; // { jellyfinUserId, seerrUser }
  }

  get settings() {
    // Zugang von StackPilot (integration.json) hat Vorrang; seerr.json bleibt der Weg ohne StackPilot.
    const link = config.integration()?.seerr;
    const k = link?.apiKey ? link : readKeyFile();
    return { url: (k?.url || 'http://127.0.0.1:5055').replace(/\/$/, ''), apiKey: k?.apiKey || null };
  }

  get configured() { return !!this.settings.apiKey; }

  async request(method, p, { query, body } = {}) {
    const { url, apiKey } = this.settings;
    if (!apiKey) throw new Error('Seerr ist noch nicht verbunden (API-Key fehlt)');
    // Wie die Seerr-Weboberfläche: Werte mit encodeURIComponent (Leerzeichen = %20).
    // URLSearchParams würde Leerzeichen als "+" schicken – Seerr antwortet darauf mit einer HTML-Fehlerseite.
    const qs = Object.entries(query || {}).filter(([, v]) => v != null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
    const u = url + '/api/v1' + p + (qs ? `?${qs}` : '');
    const res = await fetch(u, {
      method,
      headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!res.ok) throw new Error(data?.message || `Seerr: HTTP ${res.status}`);
    return data;
  }

  /** Seerr-Benutzer zum angemeldeten Jellyfin-Benutzer finden. */
  async currentUser() {
    const jfId = this.jf.userId;
    const jfName = this.jf.cfg.auth?.userName;
    if (!jfId) throw new Error('Nicht bei Jellyfin angemeldet');
    if (this.userCache?.jellyfinUserId === jfId) return this.userCache.seerrUser;
    const norm = (s) => String(s || '').toLowerCase().replace(/-/g, '');
    let found = null;
    for (let skip = 0; skip < 1000 && !found; skip += 100) {
      const res = await this.request('GET', '/user', { query: { take: 100, skip } });
      const list = res?.results || [];
      found = list.find((u) => norm(u.jellyfinUserId) === norm(jfId))
        || list.find((u) => jfName && [u.jellyfinUsername, u.username, u.displayName].some((n) => norm(n) === norm(jfName)));
      if (list.length < 100) break;
    }
    if (!found) throw new Error(`Kein Seerr-Benutzer für „${jfName}“ gefunden – einmal in Seerr anmelden bzw. importieren`);
    this.userCache = { jellyfinUserId: jfId, seerrUser: found };
    return found;
  }

  async status() {
    if (!this.configured) return { configured: false };
    const me = await this.currentUser();
    let quota = null;
    try { quota = await this.request('GET', `/user/${me.id}/quota`); } catch { /* optional */ }
    return { configured: true, user: { id: me.id, name: me.displayName || me.username || me.jellyfinUsername }, quota };
  }

  static simplify(r) {
    if (r?.mediaType === 'person') {
      return {
        id: r.id,
        mediaType: 'person',
        title: r.name || '',
        poster: r.profilePath ? TMDB_IMG + 'w300' + r.profilePath : '',
        knownFor: (r.knownFor || []).map((k) => k.title || k.name).filter(Boolean).slice(0, 3),
        status: 1,
      };
    }
    if (!r || (r.mediaType !== 'movie' && r.mediaType !== 'tv')) return null;
    const date = r.releaseDate || r.firstAirDate || '';
    return {
      id: r.id,
      mediaType: r.mediaType,
      title: r.title || r.name || r.originalTitle || r.originalName,
      year: date ? date.slice(0, 4) : '',
      overview: r.overview || '',
      poster: r.posterPath ? TMDB_IMG + 'w342' + r.posterPath : '',
      backdrop: r.backdropPath ? TMDB_IMG + 'w1280' + r.backdropPath : '',
      rating: r.voteAverage || null,
      status: r.mediaInfo?.status || 1,
      jellyfinId: r.mediaInfo?.jellyfinMediaId || null,
    };
  }

  /** Person (Schauspieler/Regie) mit allen Filmen und Serien, inkl. Verfügbarkeit. */
  async person(id) {
    const [p, credits] = await Promise.all([
      this.request('GET', `/person/${Number(id)}`, { query: { language: 'de' } }),
      this.request('GET', `/person/${Number(id)}/combined_credits`, { query: { language: 'de' } }),
    ]);
    const seen = new Set();
    const items = [...(credits?.cast || []), ...(credits?.crew || []).filter((c) => c.job === 'Director')]
      .filter((c) => (c.mediaType === 'movie' || c.mediaType === 'tv') && !seen.has(c.mediaType + c.id) && seen.add(c.mediaType + c.id))
      .map((c) => ({ ...Seerr.simplify(c), role: c.character || c.job || '', popularity: c.popularity || 0 }))
      .sort((a, b) => (b.popularity - a.popularity));
    return {
      id: p.id, name: p.name, biography: p.biography || '', department: p.knownForDepartment || '',
      photo: p.profilePath ? TMDB_IMG + 'w300' + p.profilePath : '', items,
    };
  }

  async trending(page = 1) {
    const res = await this.request('GET', '/discover/trending', { query: { page, language: 'de' } });
    return { page: res.page, totalPages: res.totalPages, results: (res.results || []).map(Seerr.simplify).filter(Boolean) };
  }

  async search(query, page = 1) {
    const res = await this.request('GET', '/search', { query: { query, page, language: 'de' } });
    return { page: res.page, totalPages: res.totalPages, results: (res.results || []).map(Seerr.simplify).filter(Boolean) };
  }

  async details(mediaType, id) {
    const me = await this.currentUser().catch(() => null);
    const d = await this.request('GET', `/${mediaType === 'tv' ? 'tv' : 'movie'}/${id}`, { query: { language: 'de' } });
    const base = Seerr.simplify({ ...d, mediaType });
    const seasonStatus = new Map((d.mediaInfo?.seasons || []).map((s) => [s.seasonNumber, s.status]));
    // offene Anfragen (Staffeln) mitzählen
    for (const req of d.mediaInfo?.requests || []) {
      if (req.status === 3) continue; // abgelehnt
      for (const s of req.seasons || []) if (!seasonStatus.has(s.seasonNumber)) seasonStatus.set(s.seasonNumber, 2);
    }
    return {
      ...base,
      genres: (d.genres || []).map((g) => g.name),
      runtime: d.runtime || d.episodeRunTime?.[0] || null,
      seasons: mediaType === 'tv'
        ? (d.seasons || []).filter((s) => s.seasonNumber > 0).map((s) => ({
          number: s.seasonNumber, name: s.name, episodes: s.episodeCount, status: seasonStatus.get(s.seasonNumber) || 1,
        }))
        : null,
      requests: (d.mediaInfo?.requests || []).map((r) => ({
        id: r.id, status: r.status, by: r.requestedBy?.displayName,
        mine: me ? r.requestedBy?.id === me.id : false, canCancel: me ? this.canCancel(me, r) : false,
        seasons: (r.seasons || []).map((x) => x.seasonNumber),
      })),
    };
  }

  /**
   * Darf der aktuelle Benutzer diese Anfrage zurückziehen? Eigene Anfragen immer – auch schon
   * freigegebene: Couchdecks Benutzer bekommt Anfragen meist automatisch freigegeben, sonst
   * ließe sich eine versehentliche Anfrage nie zurücknehmen. (Couchdeck spricht Seerr mit dem
   * API-Schlüssel an und darf das.) Fremde Anfragen bleiben tabu.
   */
  canCancel(me, req) {
    return !!req && req.requestedBy?.id === me.id; // nur eigene Anfragen
  }

  async cancelRequest(requestId) {
    const me = await this.currentUser();
    const req = await this.request('GET', `/request/${Number(requestId)}`);
    if (req?.requestedBy?.id !== me.id) throw new Error('Nur eigene Anfragen können zurückgezogen werden');
    await this.request('DELETE', `/request/${Number(requestId)}`);
    return { ok: true, wasApproved: req.status !== REQ_PENDING };
  }

  async managedMedia(body) {
    const link = config.integration?.();
    if (!this.jf.token || this.jf.token !== link?.auth?.token) return null;
    const response = await fetch('http://127.0.0.1:5173/api/couchdeck/media', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Couchdeck-Token': this.jf.token },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(25000),
    });
    if ([401, 403, 404].includes(response.status) && body.action === 'episodes') return null;
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'StackPilot konnte die Folge nicht bearbeiten');
    return result;
  }

  async seasonEpisodes({ seriesId, season, requestId }) {
    if (!Number.isSafeInteger(seriesId) || seriesId < 1 ||
        !Number.isSafeInteger(season) || season < 1) throw new Error('Ungültige Serie oder Staffel');
    if (Number.isSafeInteger(requestId) && requestId > 0) {
      const managed = await this.managedMedia({ action: 'episodes', requestId, season });
      if (managed) return managed.episodes;
    }
    const data = await this.request('GET', `/tv/${seriesId}/season/${season}`, {
      query: { language: 'de' },
    });
    if (!Array.isArray(data?.episodes)) throw new Error('Seerr meldet keine Folgenliste');
    return data.episodes.map((episode) => ({ number: episode.episodeNumber, title: episode.name || '' }));
  }

  async cancelSeason({ requestId, season }) {
    if (!Number.isSafeInteger(requestId) || requestId < 1 ||
        !Number.isSafeInteger(season) || season < 1) throw new Error('Ungültige Staffel oder Anfrage');
    const me = await this.currentUser();
    const norm = (value) => String(value || '').toLowerCase().replace(/-/g, '');
    if (!this.jf.userId || norm(me.jellyfinUserId) !== norm(this.jf.userId))
      throw new Error('Jellyfin-Konto konnte nicht eindeutig zugeordnet werden');
    const route = `/request/${requestId}`;
    const request = await this.request('GET', route);
    if (request?.requestedBy?.id !== me.id || request.media?.mediaType !== 'tv' ||
        request.status !== REQ_PENDING) throw new Error('Nur eigene, noch offene Serienanfragen sind bearbeitbar');
    const selected = request.seasons?.map((entry) => entry.seasonNumber);
    if (!selected || selected.length < 2 || !selected.includes(season))
      throw new Error('Die Staffel ist nicht in einer offenen Anfrage mit mehreren Staffeln enthalten');
    const seasons = selected.filter((number) => number !== season);
    const body = { mediaType: 'tv', seasons };
    for (const key of ['serverId', 'profileId', 'rootFolder', 'languageProfileId', 'tags']) {
      if (request[key] != null) body[key] = request[key];
    }
    await this.request('PUT', route, { body });
    const saved = await this.request('GET', route);
    if (saved?.seasons?.length !== seasons.length ||
        !seasons.every((number) => saved.seasons.some((entry) => entry.seasonNumber === number)))
      throw new Error('Seerr hat die verbleibenden Staffeln nicht bestätigt');
    return { ok: true };
  }

  async createRequest({ mediaType, mediaId, seasons }) {
    const me = await this.currentUser();
    const body = { mediaType, mediaId: Number(mediaId), userId: me.id, is4k: false };
    if (mediaType === 'tv') body.seasons = seasons?.length ? seasons.map(Number) : 'all';
    const r = await this.request('POST', '/request', { body });
    return { id: r?.id, status: r?.status };
  }

  /**
   * Aktivität der eigenen Anfragen: laufende Downloads (aus Sonarr/Radarr über Seerr)
   * und kürzlich verfügbar gewordene Titel.
   */
  async activity() {
    const me = await this.currentUser();
    const res = await this.request('GET', '/request', { query: { take: 40, sort: 'modified', requestedBy: me.id } });
    this.titleCache ||= new Map();
    const title = async (m) => {
      const key = `${m.mediaType}:${m.tmdbId}`;
      if (!this.titleCache.has(key)) {
        try {
          const d = await this.request('GET', `/${m.mediaType === 'tv' ? 'tv' : 'movie'}/${m.tmdbId}`, { query: { language: 'de' } });
          this.titleCache.set(key, { title: d.title || d.name, poster: d.posterPath ? TMDB_IMG + 'w342' + d.posterPath : '', backdrop: d.backdropPath ? TMDB_IMG + 'w780' + d.backdropPath : '' });
        } catch { this.titleCache.set(key, { title: `TMDB ${m.tmdbId}`, poster: '', backdrop: '' }); }
      }
      return this.titleCache.get(key);
    };
    const downloads = []; const available = []; const seen = new Set();
    for (const r of res?.results || []) {
      const m = r.media || {};
      const key = `${m.mediaType}:${m.tmdbId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const dl = (m.downloadStatus || []).filter((x) => x.size > 0);
      if (dl.length) {
        const size = dl.reduce((a, x) => a + x.size, 0);
        const left = dl.reduce((a, x) => a + (x.sizeLeft || 0), 0);
        const eta = dl.map((x) => x.estimatedCompletionTime).filter(Boolean).sort().at(-1) || null;
        downloads.push({ key, mediaType: m.mediaType, tmdbId: m.tmdbId, ...(await title(m)), progress: size ? 1 - left / size : 0, eta, parts: dl.length });
      } else if (m.status === 5 || m.status === 4) {
        available.push({ key, mediaType: m.mediaType, tmdbId: m.tmdbId, jellyfinId: m.jellyfinMediaId || null, status: m.status, updatedAt: m.updatedAt, ...(await title(m)) });
      }
    }
    return { downloads, available };
  }

  async myRequests() {
    const me = await this.currentUser();
    const res = await this.request('GET', '/request', { query: { take: 30, sort: 'added', requestedBy: me.id } });
    const out = await Promise.all((res?.results || []).map(async (r) => {
      const m = r.media || {};
      let title = ''; let poster = '';
      try {
        const d = await this.request('GET', `/${m.mediaType === 'tv' ? 'tv' : 'movie'}/${m.tmdbId}`, { query: { language: 'de' } });
        title = d.title || d.name; poster = d.posterPath ? TMDB_IMG + 'w342' + d.posterPath : '';
      } catch { /* Titel optional */ }
      return {
        canCancel: this.canCancel(me, r),
        id: r.id, requestStatus: r.status, status: m.status || 1, mediaType: m.mediaType, tmdbId: m.tmdbId,
        title: title || `TMDB ${m.tmdbId}`, poster, createdAt: r.createdAt,
        seasons: (r.seasons || []).map((x) => x.seasonNumber), jellyfinId: m.jellyfinMediaId || null,
      };
    }));
    return out;
  }
}

module.exports = { Seerr, KEY_FILE };
