-- Couchdeck: schlanke Bedienleiste + Menü für mpv (ersetzt die Standard-OSC).
-- Maus, Tastatur und Controller (über Couchdeck) bedienen dieselben Elemente.
--
-- Nachrichten von Couchdeck (script-message-to couchdeck_osc ...):
--   input <aktion>          Eingabe vom Controller/Tastatur (up/down/left/right/select/back/menu/...)
--   volume <prozent> <yes|no>  aktuelle Systemlautstärke / stumm
--   sinks <json>            Audioausgänge [{name, description, active}]
--   skip <label>|clear      "Intro überspringen"-Knopf zeigen/ausblenden
--   show                    Leiste kurz einblenden
-- Nachrichten an Couchdeck (script-message couchdeck ...):
--   pad <aktion>, volume-step <n>, toggle-mute, set-sink <name>, set-audio <id>,
--   set-sub <id|no>, stop, select, menu-open

local mp = require 'mp'
local utils = require 'mp.utils'

local ov = mp.create_osd_overlay('ass-events')
local S = {
  visible_until = 0,
  menu = false,
  idx = 1,
  volume = nil,
  mute = false,
  sinks = {},
  skip = nil,
  upnext = nil,      -- { secs, title }
  night = false,
  balance = 0,          -- Sprache ↔ Rest (dB)
  sleep = 'Aus',
  aspect = 1,
  hits = {},
  items = {},
}

-- Farben je Bereich (ASS-Farben sind BGR: &HBBGGRR&), passend zum Theme in style.css
local THEMES = {
  kino  = { accent = '&HFFA46F&', panel = '&H3E1A10&', dark = '&H30120A&' },  -- #6FA4FF · #101A3E · #0A1230
  yt    = { accent = '&H5E4DFF&', panel = '&H220C2E&', dark = '&H1C0A22&' },  -- #FF4D5E · #2E0C22 · #220A1C
  music = { accent = '&H8FE03E&', panel = '&H2A3008&', dark = '&H1E1F06&' },  -- #3EE08F · #08302A · #061F1E
}
local ACCENT = THEMES.kino.accent
local PANEL = THEMES.kino.panel
local DARK = THEMES.kino.dark   -- Schrift/Symbole auf Akzentflächen
local WHITE = '&HFFFFFF&'
local MUTED = '&HD8CCC4&'

-- Nur zum Testen: --script-opts=couchdeck_osc-dump=/pfad/datei.ass schreibt jede Ausgabe als ASS-Datei
local opts = { dump = '' }
require('mp.options').read_options(opts, 'couchdeck_osc')

local function send(...) mp.commandv('script-message', 'couchdeck', ...) end

local function esc(s)
  s = tostring(s or '')
  return (s:gsub('\\', '\\\\'):gsub('{', '\\{'):gsub('}', '\\}'):gsub('\n', ' '))
end

local function fmt_time(t)
  if not t or t < 0 then return '--:--' end
  t = math.floor(t)
  local h, m, s = math.floor(t / 3600), math.floor(t % 3600 / 60), t % 60
  if h > 0 then return string.format('%d:%02d:%02d', h, m, s) end
  return string.format('%d:%02d', m, s)
end

-- Pfad eines Rechtecks mit runden Ecken (ASS-Zeichnung, Bézier-Ecken)
local function rpath(w, h, r)
  w, h = math.floor(w + 0.5), math.floor(h + 0.5)
  r = math.max(0, math.min(math.floor((r or 0) + 0.5), math.floor(math.min(w, h) / 2)))
  if r == 0 then return string.format('m 0 0 l %d 0 %d %d 0 %d', w, w, h, h) end
  local c = math.floor(r * 0.448 + 0.5)
  return string.format('m %d 0 l %d 0 b %d 0 %d %d %d %d l %d %d b %d %d %d %d %d %d l %d %d b %d %d 0 %d 0 %d l 0 %d b 0 %d %d 0 %d 0',
    r, w - r, w - c, w, c, w, r, w, h - r, w, h - c, w - c, h, w - r, h, r, h, c, h, h - c, h - r, r, c, c, r)
