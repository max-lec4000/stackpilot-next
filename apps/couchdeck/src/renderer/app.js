'use strict';
/* Couchdeck – Oberfläche. Alles ist mit Steuerkreuz + A/B bedienbar. */

/* global cd */ // von preload.js bereitgestellt
const $ =(sel, root = document) => root.querySelector(sel);

const S = {
  imgBase: 'http://127.0.0.1:8096',
  auth: { loggedIn: false },
  settings: null,
  stack: [],
  overlay: null, // { node, onAction, lastFocus }
  stacks: {}, // gespeicherte Verläufe der anderen Bereiche
  player: { active: false },
};

// ---------- Helfer ----------

function h(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'data') Object.assign(n.dataset, v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return n;
}

/** Wie node.append, ignoriert aber null/false und flacht Listen ab. */
function append(node, ...children) {
  node.append(...children.flat(Infinity).filter((c) => c != null && c !== false));
  return node;
}

function img(id, type, tag, height) {
  if (!id) return '';
  const u = new URL(`${S.imgBase}/Items/${id}/Images/${type}`);
  if (tag) u.searchParams.set('tag', tag);
  if (height) u.searchParams.set('fillHeight', height);
  u.searchParams.set('quality', '88');
  return u.toString();
}

function posterUrl(it, height = 480) {
  if (it.ImageTags?.Primary) return img(it.Id, 'Primary', it.ImageTags.Primary, height);
  if (it.SeriesPrimaryImageTag) return img(it.SeriesId, 'Primary', it.SeriesPrimaryImageTag, height);
  if (it.AlbumPrimaryImageTag) return img(it.AlbumId, 'Primary', it.AlbumPrimaryImageTag, height);
  return '';
}

function wideUrl(it, height = 360) {
  if (it.Type === 'Episode' && it.ImageTags?.Primary) return img(it.Id, 'Primary', it.ImageTags.Primary, height);
  if (it.ImageTags?.Thumb) return img(it.Id, 'Thumb', it.ImageTags.Thumb, height);
  if (it.ParentThumbImageTag) return img(it.ParentThumbItemId, 'Thumb', it.ParentThumbImageTag, height);
  if (it.BackdropImageTags?.length) return img(it.Id, 'Backdrop', it.BackdropImageTags[0], height);
  if (it.ParentBackdropImageTags?.length) return img(it.ParentBackdropItemId, 'Backdrop', it.ParentBackdropImageTags[0], height);
  return posterUrl(it, height);
}

/** Titel-Logo (falls vorhanden) – bei Folgen das Logo der Serie. */
function logoUrl(it, height = 220) {
  if (it?.ImageTags?.Logo) return img(it.Id, 'Logo', it.ImageTags.Logo, height);
  if (it?.ParentLogoImageTag && it.ParentLogoItemId) return img(it.ParentLogoItemId, 'Logo', it.ParentLogoImageTag, height);
  return '';
}

/** Titel als Logo-Bild mit Text-Fallback (falls das Bild nicht lädt). */
function titleNode(it, text, cls = '') {
  const url = logoUrl(it);
  const h1 = h('h1', { class: cls }, text);
  if (!url) return h1;
  const im = h('img', { class: 'logo', src: url, alt: text });
  im.addEventListener('error', () => im.replaceWith(h1));
  return im;
}

function backdropUrl(it) {
  if (!it) return '';
  if (it.BackdropImageTags?.length) return img(it.Id, 'Backdrop', it.BackdropImageTags[0], 1080);
  if (it.ParentBackdropImageTags?.length) return img(it.ParentBackdropItemId, 'Backdrop', it.ParentBackdropImageTags[0], 1080);
  return '';
}

function runtime(ticks) {
  if (!ticks) return '';
  const m = Math.round(ticks / 600_000_000);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}

function epCode(it) {
  if (it.Type !== 'Episode') return '';
  return `S${String(it.ParentIndexNumber ?? 0).padStart(2, '0')}E${String(it.IndexNumber ?? 0).padStart(2, '0')}`;
}

function bytes(n) {
  if (n == null) return '–';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i >= 3 ? 1 : 0)} ${u[i]}`;
}

function toast(text, kind = 'info') {
  const t = h('div', { class: `toast ${kind}` }, text);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 7000 : 4000);
}

async function call(ch, arg) {
  try { return await cd.call(ch, arg); } catch (e) { toast(e.message, 'error'); throw e; }
}

const PLAYABLE = new Set(['Movie', 'Episode', 'Video', 'MusicVideo', 'Audio', 'Trailer']);

// ---------- Fokus & räumliche Navigation ----------

function activeRoot() {
  if (S.overlay) return S.overlay.node;
  return S.stack.at(-1)?.node || document.body;
}

function focusables(root = activeRoot()) {
  return [...root.querySelectorAll('.focusable')].filter((n) => n.offsetParent !== null && !n.disabled);
}

let focused = null;
function setFocus(node, { scroll = true } = {}) {
  if (!node) return;
  if (focused) focused.classList.remove('focused');
  focused = node;
  node.classList.add('focused');
  node.focus({ preventScroll: true });
  if (scroll) {
    const row = node.closest('.row-items, .tabs');
    if (row) {
      const r = node.getBoundingClientRect(); const rr = row.getBoundingClientRect();
      if (r.left < rr.left + 40 || r.right > rr.right - 40) {
        row.scrollTo({ left: node.offsetLeft - row.clientWidth / 2 + node.clientWidth / 2, behavior: 'smooth' });
      }
    }
    node.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    const sc = node.closest('.scroll');
    if (sc) {
      const r = node.getBoundingClientRect(); const sr = sc.getBoundingClientRect();
      if (r.top < sr.top + sr.height * 0.25 || r.bottom > sr.bottom - sr.height * 0.15) {
        sc.scrollTo({ top: sc.scrollTop + (r.top - sr.top) - sr.height * 0.35, behavior: 'smooth' });
      }
    }
  }
  node.dispatchEvent(new CustomEvent('cdfocus', { bubbles: true }));
  updateHints();
}

function move(dir) {
  const list = focusables();
  if (!list.length) return;
  if (!focused || !list.includes(focused)) return setFocus(list[0]);
  const a = focused.getBoundingClientRect();
  // Sehr breite Elemente (Banner): vom linken Bereich aus messen, damit ↑/↓ links landet
  const ax = a.width > window.innerWidth * 0.5 ? a.left + 120 : a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  let best = null; let bestScore = Infinity;
  for (const n of list) {
    if (n === focused) continue;
    const b = n.getBoundingClientRect();
    const bx = b.left + b.width / 2; const by = b.top + b.height / 2;
    let primary; let secondary;
    if (dir === 'left') { if (b.right > a.left + 4 && bx >= ax) continue; primary = ax - bx; secondary = Math.abs(by - ay); }
    if (dir === 'right') { if (b.left < a.right - 4 && bx <= ax) continue; primary = bx - ax; secondary = Math.abs(by - ay); }
    if (dir === 'up') { if (b.bottom > a.top + 4 && by >= ay) continue; primary = ay - by; secondary = Math.abs(bx - ax); }
    if (dir === 'down') { if (b.top < a.bottom - 4 && by <= ay) continue; primary = by - ay; secondary = Math.abs(bx - ax); }
    // Ziel muss eindeutig in der Richtung liegen (mind. halbe eigene Größe versetzt) –
    // sonst gelten z. B. minimal höhere Nachbarknöpfe als "weiter unten"
    const minStep = (dir === 'left' || dir === 'right') ? a.width / 2 : a.height / 2;
    if (primary < minStep) continue;
    // Seitwärts nur innerhalb derselben Zeile (vertikale Überlappung)
    if ((dir === 'left' || dir === 'right') && (b.bottom <= a.top + 4 || b.top >= a.bottom - 4)) continue;
    // Senkrecht: gleiche Spalte bevorzugen; waagerecht: gleiche Zeile stark bevorzugen
    const score = (dir === 'left' || dir === 'right') ? primary + secondary * 4 : primary + secondary * 0.6;
    if (score < bestScore) { bestScore = score; best = n; }
  }
  if (best) setFocus(best);
  else if (dir === 'up' && !S.overlay) enterBar(); // ganz oben: in die Bereichsleiste
  else if (dir === 'down' && !S.overlay) enterMini(); // ganz unten: in den Mini-Player (falls Musik läuft)
}

// ---------- Screens ----------

function push(screen) {
  const cur = S.stack.at(-1);
  if (cur) { cur.lastFocus = focused; cur.node.hidden = true; }
  S.stack.push(screen);
  if (screen.backdrop || S.section !== 'kino') setBackdrop(screen.backdrop || '');
  screen.node.classList.add('enter');
  $('#screens').append(screen.node);
  screen.render?.();
  focusFirst(screen);
  updateHints();
}

function pop() {
  if (S.stack.length <= 1) return false;
  const old = S.stack.pop();
  old.node.remove();
  old.destroy?.();
  const cur = S.stack.at(-1);
  cur.node.hidden = false;
  cur.node.classList.remove('enter'); void cur.node.offsetWidth; cur.node.classList.add('enter');
  if (cur.lastFocus && cur.node.contains(cur.lastFocus)) setFocus(cur.lastFocus); else focusFirst(cur);
  cur.onShow?.();
  setBackdrop(cur.backdrop);
  updateHints();
  return true;
}

function replaceRoot(screen) {
  if (bar.active) { bar.active = false; bar.el?.classList.remove('expanded'); }
  while (S.stack.length) { const s = S.stack.pop(); s.node.remove(); s.destroy?.(); }
  push(screen);
}

/** Alle Bereichs-Verläufe verwerfen (z. B. bei An-/Abmeldung). */
function resetAllSections() {
  for (const [k, st] of Object.entries(S.stacks)) { if (k !== S.section) st.forEach((sc) => { sc.node.remove(); sc.destroy?.(); }); }
  S.stacks = {};
}

function focusFirst(screen) {
  const pref = screen.node.querySelector('.focusable[data-autofocus]') || focusables(screen.node)[0];
  if (pref) setFocus(pref, { scroll: false });
}

let bdTimer = null;
function setBackdrop(url) {
  S.backdropUrl = url || '';
  clearTimeout(bdTimer);
  bdTimer = setTimeout(() => {
    const b = $('#backdrop-img');
    if (!url) { b.classList.remove('on'); return; }
    const pre = new Image();
    pre.onload = () => { b.style.backgroundImage = `url("${url}")`; b.classList.add('on'); };
    pre.src = url;
  }, 250);
}

const HINT_ACTIONS = { a: 'select', b: 'back', x: 'west', y: 'north', menu: 'menu' };

/** Tastenhinweis unten rechts – per Maus/Touch anklickbar. */
function hint(glyph, cls, text) {
  const action = HINT_ACTIONS[cls];
  return h('button', {
    class: 'hint',
    onmousedown: (e) => e.preventDefault(), // Fokus nicht verlieren
    onclick: (e) => { e.stopPropagation(); if (action) handleAction(action, { fromMouse: true }); },
  }, h('span', { class: `btn-glyph ${cls}` }, glyph), text);
}

/**
 * Tastenhinweise unten rechts – passend zum markierten Element, damit man
 * sieht, was gerade möglich ist (z. B. ←→ blättert im Banner).
 */
let lastHintKey = '';
function contextHints() {
  if (S.overlay?.hints) return S.overlay.hints();
  if (bar.active) return [['←→', 'dir', 'Bereich wechseln'], ['↓', 'dir', 'Zum Inhalt'], ['LB RB', 'menu', 'Bereich']];
  const f = focused;
  const scr = S.stack.at(-1);
  if (scr?.hintsFixed) return scr.hints();
  const search = ['Y', 'y', 'Suche'];
  const back = S.stack.length > 1 ? ['B', 'b', 'Zurück'] : null;
  if (f?.closest?.('.osk')) return [['A', 'a', 'Taste'], ['X', 'x', 'Löschen'], ['Y', 'y', 'Leerzeichen'], ['B', 'b', 'Zurück']];
  if (f?.classList.contains('spotlight')) return [['A', 'a', 'Abspielen'], ['←→', 'dir', 'Blättern'], ['X', 'x', 'Info'], search];
  if (f?.onAdjust) return [['←→', 'dir', 'Ändern'], ['A', 'a', f.classList.contains('volume') ? 'Stumm' : 'Weiter'], back || ['☰', 'menu', 'Menü']].filter(Boolean);
  if (f && (f.item || f.ytItem || f.seerrItem || f.lazyInfo)) return [['A', 'a', 'Öffnen'], ['X', 'x', 'Info'], search, back || ['LB RB', 'menu', 'Bereich']].filter(Boolean);
  if (scr?.hints) return scr.hints();
  return [['A', 'a', 'Auswählen'], search, back || ['☰', 'menu', 'Menü']].filter(Boolean);
}

function updateHints() {
  const list = contextHints();
  const key = JSON.stringify(list);
  if (key === lastHintKey) return;
  lastHintKey = key;
  const f = $('#hints'); f.textContent = '';
  for (const [g, c, t] of list) f.append(hint(g, c, t));
}

// ---------- Karten ----------

/** Folge in den letzten 7 Tagen hinzugekommen und noch nicht gesehen? */
function isNewEpisode(it) {
  return it.Type === 'Episode' && !it.UserData?.Played && it.DateCreated && Date.now() - new Date(it.DateCreated) < 7 * 864e5;
}

function cardFor(it, { wide = false, onSelect } = {}) {
  const url = wide ? wideUrl(it) : posterUrl(it);
  const ud = it.UserData || {};
  const pct = ud.PlayedPercentage && !ud.Played ? ud.PlayedPercentage : 0;
  const title = it.Type === 'Episode' ? it.SeriesName : it.Name;
  const sub = it.Type === 'Episode' ? `${epCode(it)} · ${it.Name}`
    : [it.ProductionYear, it.Type === 'Series' && it.ChildCount ? `${it.ChildCount} Staffeln` : null].filter(Boolean).join(' · ');
  const node = h('button', { class: `card focusable${wide ? ' wide' : ''}`, tabindex: -1 },
    h('div', { class: 'img', style: url ? { backgroundImage: `url("${url}")` } : {} },
      url ? null : h('div', { class: 'fallback' }, it.Name),
      ud.Played ? h('div', { class: 'badge done' }, '✓')
        : ud.UnplayedItemCount ? h('div', { class: 'badge' }, ud.UnplayedItemCount) : null,
      isNewEpisode(it) ? h('div', { class: 'badge new' }, 'NEU') : null,
      pct ? h('div', { class: 'progress' }, h('i', { style: { width: `${pct}%` } })) : null),
    h('div', { class: 'title' }, title),
    sub ? h('div', { class: 'sub' }, sub) : null);
  node.item = it;
  node.addEventListener('cdselect', () => (onSelect || openItem)(it));
  node.addEventListener('cdfocus', () => {
    if (S.section === 'kino') setBackdrop(backdropUrl(it)); // nur Kino: Bild des markierten Titels
    S.stack.at(-1)?.onItemFocus?.(it);
  });
  return node;
}

function row(title, items, opts = {}) {
  if (!items?.length) return null;
  return h('section', { class: 'row' }, h('h2', {}, title),
    h('div', { class: 'row-items' }, items.map((it) => cardFor(it, opts))));
}

function openItem(it) {
  if (it.Type === 'CollectionFolder' || it.Type === 'UserView' || it.Type === 'Folder' || it.Type === 'BoxSet') {
    push(libraryScreen(it));
  } else if (it.Type === 'Season') {
    push(detailScreen({ Id: it.SeriesId, Type: 'Series' }, { seasonId: it.Id }));
  } else {
    push(detailScreen(it));
  }
}

async function play(ids, opts = {}) {
  toast('Wird gestartet …');
  try { await cd.call('player:play', { ids, ...opts }); } catch (e) { toast('Wiedergabe fehlgeschlagen: ' + e.message, 'error'); }
}

// ---------- Login ----------

function loginScreen() {
  const node = h('div', { class: 'screen' });
  let secret = null; let timer = null;
  const body = h('div', { class: 'login' });
  node.append(body);

  async function start() {
    clearInterval(timer);
    body.textContent = '';
    body.append(h('div', {}, h('div', { class: 'spinner' })));
    let qc;
    try {
      qc = await cd.call('jf:qcInitiate');
    } catch (e) {
      body.textContent = '';
      body.append(h('div', {},
        h('h1', {}, 'Jellyfin nicht erreichbar'),
        h('p', {}, e.message),
        h('div', { class: 'actions', style: { justifyContent: 'center' } },
          h('button', { class: 'action primary focusable', 'data-autofocus': true, oncdselect: start }, 'Erneut versuchen'))));
      focusFirst(screen);
      return;
    }
    secret = qc.Secret;
    body.textContent = '';
    body.append(h('div', {},
      h('h1', {}, 'Mit Jellyfin verbinden'),
      h('p', {}, 'Öffne Jellyfin auf dem Handy oder im Browser und gib diesen Code ein:'),
      h('div', { class: 'code' }, qc.Code),
      h('ol', {},
        h('li', {}, 'Profilbild antippen → „Quick Connect“'),
        h('li', {}, 'Code eingeben und bestätigen')),
      h('div', { class: 'actions', style: { justifyContent: 'center' } },
        h('button', { class: 'action focusable', 'data-autofocus': true, oncdselect: start }, 'Neuer Code'),
        h('button', { class: 'action focusable', oncdselect: () => push(passwordScreen()) }, 'Mit Passwort anmelden'))));
    focusFirst(screen);
    timer = setInterval(async () => {
      try {
        const r = await cd.call('jf:qcPoll', secret);
        if (r.authenticated) { clearInterval(timer); }
      } catch { /* weiter warten */ }
    }, 3000);
  }

  const screen = { node, render: start, destroy: () => clearInterval(timer), hints: () => [['A', 'a', 'Auswählen']] };
  return screen;
}

function passwordScreen() {
  const node = h('div', { class: 'screen' });
  const vals = { username: '', password: '' };
  let field = 'username';
  const userF = h('button', { class: 'setting focusable', oncdselect: () => { field = 'username'; draw(); } });
  const passF = h('button', { class: 'setting focusable', oncdselect: () => { field = 'password'; draw(); } });
  const kb = keyboard((v) => { vals[field] = v; draw(); }, () => vals[field]);
  function draw() {
    userF.textContent = ''; passF.textContent = '';
    userF.append(h('span', {}, 'Benutzer'), h('span', { class: 'val' }, (vals.username || '–') + (field === 'username' ? ' ✎' : '')));
    passF.append(h('span', {}, 'Passwort'), h('span', { class: 'val' }, ('•'.repeat(vals.password.length) || '–') + (field === 'password' ? ' ✎' : '')));
    kb.sync();
  }
  const submit = h('button', { class: 'action primary focusable', oncdselect: async () => {
    try { await cd.call('jf:login', vals); } catch (e) { toast('Anmeldung fehlgeschlagen: ' + e.message, 'error'); }
  } }, 'Anmelden');
  node.append(h('div', { class: 'scroll' },
    h('h1', { class: 'screen-title' }, 'Mit Passwort anmelden'),
    h('div', { class: 'search-layout' }, kb.node,
      h('div', { style: { width: '30rem' } }, userF, passF, h('div', { class: 'actions' }, submit)))));
  draw();
  return { node };
}

// ---------- Bildschirmtastatur ----------

function keyboard(onChange, getValue, { secretField = false, extraKeys = [] } = {}) {
  const field = h('div', { class: 'field' });
  const keys = [...'abcdefghijklmnopqrstuvwxyzäöüß1234567890'.split(''), ...extraKeys];
  let value = '';
  let upper = false;
  const grid = h('div', { class: 'keys' });
  const keyNodes = [];
  for (const k of keys) {
    const b = h('button', { class: 'key focusable', oncdselect: () => set(value + (upper ? k.toUpperCase() : k)) }, k);
    b.dataset.k = k; keyNodes.push(b); grid.append(b);
  }
  grid.append(
    h('button', { class: 'key focusable', oncdselect: () => { upper = !upper; redraw(); } }, '⇧'),
    h('button', { class: 'key focusable', oncdselect: () => set(value + '-') }, '-'),
    h('button', { class: 'key span2 focusable', oncdselect: () => set(value + ' ') }, 'Leer'),
    h('button', { class: 'key span2 focusable', oncdselect: () => set(value.slice(0, -1)) }, '⌫'),
    h('button', { class: 'key focusable', oncdselect: () => set('') }, '✕'));
  function redraw() {
    for (const b of keyNodes) b.textContent = upper ? b.dataset.k.toUpperCase() : b.dataset.k;
    field.textContent = '';
    field.append(secretField ? '•'.repeat(value.length) : value, h('span', { class: 'caret' }));
  }
  function set(v) { value = v; redraw(); onChange(v); }
  const node = h('div', { class: 'osk' }, field, grid);
  return {
    node, set,
    sync() { value = getValue ? getValue() : value; redraw(); },
    backspace() { set(value.slice(0, -1)); },
    type(ch) { set(value + ch); },
  };
}

// ---------- Home ----------

function homeScreen() {
  const node = h('div', { class: 'screen' });
  const content = h('div', {}, h('div', { class: 'spinner' }));
  const scroll = h('div', { class: 'scroll' }, content);
  node.append(scroll);
  let spot = null;

  async function load() {
    let data;
    try { data = await cd.call('jf:home'); } catch (e) {
      content.textContent = '';
      content.append(h('div', { class: 'empty' }, 'Bibliothek konnte nicht geladen werden: ' + e.message),
        h('div', { class: 'navrow' }, h('button', { class: 'chip focusable', oncdselect: load }, 'Erneut versuchen')));
      focusFirst(screen);
      return;
    }
    const keep = focused && node.contains(focused) ? focused.item?.Id : null;
    content.textContent = '';
    const VIEW_ICON = { movies: '🎞', tvshows: '📺', boxsets: '🗂', music: '♪', homevideos: '🏠' };
    const nav = h('div', { class: 'navrow' },
      h('button', { class: 'chip focusable', oncdselect: () => push(searchScreen()) }, h('span', { class: 'ci' }, '🔍'), 'Suche'),
      h('button', { class: 'chip focusable', oncdselect: () => push(seerrScreen()) }, h('span', { class: 'ci' }, '＋'), 'Anfragen'),
      data.views.filter((v) => v.CollectionType !== 'music').map((v) => h('button', { class: 'chip focusable', oncdselect: () => push(libraryScreen(v)) },
        h('span', { class: 'ci' }, VIEW_ICON[v.CollectionType] || '▤'), v.Name)),
      h('button', { class: 'chip focusable', oncdselect: openMenu }, h('span', { class: 'ci' }, '☰'), 'Menü'));
    // Spotlight: Weiterschauen zuerst, dann Neuheiten – nur Titel mit Hintergrundbild
    const pool = [...data.resume, ...data.nextUp, ...data.latest.flatMap((l) => l.items)];
    const seenIds = new Set();
    const featured = pool.filter((it) => {
      const key = it.SeriesId || it.Id;
      if (seenIds.has(key) || !backdropUrl(it)) return false;
      seenIds.add(key); return true;
    }).slice(0, 7);
    spot?.destroy();
    spot = featured.length ? spotlight(featured.map((it) => jfSlide(it, data))) : null;
    content.append(...[nav,
      spot?.node,
      activityRows(),
      row('Weiterschauen', data.resume, { wide: true, onSelect: (it) => play([it.Id]) }),
      row('🆕 Neue Folgen deiner Serien', data.newEpisodes || [], { wide: true, onSelect: (it) => play([it.Id]) }),
      row('Nächste Folgen', data.nextUp, { wide: true, onSelect: (it) => play([it.Id]) }),
      ...data.latest.map(({ view, items }) => row(`Neu in ${view.Name}`, items))].filter(Boolean));
    if (!data.resume.length && !data.nextUp.length && !data.latest.some((l) => l.items.length)) {
      content.append(h('div', { class: 'empty' }, 'Noch nichts in der Bibliothek.'));
    }
    const again = keep && [...node.querySelectorAll('.card')].find((c) => c.item?.Id === keep);
    if (again) setFocus(again, { scroll: false });
    else {
      const first = spot?.focusEl || node.querySelector('.row .card') || node.querySelector('.chip');
      if (first) setFocus(first, { scroll: false });
    }
  }

  const screen = {
    node,
    render: load,
    refresh: load,
    destroy: () => spot?.destroy(),
    onAction() { return false; },
  };
  return screen;
}

// ---------- Spotlight (großes Banner oben) ----------

/** Folie aus einem Jellyfin-Titel. */
function jfSlide(it) {
  const ud = it.UserData || {};
  const resume = ud.PlaybackPositionTicks > 0;
  const isEp = it.Type === 'Episode';
  return {
    key: it.Id,
    bg: backdropUrl(it),
    logo: logoUrl(it, 260),
    title: isEp ? it.SeriesName : it.Name,
    kicker: resume ? 'Weiterschauen' : isEp ? 'Nächste Folge' : it.Type === 'Series' ? 'Neue Serie' : 'Neu in der Bibliothek',
    meta: [isEp ? `${epCode(it)} · ${it.Name}` : null, it.ProductionYear, it.RunTimeTicks ? runtime(it.RunTimeTicks) : null,
      it.OfficialRating, it.CommunityRating ? `★ ${it.CommunityRating.toFixed(1)}` : null],
    text: it.Overview || '',
    progress: resume ? ud.PlayedPercentage : null,
    playLabel: resume ? '▶ Fortsetzen' : PLAYABLE.has(it.Type) ? '▶ Abspielen' : 'Öffnen',
    onPlay: () => (PLAYABLE.has(it.Type) ? play([it.Id]) : openItem(it)),
    onOpen: () => openItem(it),
    infoCard: { item: it, dispatchEvent: () => openItem(it) },
  };
}

/** Folie aus einem YouTube-Video. */
function ytSlide(e, list) {
  return {
    key: e.id,
    bg: `https://i.ytimg.com/vi/${e.id}/maxresdefault.jpg`,
    bgFallback: e.thumb,
    title: e.title,
    kicker: `Neu von ${e.channel || 'deinen Kanälen'}`,
    meta: [fmtDur(e.duration), fmtViews(e.views), fmtAgo(e.timestamp)],
    text: '',
    playLabel: '▶ Abspielen',
    onPlay: () => ytPlay(list, list.indexOf(e)),
    onOpen: () => ytPlay(list, list.indexOf(e)),
    infoCard: { ytItem: e, dispatchEvent: () => ytPlay(list, list.indexOf(e)) },
  };
}

