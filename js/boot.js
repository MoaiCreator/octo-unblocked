// boot.js - loads OpenStrike and applies the admin's mods (data/mods.json) before the game starts.
//
// Order:  fetch mods + defaults -> merge published custom maps into the game's map storage ->
//         download openstrike.wasm -> start openstrike.js -> after the runtime initialises but before
//         main() runs, write the edited guns / skins / built-in maps straight into the game's memory.
// Nothing in openstrike.wasm is modified on disk. If anything looks wrong the game starts unmodded.
(function () {
  'use strict';
  var params = new URLSearchParams(location.search);
  var status = function (t) { var el = document.getElementById('status'); if (el) el.textContent = t; };
  var MAPS_KEY = 'openstrike.maps', PUB_KEY = 'openstrike.publishedSlots', DRAFT_KEY = 'openstrike.adminDraft';

  function getJSON(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(r.status + ' ' + url); return r.json(); });
  }
  function loadMods() {
    if (params.get('vanilla') === '1') return Promise.resolve(null);
    if (params.get('draft') === '1') {
      try { var d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); if (d) { console.info('[mods] using the admin draft from this browser'); return Promise.resolve(d); } } catch (e) { }
    }
    return getJSON('data/mods.json').catch(function () { return null; });
  }

  // ------------------------------------------------------------ custom map slots ("slot N" + 40 rows)
  function parseSlots(text) {
    var out = {}, cur = null;
    (text || '').split(/\r?\n/).forEach(function (line) {
      var m = /^slot (\d+)$/.exec(line);
      if (m) { cur = +m[1]; out[cur] = []; } else if (cur !== null && line.length) out[cur].push(line);
    });
    return out;
  }
  function writeSlots(slots) {
    return Object.keys(slots).map(Number).sort(function (a, b) { return a - b; })
      .map(function (k) { return 'slot ' + k + '\n' + slots[k].join('\n') + '\n'; }).join('');
  }
  function hash(rows) { var s = rows.join('\n'), h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }
  function validRows(rows) { return Array.isArray(rows) && rows.length === 40 && rows.every(function (r) { return typeof r === 'string' && r.length === 48; }); }

  // Published maps go into the player's custom slots, unless the player has edited that slot themselves.
  function mergeCustomMaps(mods) {
    try {
      var slots = parseSlots(localStorage.getItem(MAPS_KEY)), pub = JSON.parse(localStorage.getItem(PUB_KEY) || '{}'), next = {};
      var wanted = {}; ((mods && mods.maps && mods.maps.custom) || []).forEach(function (m) { if (m.slot >= 0 && m.slot <= 2 && validRows(m.rows)) wanted[m.slot] = m.rows; });
      for (var s = 0; s <= 2; s++) {
        var mine = slots[s], ours = mine && pub[s] && hash(mine) === pub[s];       // slot still holds what we put there
        if (wanted[s]) {
          if (!mine || ours) { slots[s] = wanted[s]; next[s] = hash(wanted[s]); }
          else console.info('[mods] custom slot ' + (s + 1) + ' has your own map, keeping it');
        } else if (ours) delete slots[s];                                        // map was unpublished
      }
      localStorage.setItem(MAPS_KEY, writeSlots(slots)); localStorage.setItem(PUB_KEY, JSON.stringify(next));
    } catch (e) { console.warn('[mods] could not merge custom maps', e); }
  }

  // ------------------------------------------------------------ memory patching
  function patchMemory(mods, defs) {
    var malloc = window._malloc;
    if (!window.HEAPU8 || typeof malloc !== 'function') { console.warn('[mods] runtime not reachable, starting unmodded'); return; }
    // fresh views every time: malloc can grow memory, which replaces the underlying buffer
    var HU = function () { return window.HEAPU8; }, DV = function () { return new DataView(window.HEAPU8.buffer); }, L = defs.layout;
    var u32 = function (a) { return DV().getUint32(a, true); };
    var setPtr = function (a, v) { DV().setUint32(a, v, true); };
    var readStr = function (a) { var H = HU(), s = ''; for (var i = a; H[i] && i < a + 200; i++) s += String.fromCharCode(H[i]); return s; };
    var newStr = function (s) {
      s = String(s).replace(/[^\x20-\x7e]/g, '').slice(0, 31);
      var p = malloc(s.length + 1), h = HU(); for (var i = 0; i < s.length; i++) h[p + i] = s.charCodeAt(i); h[p + s.length] = 0; return p;
    };
    // refuse to touch a different build
    var sig = defs.signature, wl = L.weapons, sl = L.skins;
    var ok = readStr(u32(wl.addr)) === sig.weapon0 && readStr(u32(wl.addr + 17 * wl.stride)) === sig.weapon17 &&
             readStr(u32(sl.addr)) === sig.skin0 && readStr(u32(L.mapNames.addr)) === sig.map0;
    if (!ok) { console.warn('[mods] openstrike.wasm does not match data/defaults.json - run tools/extract_defaults.py. Starting unmodded.'); return; }
    var n = 0;
    var put = function (a, type, v) {
      v = Number(v); if (!isFinite(v)) return;
      if (type === 'u8') HU()[a] = Math.max(0, Math.min(255, Math.round(v)));
      else if (type === 'i32') DV().setInt32(a, Math.round(v), true);
      else if (type === 'f32') DV().setFloat32(a, v, true);
    };
    var setColor = function (a, hex) { var m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return; var x = parseInt(m[1], 16), H = HU(); H[a] = x >> 16; H[a + 1] = (x >> 8) & 255; H[a + 2] = x & 255; H[a + 3] = 255; };

    (mods.weapons || []).forEach(function (w) {
      if (!(w.index >= 0 && w.index < wl.count)) return;
      var base = wl.addr + w.index * wl.stride, d = defs.weapons[w.index];
      defs.weaponFields.forEach(function (f) {
        if (!(f.key in w) || w[f.key] === d[f.key] || f.key === 'category' || f.key === 'slot') return;
        if (f.type === 'str') { var sp = newStr(w[f.key]); setPtr(base + f.offset, sp); } else put(base + f.offset, f.type, w[f.key]);
      });
      n++;
    });
    (mods.skins || []).forEach(function (s) {
      if (!(s.index >= 0 && s.index < sl.count)) return;
      var base = sl.addr + s.index * sl.stride, d = defs.skins[s.index];
      if (s.name && s.name !== d.name) { var np = newStr(s.name); setPtr(base, np); }
      if ('rarity' in s) put(base + 4, 'u8', Math.max(0, Math.min(4, s.rarity)));
      if ('pattern' in s) put(base + 5, 'u8', s.pattern);
      (s.colors || []).forEach(function (c, i) { if (i < 3) setColor(base + 6 + 4 * i, c); });
      n++;
    });
    var ml = L.mapRows;
    ((mods.maps && mods.maps.builtin) || []).forEach(function (m) {
      if (!(m.index >= 0 && m.index < ml.count)) return;
      if (m.name && m.name !== defs.maps[m.index].name) { var mp = newStr(m.name); setPtr(L.mapNames.addr + 4 * m.index, mp); }
      if (validRows(m.rows)) {
        var block = malloc(40 * 49), h = HU();
        m.rows.forEach(function (row, r) {
          var p = block + r * 49; for (var i = 0; i < 48; i++) h[p + i] = row.charCodeAt(i); h[p + 48] = 0;
          setPtr(ml.addr + 4 * (m.index * 40 + r), p);
        });
      }
      n++;
    });
    console.info('[mods] applied ' + n + ' edits' + (mods.version ? ' (mods v' + mods.version + ')' : ''));
  }

  // ------------------------------------------------------------ download the wasm with progress
  function fetchWasm() {
    return fetch('openstrike.wasm').then(function (r) {
      if (!r.ok) throw new Error('openstrike.wasm: ' + r.status);
      var total = +r.headers.get('content-length') || 0;
      if (!r.body || !total) return r.arrayBuffer();
      var reader = r.body.getReader(), got = 0, parts = [];
      return (function pump() {
        return reader.read().then(function (x) {
          if (x.done) { var out = new Uint8Array(got), o = 0; parts.forEach(function (p) { out.set(p, o); o += p.length; }); return out.buffer; }
          parts.push(x.value); got += x.value.length; status('Downloading game... ' + Math.round(got / total * 100) + '%'); return pump();
        });
      })();
    });
  }

  status('Loading...');
  Promise.all([loadMods(), fetchWasm()]).then(function (res) {
    var mods = res[0];
    var go = function (defs) {
      if (mods) mergeCustomMaps(mods);
      Module.wasmBinary = res[1];
      if (mods && defs) {
        var orig = Module.onRuntimeInitialized;
        Module.onRuntimeInitialized = function () { try { patchMemory(mods, defs); } catch (e) { console.warn('[mods] patch failed', e); } if (orig) orig.apply(this, arguments); };
      }
      window.__modsLoaded = !!mods;
      status('Starting...');
      var s = document.createElement('script'); s.src = 'openstrike.js'; document.body.appendChild(s);
    };
    if (mods) getJSON('data/defaults.json').then(go, function () { console.warn('[mods] data/defaults.json missing'); go(null); });
    else go(null);
  }).catch(function (e) { status('Could not load the game: ' + e.message); console.error(e); });
})();