end

-- Fläche zeichnen: Pfad an Position, Füllfarbe/-deckung, optional feine Kontur
local function shape(x, y, path, color, alpha, bord, bcolor, balpha)
  return string.format('{\\an7\\pos(%d,%d)\\bord%s\\shad0\\1c%s\\1a&H%s&\\3c%s\\3a&H%s&\\p1}%s{\\p0}',
    math.floor(x + 0.5), math.floor(y + 0.5), bord or 0, color, alpha or '00', bcolor or '&HFFFFFF&', balpha or 'FF', path)
end

local function rect(x, y, w, h, color, alpha, r)
  return shape(x, y, rpath(w, h, r or 0), color, alpha)
end

local function text(x, y, str, size, color, align, bold)
  return string.format('{\\an%d\\pos(%d,%d)\\fs%d\\bord0\\shad1\\4c&H000000&\\4a&HA0&\\1c%s\\1a&H00&\\b%d\\fnNoto Sans}%s',
    align or 7, math.floor(x + 0.5), math.floor(y + 0.5), size, color or WHITE, bold and 1 or 0, str)
end

local function hit(x1, y1, x2, y2, fn) table.insert(S.hits, { x1, y1, x2, y2, fn }) end

local function show(secs)
  S.visible_until = mp.get_time() + (secs or 3)
end

local function bar_visible()
  return S.menu or mp.get_property_native('pause') or mp.get_time() < S.visible_until
end

-- ---------- Menü ----------