/**
 * Banner mit automatisch wechselnden Folien.
 * Fokus liegt auf dem ganzen Banner: ←/→ blättern, A abspielen, X Infos.
 */
function spotlight(slides) {
  let idx = 0; let timer = null;
  const bgA = h('div', { class: 'spot-bg' }); const bgB = h('div', { class: 'spot-bg' });
  let front = bgA;
  const kicker = h('div', { class: 'spot-kicker' });
  const titleBox = h('div', { class: 'spot-title' });
  const meta = h('div', { class: 'spot-meta' });
  const text = h('p', { class: 'spot-text' });
  const prog = h('div', { class: 'spot-progress' }, h('i'));
  const playBtn = h('span', { class: 'spot-btn primary', onclick: (e) => { e.stopPropagation(); slides[idx].onPlay(); } });
  const infoBtn = h('span', { class: 'spot-btn', onclick: (e) => { e.stopPropagation(); slides[idx].onOpen(); } }, 'ⓘ Details');
  const dots = h('div', { class: 'spot-dots' }, slides.map((_, i) => h('span', { onclick: (e) => { e.stopPropagation(); go(i); } })));
  const prevA = h('span', { class: 'spot-arrow left', onclick: (e) => { e.stopPropagation(); go(idx - 1); } }, '‹');
  const nextA = h('span', { class: 'spot-arrow right', onclick: (e) => { e.stopPropagation(); go(idx + 1); } }, '›');
  const body = h('div', { class: 'spot-body' }, kicker, titleBox, meta, text, prog, h('div', { class: 'spot-actions' }, playBtn, infoBtn));
  const node = h('button', { class: 'spotlight focusable', tabindex: -1, oncdselect: () => slides[idx].onPlay() },
    bgA, bgB, h('div', { class: 'spot-shade' }), body, slides.length > 1 ? [prevA, nextA, dots] : null);

  function draw() {
    const sl = slides[idx];
    const back = front === bgA ? bgB : bgA;
    const url = sl.bg;
    const pre = new Image();
    pre.onload = () => { back.style.backgroundImage = `url("${url}")`; back.classList.add('on'); front.classList.remove('on'); front = back; };
    pre.onerror = () => { if (sl.bgFallback) { back.style.backgroundImage = `url("${sl.bgFallback}")`; back.classList.add('on'); front.classList.remove('on'); front = back; } };
    pre.src = url;
    kicker.textContent = sl.kicker;
    titleBox.textContent = '';
    if (sl.logo) {
      const im = h('img', { class: 'logo', src: sl.logo, alt: sl.title });
      im.addEventListener('error', () => im.replaceWith(h('h1', {}, sl.title)));
      titleBox.append(im);
    } else titleBox.append(h('h1', {}, sl.title));
    meta.textContent = '';
    for (const m of sl.meta.filter(Boolean)) meta.append(h('span', {}, m));
    text.textContent = sl.text;
    text.hidden = !sl.text;
    prog.hidden = sl.progress == null;
    prog.firstChild.style.width = `${sl.progress || 0}%`;
    playBtn.textContent = sl.playLabel;
    [...dots.children].forEach((d, i) => d.classList.toggle('on', i === idx));
    body.classList.remove('swap'); void body.offsetWidth; body.classList.add('swap');
    node.infoCard = sl.infoCard;
    node.item = sl.infoCard.item; node.ytItem = sl.infoCard.ytItem; // X zeigt Infos
    if (sl.infoCard.ytItem && node.classList.contains('focused')) cd.call('yt:prefetch', sl.infoCard.ytItem).catch(() => {});
  }
  function go(i) { idx = (i + slides.length) % slides.length; draw(); restart(); }
  function restart() {
    clearInterval(timer);
    if (slides.length > 1) timer = setInterval(() => { if (!node.classList.contains('focused') && document.contains(node)) go(idx + 1); }, 9000);
  }
  node.onAdjust = (d) => go(idx + d); // ←/→ blättern
  node.addEventListener('cdfocus', () => { const y = slides[idx]?.infoCard?.ytItem; if (y) cd.call('yt:prefetch', y).catch(() => {}); });
  draw(); restart();
  return { node, focusEl: node, destroy: () => clearInterval(timer) };
}

// ---------- Downloads & neu verfügbare Anfragen (Seerr) ----------

let activityCache = null;
const activityHost = h('div', { class: 'activity' });

function fmtEta(iso) {
  if (!iso) return '';
  const min = Math.round((new Date(iso) - Date.now()) / 60000);
  if (min <= 0) return 'gleich fertig';
  return min < 60 ? `noch ${min} min` : `noch ${Math.floor(min / 60)} h ${min % 60} min`;
}

/** Kachel, deren Daten für das Info-Fenster (X) erst bei Bedarf geladen werden. */
function withLazyInfo(node, loader) {
  node.lazyInfo = loader;
  return node;
}

function drawActivity() {
  const a = activityCache;
  const keep = focused && activityHost.contains(focused) ? focused.dataset.key : null;
  activityHost.textContent = '';
  if (!a) return;
  if (a.downloads.length) {
    const items = h('div', { class: 'row-items' });
    for (const d of a.downloads) {
      const pct = Math.round(d.progress * 100);
      items.append(withLazyInfo(h('button', { class: 'card wide dl focusable', tabindex: -1, data: { key: 'dl-' + d.key },
        oncdselect: () => push(seerrDetailScreen({ id: d.tmdbId, mediaType: d.mediaType, title: d.title })) },
      h('div', { class: 'img', style: d.backdrop ? { backgroundImage: `url("${d.backdrop}")` } : {} },
        h('div', { class: 'dl-pct' }, `${pct} %`),
        h('div', { class: 'progress' }, h('i', { style: { width: `${pct}%` } }))),
      h('div', { class: 'title' }, d.title),
      h('div', { class: 'sub' }, [fmtEta(d.eta), d.parts > 1 ? `${d.parts} Dateien` : null].filter(Boolean).join(' · '))),
      async () => ({ seerrItem: await cd.call('seerr:details', { mediaType: d.mediaType, id: d.tmdbId }) })));
    }
    activityHost.append(h('section', { class: 'row' }, h('h2', {}, '⬇ Wird geladen'), items));
  }
  const fresh = a.available.filter((x) => x.jellyfinId && x.updatedAt && Date.now() - new Date(x.updatedAt) < 7 * 864e5);
  if (fresh.length) {
    const items = h('div', { class: 'row-items' });
    for (const x of fresh) {
      items.append(withLazyInfo(h('button', { class: 'card focusable', tabindex: -1, data: { key: 'av-' + x.key },
        oncdselect: () => push(detailScreen({ Id: x.jellyfinId })) },
      h('div', { class: 'img', style: x.poster ? { backgroundImage: `url("${x.poster}")` } : {} },
        h('div', { class: 'badge done wide-badge' }, x.status === 4 ? 'Teilweise da' : 'Neu da')),
      h('div', { class: 'title' }, x.title),
      h('div', { class: 'sub' }, 'Deine Anfrage')),
      async () => ({ item: await cd.call('jf:item', x.jellyfinId) })));
    }
    activityHost.append(h('section', { class: 'row' }, h('h2', {}, '✨ Neu für dich'), items));
  }
  const again = keep && activityHost.querySelector(`[data-key="${CSS.escape(keep)}"]`);
  if (again) setFocus(again, { scroll: false });
}

function activityRows() {
  cd.call('seerr:activity').then((a) => { activityCache = a; drawActivity(); }).catch(() => {});
  drawActivity();
  return activityHost;
}

cd.on('activity', (a) => { activityCache = a; drawActivity(); });

// ---------- Bibliothek ----------

function libraryScreen(view) {
  const node = h('div', { class: 'screen' });
  const grid = h('div', { class: 'grid' });
  const filters = [
    ['Alle', {}],
    ['Ungesehen', { isPlayed: false }],
    ['Favoriten', { isFavorite: true }],
  ];
  const SORTS = [
    ['Name', { sortBy: 'SortName', sortOrder: 'Ascending' }],
    ['Neu hinzugefügt', { sortBy: 'DateCreated', sortOrder: 'Descending' }],
    ['Jahr', { sortBy: 'ProductionYear,SortName', sortOrder: 'Descending' }],
    ['Bewertung', { sortBy: 'CommunityRating,SortName', sortOrder: 'Descending' }],
    ['Laufzeit (kurz zuerst)', { sortBy: 'Runtime,SortName', sortOrder: 'Ascending' }],
  ];
  let filter = filters[0][1];
  let sortIdx = 0;
  let genre = null; // { Id, Name }
  let start = 0; let total = 0; let loading = false;

  const types = {
    movies: 'Movie', tvshows: 'Series', boxsets: 'BoxSet', music: 'MusicAlbum', musicvideos: 'MusicVideo', homevideos: 'Video,Photo',
  }[view.CollectionType];

  const sortChip = h('button', { class: 'tab focusable', oncdselect: () => { sortIdx = (sortIdx + 1) % SORTS.length; drawChips(); reset(); } });
  const genreChip = h('button', { class: 'tab focusable', oncdselect: pickGenre });
  const randomChip = h('button', { class: 'tab focusable', oncdselect: randomPick }, '🎲 Zufällig');
  function drawChips() {
    sortChip.textContent = `Sortierung: ${SORTS[sortIdx][0]}`;
    genreChip.textContent = `Genre: ${genre ? genre.Name : 'alle'}`;
    genreChip.classList.toggle('active', !!genre);
  }
  drawChips();
  const tabs = h('div', { class: 'tabs' }, filters.map(([name, f], i) =>
    h('button', { class: `tab focusable${i === 0 ? ' active' : ''}`, oncdselect: (e) => {
      for (const t of tabs.querySelectorAll('.filter')) t.classList.remove('active');
      e.currentTarget.classList.add('active');
      filter = f; reset();
    } }, name)), sortChip, genreChip, randomChip);
  for (const t of [...tabs.children].slice(0, filters.length)) t.classList.add('filter');
  const count = h('span', { style: { color: 'var(--muted)', fontSize: '1.2rem', marginLeft: '1rem' } });
  node.append(h('div', { class: 'scroll' }, h('h1', { class: 'screen-title' }, view.Name, count), tabs, grid));

  const query = () => ({
    parentId: view.Id, recursive: !!types, includeItemTypes: types,
    ...SORTS[sortIdx][1], ...filter, ...(genre ? { genreIds: genre.Id } : {}),
  });

  async function more() {
    if (loading || (total && start >= total)) return;
    loading = true;
    try {
      const res = await cd.call('jf:items', { ...query(), startIndex: start, limit: 120 });
      total = res.TotalRecordCount; start += res.Items.length;
      count.textContent = `${total}`;
      const first = !grid.children.length;
      for (const it of res.Items) {
        const c = cardFor(it);
        c.addEventListener('cdfocus', () => { if ([...grid.children].indexOf(c) > grid.children.length - 24) more(); });
        grid.append(c);
      }
      // Beim ersten Laden direkt auf die erste Kachel (statt auf den Filter)
      if (first && grid.firstChild && (!node.contains(focused) || focused.classList.contains('tab'))) setFocus(grid.firstChild, { scroll: false });
      if (!total) grid.append(h('div', { class: 'empty' }, 'Keine Einträge.'));
    } finally { loading = false; }
  }
  function reset() { start = 0; total = 0; grid.textContent = ''; more(); }

  async function randomPick() {
    const res = await call('jf:items', { ...query(), sortBy: 'Random', limit: 1 });
    const it = res.Items?.[0];
    if (it) openItem(it); else toast('Nichts gefunden');
  }

  async function pickGenre() {
    const res = await call('jf:genres', view.Id);
    const list = h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Genre'),
      h('button', { class: 'chip focusable close', oncdselect: closeOverlay }, '✕ Schließen')));
    const choose = (g) => { genre = g; closeOverlay(); drawChips(); reset(); };
    list.append(h('button', { class: 'setting focusable', 'data-autofocus': !genre || null, oncdselect: () => choose(null) },
      h('span', {}, 'Alle Genres'), h('span', { class: `val${!genre ? ' on' : ''}` }, !genre ? '●' : '')));
    for (const g of res.Items || []) {
      const on = genre?.Id === g.Id;
      list.append(h('button', { class: 'setting focusable', 'data-autofocus': on || null, oncdselect: () => choose({ Id: g.Id, Name: g.Name }) },
        h('span', {}, g.Name), h('span', { class: `val${on ? ' on' : ''}` }, on ? '●' : '')));
    }
    showOverlay(list, { onAction: (a) => (a === 'back' ? (closeOverlay(), true) : false), hints: () => [['A', 'a', 'Auswählen'], ['B', 'b', 'Schließen']] });
  }

  return { node, render: more, refresh: () => {} };
}

function personScreen(person) {
  const node = h('div', { class: 'screen' });
  const grid = h('div', { class: 'grid' }, h('div', { class: 'spinner' }));
  node.append(h('div', { class: 'scroll' }, h('h1', { class: 'screen-title' }, person.Name), grid));
  return {
    node,
    async render() {
      const res = await call('jf:person', person.Id);
      grid.textContent = '';
      for (const it of res.Items || []) grid.append(cardFor(it));
      if (!res.Items?.length) grid.append(h('div', { class: 'empty' }, 'Keine weiteren Titel in der Bibliothek.'));
      focusFirst(this);
    },
  };
}

