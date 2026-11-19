'use strict';
// Prüft die YouTube-Anmeldung von Couchdeck ohne Bildschirm und ohne echtes Konto:
// lädt die echte Google-Anmeldeseite einmal, tippt in das Feld, springt mit Tab weiter,
// prüft die Navigationssperre und die Übergabe der Cookies an yt-dlp (mit einem
// künstlichen Test-Cookie). Ruft kein Video ab.
//
//   /opt/couchdeck/electron/electron --ozone-platform=headless --ozone-override-screen-size=1600,900 --disable-gpu \
//     scripts/testvm/youtube-login-smoke.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-ytlogin-'));
process.env.COUCHDECK_CONFIG_DIR = path.join(tmp, 'config');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', path.join(tmp, 'userdata'));

const root = path.join(__dirname, '..', '..', 'apps', 'couchdeck', 'src', 'main');
const results = [];
const ok = (name, cond, detail = '') => { results.push([cond ? 'OK  ' : 'FEHL', name, detail]); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const { YouTubeLogin, COOKIE_FILE } = require(path.join(root, 'youtube-login.js'));
  const win = new BrowserWindow({ width: 1600, height: 900, show: true });
  win.focus();
  await win.loadURL('about:blank');
  const login = new YouTubeLogin(() => win);
  const events = [];
  for (const e of ['blocked', 'ready', 'done', 'closed']) login.on(e, (p) => events.push([e, p]));
  try {
    const st = await login.open({ autoFinish: false });
    ok('Anmeldeseite geöffnet, noch nicht angemeldet', login.isOpen && st.loggedIn === false);
    const wc = login.view.webContents;
    await wait(4000);
    const host = new URL(wc.getURL()).hostname;
    ok('Google-Anmeldeseite geladen', host === 'accounts.google.com', host);
    const b = login.view.getBounds();
    ok('Seite lässt unten Platz für die Couchdeck-Leiste', b.height < 900 && b.height > 600, JSON.stringify(b));
    login.setKeyboard(true);
    ok('Mit Tastatur wird die Seite kleiner', login.view.getBounds().height < b.height);
    login.setKeyboard(false);
    // Eingabefeld fokussieren (Google setzt den Fokus meist selbst) und tippen
    await wc.executeJavaScript("(document.querySelector('input[type=email]')||document.querySelector('input'))?.focus(); true");
    login.type('test.couchdeck@example.com');
    await wait(300);
    let value = await wc.executeJavaScript('document.activeElement && document.activeElement.value');
    ok('Bildschirmtastatur tippt in das Feld', value === 'test.couchdeck@example.com', String(value));
    login.backspace(4);
    await wait(300);
    value = await wc.executeJavaScript('document.activeElement && document.activeElement.value');
    ok('Löschen entfernt Zeichen', value === 'test.couchdeck@example', String(value));
    const before = await wc.executeJavaScript("document.activeElement && (document.activeElement.id || document.activeElement.name || document.activeElement.tagName)");
    login.input('down');
    await wait(300);
    const after = await wc.executeJavaScript("document.activeElement && (document.activeElement.id || document.activeElement.name || document.activeElement.tagName)");
    ok('Kreuz ↓ springt zum nächsten Element (Tab)', before !== after, `${before} → ${after}`);
    // Navigationssperre: Seite versucht, eine fremde Adresse zu öffnen
    await wc.executeJavaScript("location.href='https://example.com/'; true").catch(() => {});
    await wait(1500);
    ok('Fremde Adresse wird gesperrt', new URL(wc.getURL()).hostname === 'accounts.google.com' && events.some(([e]) => e === 'blocked'));
    // Übergabe an yt-dlp mit künstlichem Anmeldecookie (kein echtes Konto)
    await login.ses.cookies.set({ url: 'https://www.youtube.com', domain: '.youtube.com', name: 'LOGIN_INFO', value: 'testwert', secure: true, expirationDate: Math.floor(Date.now() / 1000) + 3600 });
    const fin = await login.finish();
    ok('Anmeldung übernommen und Ansicht geschlossen', fin.loggedIn === true && !login.isOpen && events.some(([e, p]) => e === 'done' && p.loggedIn));
    const file = fs.readFileSync(COOKIE_FILE, 'utf8');
    ok('Cookiedatei für yt-dlp geschrieben (0600)', /LOGIN_INFO\ttestwert/.test(file) && (fs.statSync(COOKIE_FILE).mode & 0o777) === 0o600);
    const { YouTube } = require(path.join(root, 'youtube.js'));
    const yt = new YouTube();
    yt.jsArgs = [];
    const args = await yt.baseArgs();
    ok('yt-dlp bekommt --cookies', args.includes('--cookies') && args[args.indexOf('--cookies') + 1] === COOKIE_FILE);
    ok('mpv-Ausweichweg bekommt cookies=', (await yt.ytdlRawOptions()).includes('cookies=' + COOKIE_FILE));
    await login.logout();
    ok('Abmelden löscht Sitzung und Datei', !fs.existsSync(COOKIE_FILE) && (await login.status()).loggedIn === false);
  } catch (e) {
    ok('Ablauf ohne Ausnahme', false, e.stack || e.message);
  }
  for (const [s, n, d] of results) console.log(s, n, d ? '· ' + String(d).slice(0, 160) : '');
  const failed = results.some(([s]) => s !== 'OK  ');
  console.log(failed ? 'YOUTUBE_LOGIN_SMOKE_FAILED' : 'YOUTUBE_LOGIN_SMOKE_CONFIRMED');
  fs.rmSync(tmp, { recursive: true, force: true });
  app.exit(failed ? 1 : 0);
});