local function build_items()
  local items = {}
  local function head(label) table.insert(items, { head = true, label = label }) end
  local function item(label, fn, opts)
    opts = opts or {}
    table.insert(items, { label = label, fn = fn, active = opts.active, adjust = opts.adjust, right = opts.right })
  end

  item('Lautstärke', function() send('toggle-mute') end, {
    adjust = function(d) send('volume-step', tostring(d * 5)) end,
    right = S.volume and (S.mute and 'stumm' or (S.volume .. ' %')) or '…',
  })

  if #S.sinks > 0 then
    head('Audioausgang')
    for _, s in ipairs(S.sinks) do
      item(s.description, function() send('set-sink', s.name) end, { active = s.active })
      items[#items].sink = true
    end
  end

  local tracks = mp.get_property_native('track-list') or {}
  local audio, subs = {}, {}
  for _, t in ipairs(tracks) do
    if t.type == 'audio' then table.insert(audio, t) elseif t.type == 'sub' then table.insert(subs, t) end
  end
  local function tname(t)
    local parts = {}
    if t.title then table.insert(parts, t.title) end
    if t.lang then table.insert(parts, t.lang:upper()) end
    if #parts == 0 then table.insert(parts, 'Spur ' .. t.id) end
    return table.concat(parts, ' · ')
  end
  if #audio > 1 then
    head('Tonspur')
    for _, t in ipairs(audio) do
      item(tname(t), function() send('set-audio', tostring(t.id)) end, { active = t.selected })
    end
  end
  head('Untertitel')
  local any_sub = false
  for _, t in ipairs(subs) do if t.selected then any_sub = true end end
  item('Aus', function() send('set-sub', 'no') end, { active = not any_sub })
  for _, t in ipairs(subs) do
    item(tname(t), function() send('set-sub', tostring(t.id)) end, { active = t.selected })
  end

  head('Wiedergabe')
  item('Nachtmodus', function() send('toggle-night') end, { right = S.night and 'An' or 'Aus', active = S.night })
  item('Sprache ↔ Rest', function() end, {
    adjust = function(d) send('balance-step', tostring(d)) end,
    right = (S.balance and S.balance > 0) and ('+' .. S.balance .. ' dB') or 'Original',
  })
  local delay = mp.get_property_number('audio-delay', 0)
  item('Ton-Versatz', function() end, {
    adjust = function(d) send('delay-step', tostring(d * 0.05)) end,
    right = string.format('%+.2f s', delay),
  })
  item('Schlaf-Timer', function() send('sleep-cycle') end, { right = S.sleep })
  local ASPECTS = { 'Original', 'Zoom (füllen)', 'Gestreckt' }
  item('Bildformat', function()
    S.aspect = S.aspect % #ASPECTS + 1
    if S.aspect == 1 then mp.set_property('panscan', '0'); mp.set_property('keepaspect', 'yes')
    elseif S.aspect == 2 then mp.set_property('panscan', '1'); mp.set_property('keepaspect', 'yes')
    else mp.set_property('panscan', '0'); mp.set_property('keepaspect', 'no') end
  end, { right = ASPECTS[S.aspect] })
  item('Technische Infos', function() mp.commandv('script-binding', 'stats/display-stats-toggle') end)

  local chapters = mp.get_property_native('chapter-list') or {}
  if #chapters > 1 then
    head('Kapitel')
    local cur = mp.get_property_number('chapter', -1)
    for i, c in ipairs(chapters) do
      local label = string.format('%s  %s', fmt_time(c.time), (c.title and c.title ~= '') and c.title or ('Kapitel ' .. i))
      item(label, function() mp.set_property_number('chapter', i - 1) end, { active = (i - 1 == cur) })
    end
  end

  head('')
  item('Wiedergabe beenden', function() send('stop') end)
  return items
end

local function selectable(i) return S.items[i] and not S.items[i].head end

local function move(d)
  local i = S.idx
  repeat i = i + d until i < 1 or i > #S.items or selectable(i)
  if i >= 1 and i <= #S.items then S.idx = i end
end

local function open_menu()
  S.menu = true
  S.items = build_items()
  S.idx = 0
  move(1)
  send('menu-open') -- Couchdeck schickt Lautstärke + Ausgänge
end

local function close_menu() S.menu = false; S.focus_outputs = false; show(2) end

-- Fokus auf den aktiven (sonst ersten) Audioausgang setzen
local function focus_outputs()
  local first
  for i, it in ipairs(S.items) do
    if it.sink then
      first = first or i
      if it.active then S.idx = i; return true end
    end
  end
  if first then S.idx = first; return true end
  return false
end

-- ---------- Zeichnen ----------

local render

local function draw()
  local dim = mp.get_property_native('osd-dimensions')
  if (not dim or dim.w == 0) and opts.dump ~= '' then dim = { w = 1920, h = 1080 } end
  if not dim or dim.w == 0 then return end
  local W, H = dim.w, dim.h
  local k = H / 1080
  local function p(v) return math.floor(v * k + 0.5) end
  S.hits = {}

  if not bar_visible() and not S.skip and not S.upnext then ov:remove(); return end

  local out = {}
  local function add(s) table.insert(out, s) end

  -- weicher Verlauf aus Streifen (ASS kennt keine Verläufe): dunkel am Rand, nach innen transparent
  local function fade(y, h, from_top, strongest)
    local n = 24
    for i = 0, n - 1 do
      -- Streifen mit ganzzahligen, lückenlosen Grenzen (keine Überlappung → keine Linien)
      local a0, a1 = math.floor(i * h / n), math.floor((i + 1) * h / n)
      local t = (i + 0.5) / n                       -- 0 = Rand, 1 = innen
      local a = strongest + (255 - strongest) * (t ^ 1.6)
      local yy = from_top and (y + a0) or (y + h - a1)
      add(rect(0, yy, W, a1 - a0, '&H000000&', string.format('%02X', math.min(255, math.floor(a)))))
    end
  end
  -- Glasknopf: dunkle Fläche im Bereichston mit feiner heller Kontur
  local function glass(x, y, w, h)
    add(shape(x, y, rpath(w, h, h / 2), PANEL, '40', math.max(1, p(1.5)), WHITE, 'B8'))
  end
  -- Tastensymbol wie in Couchdeck (farbiger Kreis mit Buchstabe)
  local function glyph(x, cy, label, color)
    local d = p(34)
    add(shape(x, cy - d / 2, rpath(d, d, d / 2), color, '00'))
    add(text(x + d / 2, cy, label, p(19), '&H120D0B&', 5, true))
    return x + d + p(10)
  end

  if bar_visible() then
    fade(0, p(190), true, 0x48)
    fade(H - p(340), p(340), false, 0x30)

    -- oben: Zurück, Titel, Uhrzeit
    local bd = p(58)
    glass(p(48), p(34), bd, bd)
    add(text(p(48) + bd / 2, p(34) + bd / 2 - p(3), '‹', p(44), WHITE, 5, true))
    hit(p(48), p(34), p(48) + bd, p(34) + bd, function() send('stop') end)
    local title = mp.get_property('force-media-title') or mp.get_property('media-title') or ''
    add(text(p(128), p(63), esc(title), p(34), WHITE, 4, true))
    add(text(W - p(56), p(63), os.date('%H:%M'), p(32), WHITE, 6, false))

    -- Zeitleiste
    local pos = mp.get_property_number('time-pos', 0) or 0
    -- YouTube mit gekürzter Playlist: mpv kennt nur die Restdauer – Couchdeck schickt die volle
    local dur = S.dur or mp.get_property_number('duration', 0) or 0
    local sx, sw = p(56), W - p(112)
    local th = p(8)
    local sy = H - p(176)
    add(rect(sx, sy, sw, th, WHITE, 'B0', th / 2))
    if dur > 0 then
      local fw = math.max(th, math.floor(sw * math.min(1, math.max(0, pos / dur))))
      add(rect(sx, sy, fw, th, ACCENT, '00', th / 2))
      local kd = p(24)
      add(shape(sx + fw - kd / 2, sy + th / 2 - kd / 2, rpath(kd, kd, kd / 2), WHITE, '00'))
    end
    hit(sx, sy - p(22), sx + sw, sy + th + p(22), function(mx)
      if dur > 0 then send('seek-abs', tostring(math.floor((mx - sx) / sw * dur))) end
    end)
    add(text(sx, sy + p(42), fmt_time(pos), p(27), WHITE, 4, true))
    if dur > 0 then
      local ende = os.date('%H:%M', os.time() + math.floor(dur - pos))
      add(text(sx + sw, sy + p(42), 'endet ' .. ende .. '   ·   ' .. fmt_time(dur), p(27), MUTED, 6, false))
    end

    -- Bedienzeile
    local cy = H - p(74)
    local paused = mp.get_property_native('pause')

    -- Mitte: −10 · Pause/Weiter · +30
    local pd = p(84)
    local px = W / 2 - pd / 2
    add(shape(px, cy - pd / 2, rpath(pd, pd, pd / 2), ACCENT, '00'))
    local ic = p(30)
    if paused then
      add(shape(px + pd / 2 - ic * 0.38, cy - ic / 2, string.format('m 0 0 l %d %d 0 %d', math.floor(ic * 0.9), math.floor(ic / 2), ic), DARK, '00'))
    else
      local bw = math.floor(ic * 0.3)
      add(shape(px + pd / 2 - ic / 2 + p(2), cy - ic / 2, rpath(bw, ic, p(3)), DARK, '00'))
      add(shape(px + pd / 2 + ic / 2 - bw - p(2), cy - ic / 2, rpath(bw, ic, p(3)), DARK, '00'))
    end
    hit(px, cy - pd / 2, px + pd, cy + pd / 2, function() mp.commandv('cycle', 'pause') end)
    local sd = p(62)
    local bx = px - p(30) - sd
    glass(bx, cy - sd / 2, sd, sd)
    add(text(bx + sd / 2, cy, '−10', p(22), WHITE, 5, true))
    hit(bx, cy - sd / 2, bx + sd, cy + sd / 2, function() send('seek-rel', '-10') end)
    local fx = px + pd + p(30)
    glass(fx, cy - sd / 2, sd, sd)
    add(text(fx + sd / 2, cy, '+30', p(22), WHITE, 5, true))
    hit(fx, cy - sd / 2, fx + sd, cy + sd / 2, function() send('seek-rel', '30') end)

    -- rechts: Lautstärke, Menü
    local bh = p(60)
    local mw = p(170)
    local mx = W - p(56) - mw
    glass(mx, cy - bh / 2, mw, bh)
    add(text(mx + mw / 2, cy, '☰  Menü', p(26), WHITE, 5, true))
    hit(mx, cy - bh / 2, mx + mw, cy + bh / 2, function() if S.menu then close_menu() else open_menu() end end)
    local vw = p(270)
    local vx = mx - p(20) - vw
    glass(vx, cy - bh / 2, vw, bh)
    local vt = S.volume and (S.mute and 'stumm' or (S.volume .. ' %')) or '–'
    add(text(vx + p(36), cy, '−', p(34), WHITE, 5, true))
    add(text(vx + vw / 2, cy, '♪  ' .. vt, p(26), WHITE, 5, false))
    add(text(vx + vw - p(36), cy, '+', p(34), WHITE, 5, true))
    hit(vx, cy - bh / 2, vx + p(72), cy + bh / 2, function() send('volume-step', '-5') end)
    hit(vx + p(72), cy - bh / 2, vx + vw - p(72), cy + bh / 2, function() send('toggle-mute') end)
    hit(vx + vw - p(72), cy - bh / 2, vx + vw, cy + bh / 2, function() send('volume-step', '5') end)

    -- links: nur die wichtigsten Tasten
    local hx = p(56)
    hx = glyph(hx, cy, 'A', '&H6BD35F&'); add(text(hx, cy, paused and 'Weiter' or 'Pause', p(24), WHITE, 4, false)); hx = hx + p(110)
    hx = glyph(hx, cy, 'B', '&H6B6BFF&'); add(text(hx, cy, 'Beenden', p(24), WHITE, 4, false)); hx = hx + p(122)
    hx = glyph(hx, cy, '☰', '&HD0D0D0&'); add(text(hx, cy, 'Ton, Untertitel …', p(24), WHITE, 4, false))
  end

  -- Intro/Abspann überspringen
  if S.skip then
    local sw, sh = p(380), p(66)
    local sx, sy = W - p(56) - sw, H - p(300)
    add(shape(sx, sy, rpath(sw, sh, sh / 2), ACCENT, '00'))
    add(text(sx + sw / 2, sy + sh / 2, esc(S.skip) .. ' überspringen  ›', p(27), DARK, 5, true))
    hit(sx, sy, sx + sw, sy + sh, function() send('select') end)
  end

  -- Countdown zur nächsten Folge
  if S.upnext then
    local bw, bh = p(600), p(132)
    local bx, by = W - p(56) - bw, H - p(370)
    add(shape(bx, by, rpath(bw, bh, p(20)), PANEL, '18', math.max(1, p(1.5)), WHITE, 'C8'))
    add(text(bx + p(30), by + p(40), 'Nächste Folge in ' .. S.upnext.secs .. ' s', p(30), WHITE, 4, true))
    if S.upnext.title ~= '' then add(text(bx + p(30), by + p(86), esc(S.upnext.title), p(24), MUTED, 4, false)) end
    local nw, nh = p(150), p(48)
    local nx = bx + bw - p(24) - nw
    add(shape(nx, by + p(16), rpath(nw, nh, nh / 2), ACCENT, '00'))
    add(text(nx + nw / 2, by + p(16) + nh / 2, 'Jetzt  ›', p(24), DARK, 5, true))
    hit(nx, by + p(16), nx + nw, by + p(16) + nh, function() send('upnext-now') end)
    add(text(nx + nw / 2, by + p(100), 'Abbrechen', p(22), MUTED, 5, false))
    hit(nx, by + p(72), nx + nw, by + p(124), function() send('upnext-cancel') end)
  end

  -- Menü rechts
  if S.menu then
    local mw = p(580)
    local mx = W - mw
    add(rect(0, 0, W, H, '&H000000&', '90'))
    add(rect(mx, 0, mw, H, PANEL, '00'))
    add(rect(mx, 0, mw, p(5), ACCENT, '00'))
    add(text(mx + p(36), p(48), 'Wiedergabe', p(40), WHITE, 7, true))
    add(text(W - p(36), p(62), '✕ Schließen', p(26), MUTED, 9, false))
    hit(W - p(220), p(40), W, p(100), close_menu)
    -- Positionen vorab berechnen und so verschieben, dass der markierte Eintrag sichtbar ist
    local top, bottom = p(130), H - p(40)
    local pos, y = {}, top
    for i, it in ipairs(S.items) do
      pos[i] = y
      y = y + (it.head and p(52) or (p(62) + p(8)))
    end
    local offset = 0
    local fy = pos[S.idx]
    if fy and fy + p(62) > bottom then offset = fy + p(62) - bottom end
    for i, it in ipairs(S.items) do
      local y = pos[i] - offset
      if y >= top - p(4) and y + p(62) <= bottom + p(4) then
        if it.head then
          if it.label ~= '' then add(text(mx + p(36), y + p(16), esc(it.label):upper(), p(21), MUTED, 7, true)) end
        else
          local ih = p(62)
          local rx, rw = mx + p(24), mw - p(48)
          local focused = (i == S.idx)
          local row_i = i
          hit(rx, y, rx + rw, y + ih, function() S.idx = row_i; it.fn() end) -- Zeile (Knöpfe liegen darüber)
          if focused then add(rect(rx, y, rw, ih, ACCENT, '00', p(14)))
          else add(rect(rx, y, rw, ih, WHITE, 'EE', p(14))) end
          local fg = focused and DARK or WHITE
          local label = esc(it.label)
          if it.active then add(text(rx + p(22), y + ih / 2, '●', p(20), focused and DARK or ACCENT, 4, true)) end
          add(text(rx + p(it.active and 50 or 24), y + ih / 2, label, p(28), fg, 4, focused or it.active))
          if it.adjust then
            -- feste Knöpfe: (−)  wert  (+)
            local bd = p(44)
            local pxb = rx + rw - p(12) - bd
            local mxb = pxb - p(130) - bd
            for _, bx in ipairs({ mxb, pxb }) do
              add(shape(bx, y + (ih - bd) / 2, rpath(bd, bd, bd / 2), focused and DARK or WHITE, focused and '70' or 'D8'))
            end
            add(text(mxb + bd / 2, y + ih / 2, '−', p(30), WHITE, 5, true))
            add(text(pxb + bd / 2, y + ih / 2, '+', p(30), WHITE, 5, true))
            add(text(mxb + bd + p(65), y + ih / 2, esc(it.right or ''), p(25), fg, 5, focused))
            local ii = i
            hit(pxb, y, pxb + bd, y + ih, function() S.idx = ii; it.adjust(1) end)
            hit(mxb, y, mxb + bd, y + ih, function() S.idx = ii; it.adjust(-1) end)
          elseif it.right then
            add(text(rx + rw - p(22), y + ih / 2, esc(it.right), p(25), focused and DARK or MUTED, 6, false))
          end
        end
      end
    end
    if offset > 0 then add(text(W - p(48), top - p(20), '▲', p(20), MUTED, 6, false)) end
    if y and (y - offset) > bottom then add(text(W - p(48), bottom + p(14), '▼', p(20), MUTED, 6, false)) end
  end

  ov.res_x, ov.res_y = W, H
  ov.data = table.concat(out, '\n')
  ov:update()

  if opts.dump ~= '' then
    local f = io.open(opts.dump, 'w')
    if f then
      f:write('[Script Info]\nScriptType: v4.00+\nPlayResX: ' .. W .. '\nPlayResY: ' .. H .. '\nScaledBorderAndShadow: yes\nWrapStyle: 2\n\n')
      f:write('[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n')
      f:write('Style: Default,Noto Sans,20,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1\n\n')
      f:write('[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n')
      for _, line in ipairs(out) do f:write('Dialogue: 0,0:00:00.00,0:01:00.00,Default,,0,0,0,,' .. line .. '\n') end
      f:close()
    end
  end
end

render = draw

-- ---------- Eingaben ----------

local function on_click()
  local mx, my = mp.get_mouse_pos()
  show(3)
  -- Treffer von oben nach unten (später gezeichnet = weiter oben)
  for i = #S.hits, 1, -1 do
    local h = S.hits[i]
    if mx >= h[1] and mx <= h[3] and my >= h[2] and my <= h[4] then
      h[5](mx, my)
      if S.menu then S.items = build_items() end
      render()
      return
    end
  end
  if S.menu then close_menu() else mp.commandv('cycle', 'pause') end
  render()
end

local function menu_input(a)
  local it = S.items[S.idx]
  if a == 'up' then move(-1)
  elseif a == 'down' then move(1)
  elseif (a == 'left' or a == 'right') and it and it.adjust then it.adjust(a == 'right' and 1 or -1)
  elseif a == 'select' and it then it.fn(); S.items = build_items()
  elseif a == 'back' or a == 'menu' or a == 'view' or a == 'home' then close_menu()
  else return false end
  return true
end

mp.register_script_message('input', function(a)
  show(3)
  if S.menu then
    -- im Menü navigiert der Stick wie das Kreuz
    local nav = a:gsub('^stick%-', '')
    if not menu_input(nav) then send('pad', a) end
  elseif a == 'menu' or a == 'view' then
    open_menu()
  else
    send('pad', a)
  end
  render()
end)

mp.register_script_message('open-outputs', function()
  if not S.menu then open_menu() end
  S.focus_outputs = true
  focus_outputs()
  render()
end)

mp.register_script_message('toggle-menu', function()
  if S.menu then close_menu() else open_menu() end
  render()
end)

mp.register_script_message('volume', function(v, mute)
  S.volume = tonumber(v)
  S.mute = (mute == 'yes')
  if S.menu then S.items = build_items() end
  show(2)
  render()
end)

mp.register_script_message('sinks', function(json)
  S.sinks = utils.parse_json(json) or {}
  if S.menu then
    S.items = build_items()
    if S.focus_outputs then focus_outputs(); S.focus_outputs = false
    elseif not selectable(S.idx) then S.idx = 0; move(1) end
  end
  render()
end)

mp.register_script_message('skip', function(label)
  if label == 'clear' or label == '' then S.skip = nil else S.skip = label end
  render()
end)

mp.register_script_message('show', function() show(3); render() end)
mp.register_script_message('duration', function(v)
  local d = tonumber(v)
  S.dur = (d and d > 0) and d or nil
  render()
end)

mp.register_script_message('upnext', function(secs, title)
  if secs == 'clear' then S.upnext = nil else S.upnext = { secs = secs, title = title or '' } end
  render()
end)

mp.register_script_message('night', function(v)
  S.night = (v == 'yes')
  if S.menu then S.items = build_items() end
  render()
end)

mp.register_script_message('balance', function(v)
  S.balance = tonumber(v) or 0
  if S.menu then S.items = build_items() end
  render()
end)

mp.register_script_message('theme', function(name)
  local t = THEMES[name] or THEMES.kino
  ACCENT, PANEL, DARK = t.accent, t.panel, t.dark
  render()
end)

mp.register_script_message('sleep', function(label)
  S.sleep = label or 'Aus'
  if S.menu then S.items = build_items() end
  render()
end)

mp.add_forced_key_binding('MBTN_LEFT', 'couchdeck_click', on_click)
mp.add_forced_key_binding('MBTN_LEFT_DBL', 'couchdeck_dbl', function() end)

mp.observe_property('mouse-pos', 'native', function(_, m)
  if m and m.hover then show(3); render() end
end)
mp.observe_property('pause', 'bool', function() render() end)
mp.observe_property('track-list', 'native', function()
  if S.menu then S.items = build_items() end
end)
mp.observe_property('osd-dimensions', 'native', function() render() end)

-- Neue Datei: Menü schließen, Leiste kurz zeigen
mp.register_event('file-loaded', function()
  S.menu = false; S.skip = nil; S.upnext = nil; S.aspect = 1
  mp.set_property('panscan', '0'); mp.set_property('keepaspect', 'yes')
  show(4); render()
end)
mp.register_event('end-file', function() S.menu = false; S.skip = nil; S.upnext = nil; ov:remove() end)
mp.observe_property('audio-delay', 'number', function() if S.menu then S.items = build_items(); render() end end)

mp.add_periodic_timer(0.25, function()
  if bar_visible() or S.skip or S.upnext then render() else ov:remove() end
end)