function detailScreen(stub, { seasonId } = {}) {
  const node = h('div', { class: 'screen' });
  const scroll = h('div', { class: 'scroll' }, h('div', { class: 'spinner' }));
  node.append(scroll);
  const screen = { node, render: load, refresh: load };
  let item = null;

  async function load() {
    try { item = await cd.call('jf:item', stub.Id); } catch { return; }
    screen.backdrop = backdropUrl(item);
    setBackdrop(screen.backdrop);
    const keepId = focused && node.contains(focused) ? focused.dataset.key : null;
    scroll.textContent = '';
    const ud = item.UserData || {};
    const streams = item.MediaStreams || item.MediaSources?.[0]?.MediaStreams || [];
    const video = streams.find((s) => s.Type === 'Video');
    const audios = streams.filter((s) => s.Type === 'Audio');
    const subs = streams.filter((s) => s.Type === 'Subtitle');

    const actions = h('div', { class: 'actions' });
    if (PLAYABLE.has(item.Type)) {
      if (ud.PlaybackPositionTicks > 0) {
        actions.append(
          h('button', { class: 'action primary focusable', 'data-autofocus': true, data: { key: 'resume' }, oncdselect: () => play([item.Id]) },
            `▶ Fortsetzen (${runtime(ud.PlaybackPositionTicks)})`),
          h('button', { class: 'action focusable', data: { key: 'restart' }, oncdselect: () => play([item.Id], { startTicks: 0 }) }, '↺ Von vorn'));
      } else {
        actions.append(h('button', { class: 'action primary focusable', 'data-autofocus': true, data: { key: 'play' }, oncdselect: () => play([item.Id], { startTicks: 0 }) }, '▶ Abspielen'));
      }
    } else if (item.Type === 'Series') {
      actions.append(h('button', { class: 'action primary focusable', 'data-autofocus': true, data: { key: 'play' }, oncdselect: playSeries }, '▶ Abspielen'),
        h('button', { class: 'action focusable', data: { key: 'shuffle' }, oncdselect: async () => {
          const res = await call('jf:items', { parentId: item.Id, recursive: true, includeItemTypes: 'Episode', limit: 500 });
          const ids = res.Items.map((i) => i.Id).sort(() => Math.random() - 0.5);
          if (ids.length) play(ids, { startTicks: 0 });
        } }, '⤮ Zufällig'));
    }
    actions.append(
      h('button', { class: 'action focusable', data: { key: 'played' }, oncdselect: async () => {
        await call('jf:setPlayed', { id: item.Id, played: !ud.Played }); load();
      } }, ud.Played ? '✓ Gesehen' : '○ Als gesehen markieren'),
      h('button', { class: 'action focusable', data: { key: 'fav' }, oncdselect: async () => {
        await call('jf:setFavorite', { id: item.Id, fav: !ud.IsFavorite }); load();
      } }, ud.IsFavorite ? '♥ Favorit' : '♡ Favorit'));

    scroll.append(h('div', { class: 'detail' },
      h('div', { class: 'poster', style: { backgroundImage: `url("${posterUrl(item, 720)}")` } }),
      h('div', { class: 'info' },
        titleNode(item, item.Type === 'Episode' ? item.SeriesName : item.Name),
        h('div', { class: 'meta' },
          item.Type === 'Episode' ? h('span', {}, `${epCode(item)} · ${item.Name}`) : null,
          item.ProductionYear ? h('span', {}, item.ProductionYear) : null,
          item.RunTimeTicks ? h('span', {}, runtime(item.RunTimeTicks)) : null,
          item.OfficialRating ? h('span', {}, item.OfficialRating) : null,
          item.CommunityRating ? h('span', {}, `★ ${item.CommunityRating.toFixed(1)}`) : null,
          item.Genres?.length ? h('span', {}, item.Genres.slice(0, 3).join(', ')) : null),
        actions,
        item.Overview ? h('p', {}, item.Overview) : null,
        video ? h('div', { class: 'tracks' }, [video.DisplayTitle,
          audios.length ? `${audios.length} Tonspur${audios.length > 1 ? 'en' : ''}` : null,
          subs.length ? `${subs.length} Untertitel` : null].filter(Boolean).join(' · ')) : null)));

    if (item.Type === 'Series') await seriesPart();
    castRow();
    await similarRow();
    const again = keepId && node.querySelector(`[data-key="${CSS.escape(keepId)}"]`);
    if (again) setFocus(again, { scroll: false }); else focusFirst(screen);
  }

  /** Besetzung (Schauspieler mit Rolle); Auswahl zeigt deren Filme/Serien. */
  function castRow() {
    const people = (item.People || []).filter((p) => p.Type === 'Actor' || p.Type === 'Director').slice(0, 20);
    if (!people.length) return;
    const row = h('div', { class: 'row-items' });
    for (const p of people) {
      const url = p.PrimaryImageTag ? img(p.Id, 'Primary', p.PrimaryImageTag, 300) : '';
      const c = h('button', { class: 'card person focusable', tabindex: -1, data: { key: 'p-' + p.Id }, oncdselect: () => push(personScreen(p)) },
        h('div', { class: 'img', style: url ? { backgroundImage: `url("${url}")` } : {} }, url ? null : h('div', { class: 'fallback' }, '👤')),
        h('div', { class: 'title' }, p.Name),
        h('div', { class: 'sub' }, p.Type === 'Director' ? 'Regie' : (p.Role || '')));
      row.append(c);
    }
    scroll.append(h('section', { class: 'row' }, h('h2', {}, 'Besetzung'), row));
  }

  async function similarRow() {
    try {
      const res = await cd.call('jf:similar', item.Id);
      const r = row('Ähnliche Titel', res.Items || []);
      if (r) scroll.append(r);
    } catch { /* optional */ }
  }

  async function playSeries() {
    const res = await call('jf:items', { parentId: item.Id, recursive: true, includeItemTypes: 'Episode', isPlayed: false, limit: 1, sortBy: 'ParentIndexNumber,IndexNumber' });
    const first = res.Items[0] || (await call('jf:items', { parentId: item.Id, recursive: true, includeItemTypes: 'Episode', limit: 1, sortBy: 'ParentIndexNumber,IndexNumber' })).Items[0];
    if (first) play([first.Id]);
  }

  async function seriesPart() {
    const seasons = (await call('jf:seasons', item.Id)).Items || [];
    if (!seasons.length) return;
    let current = seasons.find((s) => s.Id === seasonId)
      || seasons.find((s) => (s.UserData?.UnplayedItemCount || 0) > 0 && s.IndexNumber > 0) || seasons[0];
    const tabs = h('div', { class: 'tabs' });
    const eps = h('div', { class: 'episodes' });
    for (const s of seasons) {
      tabs.append(h('button', { class: `tab focusable${s.Id === current.Id ? ' active' : ''}`, data: { key: 'season-' + s.Id }, oncdselect: (e) => {
        for (const t of tabs.children) t.classList.remove('active');
        e.currentTarget.classList.add('active');
        current = s; seasonId = s.Id; showEpisodes();
      } }, s.Name));
    }
    scroll.append(tabs, eps);
    async function showEpisodes() {
      eps.textContent = '';
      const list = (await call('jf:episodes', { seriesId: item.Id, seasonId: current.Id })).Items || [];
      list.forEach((ep, i) => {
        const ud = ep.UserData || {};
        const pct = ud.PlayedPercentage && !ud.Played ? ud.PlayedPercentage : 0;
        const n = h('button', { class: 'list-item focusable', data: { key: 'ep-' + ep.Id }, oncdselect: () =>
          play(list.slice(i).map((x) => x.Id)) },
        h('div', { class: 'thumb', style: { backgroundImage: `url("${wideUrl(ep, 300)}")` } },
          ud.Played ? h('div', { class: 'badge done' }, '✓') : null,
          pct ? h('div', { class: 'progress' }, h('i', { style: { width: `${pct}%` } })) : null),
        h('div', {}, h('h3', {}, `${ep.IndexNumber ?? ''}. ${ep.Name}`),
          h('p', {}, [runtime(ep.RunTimeTicks), ep.Overview].filter(Boolean).join(' · '))));
        eps.append(n);
      });
    }
    await showEpisodes();
  }

  return screen;
}

// ---------- Suche ----------

function searchScreen() {
  const node = h('div', { class: 'screen' });
  const results = h('div', { class: 'grid' });
  let t = null; let seq = 0;
  const kb = keyboard((v) => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const my = ++seq;
      if (v.trim().length < 2) { results.textContent = ''; return; }
      const res = await call('jf:search', v.trim());
      if (my !== seq) return;
      results.textContent = '';
      for (const it of res.Items) results.append(cardFor(it));
      if (!res.Items.length) results.append(h('div', { class: 'empty' }, 'Nichts gefunden.'));
    }, 350);
  });
  node.append(h('div', { class: 'scroll' }, h('h1', { class: 'screen-title' }, 'Suche'),
    h('div', { class: 'search-layout' }, kb.node, h('div', { class: 'search-results' }, results))));
  return {
    node, keyboard: kb,
    onAction(a) {
      const onKeys = focused?.closest('.osk');
      if (a === 'west' && onKeys) { kb.backspace(); return true; }
      if (a === 'north' && onKeys) { kb.type(' '); return true; }
      return false;
    },
    hints: () => [['A', 'a', 'Auswählen'], ['X', 'x', 'Löschen / Info'], ['Y', 'y', 'Leerzeichen'], ['B', 'b', 'Zurück']],
  };
}

// ---------- Anfragen (Seerr) ----------

const SEERR_STATUS = { 2: 'Angefragt', 3: 'In Bearbeitung', 4: 'Teilweise da', 5: 'Verfügbar', 6: 'Gelöscht' };
const REQUEST_STATUS = { 1: 'Wartet auf Freigabe', 2: 'Freigegeben', 3: 'Abgelehnt', 4: 'Fehlgeschlagen', 5: 'Erledigt' };

function seerrCard(it, onSelect) {
  if (it.mediaType === 'person') {
    const node = h('button', { class: 'card person focusable', tabindex: -1 },
      h('div', { class: 'img', style: it.poster ? { backgroundImage: `url("${it.poster}")` } : {} }, it.poster ? null : h('div', { class: 'fallback' }, '👤')),
      h('div', { class: 'title' }, it.title),
      h('div', { class: 'sub' }, it.knownFor?.length ? `bekannt aus ${it.knownFor.join(', ')}` : 'Person'));
    node.addEventListener('cdselect', () => push(seerrPersonScreen(it)));
    return node;
  }
  const label = SEERR_STATUS[it.status];
  const node = h('button', { class: 'card focusable', tabindex: -1 },
    h('div', { class: 'img', style: it.poster ? { backgroundImage: `url("${it.poster}")` } : {} },
      it.poster ? null : h('div', { class: 'fallback' }, it.title),
      label ? h('div', { class: `badge${it.status === 5 ? ' done' : ''} wide-badge` }, label) : null),
    h('div', { class: 'title' }, it.title),
    h('div', { class: 'sub' }, it.role ? `${it.role}${it.year ? ' · ' + it.year : ''}` : [it.year, it.mediaType === 'tv' ? 'Serie' : 'Film'].filter(Boolean).join(' · ')));
  node.seerrItem = it;
  node.addEventListener('cdselect', () => (onSelect || ((x) => push(seerrDetailScreen(x))))(it));
  return node;
}

function seerrScreen() {
  const node = h('div', { class: 'screen' });
  const info = h('span', { class: 'quota' });
  const body = h('div', {});
  const tabs = h('div', { class: 'tabs' });
  node.append(h('div', { class: 'scroll' }, h('h1', { class: 'screen-title' }, 'Anfragen', info), tabs, body));
  let current = null;
  const screen = { node, render: init, refresh: () => current?.refresh?.() };

  async function init() {
    let st;
    try { st = await cd.call('seerr:status'); } catch (e) {
      body.append(h('div', { class: 'empty' }, 'Seerr nicht erreichbar: ' + e.message));
      return;
    }
    if (!st.configured) {
      body.append(h('div', { class: 'empty' },
        h('p', {}, 'Seerr ist noch nicht mit Couchdeck verbunden.'),
        h('p', {}, 'Auf dem Server einmal ausführen und den API-Key aus Seerr (Einstellungen → Allgemein) einfügen:'),
        h('code', { class: 'cmd' }, 'sudo bash /opt/couchdeck/app/deploy/set-seerr-key.sh')));
      return;
    }
    const q = st.quota;
    const fmtQ = (x, label) => (x && x.limit ? `${label}: ${x.remaining ?? '–'} von ${x.limit} frei` : null);
    info.textContent = [st.user?.name, fmtQ(q?.movie, 'Filme'), fmtQ(q?.tv, 'Staffeln')].filter(Boolean).join(' · ');
    const views = [['Trends', trendingView], ['Suche', searchView], ['Meine Anfragen', mineView]];
    views.forEach(([name, fn], i) => tabs.append(h('button', {
      class: `tab focusable${i === 0 ? ' active' : ''}`, 'data-autofocus': i === 0 ? true : null,
      oncdselect: (e) => {
        for (const t of tabs.children) t.classList.remove('active');
        e.currentTarget.classList.add('active');
        show(fn);
      },
    }, name)));
    show(trendingView);
    focusFirst(screen);
  }

  function show(fn) {
    body.textContent = '';
    screen.keyboard = null;
    current = fn();
    body.append(current.node);
  }

  function trendingView() {
    const grid = h('div', { class: 'grid' });
    let page = 0; let total = 1; let loading = false;
    async function more() {
      if (loading || page >= total) return;
      loading = true;
      try {
        const res = await call('seerr:trending', page + 1);
        page = res.page; total = res.totalPages;
        for (const it of res.results) {
          const c = seerrCard(it);
          c.addEventListener('cdfocus', () => { if ([...grid.children].indexOf(c) > grid.children.length - 14) more(); });
          grid.append(c);
        }
      } finally { loading = false; }
    }
    more();
    return { node: grid };
  }

  function searchView() {
    const results = h('div', { class: 'grid' });
    let t = null; let seq = 0; let last = []; let kind = 'all';
    const KINDS = [['all', 'Alle'], ['movie', 'Filme'], ['tv', 'Serien'], ['person', 'Personen']];
    const kinds = h('div', { class: 'tabs', style: { padding: '0 0 0.8rem' } }, KINDS.map(([k, label], i) =>
      h('button', { class: `tab focusable${i === 0 ? ' active' : ''}`, oncdselect: (e) => {
        for (const x of kinds.children) x.classList.remove('active');
        e.currentTarget.classList.add('active'); kind = k; draw();
      } }, label)));
    function draw() {
      results.textContent = '';
      const list = kind === 'all' ? last : last.filter((it) => it.mediaType === kind);
      for (const it of list) results.append(seerrCard(it));
      if (!list.length && last.length) results.append(h('div', { class: 'empty' }, 'In dieser Kategorie nichts gefunden.'));
      else if (!list.length) results.append(h('div', { class: 'empty' }, 'Nichts gefunden.'));
    }
    const kb = keyboard((v) => {
      clearTimeout(t);
      t = setTimeout(async () => {
        const my = ++seq;
        if (v.trim().length < 2) { results.textContent = ''; last = []; return; }
        try {
          const res = await cd.call('seerr:search', { query: v.trim() });
          if (my !== seq) return;
          last = res.results; draw();
        } catch (e) { if (my === seq) { results.textContent = ''; results.append(h('div', { class: 'empty' }, 'Suche fehlgeschlagen: ' + e.message)); } }
      }, 500);
    });
    screen.keyboard = kb;
    return { node: h('div', { class: 'search-layout' }, kb.node, h('div', { class: 'search-results' }, kinds, results)) };
  }

  function mineView() {
    const list = h('div', { class: 'episodes' }, h('div', { class: 'spinner' }));
    async function load() {
      const items = await call('seerr:mine');
      list.textContent = '';
      if (!items.length) list.append(h('div', { class: 'empty' }, 'Noch keine Anfragen.'));
      for (const r of items) {
        const state = r.status === 5 ? 'Verfügbar' : r.requestStatus === 2 ? (SEERR_STATUS[r.status] || 'Freigegeben') : REQUEST_STATUS[r.requestStatus] || '';
        list.append(h('div', { class: 'req-row' },
          h('button', { class: 'list-item focusable', oncdselect: () => push(seerrDetailScreen({ id: r.tmdbId, mediaType: r.mediaType, title: r.title })) },
            h('div', { class: 'thumb poster-thumb', style: r.poster ? { backgroundImage: `url("${r.poster}")` } : {} }),
            h('div', {}, h('h3', {}, r.title),
              h('p', {}, [r.mediaType === 'tv' ? `Serie${r.seasons.length ? ' · Staffel ' + r.seasons.join(', ') : ''}` : 'Film',
                new Date(r.createdAt).toLocaleDateString('de-DE')].join(' · ')),
              h('p', { class: `req-state s${r.status} r${r.requestStatus}` }, state))),
          r.canCancel && r.status !== 5
            ? h('button', { class: 'action danger focusable', oncdselect: () => cancelSeerrRequest(r, load) }, '✕ Zurückziehen')
            : null));
      }
    }
    load().catch(() => { list.textContent = ''; list.append(h('div', { class: 'empty' }, 'Anfragen konnten nicht geladen werden.')); });
    return { node: list, refresh: load };
  }

  screen.onAction = (a) => {
    const onKeys = focused?.closest('.osk');
    if (screen.keyboard && onKeys && a === 'west') { screen.keyboard.backspace(); return true; }
    if (screen.keyboard && onKeys && a === 'north') { screen.keyboard.type(' '); return true; }
    return false;
  };
  return screen;
}

function cancelSeerrRequest(r, after) {
  const approved = r.requestStatus && r.requestStatus !== 1;
  confirmDialog('Anfrage zurückziehen?',
    `Die Anfrage für „${r.title}“ wird in Seerr gelöscht.` +
    (approved ? ' Sie ist bereits freigegeben – ein laufender Download in Sonarr/Radarr wird dadurch nicht automatisch gestoppt.' : ''),
    'Zurückziehen', async () => {
      try { await cd.call('seerr:cancel', r.id); toast(`Anfrage für „${r.title}“ zurückgezogen`); after?.(); } catch (e) { toast(e.message, 'error'); }
    });
}

function chooseSeriesCancellations(requests, submit) {
  const choices = requests.map(request => {
    const seasons = (request.seasons || []).filter(n => Number.isSafeInteger(n) && n >= 0).sort((a, b) => a - b);
    return { request, seasons, partial: request.status === 1 && seasons.length > 1 && seasons[0] > 0, selected: new Set() };
  });
  const panel = h('div', { class: 'dialog' }, h('h2', {}, 'Serienanfragen zurückziehen'));
  const options = h('div', { class: 'series-cancel-options' });
  const proceed = h('button', { class: 'action primary focusable', disabled: true,
    oncdselect: () => {
      const selected = choices.filter(choice => choice.selected.size).map(choice => {
        const { request, seasons, partial } = choice;
        const whole = !partial || choice.selected.size === seasons.length;
        return { requestId: request.id, expected: { status: request.status, seasons },
          seasons: whole ? null : seasons.filter(n => choice.selected.has(n)),
          label: whole ? `Anfrage #${request.id} vollständig` :
            `Anfrage #${request.id} · Staffel ${seasons.filter(n => choice.selected.has(n)).join(', ')}` };
      });
      if (!selected.length) return;
      confirmDialog('Auswahl bestätigen', selected.map(item => item.label).join('\n') +
        '\nLaufende Downloads und vorhandene Dateien werden dadurch nicht entfernt.',
      'Auswahl zurückziehen', () => submit(selected));
      $('#overlay .dialog p')?.classList.add('series-cancel-review');
    },
  }, 'Weiter zur Bestätigung');
  for (const { request, seasons, partial, selected } of choices) {
    const group = h('fieldset', {}, h('legend', {}, `Anfrage #${request.id}${request.status === 1 ? ' · Offen' : ''}`));
    const actions = h('div', { class: 'actions' });
    for (const value of partial ? seasons : [null]) {
      const label = value !== null ? `Staffel ${value}` :
        seasons.length ? `Ganze Anfrage · Staffel ${seasons.join(', ')}` : 'Ganze Anfrage';
      const button = h('button', { class: 'action focusable', 'aria-pressed': 'false',
        oncdselect: () => {
          if (selected.has(value)) selected.delete(value); else selected.add(value);
          button.setAttribute('aria-pressed', String(selected.has(value)));
          proceed.disabled = !choices.some(choice => choice.selected.size);
        },
      }, label);
      actions.append(button);
    }
    options.append(append(group, actions));
  }
  panel.append(options, h('div', { class: 'actions' }, proceed,
    h('button', { class: 'action focusable', oncdselect: closeOverlay }, 'Abbrechen')));
  const reopen = () => showOverlay(panel, { centered: true, reopen,
    onAction: (a) => a === 'back' ? (closeOverlay(), true) : false });
  reopen();
}

function upcomingEpisode(episode) {
  if (episode.hasFile || typeof episode.airDate !== 'string') return null;
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(episode.airDate) ? episode.airDate + 'T00:00:00' : episode.airDate);
  return date.getTime() > Date.now()
    ? `Voraussichtlich am ${new Intl.DateTimeFormat('de-AT', { dateStyle: 'medium' }).format(date)}`
    : null;
}

