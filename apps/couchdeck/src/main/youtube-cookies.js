'use strict';
// Reine Hilfsfunktionen für die YouTube-Anmeldung (ohne Electron, damit testbar):
// welche Adressen die Anmeldeseite öffnen darf, wann eine Sitzung als angemeldet gilt und
// wie die Cookies für yt-dlp (Netscape-Format) geschrieben werden.
const fs = require('fs');
const path = require('path');

// Nur Google/YouTube-Seiten, die für Anmeldung und Bestätigung nötig sind.
const ALLOWED_HOSTS = ['youtube.com', 'google.com', 'gstatic.com', 'googleusercontent.com', 'youtube-nocookie.com'];

function allowedUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'https:') return u.href === 'about:blank';
  const host = u.hostname.toLowerCase();
  return ALLOWED_HOSTS.some((h) => host === h || host.endsWith('.' + h));
}

// Cookies, die YouTube nach einer Anmeldung setzt. Eines davon genügt als Nachweis.
const LOGIN_COOKIES = ['LOGIN_INFO', 'SAPISID', '__Secure-1PSID', '__Secure-3PSID'];

function relevant(cookie) {
  const d = String(cookie.domain || '').replace(/^\./, '').toLowerCase();
  return ['youtube.com', 'google.com'].some((h) => d === h || d.endsWith('.' + h));
}

function isLoggedIn(cookies) {
  return (cookies || []).some((c) => relevant(c)
    && /(^|\.)youtube\.com$/.test(String(c.domain || '').replace(/^\./, ''))
    && LOGIN_COOKIES.includes(c.name) && c.value);
}

/** Netscape-Cookiedatei, wie yt-dlp sie mit --cookies liest. */
function netscapeCookies(cookies) {
  const clean = (v) => String(v ?? '').replace(/[\t\r\n]/g, '');
  const lines = ['# Netscape HTTP Cookie File', '# Von Couchdeck aus der YouTube-Anmeldung erzeugt. Nicht weitergeben.', ''];
  for (const c of cookies || []) {
    if (!relevant(c) || !c.name) continue;
    const domain = clean(c.domain);
    const sub = !c.hostOnly || domain.startsWith('.');
    const host = sub && !domain.startsWith('.') ? '.' + domain : domain;
    // Sitzungscookies haben kein Ablaufdatum; yt-dlp liest 0 als „Sitzung“.
    const expiry = c.session || !c.expirationDate ? 0 : Math.floor(c.expirationDate);
    lines.push([host, sub ? 'TRUE' : 'FALSE', clean(c.path || '/'), c.secure ? 'TRUE' : 'FALSE', String(expiry), clean(c.name), clean(c.value)].join('\t'));
  }
  return lines.join('\n') + '\n';
}

/** Atomar und nur für den Couchdeck-Benutzer lesbar schreiben. */
function writeCookieFile(file, cookies) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, netscapeCookies(cookies), { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
}

module.exports = { allowedUrl, isLoggedIn, netscapeCookies, writeCookieFile, LOGIN_COOKIES };
