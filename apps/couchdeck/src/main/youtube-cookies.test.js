'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { allowedUrl, isLoggedIn, netscapeCookies, writeCookieFile } = require('./youtube-cookies');

test('Anmeldeseite darf nur Google/YouTube über HTTPS öffnen', () => {
  for (const ok of ['https://accounts.google.com/ServiceLogin', 'https://www.youtube.com/', 'https://consent.youtube.com/x', 'https://ssl.gstatic.com/a.js', 'about:blank'])
    assert.equal(allowedUrl(ok), true, ok);
  for (const bad of ['http://www.youtube.com/', 'https://evil.com/', 'https://youtube.com.evil.com/', 'https://notgoogle.com/', 'file:///etc/passwd', 'javascript:alert(1)', 'nonsense'])
    assert.equal(allowedUrl(bad), false, bad);
});

test('Als angemeldet gilt nur ein YouTube-Anmeldecookie mit Wert', () => {
  assert.equal(isLoggedIn([{ domain: '.youtube.com', name: 'PREF', value: 'x' }]), false);
  assert.equal(isLoggedIn([{ domain: '.google.com', name: 'SAPISID', value: 'x' }]), false);
  assert.equal(isLoggedIn([{ domain: '.youtube.com', name: 'LOGIN_INFO', value: '' }]), false);
  assert.equal(isLoggedIn([{ domain: '.youtube.com', name: 'LOGIN_INFO', value: 'abc' }]), true);
  assert.equal(isLoggedIn([{ domain: 'www.youtube.com', name: '__Secure-3PSID', value: 'abc' }]), true);
});

test('Cookiedatei im Netscape-Format: nur Google/YouTube, Sitzungen mit 0, keine Steuerzeichen', () => {
  const text = netscapeCookies([
    { domain: '.youtube.com', hostOnly: false, path: '/', secure: true, expirationDate: 1900000000.7, name: 'LOGIN_INFO', value: 'a\tb' },
    { domain: 'accounts.google.com', hostOnly: true, path: '/', secure: true, session: true, name: 'LSID', value: 'x' },
    { domain: '.example.com', path: '/', name: 'X', value: 'y' },
  ]);
  const lines = text.trim().split('\n').filter((l) => !l.startsWith('#') && l);
  assert.equal(text.split('\n')[0], '# Netscape HTTP Cookie File');
  assert.deepEqual(lines, [
    '.youtube.com\tTRUE\t/\tTRUE\t1900000000\tLOGIN_INFO\tab',
    'accounts.google.com\tFALSE\t/\tTRUE\t0\tLSID\tx',
  ]);
});

test('Cookiedatei ist nur für den Besitzer lesbar', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-yt-'));
  const file = path.join(dir, 'sub', 'youtube-cookies.txt');
  writeCookieFile(file, [{ domain: '.youtube.com', name: 'LOGIN_INFO', value: 'v', path: '/' }]);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.match(fs.readFileSync(file, 'utf8'), /LOGIN_INFO\tv/);
  fs.rmSync(dir, { recursive: true, force: true });
});