/** Person aus Seerr: alle Filme/Serien, direkt anfragbar. */
function seerrPersonScreen(stub) {
  const node = h('div', { class: 'screen' });
  const grid = h('div', { class: 'grid' }, h('div', { class: 'spinner' }));
  const head = h('div', { class: 'detail yt-head' },
    stub.poster ? h('div', { class: 'poster round', style: { backgroundImage: `url("${stub.poster}")` } }) : null,
    h('div', { class: 'info' }, h('h1', {}, stub.title), h('div', { class: 'meta' }, h('span', {}, 'Person'))));
  const tabs = h('div', { class: 'tabs' });
  node.append(h('div', { class: 'scroll' }, head, tabs, grid));
  let items = []; let filter = 'all';
  function draw() {
    grid.textContent = '';
    const list = items.filter((it) => filter === 'all' || (filter === 'missing' ? it.status !== 5 && it.status !== 4 : it.mediaType === filter));
    for (const it of list) grid.append(seerrCard(it));
    if (!list.length) grid.append(h('div', { class: 'empty' }, 'Keine Einträge.'));
  }
  return {
    node,
    async render() {
      let p;
      try { p = await cd.call('seerr:person', stub.id); } catch (e) { grid.textContent = ''; grid.append(h('div', { class: 'empty' }, e.message)); return; }
      items = p.items;
      const info = head.querySelector('.info');
      info.querySelector('.meta').textContent = '';
      append(info.querySelector('.meta'), h('span', {}, p.department === 'Acting' ? 'Schauspiel' : p.department === 'Directing' ? 'Regie' : (p.department || 'Person')), h('span', {}, `${items.length} Titel`));
      if (p.biography) info.append(h('p', {}, p.biography));
      [['all', 'Alle'], ['movie', 'Filme'], ['tv', 'Serien'], ['missing', 'Noch nicht vorhanden']].forEach(([k, label], i) =>
        tabs.append(h('button', { class: `tab focusable${i === 0 ? ' active' : ''}`, oncdselect: (e) => {
          for (const x of tabs.children) x.classList.remove('active');
          e.currentTarget.classList.add('active'); filter = k; draw();
        } }, label)));
      draw();
      if (grid.firstChild?.classList?.contains('card')) setFocus(grid.firstChild, { scroll: false }); else focusFirst(this);
    },
  };
}

function seerrDetailScreen(stub) {
  const node = h('div', { class: 'screen' });
  const scroll = h('div', { class: 'scroll' }, h('div', { class: 'spinner' }));
  node.append(scroll);
  const screen = { node, render: load, refresh: load };
  const chosen = new Set();
  let busy = false; // eine Anfrage nach der anderen
  let lastRequestId = null; // nach dem Anfragen: Fokus auf "Zurückziehen" statt auf den nächsten Anfrage-Knopf

  async function load() {
    let d;
    try { d = await cd.call('seerr:details', { mediaType: stub.mediaType, id: stub.id }); } catch (e) {
      scroll.textContent = ''; scroll.append(h('div', { class: 'empty' }, e.message)); return;
    }
    screen.backdrop = d.backdrop; setBackdrop(d.backdrop);
    scroll.textContent = '';
    const actions = h('div', { class: 'actions' });
    const requestable = (st) => st === 1 || st === 6;
    const openSeasons = (d.seasons || []).filter((x) => requestable(x.status));

    async function doSend(seasons) {
      if (busy) return;
      busy = true;
      lockSelect(1500); // ein zweites A darf nicht den nächsten Knopf auslösen
      try {
        const r = await cd.call('seerr:request', { mediaType: d.mediaType, mediaId: d.id, seasons });
        if (r.warning) toast(r.warning, 'error');
        else toast(r.status === 2 ? `„${d.title}“ angefragt und freigegeben` : `„${d.title}“ angefragt – wartet auf Freigabe`);
        chosen.clear();
        lastRequestId = r.id;
        await load();
        lockSelect(700);
      } catch (e) { toast('Anfrage fehlgeschlagen: ' + e.message, 'error'); } finally { busy = false; }
    }
    /** Ab 3 Staffeln erst nachfragen – Serien wie South Park haben fast 30 Staffeln. */
    function send(seasons) {
      if (busy) return;
      if (d.mediaType !== 'tv' || !seasons || seasons.length < 3) { doSend(seasons); return; }
      const nums = [...seasons].sort((a, b) => a - b);
      const eps = (d.seasons || []).filter((x) => nums.includes(x.number)).reduce((n, x) => n + (x.episodes || 0), 0);
      const range = nums.length > 6 ? `${nums[0]}–${nums[nums.length - 1]}` : nums.join(', ');
      confirmDialog(`${nums.length} Staffeln anfragen?`,
        `„${d.title}“: Staffel ${range}${eps ? ` – insgesamt ${eps} Folgen` : ''}. Sonarr beginnt danach sofort mit dem Herunterladen.`,
        `${nums.length} Staffeln anfragen`, () => doSend(nums));
    }

    if (d.jellyfinId && (d.status === 5 || d.status === 4)) {
      actions.append(h('button', { class: 'action primary focusable', 'data-autofocus': true,
        oncdselect: () => push(detailScreen({ Id: d.jellyfinId })) }, '▶ In der Bibliothek öffnen'));
    }
    if (d.managed && d.mediaType === 'movie') {
      const cap = await cd.call('seerr:film-limit');
      actions.append(h('button', { class: 'action focusable', oncdselect: () => editFilmLimit(cap, load) },
        cap ? `Filmstandard: höchstens ${cap} GiB` : 'Film-Größenstandard einstellen'));
    }
    if (d.mediaType === 'movie' && requestable(d.status)) {
      actions.append(h('button', { class: 'action primary focusable', 'data-autofocus': true, oncdselect: () => send() }, '＋ Film anfragen'));
    }
    if (d.mediaType === 'tv' && openSeasons.length) {
      actions.append(h('button', { class: 'action primary focusable', 'data-autofocus': !d.jellyfinId || null,
        oncdselect: () => send(openSeasons.map((x) => x.number)) },
      openSeasons.length === d.seasons.length ? '＋ Alle Staffeln anfragen' :
        openSeasons.length === 1 ? '＋ Fehlende Staffel anfragen' : `＋ Fehlende ${openSeasons.length} Staffeln anfragen`));
      actions.append(h('button', { class: 'action focusable', oncdselect: () => {
        if (!chosen.size) { toast('Erst unten Staffeln auswählen'); return; }
        send([...chosen]);
      } }, '＋ Auswahl anfragen'));
    }
    const ownRequests = (d.requests || []).filter((x) => x.mine && x.canCancel);
    if (d.mediaType === 'tv' && ownRequests.length) {
      actions.append(h('button', { class: 'action danger focusable', 'data-series-cancel': true,
        oncdselect: () => {
          if (busy) return;
          chooseSeriesCancellations(ownRequests, async (selection) => {
            if (busy) return;
            busy = true;
            const outcomes = [];
            try {
              for (const { label, ...target } of selection) {
                try {
                  await cd.call(target.seasons ? 'seerr:cancel-season' : 'seerr:cancel-selected', target);
                  outcomes.push(`${label} · zurückgezogen`);
                } catch (error) { outcomes.push(`${label} · ${error.message}`); }
              }
              await load();
              if (S.stack.at(-1) === screen && !S.overlay)
                showOverlay(h('div', { class: 'dialog' }, h('h2', {}, 'Ergebnis'),
                  ...outcomes.map(line => h('p', {}, line)),
                  h('button', { class: 'action focusable', oncdselect: closeOverlay }, 'Schließen')), { centered: true });
            } finally { busy = false; }
          });
        },
      }, '✕ Anfragen zurückziehen'));
    } else if (d.mediaType === 'movie') for (const rq of ownRequests) {
      actions.append(h('button', { class: 'action danger focusable', 'data-req': rq.id, oncdselect: () =>
        cancelSeerrRequest({ id: rq.id, title: d.title, requestStatus: rq.status }, load) }, '✕ Anfrage zurückziehen'));
    }
    const state = SEERR_STATUS[d.status];
    scroll.append(h('div', { class: 'detail' },
      h('div', { class: 'poster', style: d.poster ? { backgroundImage: `url("${d.poster}")` } : {} }),
      h('div', { class: 'info' },
        h('h1', {}, d.title),
        h('div', { class: 'meta' },
          h('span', {}, d.mediaType === 'tv' ? 'Serie' : 'Film'),
          d.mediaType === 'tv' && d.seasons?.length
            ? h('span', {}, d.seasons.length === 1 ? '1 Staffel insgesamt' : `${d.seasons.length} Staffeln insgesamt`) : null,
          d.year ? h('span', {}, d.year) : null,
          d.runtime ? h('span', {}, `${d.runtime} min`) : null,
          d.rating ? h('span', {}, `★ ${d.rating.toFixed(1)}`) : null,
          d.genres?.length ? h('span', {}, d.genres.slice(0, 3).join(', ')) : null,
          state ? h('span', { class: `req-state s${d.status}` }, state) : null),
        actions,
        d.overview ? h('p', {}, d.overview) : null)));

    if (d.mediaType === 'tv' && d.seasons?.length) {
      const list = h('div', { class: 'episodes' });
      for (const sn of d.seasons) {
        const can = requestable(sn.status);
        const row = h('button', { class: 'list-item focusable season-item',
          'aria-expanded': 'false', oncdselect: () => void toggleEpisodes() },
          h('span', { class: 'check', 'aria-hidden': 'true' }, '▸'),
          h('div', {}, h('h3', {}, sn.name || `Staffel ${sn.number}`),
            h('p', {}, [`${sn.episodes} Folgen`, SEERR_STATUS[sn.status]].filter(Boolean).join(' · '))));
        const approvedRequest = (d.requests || []).find((r) =>
          r.mine && r.status === 2 && r.seasons.includes(sn.number));
        const ownSeriesRequest = approvedRequest || (d.requests || []).find((r) =>
          r.mine && [2, 5].includes(r.status));
        const seasonContent = h('div', { class: 'seerr-season-content' });
        seasonContent.hidden = true;
        const episodeList = h('div', {});
        let loaded = false, loadingEpisodes = false, capGiB = 0;
        async function toggleEpisodes() {
          const show = seasonContent.hidden;
          seasonContent.hidden = !show;
          row.setAttribute('aria-expanded', String(show));
          row.firstElementChild.textContent = show ? '▾' : '▸';
          if (!show) { setFocus(row, { scroll: false }); return; }
          if (loaded || loadingEpisodes) return;
          loadingEpisodes = true;
            episodeList.textContent = 'Folgen werden geladen …';
            try {
              const episodes = await cd.call('seerr:season-episodes', {
                seriesId: d.id, season: sn.number, requestId: ownSeriesRequest?.id, episodeCount: sn.episodes,
              });
              episodeList.textContent = '';
              if (episodes.some((episode) => episode.canSearch)) {
                const limitButton = h('button', { class: 'action focusable', oncdselect: () =>
                  editSizeLimit(capGiB, 'Größenlimit für Folge oder Staffelpaket', (value) => {
                    capGiB = value;
                    limitButton.textContent = capGiB ? `Größenlimit: ${capGiB} GiB` : 'Größenlimit festlegen';
                  }),
                }, 'Größenlimit festlegen');
                episodeList.append(limitButton);
              }
              if (approvedRequest && episodes.some((episode) => episode.canSearchSeason && episode.canSearch)) episodeList.append(h('button', {
                class: 'action focusable',
                oncdselect: async () => {
                  if (busy) return;
                  busy = true;
                  try {
                    const result = await cd.call('seerr:season-search', { requestId: approvedRequest.id, season: sn.number, capGiB });
                    if (!result) throw new Error('StackPilot ist für dieses Konto nicht verbunden');
                    toast(result.grabbed ? 'Staffelpaket an qBittorrent übergeben' : result.alreadyRunning ? 'Suche läuft bereits' : `Suche für Staffel ${sn.number} gestartet`);
                  } catch (e) { toast(e.message, 'error'); } finally { busy = false; }
                },
              }, `Nur Staffel ${sn.number} suchen`));
              for (const episode of episodes) {
                const upcoming = upcomingEpisode(episode);
                const selection = { requestId: ownSeriesRequest?.id, season: sn.number, episodeId: episode.id };
                const info = h('div', {}, h('p', {},
                  `Folge ${episode.number}${episode.title ? ' · ' + episode.title : ''}`));
                if (upcoming) info.append(h('p', { class: 'muted' }, upcoming));
                if (episode.canSearch && !upcoming) info.append(h('button', { class: 'action focusable',
                  oncdselect: async () => {
                    if (busy) return;
                    busy = true;
                    try {
                      const result = await cd.call('seerr:episode-search', { ...selection, capGiB });
                      if (!result) throw new Error('StackPilot ist für dieses Konto nicht verbunden');
                      toast('Einzelfolge an den Downloadclient übergeben');
                    } catch (e) { toast(e.message, 'error'); } finally { busy = false; }
                  },
                }, `Folge ${episode.number} herunterladen`));
                if (!upcoming && !episode.canSearch && !episode.hasFile && episode.searchBlocker) info.append(h('p', {}, episode.searchBlocker));
                if (episode.removableFileId) info.append(h('button', { class: 'action danger focusable',
                  oncdselect: () => confirmDialog(`Datei von Folge ${episode.number} löschen?`,
                    'Die Datei wird aus der Mediathek entfernt. Sonarr kann eine überwachte Folge erneut laden.',
                    'Datei löschen', async () => {
                      if (busy) return;
                      busy = true;
                      try {
                        const result = await cd.call('seerr:episode-delete', { ...selection, fileId: episode.removableFileId });
                        if (!result) throw new Error('StackPilot ist für dieses Konto nicht verbunden');
                        toast('Folgendatei entfernt');
                        await load();
                      } catch (e) { toast(e.message, 'error'); } finally { busy = false; }
                    }),
                }, `Datei von Folge ${episode.number} löschen`));
                episodeList.append(info);
              }
              if (!episodes.length) episodeList.textContent = 'Keine Folgen gemeldet.';
              loaded = true;
            } catch (e) { episodeList.textContent = e.message; }
            finally { loadingEpisodes = false; }
        }
        list.append(row, seasonContent);
        if (can) {
          const selectSeason = h('button', { class: 'action focusable', oncdselect: () => {
            if (chosen.has(sn.number)) chosen.delete(sn.number); else chosen.add(sn.number);
            selectSeason.textContent = chosen.has(sn.number)
              ? `Staffel ${sn.number} aus Auswahl nehmen` : `Staffel ${sn.number} auswählen`;
          } }, chosen.has(sn.number) ? `Staffel ${sn.number} aus Auswahl nehmen` : `Staffel ${sn.number} auswählen`);
          seasonContent.append(selectSeason);
        }
        if (approvedRequest && d.managed) {
          const changePackage = async (remove) => {
            if (busy) return;
            try {
              const requestId = approvedRequest.id, season = sn.number;
              const transfer = await cd.call('seerr:season-transfer', { requestId, season, remove });
              if (!transfer) return;
              const verb = remove ? 'entfernen' : 'pausieren';
              const consequence = remove ? 'Sonarr kann das Paket erneut finden.' : '';
              confirmDialog(`Staffelpaket ${verb}?`,
                `„${transfer.name}“: Geladene Dateien bleiben erhalten. ${consequence}`.trim(),
                remove ? 'Entfernen' : 'Pausieren', async () => {
                  if (busy) return;
                  busy = true;
                  try {
                    await cd.call('seerr:season-change', { requestId, season, review: transfer.review, remove });
                    toast(remove ? 'Staffelpaket aus qBittorrent entfernt' : 'Staffelpaket pausiert');
                  } catch (e) { toast(e.message, 'error'); } finally { busy = false; }
                });
            } catch (e) { toast(e.message, 'error'); }
          };
          seasonContent.append(
            h('button', { class: 'action focusable', oncdselect: () => changePackage(false) }, 'Staffelpaket pausieren …'),
            h('button', { class: 'action focusable', oncdselect: () => changePackage(true) }, 'Pausiertes Staffelpaket entfernen …'),
          );
        }
        seasonContent.append(episodeList);
      }
      scroll.append(h('h2', { class: 'screen-title', style: { fontSize: '1.5rem', marginTop: '1.6rem' } }, 'Staffeln'), list);
    }
    // Nach einer Anfrage nicht auf "Alle/Fehlende Staffeln anfragen" landen (ein zweites A
    // fragte sonst sofort alle übrigen Staffeln an), sondern auf "Zurückziehen" der neuen Anfrage.
    const undo = lastRequestId != null && (scroll.querySelector(`[data-req="${lastRequestId}"]`) || scroll.querySelector('[data-series-cancel]'));
    lastRequestId = null;
    if (undo) setFocus(undo, { scroll: false }); else focusFirst(screen);
  }
  return screen;
}

function editFilmLimit(current, after) {
  editSizeLimit(current, 'Standard für neue Couchdeck-Filmanfragen', async (value) => {
    await cd.call('seerr:film-limit', value);
    await after();
  });
}

function editSizeLimit(current, title, save) {
  let value = current || 0;
  const label = h('p', {});
  const display = () => { label.textContent = value ? `Höchstens ${value} GiB` : 'Kein zusätzliches Limit'; };
  display();
  const adjust = (delta) => { value = Math.max(0, Math.min(200, value + delta)); display(); };
  showOverlay(h('div', { class: 'dialog' }, h('h2', {}, title), label,
    h('div', { class: 'actions' },
      ...[-5, -0.5, 0.5, 5].map((delta) => h('button', {
        class: 'action focusable', oncdselect: () => adjust(delta),
      }, `${delta > 0 ? '+' : ''}${delta} GiB`))),
    h('button', { class: 'action primary focusable', oncdselect: async () => {
      try { await save(value); closeOverlay(); }
      catch (e) { toast(e.message, 'error'); }
    } }, 'Speichern'),
    h('button', { class: 'action focusable', oncdselect: closeOverlay }, 'Abbrechen')));
}

// ---------- Kurzinfo (X auf einer Kachel) ----------

function showInfo(card) {
  const it = card.item; const sr = card.seerrItem;
  let title; let sub; let meta; let overview; let extra = null;
  if (it) {
    title = it.Type === 'Episode' ? it.SeriesName : it.Name;
    sub = it.Type === 'Episode' ? `${epCode(it)} · ${it.Name}` : null;
    const ud = it.UserData || {};
    meta = [
      { Movie: 'Film', Series: 'Serie', Episode: 'Folge', BoxSet: 'Sammlung', MusicAlbum: 'Album', Season: 'Staffel' }[it.Type],
      it.ProductionYear,
      it.RunTimeTicks ? runtime(it.RunTimeTicks) : null,
      it.Type === 'Series' && it.ChildCount ? `${it.ChildCount} Staffel${it.ChildCount > 1 ? 'n' : ''}` : null,
      it.OfficialRating,
      it.CommunityRating ? `★ ${it.CommunityRating.toFixed(1)}` : null,
    ];
    overview = it.Overview;
    const genres = (it.Genres || []).slice(0, 3).join(', ');
    const state = ud.Played ? '✓ Gesehen'
      : ud.PlayedPercentage ? `${Math.round(ud.PlayedPercentage)} % gesehen`
        : ud.UnplayedItemCount ? `${ud.UnplayedItemCount} ungesehen` : null;
    extra = [genres, state].filter(Boolean).join(' · ');
  } else {
    title = sr.title;
    meta = [sr.mediaType === 'tv' ? 'Serie' : 'Film', sr.year, sr.rating ? `★ ${sr.rating.toFixed(1)}` : null];
    overview = sr.overview;
    extra = SEERR_STATUS[sr.status] || 'Noch nicht vorhanden';
  }
  const poster = it ? posterUrl(it, 360) : sr.poster;
  const box = h('div', { class: 'infopop' },
    h('div', { class: 'ip-poster', style: poster ? { backgroundImage: `url("${poster}")` } : {} }),
    h('div', { class: 'ip-body' },
      h('h2', {}, title),
      sub ? h('div', { class: 'ip-sub' }, sub) : null,
      h('div', { class: 'meta' }, meta.filter(Boolean).map((m) => h('span', {}, m))),
      extra ? h('div', { class: 'ip-extra' }, extra) : null,
      h('p', {}, overview || 'Keine Beschreibung vorhanden.'),
      h('div', { class: 'actions' },
        h('button', { class: 'action primary focusable', 'data-autofocus': true, oncdselect: () => {
          closeOverlay(); (card.infoCard || card).dispatchEvent(new CustomEvent('cdselect'));
        } }, 'Öffnen'),
        h('button', { class: 'action focusable', oncdselect: closeOverlay }, 'Schließen'),
        it?.CanDelete ? h('button', { class: 'action danger focusable', oncdselect: () => confirmDelete(it) }, '🗑 Löschen') : null)));
  showOverlay(box, {
    centered: true,
    onAction: (a) => {
      if (a === 'west' || a === 'back' || a === 'menu' || a === 'home') { closeOverlay(); return true; }
      return false;
    },
    hints: () => [['A', 'a', 'Öffnen'], ['X', 'x', 'Schließen'], ['B', 'b', 'Schließen']],
  });
}

