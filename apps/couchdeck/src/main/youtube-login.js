'use strict';
// YouTube-Anmeldung in Couchdeck: Die echte Google/YouTube-Seite wird über der Oberfläche
// eingeblendet (eigene, dauerhafte Sitzung, ohne Zugriff auf Couchdeck selbst). Bedienung
// mit Controller: Kreuz springt zwischen Feldern (Tab), A bestätigt (Enter), Texteingabe
// über die Couchdeck-Bildschirmtastatur. Nach der Anmeldung werden die Cookies für yt-dlp
// geschrieben – damit verschwindet die Bot-Bestätigung in der Regel.
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const { WebContentsView, session, screen } = require('electron');
const config = require('./config');
const { allowedUrl, isLoggedIn, writeCookieFile } = require('./youtube-cookies');

const PARTITION = 'persist:youtube-login';
const COOKIE_FILE = path.join(config.DIR, 'youtube-cookies.txt');
const SIGN_IN = 'https://accounts.google.com/ServiceLogin?service=youtube&hl=de&passive=true'
  + '&continue=' + encodeURIComponent('https://www.youtube.com/signin?action_handle_signin=true&next=%2F');
const HOME = 'https://www.youtube.com/';

class YouTubeLogin extends EventEmitter {
  constructor(getWindow) {
    super();
    this.getWindow = getWindow;
    this.view = null;
    this.keyboard = false;
    this.autoFinish = false;
    this.finishing = false;
  }

  get ses() { return session.fromPartition(PARTITION); }
  get isOpen() { return !!this.view; }
  get cookieFile() { return COOKIE_FILE; }

  async cookies() { return this.ses.cookies.get({}); }

  async status() {
    const loggedIn = isLoggedIn(await this.cookies());
    return { loggedIn, cookieFile: fs.existsSync(COOKIE_FILE) };
  }

  /** Anmeldeseite einblenden. autoFinish: nach erfolgreicher Anmeldung selbst schließen. */
  async open({ autoFinish = false } = {}) {
    const win = this.getWindow();
    if (!win || win.isDestroyed()) throw new Error('Kein Fenster');
    if (this.view) return this.status();
    this.autoFinish = autoFinish;
    const ses = this.ses;
    // Keine Kamera, kein Mikrofon, keine Benachrichtigungen o. Ä. für die Anmeldeseite.
    ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    ses.setPermissionCheckHandler(() => false);
    const view = new WebContentsView({
      webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
    });
    this.view = view;
    const wc = view.webContents;
    wc.setWindowOpenHandler(({ url }) => {
      if (allowedUrl(url)) wc.loadURL(url);
      return { action: 'deny' };
    });
    const guard = (e, url) => {
      if (!allowedUrl(url)) { e.preventDefault(); this.emit('blocked', url); }
    };
    wc.on('will-navigate', guard);
    wc.on('will-redirect', guard);
    wc.on('did-navigate', () => this.check());
    wc.on('did-navigate-in-page', () => this.check());
    // Tastatur am Server: Esc bricht ab
    wc.on('before-input-event', (e, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') { e.preventDefault(); this.close(); }
    });
    win.contentView.addChildView(view);
    this.layout();
    const already = isLoggedIn(await this.cookies());
    await wc.loadURL(already ? HOME : SIGN_IN).catch(() => {});
    wc.focus();
    return { loggedIn: already };
  }

  /** Seite oben, Couchdeck-Leiste (Hinweise bzw. Bildschirmtastatur) unten. */
  layout() {
    const win = this.getWindow();
    if (!this.view || !win || win.isDestroyed()) return;
    let { width, height } = win.getContentBounds();
    if (width < 100 || height < 100) ({ width, height } = screen.getPrimaryDisplay().size);
    const bar = Math.round(height * (this.keyboard ? 0.46 : 0.12));
    this.view.setBounds({ x: 0, y: 0, width, height: Math.max(200, height - bar) });
  }

  setKeyboard(open) { this.keyboard = !!open; this.layout(); if (!open) this.view?.webContents.focus(); }

  press(keyCode, modifiers = []) {
    const wc = this.view?.webContents;
    if (!wc) return;
    // Tastenereignisse kommen nur an, wenn die Seite den Fokus hat.
    if (!wc.isFocused()) wc.focus();
    wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    if (keyCode === 'Enter') wc.sendInputEvent({ type: 'char', keyCode: '\r', modifiers });
    if (keyCode === 'Space') wc.sendInputEvent({ type: 'char', keyCode: ' ', modifiers });
    wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  }

  /** Controller-Aktion auf die Seite übertragen. */
  input(action) {
    if (!this.view) return;
    const map = {
      down: ['Tab'], right: ['Tab'], up: ['Tab', ['shift']], left: ['Tab', ['shift']],
      select: ['Enter'], west: ['Backspace'], lb: ['PageUp'], rb: ['PageDown'],
    };
    if (action === 'view') { this.view.webContents.navigationHistory.goBack(); return; }
    const m = map[action];
    if (m) this.press(m[0], m[1] || []);
  }

  type(text) {
    const wc = this.view?.webContents;
    if (wc && typeof text === 'string' && text.length <= 200) wc.insertText(text);
  }

  backspace(n = 1) { for (let i = 0; i < Math.min(64, n); i++) this.press('Backspace'); }

  /** Nach jedem Seitenwechsel: angemeldet und zurück auf YouTube? Dann ggf. selbst abschließen. */
  async check() {
    if (!this.view || this.finishing) return;
    let host = '';
    try { host = new URL(this.view.webContents.getURL()).hostname; } catch {}
    if (!/(^|\.)youtube\.com$/.test(host)) return;
    if (!isLoggedIn(await this.cookies())) return;
    this.emit('ready');
    if (this.autoFinish) this.finish().catch(() => {});
  }

  /** Cookies für yt-dlp schreiben und schließen. */
  async finish() {
    if (this.finishing) return { loggedIn: false };
    this.finishing = true;
    try {
      const cookies = await this.cookies();
      const loggedIn = isLoggedIn(cookies);
      if (loggedIn) writeCookieFile(COOKIE_FILE, cookies);
      this.close();
      this.emit('done', { loggedIn });
      return { loggedIn };
    } finally { this.finishing = false; }
  }

  close() {
    const view = this.view;
    this.view = null;
    this.keyboard = false;
    if (!view) return;
    try { this.getWindow()?.contentView.removeChildView(view); } catch {}
    try { view.webContents.close(); } catch {}
    this.emit('closed');
  }

  /** Abmelden: Sitzung und Cookiedatei löschen. */
  async logout() {
    this.close();
    await this.ses.clearStorageData();
    try { fs.unlinkSync(COOKIE_FILE); } catch {}
    return { loggedIn: false };
  }
}

module.exports = { YouTubeLogin, COOKIE_FILE };
