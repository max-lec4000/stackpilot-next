// Testdaten für die Oberfläche im normalen Browser (ohne Electron/Jellyfin).
(function () {
  const listeners = {};
  const it = (i, type = 'Movie', extra = {}) => ({ Id: 'id' + i, Name: `${type} ${i}`, Type: type, ProductionYear: 2000 + i,
    RunTimeTicks: 6e10, Overview: 'Eine spannende Geschichte über Mut, Freundschaft und große Entscheidungen – Folge ' + i + ' der Testdaten mit etwas längerer Beschreibung.', CanDelete: i % 2 === 1, BackdropImageTags: ['b'], ImageTags: { Primary: 'p' }, CommunityRating: 7.2, OfficialRating: 'FSK 12', UserData: { PlayedPercentage: i % 3 ? 0 : 40 }, ...extra });
  let vol = { volume: 20, mute: false };
  const data = {
    'app:state': { auth: { loggedIn: true, userName: 'max' }, settings: { youtube: { maxHeight: 1440, sponsorAuto: false }, player: { autoplayNext: true, autoSkipIntro: false, upNextSeconds: 10, seekBack: 10, seekForward: 30, nightMode: false }, audio: { startVolume: 40 }, ui: { screensaverMin: 5, accent: 'violett' } } },
    'jf:imageBase': location.origin + '/dev/img',
    'jf:home': { views: [{ Id: 'v1', Name: 'Filme', CollectionType: 'movies' }, { Id: 'v2', Name: 'Serien', CollectionType: 'tvshows' }],
      resume: [], nextUp: [1, 2, 3].map((i) => it(i, 'Episode', { SeriesName: 'Serie', IndexNumber: i, ParentIndexNumber: 1 })),
      latest: [{ view: { Name: 'Filme' }, items: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => it(i)) }, { view: { Name: 'Musik' }, items: [] }] },
    'sys:sinks': { default: 'raop', sinks: [{ name: 'raop', description: 'WiiM_PC', kind: 'airplay' }, { name: 'hdmi', description: 'Monitor (DisplayPort)', kind: 'monitor' }] },
    'sys:status': { load: { l1: 0.5, cores: 6 }, memory: { total: 16e9, free: 10e9 }, temp: 45, disk: { free: 5.6e10 } },
    'sys:services': [{ name: 'Jellyfin', up: true, ms: 3 }, { name: 'Seerr', up: false, error: 'nicht erreichbar' }],
    'bt:devices': [{ mac: 'AA:BB:CC:DD:EE:FF', name: 'Xbox Wireless Controller', icon: 'input-gaming', paired: true, connected: true, battery: 80 }],
  };
  window.cd = {
    async call(ch, arg) {
      console.log('call', ch, arg);
      if (ch === 'sys:volume') return vol;
      if (ch === 'sys:changeVolume') { vol = { ...vol, volume: Math.max(0, Math.min(100, vol.volume + arg)) }; return vol; }
      if (ch === 'sys:setVolume') { vol = { ...vol, volume: arg, mute: false }; return vol; }
      if (ch === 'sys:toggleMute') { vol = { ...vol, mute: !vol.mute }; return vol; }
      if (ch === 'jf:items') return { Items: [1, 2, 3].map((i) => it(i)), TotalRecordCount: 3 };
      if (ch === 'jf:search') return { Items: [it(9)] };
      if (ch === 'bt:scan') return data['bt:devices'];
      const sItem = (i, t = 'movie', st = 1) => ({ id: 100 + i, mediaType: t, title: (t === 'tv' ? 'Serie ' : 'Film ') + i, year: '2025', overview: 'Beschreibung', poster: '', backdrop: '', rating: 7.5, status: st });
      if (ch === 'seerr:status') return { configured: true, user: { name: 'max' }, quota: { movie: { limit: 10, remaining: 7 } } };
      if (ch === 'seerr:trending') return { page: 1, totalPages: 1, results: [sItem(1), sItem(2, 'tv', 4), sItem(3, 'movie', 5), sItem(4, 'movie', 2)] };
      if (ch === 'seerr:details') {
        window.mockReqs ||= [];
        const reqs = window.mockReqs.filter((r) => r.mediaId === arg.id);
        const asked = new Set(reqs.flatMap((r) => r.seasons || []));
        const seasons = arg.mediaType === 'tv' ? [1, 2, 3, 4, 5, 6].map((n) => ({ number: n, name: `Staffel ${n}`, episodes: 10 + n, status: n === 1 ? 5 : asked.has(n) ? 2 : 1 })) : null;
        return { ...sItem(arg.id - 100, arg.mediaType, arg.mediaType === 'tv' ? 4 : 1), genres: ['Drama'], runtime: 50, seasons, jellyfinId: arg.mediaType === 'tv' ? 'id1' : null,
          requests: reqs.map((r) => ({ id: r.id, status: 2, mine: true, canCancel: true, seasons: r.seasons || [] })) };
      }
      if (ch === 'seerr:request') {
        window.lastRequest = arg; window.mockReqs ||= []; window.allRequests ||= [];
        const r = { id: 100 + window.mockReqs.length, mediaId: arg.mediaId, seasons: arg.seasons };
        window.mockReqs.push(r); window.allRequests.push(arg);
        await new Promise((res) => setTimeout(res, 300));
        return { id: r.id, status: 2 };
      }
      if (ch === 'seerr:cancel') { window.lastCancel = arg; window.mockReqs = (window.mockReqs || []).filter((r) => r.id !== arg); return { ok: true }; }
      if (ch === 'seerr:mine') return [{ canCancel: true, id: 1, requestStatus: 1, status: 2, mediaType: 'movie', tmdbId: 101, title: 'Film 1', poster: '', createdAt: '2026-11-11T20:00:00Z', seasons: [] }];
      if (ch === 'jf:delete') { window.lastDelete = arg; return { name: 'x' }; }
      if (ch === 'jf:item') return { ...it(1), People: [{ Id: 'p1', Name: 'Anna Beispiel', Role: 'Heldin', Type: 'Actor' }, { Id: 'p2', Name: 'Ben Regie', Type: 'Director' }] };
      if (ch === 'jf:similar') return { Items: [5, 6, 7].map((i) => it(i)) };
      if (ch === 'jf:genres') return { Items: [{ Id: 'g1', Name: 'Action' }, { Id: 'g2', Name: 'Drama' }] };
      if (ch === 'jf:person') return { Items: [it(3), it(4)] };
      if (ch === 'sys:setting') { data['app:state'].settings[arg.section][arg.key] = arg.value; return data['app:state'].settings[arg.section]; }
      if (ch === 'seerr:activity') return { downloads: [{ key: 'movie:1', mediaType: 'movie', tmdbId: 1, title: 'Film im Download', poster: '', backdrop: '', progress: 0.42, eta: new Date(Date.now() + 38 * 60000).toISOString(), parts: 1 }], available: [{ key: 'tv:2', mediaType: 'tv', tmdbId: 2, jellyfinId: 'id2', status: 5, updatedAt: new Date().toISOString(), title: 'Neue Serie', poster: '' }] };
      const yv = (i, ch2 = 'Kanal A') => ({ kind: 'video', id: 'v' + i, url: 'https://www.youtube.com/watch?v=v' + i, title: 'Video Nummer ' + i + ' mit etwas längerem Titel', channel: ch2, channelId: 'UC1', channelUrl: 'https://www.youtube.com/channel/UC1', duration: 600 + i * 37, views: 123000 * i, timestamp: Date.now() / 1000 - i * 86400, thumb: '' });
      window.ytFavs ||= [{ kind: 'channel', id: 'UC1', url: 'https://www.youtube.com/channel/UC1', title: 'Kanal A', thumb: '' }];
      if (ch === 'yt:status') return { available: true, favorites: window.ytFavs };
      if (ch === 'yt:feed') return [1, 2, 3, 4, 5].map((i) => yv(i));
      if (ch === 'yt:history') return [yv(9, 'Kanal B')];
      if (ch === 'yt:search' || ch === 'yt:channel' || ch === 'yt:playlist') return { entries: [1, 2, 3, 4].map((i) => yv(i)) };
      if (ch === 'yt:channelPlaylists') return { entries: [{ kind: 'playlist', id: 'PL9', url: 'https://www.youtube.com/playlist?list=PL9', title: 'Biologie', channel: 'Kanal A', thumb: '' }] };
      if (ch === 'yt:toggleFavorite') { const had = window.ytFavs.some((f) => f.id === arg.id); window.ytFavs = had ? window.ytFavs.filter((f) => f.id !== arg.id) : [{ kind: arg.kind, id: arg.id, url: arg.url, title: arg.title, thumb: arg.thumb }, ...window.ytFavs]; return { favorite: !had }; }
      if (ch === 'yt:play') { window.lastYt = arg; return null; }
      if (ch === 'player:control') { window.lastCtl = arg; return null; }
      if (ch === 'seerr:search') { window.lastSeerrQuery = arg.query; return { page: 1, totalPages: 1, results: [
        { id: 500, mediaType: 'person', title: 'Keanu Reeves', poster: '', knownFor: ['Matrix', 'John Wick'], status: 1 },
        { id: 101, mediaType: 'movie', title: 'Matrix', year: '1999', poster: '', status: 5 },
        { id: 102, mediaType: 'tv', title: 'Eine Serie', year: '2020', poster: '', status: 1 }] }; }
      if (ch === 'seerr:person') return { id: 500, name: 'Keanu Reeves', department: 'Acting', biography: 'Kanadischer Schauspieler, bekannt aus Matrix und John Wick.', photo: '', items: [
        { id: 101, mediaType: 'movie', title: 'Matrix', year: '1999', poster: '', status: 5, role: 'Neo' },
        { id: 103, mediaType: 'movie', title: 'John Wick', year: '2014', poster: '', status: 1, role: 'John Wick' },
        { id: 104, mediaType: 'tv', title: 'Swedish Dicks', year: '2016', poster: '', status: 1, role: 'Tex' }] };
      if (ch === 'jf:home') { const d = data['jf:home']; d.newEpisodes = [it(7, 'Episode', { SeriesName: 'Neue Serie', IndexNumber: 3, ParentIndexNumber: 2, DateCreated: new Date().toISOString(), UserData: {} })]; return d; }
      if (ch === 'yt:continue') return [{ ...yv(3), progress: 0.4 }];
      if (ch === 'yt:watchLater') return window.ytLater ||= [{ ...yv(5) }];
      if (ch === 'yt:toggleWatchLater') { window.ytLater ||= []; const had = window.ytLater.some((x) => x.id === arg.id); window.ytLater = had ? window.ytLater.filter((x) => x.id !== arg.id) : [arg, ...window.ytLater]; return { watchLater: !had }; }
      if (ch === 'yt:isWatchLater') return (window.ytLater || []).some((x) => x.id === arg);
      window.snd ||= { active: 'standard', profiles: [
        { id: 'standard', name: 'Standard', builtin: true, speech: 0, bass: 0, treble: 0, dynamics: 'aus', level: 0 },
        { id: 'nacht', name: 'Nacht', builtin: true, speech: 6, bass: -8, treble: 0, dynamics: 'mittel', level: 2 }] };
      window.sst ||= { night: false, balance: 0 };
      if (ch === 'sound:state') return { ...window.sst };
      if (ch === 'sound:setNight') { window.sst.night = !!arg; window.sst.balance = arg ? 6 : 0; return { ...window.sst }; }
      if (ch === 'sound:setBalance') { window.sst.balance = Math.max(0, Math.min(12, arg)); return { ...window.sst }; }
      if (ch === 'sound:list') return JSON.parse(JSON.stringify(window.snd));
      if (ch === 'sound:setActive') { window.snd.active = arg; return window.snd; }
      if (ch === 'sound:update') { const p = window.snd.profiles.find((x) => x.id === arg.id); Object.assign(p, arg.patch); return { ...p }; }
      if (ch === 'sound:create') { const p = { ...window.snd.profiles[0], id: 'e1', name: 'Eigenes 1', builtin: false }; window.snd.profiles.push(p); return p; }
      if (ch === 'sound:remove') { window.snd.profiles = window.snd.profiles.filter((x) => x.id !== arg); return window.snd; }
      if (ch === 'sound:reset') return {};
      if (ch in data) return data[ch];
      return null;
    },
    on(ch, fn) { (listeners[ch] ||= []).push(fn); },
    emit(ch, p) { (listeners[ch] || []).forEach((f) => f(p)); },
  };
}());