function confirmDelete(it) {
  const what = it.Type === 'Series' ? `die Serie „${it.Name}“ mit allen Staffeln und Folgen`
    : it.Type === 'Season' ? `„${it.SeriesName} – ${it.Name}“ mit allen Folgen`
      : it.Type === 'Episode' ? `die Folge „${it.SeriesName} ${epCode(it)} – ${it.Name}“` : `„${it.Name}“`;
  confirmDialog('Wirklich löschen?',
    `Damit wird ${what} vom Server gelöscht – die Dateien sind danach endgültig weg. ` +
    'Hinweis: Wird der Titel in Sonarr/Radarr noch überwacht, kann er erneut heruntergeladen werden.',
    'Endgültig löschen', async () => {
      try {
        await cd.call('jf:delete', it.Id);
        toast(`Gelöscht: ${it.Type === 'Episode' ? it.SeriesName + ' ' + epCode(it) : it.Name}`);
        S.stack.at(-1)?.refresh?.();
      } catch (e) { toast('Löschen fehlgeschlagen: ' + e.message, 'error'); }
    });
}

// ---------- Tastenbelegung (Übersicht) ----------

function controlsScreen() {
  const node = h('div', { class: 'screen' });
  const UI = [
    ['Steuerkreuz / Stick', 'Navigieren'], ['A', 'Auswählen · im Banner: abspielen'], ['B', 'Zurück · auf der Startseite: nach oben, dann Bereichsleiste'],
    ['X', 'Kurzinfo zur Kachel (Tastatur: löschen)'], ['Y', 'Suche im aktuellen Bereich (Tastatur: Leerzeichen)'],
    ['LB / RB', 'Bereich wechseln: Kino · YouTube · Musik'], ['LT / RT', 'Schnell springen (6 Kacheln bzw. 3 Zeilen)'],
    ['☰ Start', 'Menü (Lautstärke, Ausgang, Bluetooth, Einstellungen)'], ['⧉ View', 'Bereichsleiste öffnen'], ['Xbox-Taste', 'Startseite des Bereichs · dort: Menü'],
  ];
  const PLAY = [
    ['A (kurz)', 'Pause · Intro/Werbung überspringen'], ['B', 'Leiste zeigen · nochmal B: beenden'],
    ['Kreuz ← →', 'Leiser / lauter'], ['Kreuz ↓', 'Audioausgang wählen'], ['Stick ← →', '10 s zurück / 30 s vor'], ['A halten + spulen', 'Schnell: 2 min zurück / 5 min vor']
    ['LT / RT', '10 s zurück / 30 s vor'], ['LB / RB', 'Vorherige / nächste Folge'], ['X / Y', 'Untertitel / Tonspur wechseln'],
    ['☰ Start', 'Player-Menü (Nachtmodus, Ton-Versatz, Schlaf-Timer, Kapitel …)'], ['Xbox-Taste', 'Leiste zeigen · nochmal: beenden'],
  ];
  const table = (rows) => h('div', { class: 'ctl-table' }, rows.map(([k, v]) => h('div', { class: 'ctl-row' }, h('span', { class: 'ctl-key' }, k), h('span', {}, v))));
  node.append(h('div', { class: 'scroll' }, h('h1', { class: 'screen-title' }, 'Tastenbelegung'),
    h('div', { class: 'ctl-cols' },
      h('div', {}, h('h3', {}, 'In der Oberfläche'), table(UI)),
      h('div', {}, h('h3', {}, 'Während der Wiedergabe'), table(PLAY))),
    h('div', { class: 'navrow' }, h('button', { class: 'chip focusable', 'data-autofocus': true, oncdselect: () => push(controllerTestScreen()) }, '🎮 Controller testen'))));
  return { node };
}

// ---------- Nachtmodus + Regler "Sprache ↔ Rest" ----------

function nightRow() {
  let on = false;
  const node = valueRow('Nachtmodus (Sprache lauter, Spitzen gedämpft)', [[false, 'Aus'], [true, 'An']], () => on, async (v) => { on = (await call('sound:setNight', v)).night; balRefresh?.(); });
  cd.call('sound:state').then((st) => { on = st.night; node.redraw(); }).catch(() => {});
  return node;
}

let balRefresh = null;
function balanceRow() {
  let val = 0;
  const values = [[0, 'Original'], ...Array.from({ length: 12 }, (_, i) => [i + 1, `Sprache +${i + 1} dB`])];
  const node = valueRow('Sprache ↔ Rest', values, () => val, async (v) => { val = (await call('sound:setBalance', v)).balance; });
  balRefresh = () => cd.call('sound:state').then((st) => { val = st.balance; node.redraw(); }).catch(() => {});
  balRefresh();
  return node;
}

// ---------- Klangprofile ----------

const DYN_LABEL = { aus: 'Aus', leicht: 'Leicht', mittel: 'Mittel', stark: 'Stark' };

/** Zeile mit Wert, ←/→ (bzw. ‹ › per Maus) ändert. values: [[wert, anzeige], …] */
function valueRow(label, values, get, set) {
  const val = h('span', { class: 'val' });
  const mouseOnly = (fn) => (e) => { e.stopPropagation(); e.preventDefault(); fn(); };
  const node = h('button', { class: 'setting adjust focusable', oncdselect: () => step(1) },
    h('span', {}, label),
    h('span', { class: 'adj' }, h('span', { class: 'volbtn', onclick: mouseOnly(() => step(-1)) }, '‹'), val,
      h('span', { class: 'volbtn', onclick: mouseOnly(() => step(1)) }, '›')));
  const draw = () => { const v = get(); const f = values.find(([x]) => x === v); val.textContent = f ? f[1] : String(v); };
  async function step(d) {
    const i = values.findIndex(([x]) => x === get());
    const ni = Math.max(0, Math.min(values.length - 1, (i < 0 ? 0 : i) + d));
    await set(values[ni][0]); draw();
  }
  node.onAdjust = step;
  node.redraw = draw;
  draw();
  return node;
}

const dbValues = (min, max, step = 1) => { const out = []; for (let v = min; v <= max; v += step) out.push([v, `${v > 0 ? '+' : ''}${v} dB`]); return out; };

function soundProfilesScreen() {
  const node = h('div', { class: 'screen' });
  const list = h('div', { class: 'settings-list' });
  node.append(h('div', { class: 'scroll' }, h('h1', { class: 'screen-title' }, '🎚 Klangprofile'),
    h('p', { class: 'empty', style: { paddingTop: 0 } }, 'Feste Klangeinstellungen ohne „Pumpen“. Im Film wechselst du das Profil im Player-Menü (Start) unter „Klangprofil“.'),
    list));
  async function load() {
    const { profiles, active } = await call('sound:list');
    const keep = focused && node.contains(focused) ? focused.dataset.key : null;
    list.textContent = '';
    for (const p of profiles) {
      const desc = [p.speech ? `Sprache +${p.speech}` : null, p.bass ? `Bass ${p.bass > 0 ? '+' : ''}${p.bass}` : null,
        p.dynamics !== 'aus' ? `Dynamik ${DYN_LABEL[p.dynamics]}` : null].filter(Boolean).join(' · ') || 'unverändert';
      list.append(h('button', { class: 'setting focusable', data: { key: p.id }, oncdselect: () => push(soundEditorScreen(p.id)) },
        h('span', {}, `${p.id === active ? '● ' : ''}${p.name}`), h('span', { class: `val${p.id === active ? ' on' : ''}` }, desc)));
    }
    list.append(h('button', { class: 'setting focusable', data: { key: 'new' }, oncdselect: async () => {
      const p = await call('sound:create'); toast(`„${p.name}“ angelegt`); push(soundEditorScreen(p.id));
    } }, h('span', {}, '＋ Neues Profil'), h('span', { class: 'val' }, 'Kopie des aktiven Profils')));
    const again = keep && list.querySelector(`[data-key="${CSS.escape(keep)}"]`);
    if (again) setFocus(again, { scroll: false }); else focusFirst(screen);
  }
  const screen = { node, render: load, onShow: load, hints: () => [['A', 'a', 'Bearbeiten'], ['B', 'b', 'Zurück']] };
  return screen;
}

function soundEditorScreen(id) {
  const node = h('div', { class: 'screen' });
  const body = h('div', { class: 'settings-list' });
  const title = h('h1', { class: 'screen-title' });
  node.append(h('div', { class: 'scroll' }, title, body));
  let prof = null; let isActive = false;
  async function load() {
    const { profiles, active } = await call('sound:list');
    prof = profiles.find((p) => p.id === id);
    if (!prof) { pop(); return; }
    isActive = active === id;
    title.textContent = `🎚 ${prof.name}${isActive ? '  ·  aktiv' : ''}`;
    body.textContent = '';
    const set = (key) => async (v) => { prof = await call('sound:update', { id, patch: { [key]: v } }); };
    append(body,
      h('div', { class: 'actions', style: { margin: '0 0 0.6rem' } },
        isActive ? h('span', { class: 'chip active' }, '● Aktives Profil')
          : h('button', { class: 'action primary focusable', 'data-autofocus': true, oncdselect: async () => { await call('sound:setActive', id); toast(`Klangprofil „${prof.name}“ aktiv`); load(); } }, '✓ Verwenden'),
        h('button', { class: 'action focusable', oncdselect: () => renameProfile() }, '✎ Umbenennen'),
        prof.builtin
          ? h('button', { class: 'action focusable', oncdselect: async () => { await call('sound:reset', id); toast('Zurückgesetzt'); load(); } }, '↺ Zurücksetzen')
          : h('button', { class: 'action danger focusable', oncdselect: () => confirmDialog('Profil löschen?', `„${prof.name}“ wird gelöscht.`, 'Löschen', async () => { await call('sound:remove', id); pop(); }) }, '🗑 Löschen')),
      h('h3', {}, 'Klang'),
      valueRow('Sprache / Dialoge anheben', dbValues(0, 12), () => prof.speech, set('speech')),
      valueRow('Bass / Explosionen', dbValues(-15, 9), () => prof.bass, set('bass')),
      valueRow('Höhen', dbValues(-9, 9), () => prof.treble, set('treble')),
      h('h3', {}, 'Lautstärke'),
      valueRow('Dynamik ausgleichen (laute Spitzen dämpfen)', Object.entries(DYN_LABEL), () => prof.dynamics, set('dynamics')),
      valueRow('Pegel', dbValues(-9, 9), () => prof.level, set('level')),
      h('p', { class: 'empty', style: { padding: '1rem 0 0' } }, 'Änderungen gelten sofort – läuft gerade ein Film mit diesem Profil, hörst du sie direkt. Bei 5.1-Ton wird für „Sprache“ zusätzlich der Center-Kanal (Dialoge) angehoben.'));
    if (!body.contains(focused)) focusFirst(screen);
  }
  function renameProfile() {
    let name = prof.name;
    const kb = keyboard((v) => { name = v; });
    kb.set(prof.name);
    const box = h('div', { class: 'dialog', style: { width: 'auto' } }, h('h2', {}, 'Profil umbenennen'), kb.node,
      h('div', { class: 'actions' },
        h('button', { class: 'action focusable', oncdselect: closeOverlay }, 'Abbrechen'),
        h('button', { class: 'action primary focusable', oncdselect: async () => { closeOverlay(); await call('sound:update', { id, patch: { name } }); load(); } }, 'Speichern')));
    showOverlay(box, { centered: true, onAction: (a) => (a === 'back' ? (closeOverlay(), true) : a === 'west' ? (kb.backspace(), true) : false), hints: () => [['A', 'a', 'Taste'], ['X', 'x', 'Löschen'], ['B', 'b', 'Abbrechen']] });
  }
  const screen = { node, render: load, onShow: load };
  return screen;
}

// ---------- Einstellungen ----------

/**
 * Einstellungszeile: ←/→ (oder −/+ per Maus) ändern den Wert, A schaltet weiter.
 * opts: { label, section, key, values: [[wert, anzeige], …] }
 */
function settingRow({ label, section, key, values }) {
  const val = h('span', { class: 'val' });
  const mouseOnly = (fn) => (e) => { e.stopPropagation(); e.preventDefault(); fn(); };
  const node = h('button', { class: 'setting adjust focusable', oncdselect: () => step(1) },
    h('span', {}, label),
    h('span', { class: 'adj' },
      h('span', { class: 'volbtn', onclick: mouseOnly(() => step(-1)) }, '‹'),
      val,
      h('span', { class: 'volbtn', onclick: mouseOnly(() => step(1)) }, '›')));
  const cur = () => S.settings?.[section]?.[key];
  function draw() {
    const v = cur();
    const found = values.find(([x]) => x === v);
    val.textContent = found ? found[1] : String(v ?? '–');
    val.classList.toggle('on', v === true);
  }
  async function step(d) {
    const i = values.findIndex(([x]) => x === cur());
    const next = values[(Math.max(0, i) + d + values.length) % values.length][0];
    S.settings[section] = await call('sys:setting', { section, key, value: next });
    if (section === 'ui' && key === 'screensaverMin') resetIdle();
    draw();
  }
  node.onAdjust = step;
  draw();
  return node;
}

function settingsScreen() {
  const node = h('div', { class: 'screen' });
  const onOff = [[true, 'An'], [false, 'Aus']];
  const list = h('div', { class: 'settings-list' },
    h('h3', {}, 'Ton'),
    settingRow({ label: 'Startlautstärke', section: 'audio', key: 'startVolume', values: [0, 10, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80].map((v) => [v, `${v} %`]) }),
    nightRow(),
    balanceRow(),
    h('h3', {}, 'Wiedergabe'),
    settingRow({ label: 'Nächste Folge automatisch', section: 'player', key: 'autoplayNext', values: onOff }),
    settingRow({ label: 'Countdown bis zur nächsten Folge', section: 'player', key: 'upNextSeconds', values: [5, 10, 15, 20, 30].map((v) => [v, `${v} s`]) }),
    settingRow({ label: 'Intro automatisch überspringen', section: 'player', key: 'autoSkipIntro', values: onOff }),
    settingRow({ label: 'Zurückspulen (LT / Stick ←)', section: 'player', key: 'seekBack', values: [5, 10, 15, 30].map((v) => [v, `${v} s`]) }),
    settingRow({ label: 'Vorspulen (RT / Stick →)', section: 'player', key: 'seekForward', values: [10, 15, 30, 60].map((v) => [v, `${v} s`]) }),
    h('h3', {}, 'YouTube'),
    settingRow({ label: 'Höchste Qualität', section: 'youtube', key: 'maxHeight', values: [[480, '480p (sparsam)'], [720, '720p'], [1080, '1080p'], [1440, '1440p'], [2160, '2160p (4K)']] }),
    settingRow({ label: 'Sponsor-Abschnitte automatisch überspringen', section: 'youtube', key: 'sponsorAuto', values: [[false, 'Aus (Knopf)'], [true, 'An']] }),
    ytLoginRow(),
    h('h3', {}, 'Oberfläche'),
    settingRow({ label: 'Bildschirmschoner nach', section: 'ui', key: 'screensaverMin', values: [[0, 'Aus'], [2, '2 min'], [5, '5 min'], [10, '10 min'], [15, '15 min'], [30, '30 min']] }),
    h('h3', {}, 'Controller'),
    h('button', { class: 'setting focusable', oncdselect: () => push(controllerTestScreen()) },
      h('span', {}, '🎮 Controller testen'), h('span', { class: 'val' }, 'zeigt jede Taste an')));
  node.append(h('div', { class: 'scroll' }, h('h1', { class: 'screen-title' }, 'Einstellungen'), list));
  return { node, hints: () => [['A', 'a', 'Ändern'], ['B', 'b', 'Zurück']] };
}

// ---------- Controller-Test ----------

function controllerTestScreen() {
  const node = h('div', { class: 'screen' });
  const KEYS = [['select', 'A'], ['back', 'B'], ['west', 'X'], ['north', 'Y'], ['lb', 'LB'], ['rb', 'RB'], ['lt', 'LT'], ['rt', 'RT'],
    ['view', 'View'], ['menu', 'Menü'], ['home', 'Xbox'], ['up', '↑'], ['down', '↓'], ['left', '←'], ['right', '→'], ['ls', 'L-Stick'], ['rs', 'R-Stick']];
  const cells = new Map();
  const grid = h('div', { class: 'padgrid' }, KEYS.map(([a, label]) => { const c = h('div', { class: 'padkey' }, label); cells.set(a, c); return c; }));
  const raw = h('div', { class: 'padraw' }, 'Drück eine Taste …');
  node.append(h('div', { class: 'scroll' }, h('h1', { class: 'screen-title' }, 'Controller testen'),
    h('p', { class: 'empty' }, 'Jede Taste leuchtet kurz auf. Zum Verlassen B zweimal schnell drücken.'), grid, raw));
  let lastBack = 0;
  const flash = (a) => {
    const c = cells.get(a); if (!c) return;
    c.classList.add('on'); clearTimeout(c.t); c.t = setTimeout(() => c.classList.remove('on'), 350);
  };
  const onRaw = (r) => { if (S.stack.at(-1)?.node === node) raw.textContent = `Code ${r.code} → ${r.action || 'nicht belegt'}  (${r.device})`; };
  cd.on('raw-input', onRaw);
  return {
    node,
    onAction(a) {
      flash(a);
      if (a === 'back') { if (Date.now() - lastBack < 600) pop(); lastBack = Date.now(); }
      return true; // alle Eingaben hier abfangen
    },
    hintsFixed: true,
    hints: () => [['B', 'b', '2× Zurück']],
  };
}

// ---------- Bildschirmschoner ----------

const saver = { el: null, timer: null, slide: null, items: [], idx: 0 };

function resetIdle() {
  clearTimeout(saver.timer);
  const min = S.settings?.ui?.screensaverMin || 0;
  if (!min) return;
  saver.timer = setTimeout(startSaver, min * 60000);
}

async function startSaver() {
  if (S.player?.active || !S.auth.loggedIn || saver.el) return;
  try {
    const res = await cd.call('jf:items', { recursive: true, includeItemTypes: 'Movie,Series', imageTypes: 'Backdrop', sortBy: 'Random', limit: 30 });
    saver.items = (res.Items || []).filter((i) => i.BackdropImageTags?.length);
  } catch { saver.items = []; }
  if (!saver.items.length) return;
  const a = h('div', { class: 'saver-img' }); const b = h('div', { class: 'saver-img' });
  const cap = h('div', { class: 'saver-cap' }); const clock = h('div', { class: 'saver-clock' });
  saver.el = h('div', { id: 'saver' }, a, b, h('div', { class: 'saver-shade' }), clock, cap);
  document.body.append(saver.el);
  let front = a;
  const show = () => {
    const it = saver.items[saver.idx++ % saver.items.length];
    const back = front === a ? b : a;
    back.style.backgroundImage = `url("${img(it.Id, 'Backdrop', it.BackdropImageTags[0], 1080)}")`;
    back.classList.add('on'); front.classList.remove('on'); front = back;
    cap.textContent = [it.Name, it.ProductionYear].filter(Boolean).join(' · ');
    clock.textContent = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  };
  show();
  saver.slide = setInterval(show, 12000);
}

function stopSaver() {
  if (!saver.el) return false;
  clearInterval(saver.slide);
  saver.el.remove(); saver.el = null;
  return true;
}

/** Jede Eingabe: Schoner beenden (Eingabe dann verwerfen) und Leerlauf neu starten. */
function noteActivity() {
  const wasOn = stopSaver();
  resetIdle();
  return wasOn;
}

// ---------- Bereiche: Kino / YouTube / Musik ----------

const SECTIONS = {
  kino: { label: 'Kino', icon: '🎬', sub: 'Filme & Serien', root: () => homeScreen() },
  yt: { label: 'YouTube', icon: '▶', sub: 'Kanäle & Videos', root: () => ytHomeScreen() },
  music: { label: 'Musik', icon: '♪', sub: 'Alben & Playlists', root: () => musicHomeScreen() },
};
const bar = { el: null, pills: new Map(), active: false };

function buildSectionBar() {
  bar.el = document.getElementById('sections');
  bar.el.textContent = '';
  for (const [key, sec] of Object.entries(SECTIONS)) {
    const pill = h('button', { class: `sec sec-${key}`, onclick: (e) => { e.stopPropagation(); switchSection(key); leaveBar(); } },
      h('span', { class: 'sec-icon' }, sec.icon),
      h('span', { class: 'sec-text' }, h('span', { class: 'sec-label' }, sec.label), h('span', { class: 'sec-sub' }, sec.sub)));
    bar.pills.set(key, pill);
    bar.el.append(pill);
  }
}

