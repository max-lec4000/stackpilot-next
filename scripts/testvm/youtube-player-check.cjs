'use strict';
// Spielt in sp-test EIN kurzes YouTube-Video mit Couchdecks echtem Player (mpv ohne Bild/Ton)
// und protokolliert Ladezustand, aktiven Player und Position – so lässt sich prüfen, ob der
// Player nach dem Start die Controller-Eingaben bekommt (loading=false, active=true).
//   node scripts/testvm/youtube-player-check.cjs [VIDEO-ID]
const fs = require('fs');
const os = require('os');
const path = require('path');
if (os.hostname() !== 'sp-test') throw Error('Nur in sp-test ausführen.');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-player-'));
process.env.COUCHDECK_CONFIG_DIR = tmp;
fs.writeFileSync(path.join(tmp, 'config.json'), JSON.stringify({ player: { extraArgs: ['--vo=null', '--ao=null'] } }));
const main = path.join(__dirname, '..', '..', 'apps', 'couchdeck', 'src', 'main');
const { Player } = require(path.join(main, 'player.js'));
const { YouTube } = require(path.join(main, 'youtube.js'));
const id = process.argv.slice(2).find((a) => /^[\w-]{11}$/.test(a)) || 'jNQXAC9IVRw';
(async () => {
  const yt = new YouTube();
  const player = new Player({ item: async () => ({}), playbackInfo: async () => ({}), report: async () => {} }, yt);
  // --drop-restart: mpv-Ereignis playback-restart verschlucken (Ladeanzeige muss trotzdem enden)
  if (process.argv.includes('--drop-restart')) {
    const orig = player.onEvent.bind(player);
    player.onEvent = (e) => (e.event === 'playback-restart' ? undefined : orig(e));
    player.mpv.removeAllListeners('event');
    player.mpv.on('event', (e) => player.onEvent(e));
  }
  const t0 = Date.now();
  const at = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';
  for (const ev of ['log', 'error', 'notice', 'started', 'ended', 'youtube-bot-check'])
    player.on(ev, (x) => console.log(at(), ev, typeof x === 'string' ? x.slice(0, 160) : ''));
  player.mpv?.on?.('log', (l) => console.log(at(), 'mpv', String(l).slice(0, 160)));
  await player.playYouTube([{ kind: 'video', id, title: 'Test', url: `https://www.youtube.com/watch?v=${id}` }], 0).catch((e) => console.log('play-Fehler', e.message));
  let firstReady = null;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const ready = !player.loading && player.active;
    if (ready && firstReady === null) firstReady = at();
    if (i % 4 === 0) console.log(at(), 'loading=' + !!player.loading, 'active=' + player.active, 'pos=' + (player.state.pos || 0).toFixed(1));
  }
  console.log(firstReady ? `PLAYER_READY nach ${firstReady}` : 'PLAYER_NOT_READY (Eingaben gingen an die Oberfläche)');
  // Verlorene Zuordnung nachstellen: mpv spielt weiter, Couchdeck hält nichts mehr
  const saved = player.current;
  player.current = null;
  console.log(player.state.idle === false ? 'ORPHAN_DETECTED (Eingaben gingen an mpv)' : 'ORPHAN_MISSED idle=' + player.state.idle);
  player.current = saved;
  await player.stop?.({ silent: true }).catch(() => {});
  player.mpv?.proc?.kill();
  yt.routes.stop();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(0);
})();