let mediaFreeReading = false;
async function updateMediaFree() {
  const label = $('#media-free');
  const inCinema = () => S.auth.loggedIn && S.section === 'kino';
  label.hidden = !inCinema() || !label.textContent;
  if (!inCinema() || mediaFreeReading) return;
  mediaFreeReading = true;
  try {
    const free = (await cd.call('sys:media-storage'))?.media?.freeBytes;
    label.textContent = Number.isFinite(free) && free >= 0 ? `${bytes(free)} frei` : '';
  } catch { label.textContent = ''; }
  finally {
    mediaFreeReading = false;
    label.hidden = !inCinema() || !label.textContent;
  }
}

function markSection() {
  for (const [key, pill] of bar.pills) pill.classList.toggle('current', key === S.section);
  void updateMediaFree();
  if (document.body.dataset.section === S.section) return;
  document.body.dataset.section = S.section;
  // Licht und Bereichsmotiv weich einblenden
  const bg = $('#bg');
  if (bg) { bg.classList.remove('swap'); void bg.offsetWidth; bg.classList.add('swap'); }
}

/**
 * Bereich wechseln. Jeder Bereich behält seinen eigenen Verlauf (Stapel) und die
 * Fokus-Position – zurück im Bereich ist man genau dort, wo man war.
 */
function switchSection(key, { reset = false } = {}) {
  if (!SECTIONS[key]) return;
  const inBar = bar.active;
  if (key !== S.section) {
    const cur = S.stack.at(-1);
    if (cur) { cur.lastFocus = focused && cur.node.contains(focused) ? focused : cur.lastFocus; cur.node.hidden = true; }
    S.stacks[S.section] = S.stack;
    (S.backdrops ||= {})[S.section] = S.backdropUrl;
    S.section = key;
    markSection();
    S.stack = S.stacks[key] || [];
    if (!S.stack.length || reset) { S.stack.forEach((sc) => { sc.node.remove(); sc.destroy?.(); }); S.stack = []; push(SECTIONS[key].root()); }
    else {
      const top = S.stack.at(-1);
      top.node.hidden = false;
      top.node.classList.remove('enter'); void top.node.offsetWidth; top.node.classList.add('enter');
      if (top.lastFocus && top.node.contains(top.lastFocus)) setFocus(top.lastFocus, { scroll: false }); else focusFirst(top);
      top.onShow?.();
      setBackdrop(top.backdrop || (key === 'kino' ? S.backdrops?.kino : '') || '');
      updateHints();
    }
    if (key !== 'kino' && !S.stack.at(-1)?.backdrop) setBackdrop('');
  } else if (reset) {
    replaceRoot(SECTIONS[key].root());
  }
  if (inBar) enterBar(); // Fokus bleibt in der Leiste
}

/** Zur Startseite des aktuellen Bereichs (Xbox-/Home-Taste). */
function goSectionHome() {
  if (S.stack.length > 1) {
    while (S.stack.length > 1) { const old = S.stack.pop(); old.node.remove(); old.destroy?.(); }
    const root = S.stack[0];
    root.node.hidden = false;
    setBackdrop('');
  }
  const root = S.stack[0];
  root.node.querySelector('.scroll')?.scrollTo({ top: 0, behavior: 'smooth' });
  focusFirst(root);
  updateHints();
}

/** Fokus in die Bereichsleiste: sie wird größer, ←/→ wechseln, ↓/A zurück in den Inhalt. */
function enterBar() {
  if (!S.auth.loggedIn || S.overlay) return;
  bar.active = true;
  bar.el.classList.add('expanded');
  if (focused) focused.classList.remove('focused');
  focused = bar.pills.get(S.section);
  focused.classList.add('focused');
  updateHints();
}

function leaveBar() {
  if (!bar.active) return;
  bar.active = false;
  bar.el.classList.remove('expanded');
  bar.pills.get(S.section)?.classList.remove('focused');
  focused = null;
  focusFirst(S.stack.at(-1));
  updateHints();
}

/** LB/RB: Bereich direkt wechseln; Leiste klappt kurz auf als Rückmeldung. */
let barFlashTimer = null;
function stepSection(dir) {
  if (!S.auth.loggedIn) return;
  const keys = Object.keys(SECTIONS);
  const next = keys[(keys.indexOf(S.section) + dir + keys.length) % keys.length];
  if (bar.active) { switchSection(next); return; }
  switchSection(next);
  bar.el.classList.add('expanded', 'flash');
  clearTimeout(barFlashTimer);
  barFlashTimer = setTimeout(() => { if (!bar.active) bar.el.classList.remove('expanded'); bar.el.classList.remove('flash'); }, 1300);
}

function barAction(a) {
  const keys = Object.keys(SECTIONS);
  const i = keys.indexOf(S.section);
  if (a === 'left' || a === 'right' || a === 'lb' || a === 'rb') {
    const next = keys[(i + ((a === 'right' || a === 'rb') ? 1 : -1) + keys.length) % keys.length];
    switchSection(next);
    return true;
  }
  if (a === 'down' || a === 'select' || a === 'back') { leaveBar(); return true; }
  if (a === 'up') return true;
  return false;
}

// ---------- YouTube ----------

function fmtDur(sec) {
  if (!sec) return '';
  sec = Math.round(sec);
  const h2 = Math.floor(sec / 3600); const m = Math.floor((sec % 3600) / 60); const s2 = sec % 60;
  return h2 ? `${h2}:${String(m).padStart(2, '0')}:${String(s2).padStart(2, '0')}` : `${m}:${String(s2).padStart(2, '0')}`;
}

function fmtViews(n) {
  if (!n) return '';
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.', ',')} Mio. Aufrufe`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} Tsd. Aufrufe`;
  return `${n} Aufrufe`;
}

function fmtAgo(ts) {
  if (!ts) return '';
  const d = (Date.now() / 1000 - ts) / 86400;
  if (d < 1) return 'heute';
  if (d < 2) return 'gestern';
  if (d < 30) return `vor ${Math.floor(d)} Tagen`;
  if (d < 365) return `vor ${Math.floor(d / 30)} Monaten`;
  return `vor ${Math.floor(d / 365)} Jahren`;
}

/** Karte für ein YouTube-Video, einen Kanal oder eine Playlist. list = Kontext für Autoplay. */
function ytCard(e, list = null) {
  const isVid = e.kind === 'video';
  const node = h('button', { class: `card ${isVid || e.kind === 'playlist' ? 'wide' : 'channel'} yt focusable`, tabindex: -1 },
    h('div', { class: 'img', style: e.thumb ? { backgroundImage: `url("${e.thumb}")` } : {} },
      e.thumb ? null : h('div', { class: 'fallback' }, e.title),
      isVid && e.duration ? h('div', { class: 'dur' }, fmtDur(e.duration)) : null,
      e.live ? h('div', { class: 'dur live' }, 'LIVE') : null,
      e.kind === 'playlist' ? h('div', { class: 'dur' }, `☰ ${e.count || ''} Playlist`) : null,
      isVid && e.watched && !e.progress ? h('div', { class: 'badge done' }, '✓') : null,
      isVid && e.progress ? h('div', { class: 'progress' }, h('i', { style: { width: `${Math.round(e.progress * 100)}%` } })) : null),
    h('div', { class: 'title' }, e.title),
    h('div', { class: 'sub' }, isVid ? [e.channel, fmtViews(e.views), fmtAgo(e.timestamp)].filter(Boolean).join(' · ')
      : e.kind === 'channel' ? 'Kanal' : e.channel || ''));
  node.ytItem = e;
  // Schneller Start: nach kurzem Verweilen die Stream-Adressen im Hintergrund vorbereiten
  if (isVid) {
    let pf = null;
    node.addEventListener('cdfocus', () => { clearTimeout(pf); pf = setTimeout(() => { if (focused === node) cd.call('yt:prefetch', e).catch(() => {}); }, 600); });
  }
  node.addEventListener('cdselect', () => {
    if (e.kind === 'channel') push(ytChannelScreen(e));
    else if (e.kind === 'playlist') push(ytPlaylistScreen(e));
    else ytPlay(list || [e], list ? list.indexOf(e) : 0);
  });
  return node;
}

async function ytPlay(entries, startIndex = 0) {
  toast('YouTube wird geladen …');
  try { await cd.call('yt:play', { entries: entries.filter((x) => x.kind === 'video'), startIndex: Math.max(0, startIndex) }); } catch (e) { toast('YouTube: ' + e.message, 'error'); }
}

function showYouTubeLink(id, blocked = false, signedIn = false) {
  const result = h('div', { class: 'yt-share-result' }, 'Link wird vorbereitet …');
  const login = blocked ? h('button', { class: 'action primary focusable', 'data-autofocus': true,
    oncdselect: () => { closeOverlay(); openYouTubeLogin({ autoFinish: true }); } },
  signedIn ? 'Anmeldung erneuern' : 'Bei YouTube anmelden') : null;
  const panel = h('div', { class: 'dialog yt-share' },
    h('h2', {}, blocked ? 'YouTube möchte eine Bestätigung' : 'Auf YouTube ansehen'),
    blocked ? h('p', {}, signedIn
      ? 'YouTube verlangt trotz Anmeldung eine neue Bestätigung. Melde dich erneut an – danach geht es mit dem Video weiter.'
      : 'YouTube verlangt auf diesem Server eine Bestätigung. Melde dich einmal mit einem Google-Konto an – danach geht es mit dem Video weiter.') : null,
    blocked ? h('p', { class: 'muted' }, 'Oder auf dem Handy ansehen:') : null,
    result,
    h('div', { class: 'actions' }, login,
      h('button', { class: blocked ? 'action focusable' : 'action primary focusable', 'data-autofocus': !blocked || undefined, oncdselect: closeOverlay }, 'Schließen')));
  showOverlay(panel, { centered: true, onAction: (a) => a === 'back' ? (closeOverlay(), true) : false,
    hints: () => [['A', 'a', blocked ? 'Auswählen' : 'Schließen'], ['B', 'b', 'Zurück']] });
  cd.call('yt:share', id).then(({ url, image }) => {
    if (!result.isConnected) return;
    result.textContent = '';
    if (image) result.append(h('p', {}, 'Scanne den QR-Code mit der Kamera deines Handys oder Tablets.'),
      h('img', { class: 'yt-share-code', src: image, alt: 'QR-Code zum YouTube-Video', width: 264, height: 264 }));
    result.append(h('p', {}, h('code', {}, url)));
  }).catch(() => { result.textContent = 'Der YouTube-Link konnte nicht erstellt werden.'; });
}

// ---------- YouTube-Anmeldung ----------
// Die echte Google/YouTube-Seite liegt oben über der Oberfläche (eigene Sitzung, im
// Hauptprozess). Hier unten: Bedienhinweise und auf Wunsch die Bildschirmtastatur.
let ytLoginState = null;
async function openYouTubeLogin({ autoFinish = false } = {}) {
  if (ytLoginState) return;
  let typed = '';
  const kb = keyboard((v) => {
    // Nur die Änderung an die Seite schicken: neue Zeichen tippen, gelöschte zurücknehmen
    if (v.startsWith(typed)) { const add = v.slice(typed.length); if (add) cd.call('yt:login-text', add).catch(() => {}); }
    else if (typed.startsWith(v)) cd.call('yt:login-backspace', typed.length - v.length).catch(() => {});
    else cd.call('yt:login-backspace', typed.length).then(() => v && cd.call('yt:login-text', v)).catch(() => {});
    typed = v;
  }, null, { secretField: true, extraKeys: ['@', '.', '_', '+', '!', '?', '#', '$', '%', '&', '*'] });
  const status = h('p', { class: 'yt-login-status' }, 'Google-Anmeldung wird geladen …');
  const kbWrap = h('div', { class: 'yt-login-kb', hidden: true }, kb.node);
  const bar = h('div', { class: 'yt-login-bar' }, status, kbWrap);
  const state = { keyboard: false, autoFinish };
  ytLoginState = state;
  const setKeyboard = (open) => {
    state.keyboard = open;
    kbWrap.hidden = !open;
    bar.classList.toggle('with-kb', open);
    if (open) {
      typed = ''; kb.set(''); typed = '';
      const first = focusables(kbWrap)[0];
      if (first) setFocus(first, { scroll: false });
    }
    cd.call('yt:login-keyboard', open).catch(() => {});
    updateHints();
  };
  const finish = async () => {
    status.textContent = 'Anmeldung wird übernommen …';
    try { await cd.call('yt:login-finish'); } catch (e) { toast('YouTube-Anmeldung: ' + e.message, 'error'); }
  };
  showOverlay(bar, {
    destroy() { ytLoginState = null; },
    onAction(a) {
      if (a === 'menu') { finish(); return true; }
      if (a === 'north') { setKeyboard(!state.keyboard); return true; }
      if (state.keyboard) {
        if (a === 'back') { setKeyboard(false); return true; }
        if (a === 'west') { kb.backspace(); return true; }
        return false; // Kreuz/A bedienen die Bildschirmtastatur
      }
      if (a === 'back') { cd.call('yt:login-cancel').catch(() => {}); return true; }
      cd.call('yt:login-key', a).catch(() => {}); // Kreuz: nächstes/voriges Feld, A: bestätigen
      return true;
    },
    hints: () => state.keyboard
      ? [['A', 'a', 'Taste'], ['X', 'x', 'Löschen'], ['Y', 'y', 'Tastatur zu'], ['☰', 'menu', 'Fertig'], ['B', 'b', 'Tastatur zu']]
      : [['✚', 'dir', 'Nächstes Feld'], ['A', 'a', 'Bestätigen'], ['Y', 'y', 'Tastatur'], ['☰', 'menu', 'Fertig'], ['B', 'b', 'Abbrechen']],
  });
  bar.classList.add('yt-login-open');
  $('#overlay').classList.add('yt-login');
  try {
    const r = await cd.call('yt:login-open', { autoFinish });
    status.textContent = r.loggedIn
      ? 'Du bist bei YouTube angemeldet. Zeigt die Seite eine Bestätigung, folge ihr. ☰ übernimmt die Anmeldung.'
      : 'Mit einem Google-Konto anmelden (am besten ein eigenes nur für Couchdeck). Y öffnet die Tastatur, ✚ springt zum nächsten Feld.';
  } catch (e) {
    toast('YouTube-Anmeldung: ' + e.message, 'error');
    closeOverlay();
  }
}

function ytLoginEvent(p) {
  if (!p) return;
  if (p.state === 'ready' && ytLoginState) {
    const s = document.querySelector('.yt-login-status');
    if (s) s.textContent = ytLoginState.autoFinish ? 'Angemeldet – das Video wird gleich fortgesetzt …' : 'Angemeldet. ☰ drücken, um zu übernehmen.';
  }
  if (p.state === 'done') toast(p.loggedIn ? 'YouTube-Anmeldung übernommen.' : 'Keine YouTube-Anmeldung erkannt.', p.loggedIn ? 'info' : 'error');
  if ((p.state === 'closed' || p.state === 'done') && ytLoginState) { $('#overlay').classList.remove('yt-login'); closeOverlay(); }
}

function ytLoginRow() {
  const val = h('span', { class: 'val' }, '…');
  const b = h('button', { class: 'setting focusable', oncdselect: async () => {
    const st = await cd.call('yt:login-status').catch(() => null);
    if (st?.signedIn) confirmDialog('YouTube abmelden?', 'Couchdeck vergisst die Google-Anmeldung. Danach kann YouTube wieder eine Bestätigung verlangen.', 'Abmelden',
      async () => { await cd.call('yt:login-logout').catch(() => {}); refresh(); });
    else openYouTubeLogin();
  } }, h('span', {}, 'Google-Anmeldung für YouTube'), val);
  const refresh = () => cd.call('yt:login-status').then((st) => { val.textContent = st.signedIn ? 'angemeldet · abmelden' : 'nicht angemeldet · anmelden'; }).catch(() => { val.textContent = '–'; });
  refresh();
  return b;
}

function ytRow(title, entries, { list } = {}) {
  if (!entries?.length) return null;
  return h('section', { class: 'row' }, h('h2', {}, title),
    h('div', { class: 'row-items' }, entries.map((e) => ytCard(e, list || entries))));
}

function ytMissing() {
  return h('div', { class: 'empty yt-missing' },
    h('h2', {}, 'YouTube ist noch nicht eingerichtet'),
    h('p', {}, 'Dafür wird das Programm yt-dlp gebraucht. Das Installationsskript fragt beim nächsten Durchlauf, ob es installiert werden soll:'),
    h('code', { class: 'cmd' }, "ssh -t medienserver 'sudo bash ~/couchdeck-staging/deploy/install.sh'"));
}

/** Kompakter Bereichskopf: Symbol-Plakette, Titel und Untertitel in einer Zeile. */
function sectionHead(icon, title, sub) {
  return h('div', { class: 'section-head' }, h('span', { class: 'sh-badge' }, icon),
    h('div', {}, h('div', { class: 'sh-title' }, title), h('div', { class: 'sh-sub' }, sub)));
}

/**
 * YouTube-Startseite – geordnet nach Nutzen:
 * Weiterschauen → Später ansehen → Neu von deinen Kanälen → je Lieblingskanal eine Reihe
 * → Deine Kanäle / Playlists → Zuletzt angesehen. Kein Banner (wiederholte nur den Feed).
 */
function ytHomeScreen() {
  const node = h('div', { class: 'screen' });
  const content = h('div', {}, h('div', { class: 'spinner' }));
  node.append(h('div', { class: 'scroll' }, sectionHead('▶', 'YouTube', 'Ohne Werbung · Sponsor-Abschnitte überspringbar'), content));
  // Bei Rückkehr (z. B. nach ★ Merken) neu laden, damit Änderungen sofort erscheinen
  const screen = { node, render: load, refresh: load, onShow: () => load({ keepFocus: true }), onAction: () => false };

  /** Feed aufbereiten: Shorts raus, ungesehene zuerst (sonst nach Datum). */
  function cleanFeed(feed) {
    return feed.filter((e) => !(e.duration && e.duration < 70) && !e.live)
      .sort((a, b) => (Number(!!a.watched) - Number(!!b.watched)) || ((b.timestamp || 0) - (a.timestamp || 0)));
  }

  /** Eine Reihe je Kanal (aus den bereits geladenen Feed-Daten, keine Zusatzabfragen). */
  function channelRows(feed, chans) {
    return chans.map((c) => {
      const vids = feed.filter((e) => (c.id && e.channelId === c.id) || (e.channel && e.channel === c.title)).slice(0, 10);
      if (!vids.length) return null;
      const r = ytRow(c.title, vids);
      const more = h('button', { class: 'card wide more-card focusable', tabindex: -1, oncdselect: () => push(ytChannelScreen(c)) },
        h('div', { class: 'img' }, h('div', { class: 'fallback' }, 'Alle Videos ›')), h('div', { class: 'title' }, c.title), h('div', { class: 'sub' }, 'Kanal öffnen'));
      r.querySelector('.row-items').append(more);
      return r;
    });
  }

  async function load({ keepFocus = false } = {}) {
    const st = await call('yt:status');
    const keepId = keepFocus && focused && node.contains(focused) ? focused.ytItem?.id || focused.textContent : null;
    const nav = h('div', { class: 'navrow' },
      h('button', { class: 'chip focusable', oncdselect: () => push(ytSearchScreen()) }, h('span', { class: 'ci' }, '🔍'), 'Suchen'),
      h('button', { class: 'chip focusable', oncdselect: () => push(ytWatchLaterScreen()) }, h('span', { class: 'ci' }, '🕒'), 'Später ansehen'),
      h('button', { class: 'chip focusable', oncdselect: openMenu }, h('span', { class: 'ci' }, '☰'), 'Menü'));
    if (!st.available) { content.textContent = ''; content.append(nav, ytMissing()); focusFirst(screen); return; }
    const favs = st.favorites || [];
    const chans = favs.filter((f) => f.kind === 'channel');
    const lists = favs.filter((f) => f.kind === 'playlist');
    const [history, cont, later] = await Promise.all([
      call('yt:history').catch(() => []), call('yt:continue').catch(() => []), call('yt:watchLater').catch(() => [])]);
    const feedHost = h('div', {});
    content.textContent = '';
    append(content, nav,
      ytRow('▶ Weiterschauen', cont),
      ytRow('🕒 Später ansehen', later.slice(0, 20)),
      chans.length ? feedHost : null,
      ytRow('Deine Kanäle', chans),
      ytRow('Deine Playlists', lists),
      ytRow('Zuletzt angesehen', history.slice(0, 20)),
      !favs.length ? h('div', { class: 'empty' }, 'Tipp: Suche einen Kanal oder eine Playlist und merke sie dir mit ★ – dann erscheinen hier ihre neuesten Videos, ganz ohne Tippen.') : null);
    if (chans.length) feedHost.append(h('section', { class: 'row' }, h('h2', {}, 'Neu von deinen Kanälen'), h('div', { class: 'spinner small' })));
    const refocus = () => {
      const again = keepId && [...node.querySelectorAll('.focusable')].find((n) => (n.ytItem?.id || n.textContent) === keepId);
      if (again) setFocus(again, { scroll: false }); else if (!node.contains(focused)) focusFirst(screen);
    };
    refocus();
    if (chans.length) {
      try {
        const feed = cleanFeed(await cd.call('yt:feed'));
        feedHost.textContent = '';
        append(feedHost, ytRow('Neu von deinen Kanälen', feed.slice(0, 24)), ...channelRows(feed, chans));
        refocus();
      } catch { feedHost.textContent = ''; }
    }
  }
  return screen;
}

/** Eigene Seite "Später ansehen" (Raster, alle Einträge). */
function ytWatchLaterScreen() {
  const node = h('div', { class: 'screen' });
  const grid = h('div', { class: 'grid wide-grid' }, h('div', { class: 'spinner' }));
  node.append(h('div', { class: 'scroll' }, h('h1', { class: 'screen-title' }, '🕒 Später ansehen'), grid));
  async function load() {
    const list = await call('yt:watchLater').catch(() => []);
    grid.textContent = '';
    for (const e of list) grid.append(ytCard(e, list));
    if (!list.length) grid.append(h('div', { class: 'empty' }, 'Noch nichts vorgemerkt. Im Info-Fenster eines Videos (X) gibt es „🕒 Später ansehen“.'));
    focusFirst(screen);
  }
  const screen = { node, render: load, onShow: load };
  return screen;
}

function ytSearchScreen() {
  const node = h('div', { class: 'screen' });
  const results = h('div', { class: 'grid wide-grid' });
  let kind = 'video'; let t = null; let seq = 0; let lastQuery = '';
  const KINDS = [['video', 'Videos'], ['channel', 'Kanäle'], ['playlist', 'Playlists']];
  const kinds = h('div', { class: 'tabs', style: { padding: '0 0 0.8rem' } }, KINDS.map(([k, label], i) =>
    h('button', { class: `tab focusable${i === 0 ? ' active' : ''}`, oncdselect: (e) => {
      for (const x of kinds.children) x.classList.remove('active');
      e.currentTarget.classList.add('active'); kind = k; run(lastQuery, true);
    } }, label)));
  async function run(v, now) {
    clearTimeout(t);
    lastQuery = v;
    t = setTimeout(async () => {
      const my = ++seq;
      if (v.trim().length < 2) { results.textContent = ''; return; }
      results.textContent = ''; results.append(h('div', { class: 'spinner' }));
      try {
        const res = await cd.call('yt:search', { query: v.trim(), kind });
        if (my !== seq) return;
        results.textContent = '';
        for (const e of res.entries) results.append(ytCard(e, res.entries));
        if (!res.entries.length) results.append(h('div', { class: 'empty' }, 'Nichts gefunden.'));
      } catch (e) { if (my === seq) { results.textContent = ''; results.append(h('div', { class: 'empty' }, e.message)); } }
    }, now ? 0 : 900); // yt-dlp ist langsamer: erst nach kurzer Tipp-Pause suchen
  }
  const kb = keyboard((v) => run(v));
  node.append(h('div', { class: 'scroll' }, h('h1', { class: 'screen-title' }, 'YouTube durchsuchen'),
    h('div', { class: 'search-layout' }, kb.node, h('div', { class: 'search-results' }, kinds, results))));
  return {
    node, keyboard: kb,
    onAction(a) {
      const onKeys = focused?.closest('.osk');
      if (a === 'west' && onKeys) { kb.backspace(); return true; }
      if (a === 'north' && onKeys) { kb.type(' '); return true; }
      return false;
    },
    hints: () => [['A', 'a', 'Auswählen'], ['X', 'x', 'Löschen / Info'], ['Y', 'y', 'Leerzeichen'], ['B', 'b', 'Zurück']],
  };
}

function ytCollectionScreen(entry, loader, { playlist = false } = {}) {
  const node = h('div', { class: 'screen' });
  const grid = h('div', { class: 'grid wide-grid' }, h('div', { class: 'spinner' }));
  const favBtn = h('button', { class: 'action focusable', oncdselect: toggleFav });
  const actions = h('div', { class: 'actions' });
  let entries = [];
  // Kanal: Reiter Videos | Playlists
  const tabs = playlist ? null : h('div', { class: 'tabs' });
  function drawFav(on) { favBtn.textContent = on ? '★ Gemerkt' : '☆ Merken'; favBtn.classList.toggle('primary', !on); }
  async function toggleFav() {
    const r = await call('yt:toggleFavorite', entry);
    drawFav(r.favorite);
    toast(r.favorite ? `„${entry.title}“ gemerkt – erscheint jetzt auf der YouTube-Startseite` : 'Aus den Favoriten entfernt');
  }
  node.append(h('div', { class: 'scroll' },
    h('div', { class: 'detail yt-head' },
      entry.thumb ? h('div', { class: `poster ${playlist ? 'wide' : 'round'}`, style: { backgroundImage: `url("${entry.thumb}")` } }) : null,
      h('div', { class: 'info' }, h('h1', {}, entry.title || entry.channel), h('div', { class: 'meta' }, h('span', {}, playlist ? 'Playlist' : 'Kanal')), actions)),
    tabs, grid));

  async function showList(load, { videos = true } = {}) {
    grid.textContent = ''; grid.append(h('div', { class: 'spinner' }));
    try {
      const res = await load(entry);
      const list = res.entries.filter((e) => (videos ? e.kind === 'video' : e.kind === 'playlist'));
      if (videos) entries = list;
      grid.textContent = '';
      for (const e of list) grid.append(ytCard(e, videos ? list : null));
      if (!list.length) grid.append(h('div', { class: 'empty' }, videos ? 'Keine Videos gefunden.' : 'Dieser Kanal hat keine öffentlichen Playlists.'));
    } catch (e) { grid.textContent = ''; grid.append(h('div', { class: 'empty' }, e.message)); }
  }

  const screen = {
    node,
    async render() {
      const st = await call('yt:status');
      drawFav((st.favorites || []).some((f) => f.id === entry.id));
      append(actions,
        h('button', { class: 'action primary focusable', 'data-autofocus': true, oncdselect: () => ytPlay(entries, 0) }, playlist ? '▶ Alle abspielen' : '▶ Neueste abspielen'),
        playlist ? h('button', { class: 'action focusable', oncdselect: () => ytPlay([...entries].sort(() => Math.random() - 0.5), 0) }, '⤮ Zufällig') : null,
        favBtn);
      if (tabs) {
        const TABS = [['Videos', () => showList(loader)], ['Playlists', () => showList((x) => cd.call('yt:channelPlaylists', x), { videos: false })]];
        TABS.forEach(([label, fn], i) => tabs.append(h('button', { class: `tab focusable${i === 0 ? ' active' : ''}`, oncdselect: (e) => {
          for (const t of tabs.children) t.classList.remove('active');
          e.currentTarget.classList.add('active'); fn();
        } }, label)));
      }
      focusFirst(screen);
      await showList(loader);
    },
  };
  return screen;
}

const ytChannelScreen = (e) => ytCollectionScreen({ ...e, kind: 'channel' }, (x) => cd.call('yt:channel', x));
const ytPlaylistScreen = (e) => ytCollectionScreen({ ...e, kind: 'playlist' }, (x) => cd.call('yt:playlist', x), { playlist: true });

function showYtInfo(card) {
  const e = card.ytItem;
  const chan = e.channelId || e.channelUrl ? { kind: 'channel', id: e.channelId, url: e.channelUrl, title: e.channel, thumb: null } : null;
  const box = h('div', { class: 'infopop' },
    h('div', { class: 'ip-poster yt', style: e.thumb ? { backgroundImage: `url("${e.thumb}")` } : {} }),
    h('div', { class: 'ip-body' },
      h('h2', {}, e.title),
      h('div', { class: 'meta' }, [e.channel, fmtDur(e.duration), fmtViews(e.views), fmtAgo(e.timestamp)].filter(Boolean).map((m) => h('span', {}, m))),
      h('div', { class: 'actions' },
        h('button', { class: 'action primary focusable', 'data-autofocus': true, oncdselect: () => { closeOverlay(); (card.infoCard || card).dispatchEvent(new CustomEvent('cdselect')); } },
          e.kind === 'video' ? '▶ Abspielen' : 'Öffnen'),
        e.kind === 'video' ? h('button', { class: 'action focusable', oncdselect: () => showYouTubeLink(e.id) }, 'Auf Handy ansehen') : null,
        e.kind === 'video' ? h('button', { class: 'action focusable wl-btn', oncdselect: async () => {
          const r = await call('yt:toggleWatchLater', e); closeOverlay();
          toast(r.watchLater ? `„${e.title}“ auf „Später ansehen“` : 'Von „Später ansehen“ entfernt');
          S.stack.at(-1)?.onShow?.();
        } }, '🕒 Später ansehen') : null,
        chan && e.kind === 'video' ? h('button', { class: 'action focusable', oncdselect: () => { closeOverlay(); push(ytChannelScreen(chan)); } }, 'Kanal öffnen') : null,
        chan && e.kind === 'video' ? h('button', { class: 'action focusable', oncdselect: async () => {
          const r = await call('yt:toggleFavorite', chan); closeOverlay();
          toast(r.favorite ? `Kanal „${chan.title}“ gemerkt` : `Kanal „${chan.title}“ entfernt`);
        } }, '★ Kanal merken') : null,
        e.kind !== 'video' ? h('button', { class: 'action focusable', oncdselect: async () => {
          const r = await call('yt:toggleFavorite', e); closeOverlay();
          toast(r.favorite ? `„${e.title}“ gemerkt` : `„${e.title}“ entfernt`);
        } }, '★ Merken / entfernen') : null,
        h('button', { class: 'action focusable', oncdselect: closeOverlay }, 'Schließen'))));
  showOverlay(box, {
    centered: true,
    onAction: (a) => ((a === 'west' || a === 'back') ? (closeOverlay(), true) : false),
    hints: () => [['A', 'a', 'Auswählen'], ['X', 'x', 'Schließen']],
  });
  // Beschriftung passend zum Listenstatus
  if (e.kind === 'video') cd.call('yt:isWatchLater', e.id).then((on) => { const b = box.querySelector('.wl-btn'); if (b && on) b.textContent = '🕒 Von „Später ansehen“ entfernen'; }).catch(() => {});
}

// ---------- Musik ----------

function musicHomeScreen() {
  const node = h('div', { class: 'screen' });
  const content = h('div', {}, h('div', { class: 'spinner' }));
  node.append(h('div', { class: 'scroll' }, sectionHead('♪', 'Musik', 'Alben, Künstler und Playlists aus Jellyfin'), content));
  const screen = {
    node,
    onAction: () => false,
    async render() {
      const views = ((await call('jf:home').catch(() => ({ views: [] }))).views || []).filter((v) => v.CollectionType === 'music');
      content.textContent = '';
      const nav = h('div', { class: 'navrow' }, h('button', { class: 'chip focusable', oncdselect: openMenu }, '☰ Menü'));
      if (!views.length) {
        content.append(nav, h('div', { class: 'empty music-empty' },
          h('div', { class: 'eq' }, [1, 2, 3, 4, 5, 6, 7].map(() => h('i'))),
          h('h2', {}, 'Noch keine Musik'),
          h('p', {}, 'Sobald auf dem Server eine Musik-Bibliothek in Jellyfin eingerichtet ist (z. B. über Lidarr), erscheinen hier Alben, Künstler und Playlists. Abgespielt wird dann über den WiiM.')));
        focusFirst(screen); return;
      }
      nav.append(...views.map((v) => h('button', { class: 'chip focusable', oncdselect: () => push(libraryScreen(v)) }, v.Name)));
      content.append(nav);
      for (const v of views) {
        const items = await call('jf:items', { parentId: v.Id, recursive: true, includeItemTypes: 'MusicAlbum', sortBy: 'DateCreated', sortOrder: 'Descending', limit: 24 }).catch(() => ({ Items: [] }));
        const r = row(`Neu in ${v.Name}`, items.Items);
        if (r) content.append(r);
      }
      focusFirst(screen);
    },
  };
  return screen;
}

// ---------- Mini-Player (Wiedergabe ohne Bild, z. B. Musik) ----------

const mini = { el: null, btns: [] };

function drawMini(p) {
  mini.el ||= document.getElementById('mini');
  const show = p?.active && p.audio;
  mini.el.hidden = !show;
  if (!show) { if (focused && mini.el.contains(focused)) leaveMini(); return; }
  if (!mini.btns.length) {
    const ctl = (label, cmd) => {
      const b = h('button', { class: 'mini-btn', onclick: (e) => { e.stopPropagation(); cd.call('player:control', cmd); } }, label);
      b.addEventListener('cdselect', () => cd.call('player:control', cmd));
      return b;
    };
    mini.title = h('div', { class: 'mini-title' });
    mini.time = h('div', { class: 'mini-time' });
    mini.bar = h('i');
    mini.btns = [ctl('⏮', 'prev'), ctl('⏯', 'toggle'), ctl('⏭', 'next'), ctl('⏹', 'stop')];
    mini.el.append(h('div', { class: 'mini-eq' }, [1, 2, 3, 4].map(() => h('i'))),
      h('div', { class: 'mini-info' }, mini.title, h('div', { class: 'mini-prog' }, mini.bar), mini.time), h('div', { class: 'mini-btns' }, mini.btns));
  }
  mini.title.textContent = p.title || '';
  mini.time.textContent = `${fmtDur(p.pos)} / ${fmtDur(p.duration)}${p.paused ? ' · Pause' : ''}`;
  mini.bar.style.width = p.duration ? `${(p.pos / p.duration) * 100}%` : '0%';
  mini.el.classList.toggle('paused', !!p.paused);
}

function enterMini() {
  if (mini.el?.hidden !== false) return false;
  mini.back = focused;
  setFocus(mini.btns[1]);
  return true;
}

function leaveMini() {
  const back = mini.back && document.contains(mini.back) ? mini.back : null;
  if (back) setFocus(back, { scroll: false }); else focusFirst(S.stack.at(-1));
}

/** Steuerung innerhalb des Mini-Players. */
function miniAction(a) {
  const i = mini.btns.indexOf(focused);
  if (i < 0) return false;
  if (a === 'left' || a === 'right') { setFocus(mini.btns[Math.max(0, Math.min(mini.btns.length - 1, i + (a === 'right' ? 1 : -1)))]); return true; }
  if (a === 'up' || a === 'back') { leaveMini(); return true; }
  if (a === 'select') { focused.dispatchEvent(new CustomEvent('cdselect')); return true; }
  if (a === 'down') return true;
  return false;
}

// ---------- Ladeanzeige beim Start der Wiedergabe (mit Abbrechen) ----------

let loadingBox = null; let loadingTimer = null;
function showLoading(l) {
  if (!l) {
    clearInterval(loadingTimer); loadingTimer = null;
    if (loadingBox && S.overlay?.node.contains(loadingBox)) closeOverlay();
    loadingBox = null;
    return;
  }
  const secs = h('div', { class: 'load-secs' });
  const hintEl = h('p', { class: 'load-hint' });
  loadingBox = h('div', { class: 'dialog loading-box' },
    h('div', { class: 'spinner' }),
    h('h2', {}, l.title ? `„${l.title}“ wird geladen …` : 'Wird geladen …'),
    secs, hintEl,
    h('div', { class: 'actions' }, h('button', { class: 'action focusable', 'data-autofocus': true, oncdselect: cancel }, '✕ Abbrechen')));
  function cancel() { cd.call('player:stop').catch(() => {}); showLoading(null); toast('Abgebrochen'); }
  showOverlay(loadingBox, {
    centered: true,
    onAction: (a) => { if (a === 'back' || a === 'select' || a === 'home') { cancel(); return true; } return true; },
    hints: () => [['B', 'b', 'Abbrechen']],
  });
  const t0 = l.since || Date.now();
  clearInterval(loadingTimer);
  loadingTimer = setInterval(() => {
    const s = Math.round((Date.now() - t0) / 1000);
    secs.textContent = `${s} s`;
    hintEl.textContent = s > 20 ? 'Das dauert ungewöhnlich lange – du kannst jederzeit abbrechen.' : '';
  }, 500);
}
cd.on('player-loading', showLoading);

// ---------- Globale Tasten-Helfer ----------

function atTop() {
  const sc = S.stack.at(-1)?.node.querySelector('.scroll');
  const first = S.stack.at(-1) && focusables(S.stack.at(-1).node)[0];
  return (!sc || sc.scrollTop < 20) && (!first || focused === first);
}

/** B auf einer Startseite: erst nach oben zum ersten Element, dann in die Bereichsleiste. */
function backAtRoot() {
  if (!S.auth.loggedIn) return;
  if (!atTop()) {
    const root = S.stack.at(-1);
    root.node.querySelector('.scroll')?.scrollTo({ top: 0, behavior: 'smooth' });
    focusFirst(root);
  } else enterBar();
}

/** Y: Suche passend zum Bereich – von jeder Seite aus. */
function openSectionSearch() {
  const top = S.stack.at(-1);
  if (top?.keyboard) return; // schon in einer Suche (dort ist Y = Leerzeichen)
  if (S.section === 'yt') push(ytSearchScreen());
  else push(searchScreen());
}

// ---------- Menü (Overlay) ----------

function closeOverlay() {
  if (!S.overlay) return;
  S.overlay.destroy?.();
  const last = S.overlay.lastFocus;
  S.overlay = null;
  const o = $('#overlay'); o.hidden = true; o.textContent = '';
  if (last && document.contains(last)) setFocus(last, { scroll: false }); else focusFirst(S.stack.at(-1));
  updateHints();
}

function showOverlay(content, opts = {}) {
  const lastFocus = S.overlay ? S.overlay.lastFocus : focused;
  if (S.overlay) S.overlay.destroy?.();
  const o = $('#overlay'); o.textContent = ''; o.append(content); o.hidden = false;
  o.classList.toggle('centered', !!opts.centered);
  S.overlay = { node: o, lastFocus, ...opts };
  const first = o.querySelector('.focusable[data-autofocus]') || focusables(o)[0];
  if (first) setFocus(first, { scroll: false });
  updateHints();
}

/** A kurz sperren (z. B. direkt nach einer Anfrage, während die Seite neu aufgebaut wird). */
let selectLockUntil = 0;
function lockSelect(ms) { selectLockUntil = Math.max(selectLockUntil, Date.now() + ms); }

function confirmDialog(title, text, okLabel, onOk) {
  const prev = S.overlay;
  const back = () => { if (prev?.reopen) prev.reopen(); else closeOverlay(); };
  const box = h('div', { class: 'dialog' }, h('h2', {}, title), h('p', {}, text),
    h('div', { class: 'actions' },
      h('button', { class: 'action focusable', 'data-autofocus': true, oncdselect: back }, 'Abbrechen'),
      h('button', { class: 'action primary focusable', oncdselect: () => { closeOverlay(); onOk(); } }, okLabel)));
  showOverlay(box, { onAction: (a) => (a === 'back' ? (back(), true) : false), hints: () => [['A', 'a', 'Auswählen'], ['B', 'b', 'Abbrechen']] });
}

async function openMenu() {
  const panel = h('div', { class: 'panel' });
  let timer = null;
  const toggle = (label, section, key) => {
    const b = h('button', { class: 'setting focusable', oncdselect: async () => {
      const v = !S.settings[section][key];
      S.settings[section] = await call('sys:setting', { section, key, value: v });
      draw();
    } });
    const draw = () => {
      const on = !!S.settings[section][key];
      b.textContent = '';
      b.append(h('span', {}, label), h('span', { class: `val${on ? ' on' : ''}` }, on ? 'An' : 'Aus'));
    };
    draw();
    return b;
  };

  const audioBox = h('div', {}, h('div', { class: 'empty', style: { padding: '0.4rem 0' } }, 'Lade …'));
  const volRow = volumeControl();
  const btRow = h('button', { class: 'setting focusable', oncdselect: openBluetooth },
    h('span', {}, '🎮 Bluetooth-Geräte'), h('span', { class: 'val' }, 'Controller, Kopfhörer …'));
  const statBox = h('div', { class: 'stat-grid' });
  const svcBox = h('div', {});

  async function loadAudio() {
    try {
      const { sinks, default: def } = await cd.call('sys:sinks');
      audioBox.textContent = '';
      if (!sinks.length) audioBox.append(h('div', { class: 'svc' }, 'Keine Audioausgänge gefunden'));
      for (const s of sinks) {
        const icon = { airplay: '📡', monitor: '🖥', bluetooth: '🎧' }[s.kind] || '🔊';
        audioBox.append(h('button', { class: 'setting focusable', oncdselect: async () => {
          await call('sys:setSink', s.name); toast(`Audio: ${s.description}`); loadAudio();
        } }, h('span', {}, `${icon} ${s.description}`), h('span', { class: `val${s.name === def ? ' on' : ''}` }, s.name === def ? '● aktiv' : '')));
      }
    } catch { audioBox.textContent = 'Audio nicht verfügbar'; }
  }

  async function loadStatus() {
    try {
      const st = await cd.call('sys:status');
      statBox.textContent = '';
      const memUsed = st.memory.total - st.memory.free;
      const disks = st.storage ? [
        [st.storage.shared ? 'System- und Medienspeicher' : 'Medienspeicher', st.storage.media],
        ['Systemspeicher', st.storage.system],
      ].filter(([, usage]) => usage) : [];
      statBox.append(
        h('div', { class: 'stat' }, h('b', {}, `${Math.round((st.load.l1 / st.load.cores) * 100)} %`), h('span', {}, 'CPU-Last')),
        h('div', { class: 'stat' }, h('b', {}, st.temp != null ? `${Math.round(st.temp)} °C` : '–'), h('span', {}, 'Temperatur')),
        h('div', { class: 'stat' }, h('b', {}, bytes(memUsed)), h('span', {}, `von ${bytes(st.memory.total)} RAM`)),
        ...(disks.length ? disks.map(([name, usage]) => h('div', { class: 'stat' },
          h('b', {}, usage.usedBytes != null && usage.totalBytes != null
            ? `${bytes(usage.usedBytes)} von ${bytes(usage.totalBytes)} belegt` : 'Belegung unbekannt'),
          h('span', {}, name, ['warning', 'critical'].includes(usage.state) ? ' · Platz wird knapp' : ''))) :
          (st.disks?.length ? st.disks : [{ mount: '/', ...st.disk }]).map((d) => h('div', { class: 'stat' },
          h('b', {}, d.free != null ? bytes(d.free) : '–'), h('span', {}, `frei auf ${d.mount} (${d.total ? Math.round((1 - d.free / d.total) * 100) : '–'} % belegt)`)))));
      const svcs = await cd.call('sys:services');
      svcBox.textContent = '';
      for (const s of svcs) {
        svcBox.append(h('div', { class: 'svc' }, h('span', { class: `dot${s.up ? ' up' : ''}` }), s.name,
          h('span', { class: 'ms' }, s.up ? `${s.ms} ms` : s.error)));
      }
    } catch { /* still */ }
  }

  panel.append(
    h('div', { class: 'panel-head' }, h('h2', {}, 'Menü'),
      h('button', { class: 'chip focusable close', oncdselect: closeOverlay }, '✕ Schließen')),
    h('h3', {}, 'Lautstärke'), volRow,
    h('h3', {}, 'Audioausgang'), audioBox,
    h('h3', {}, 'Geräte'), btRow,
    h('h3', {}, 'Wiedergabe'),
    toggle('Nächste Folge automatisch', 'player', 'autoplayNext'),
    toggle('Intro automatisch überspringen', 'player', 'autoSkipIntro'),
    h('h3', {}, 'Server'), statBox, svcBox,
    h('h3', {}, 'Konto & System'),
    h('button', { class: 'setting focusable', oncdselect: () => { closeOverlay(); push(settingsScreen()); } },
      h('span', {}, '⚙ Einstellungen'), h('span', { class: 'val' }, 'Ton, Wiedergabe, Aussehen')),
    h('button', { class: 'setting focusable', oncdselect: () => { closeOverlay(); push(controlsScreen()); } },
      h('span', {}, '🎮 Tastenbelegung'), h('span', { class: 'val' }, 'Übersicht aller Tasten')),
    h('button', { class: 'setting focusable', oncdselect: () => { closeOverlay(); replaceRoot(homeScreen()); } }, h('span', {}, '⟳ Startseite neu laden')),
    h('button', { class: 'setting focusable', oncdselect: () => confirmDialog('Abmelden?', `Couchdeck wird von ${S.auth.userName} abgemeldet.`, 'Abmelden', () => cd.call('jf:logout')) },
      h('span', {}, '⎋ Abmelden'), h('span', { class: 'val' }, S.auth.userName || '')),
    h('button', { class: 'setting focusable', oncdselect: () => cd.call('app:restart') }, h('span', {}, '↻ Couchdeck neu starten')),
    h('button', { class: 'setting danger focusable', oncdselect: () => confirmDialog('Server neu starten?',
      'Der Server startet neu. Jellyfin und alle anderen Dienste sind für ein paar Minuten nicht erreichbar.', 'Neu starten', () => cd.call('sys:power', 'reboot')) },
    h('span', {}, '⟲ Server neu starten')),
    h('button', { class: 'setting danger focusable', oncdselect: () => confirmDialog('Server herunterfahren?',
      'Der Server wird ausgeschaltet. Jellyfin und alle anderen Dienste sind dann nicht mehr erreichbar.', 'Herunterfahren', () => cd.call('sys:power', 'poweroff')) },
    h('span', {}, '⏻ Server herunterfahren')),
    h('button', { class: 'setting focusable', oncdselect: () => confirmDialog('Couchdeck ausschalten?',
      'Die Oberfläche wird beendet, der Server läuft weiter. Wieder einschalten: Controller aus- und wieder einschalten oder Bildschirm aus und wieder an.',
      'Ausschalten', () => cd.call('app:off')) },
    h('span', {}, '⏻ Couchdeck ausschalten')));

  const reopen = () => openMenu();
  showOverlay(panel, {
    reopen,
    onAction: (a) => { if (a === 'back' || a === 'menu' || a === 'home') { closeOverlay(); return true; } return false; },
    destroy: () => clearInterval(timer),
    hints: () => [['A', 'a', 'Auswählen'], ['B', 'b', 'Schließen']],
  });
  if (S.overlay?.node.contains(panel)) setFocus(volRow, { scroll: false });
  await loadAudio();
  loadStatus();
  timer = setInterval(loadStatus, 5000);
}

// ---------- Lautstärke ----------

/** Lautstärke-Regler: ←/→ oder −/+ ändern, Klick auf den Balken setzt den Wert, A / 🔊 schaltet stumm. */
function volumeControl() {
  const bar = h('i', { style: { width: '0%' } });
  const val = h('span', { class: 'val' }, '–');
  // Maus-Elemente: Klick nicht an die Zeile weitergeben (die würde stumm schalten)
  const mouseOnly = (fn) => (e) => { e.stopPropagation(); e.preventDefault(); fn(e); };
  const minus = h('span', { class: 'volbtn', title: 'Leiser', onclick: mouseOnly(() => step(-1)) }, '−');
  const plus = h('span', { class: 'volbtn', title: 'Lauter', onclick: mouseOnly(() => step(1)) }, '+');
  const track = h('div', { class: 'volbar', onclick: mouseOnly((e) => {
    const r = track.getBoundingClientRect();
    const pct = Math.round(((e.clientX - r.left) / r.width) * 20) * 5; // auf 5 % runden
    queue(() => cd.call('sys:setVolume', pct));
  }) }, bar);
  const icon = h('span', { class: 'volicon', title: 'Stumm', onclick: mouseOnly(() => queue(() => cd.call('sys:toggleMute'))) }, '🔊');
  const node = h('button', { class: 'setting volume focusable', oncdselect: () => queue(() => cd.call('sys:toggleMute')) },
    icon, minus, track, plus, val);
  function show(v) {
    if (!v || v.volume == null) { val.textContent = 'nicht verfügbar'; return; }
    bar.style.width = `${v.mute ? 0 : v.volume}%`;
    val.textContent = v.mute ? 'stumm' : `${v.volume} %`;
    val.classList.toggle('on', !v.mute);
    icon.textContent = v.mute ? '🔇' : '🔊';
  }
  let busy = Promise.resolve();
  function queue(fn) { busy = busy.then(async () => show(await fn().catch(() => null))); }
  function step(dir) { queue(() => cd.call('sys:changeVolume', dir * 5)); }
  node.onAdjust = step;
  node.showVolume = show;
  cd.call('sys:volume').then(show).catch(() => show(null));
  return node;
}

// ---------- Bluetooth ----------

async function openBluetooth() {
  const panel = h('div', { class: 'panel' });
  const list = h('div', {});
  const status = h('div', { class: 'svc' });
  let scanning = false;

  function draw(devices) {
    list.textContent = '';
    if (!devices.length) list.append(h('div', { class: 'svc' }, 'Keine Geräte gefunden.'));
    for (const d of devices) {
      const icon = /input-gaming/.test(d.icon) ? '🎮' : /audio|headset|headphone/.test(d.icon) ? '🎧'
        : /keyboard/.test(d.icon) ? '⌨️' : /mouse/.test(d.icon) ? '🖱' : '🔹';
      const state = d.paired && !d.bonded ? '⚠ neu koppeln'
        : d.connected ? `● verbunden${d.battery ? ` · ${d.battery} %` : ''}` : d.paired ? 'gekoppelt' : 'neu';
      list.append(h('button', { class: 'setting focusable', data: { mac: d.mac }, oncdselect: () => deviceDialog(d) },
        h('span', {}, `${icon} ${d.name}`), h('span', { class: `val${d.connected ? ' on' : ''}` }, state)));
    }
  }

  async function refresh() {
    try { draw(await cd.call('bt:devices')); } catch (e) { status.textContent = 'Bluetooth nicht verfügbar: ' + e.message; }
  }

  async function scan() {
    if (scanning) return;
    scanning = true;
    status.textContent = 'Suche läuft (30 s) … Gerät jetzt in den Kopplungsmodus versetzen.';
    try { draw(await cd.call('bt:scan')); status.textContent = 'Suche beendet. Gerät auswählen zum Verbinden.'; } catch (e) { status.textContent = e.message; }
    scanning = false;
  }

  function deviceDialog(d) {
    const act = async (fn, label) => {
      status.textContent = `${label} …`;
      showBt();
      try { await fn(); status.textContent = `${d.name}: ${label} erledigt.`; } catch (e) { status.textContent = `${label} fehlgeschlagen: ${e.message}`; }
      refresh();
    };
    const needsPair = !d.paired || !d.bonded;
    const box = h('div', { class: 'dialog' }, h('h2', {}, d.name),
      h('p', {}, needsPair
        ? 'Gerät jetzt in den Kopplungsmodus versetzen (Xbox: Kopplungstaste oben gedrückt halten, bis das Logo schnell blinkt), dann „Koppeln“ wählen.'
        : d.mac),
      h('div', { class: 'actions' },
        needsPair
          ? h('button', { class: 'action primary focusable', 'data-autofocus': true, oncdselect: () => act(() => cd.call('bt:connect', d.mac), 'Koppeln') }, 'Koppeln')
          : d.connected
          ? h('button', { class: 'action primary focusable', 'data-autofocus': true, oncdselect: () => act(() => cd.call('bt:disconnect', d.mac), 'Trennen') }, 'Trennen')
          : h('button', { class: 'action primary focusable', 'data-autofocus': true, oncdselect: () => act(() => cd.call('bt:connect', d.mac), d.paired ? 'Verbinden' : 'Koppeln') }, d.paired ? 'Verbinden' : 'Koppeln'),
        h('button', { class: 'action focusable', oncdselect: () => act(() => cd.call('bt:remove', d.mac), 'Entfernen') }, 'Entfernen'),
        h('button', { class: 'action focusable', oncdselect: showBt }, 'Abbrechen')));
    showOverlay(box, { onAction: (a) => (a === 'back' ? (showBt(), true) : false), hints: () => [['A', 'a', 'Auswählen'], ['B', 'b', 'Zurück']] });
  }

  append(panel,
    h('div', { class: 'panel-head' }, h('h2', {}, 'Bluetooth'),
      h('button', { class: 'chip focusable close', oncdselect: () => openMenu() }, '← Zurück')),
    h('button', { class: 'setting focusable', 'data-autofocus': true, oncdselect: scan },
      h('span', {}, '🔍 Nach neuen Geräten suchen'), h('span', { class: 'val' }, '30 s')),
    status, h('h3', {}, 'Geräte'), list);

  function showBt() {
    showOverlay(panel, {
      onAction: (a) => { if (a === 'back') { openMenu(); return true; } if (a === 'menu' || a === 'home') { closeOverlay(); return true; } return false; },
      hints: () => [['A', 'a', 'Auswählen'], ['B', 'b', 'Zurück']],
    });
  }
  showBt();
  refresh();
}

// ---------- Eingabe ----------

function handleAction(a, { fromMouse = false } = {}) {
  if (noteActivity()) return; // erste Eingabe beendet nur den Bildschirmschoner
  if (!fromMouse) document.body.classList.remove('mouse');
  if ((a === 'lb' || a === 'rb') && !S.overlay) { stepSection(a === 'rb' ? 1 : -1); return; }
  if (bar.active && !S.overlay) { if (barAction(a)) return; if (a === 'menu' || a === 'home') leaveBar(); }
  if (!S.overlay && focused && mini.el?.contains(focused) && miniAction(a)) return;
  if (a === 'playpause' && S.player?.active) { cd.call('player:control', 'toggle'); return; }
  if (S.overlay?.onAction?.(a)) return;
  if (!S.overlay && S.stack.at(-1)?.onAction?.(a)) return;
  if (a === 'north' && !S.overlay && S.auth.loggedIn) { openSectionSearch(); return; } // Y: Suche im aktuellen Bereich
  if (a === 'view' && !S.overlay && S.auth.loggedIn) { enterBar(); return; } // View: Bereichsleiste
  if (a === 'west' && !S.overlay && focused?.lazyInfo) {
    const card = focused;
    card.lazyInfo().then((info) => { if (!S.overlay) showInfo({ ...info, infoCard: card }); })
      .catch((e) => toast('Infos konnten nicht geladen werden: ' + e.message, 'error'));
    return;
  }
  if (a === 'west' && !S.overlay && focused?.ytItem) { showYtInfo(focused); return; }
  if (a === 'west' && !S.overlay && focused && (focused.item || focused.seerrItem)) { showInfo(focused); return; }
  if ((a === 'left' || a === 'right') && focused?.onAdjust && activeRoot().contains(focused)) {
    focused.onAdjust(a === 'right' ? 1 : -1);
    return;
  }
  switch (a) {
    case 'up': case 'down': case 'left': case 'right': move(a); break;
    case 'select': if (focused && Date.now() >= selectLockUntil) focused.dispatchEvent(new CustomEvent('cdselect')); break;
    case 'back': if (S.overlay) closeOverlay(); else if (!pop()) backAtRoot(); break;
    case 'menu': if (S.overlay) closeOverlay(); else if (S.auth.loggedIn) openMenu(); break;
    case 'home':
      // Xbox-/Home-Taste: zur Startseite des Bereichs; dort nochmal = Menü
      if (S.overlay) closeOverlay();
      else if (S.auth.loggedIn && (S.stack.length > 1 || !atTop())) goSectionHome();
      else if (S.auth.loggedIn) openMenu();
      break;
    case 'lt': case 'rt': {
      // Trigger: schnell springen – in Reihen 6 Kacheln, in Rastern 3 Zeilen
      const dir = a === 'rt' ? 1 : -1;
      const r = focused?.closest('.row-items');
      if (r) { const cards = [...r.children]; const i = cards.indexOf(focused); setFocus(cards[Math.max(0, Math.min(cards.length - 1, i + dir * 6))]); break; }
      if (focused?.closest('.grid')) { for (let k = 0; k < 3; k++) move(dir > 0 ? 'down' : 'up'); }
      break;
    }
    default: break;
  }
}

cd.on('input', handleAction);

const KEYMAP = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  Enter: 'select', Escape: 'back', BrowserBack: 'back', ContextMenu: 'menu', F1: 'menu', Home: 'home',
  PageUp: 'lb', PageDown: 'rb',
};
// Lautstärketasten / USB-Drehregler: Systemlautstärke (dieselbe wie Menü und Controller)
const VOLUME_KEYS = { AudioVolumeUp: 2, AudioVolumeDown: -2 };
let volToastTimer = null;
async function volumeKey(e) {
  e.preventDefault();
  const v = e.key === 'AudioVolumeMute' ? await cd.call('sys:toggleMute') : await cd.call('sys:changeVolume', VOLUME_KEYS[e.key]);
  document.querySelectorAll('.setting.volume').forEach((n) => n.showVolume?.(v));
  clearTimeout(volToastTimer);
  volToastTimer = setTimeout(() => toast(v.mute ? 'Stumm' : `Lautstärke ${v.volume} %`), 150);
}

document.addEventListener('keydown', (e) => {
  if (noteActivity()) { e.preventDefault(); return; }
  if (e.key in VOLUME_KEYS || e.key === 'AudioVolumeMute') { volumeKey(e).catch(() => {}); return; }
  const scr = S.stack.at(-1);
  if (scr?.keyboard && !S.overlay) {
    if (e.key === 'Backspace') { scr.keyboard.backspace(); e.preventDefault(); return; }
    if (e.key.length === 1 && !e.ctrlKey && !e.altKey) { scr.keyboard.type(e.key); e.preventDefault(); return; }
  }
  if (e.key === 'Backspace') { handleAction('back'); e.preventDefault(); return; }
  const a = KEYMAP[e.key];
  if (a) { e.preventDefault(); handleAction(a); }
});
// Maus (z. B. beim Entwickeln) funktioniert ebenfalls
document.addEventListener('contextmenu', (e) => { e.preventDefault(); handleAction('back'); });
document.addEventListener('mousemove', () => { document.body.classList.add('mouse'); noteActivity(); });
document.getElementById('overlay').addEventListener('click', (e) => {
  if (e.target.id === 'overlay') closeOverlay();
});
document.addEventListener('click', (e) => {
  const f = e.target.closest('.focusable');
  if (f && activeRoot().contains(f)) { setFocus(f, { scroll: false }); f.dispatchEvent(new CustomEvent('cdselect')); }
});

// ---------- Ereignisse aus dem Hauptprozess ----------

cd.on('toast', ({ text, kind }) => toast(text, kind));
cd.on('youtube-bot-check', (p) => (typeof p === 'object' && p ? showYouTubeLink(p.id, true, p.signedIn) : showYouTubeLink(p, true)));
cd.on('youtube-login', (p) => ytLoginEvent(p));
cd.on('auth', (a) => {
  const was = S.auth.loggedIn;
  S.auth = a;
  if (a.loggedIn && !was) { toast(`Angemeldet als ${a.userName}`); closeOverlay(); resetAllSections(); S.section = 'kino'; markSection(); bar.el.hidden = false; replaceRoot(homeScreen()); }
  if (!a.loggedIn && was) { closeOverlay(); resetAllSections(); bar.el.hidden = true; void updateMediaFree(); replaceRoot(loginScreen()); }
});
cd.on('player-state', (p) => { S.player = p; drawMini(p); if (p.active) stopSaver(); else resetIdle(); });
cd.on('volume', (v) => { document.querySelectorAll('.setting.volume').forEach((n) => n.showVolume?.(v)); });
let refreshTimer = null;
cd.on('refresh', () => {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => { if (!S.overlay) S.stack.at(-1)?.refresh?.(); }, 800);
});

function tickClock() {
  const d = new Date();
  $('#clock').textContent = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

// Lebenszeichen für die Selbstheilung: Herzschlag + Alter des letzten gezeichneten Bildes
let lastRaf = performance.now();
(function rafLoop() { lastRaf = performance.now(); requestAnimationFrame(rafLoop); }());
setInterval(() => { cd.call('app:heartbeat', { rafAge: Math.round(performance.now() - lastRaf) }).catch(() => {}); }, 5000);

(async function init() {
  tickClock(); setInterval(tickClock, 10000);
  setInterval(updateMediaFree, 60000);
  const st = await cd.call('app:state');
  S.auth = st.auth;
  S.settings = st.settings;
  buildSectionBar();
  S.section = 'kino';
  markSection();
  bar.el.hidden = !st.auth.loggedIn;
  resetIdle();
  S.imgBase = await cd.call('jf:imageBase');
  replaceRoot(st.auth.loggedIn ? homeScreen() : loginScreen());
  setTimeout(() => document.getElementById('splash')?.classList.add('gone'), 600);
  setTimeout(() => document.getElementById('splash')?.remove(), 1500);
}());
