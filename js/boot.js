// boot.js - starts OpenStrike.
//
// openstrike.wasm already contains the published edits (guns, skins, built-in maps): the admin page writes
// them into the file when it publishes (js/bake.js). This loader only:
//   - puts published *new* maps into the game's custom map slots (the game keeps those in localStorage)
//   - downloads the wasm with a progress bar and hands it to openstrike.js
// URL flags:  ?draft=1    play the admin's unpublished draft (baked in this browser from the original file)
//             ?vanilla=1  play the original game with no edits
(function () {
  'use strict';
  var params = new URLSearchParams(location.search);
  var status = function (t) { var el = document.getElementById('status'); if (el) el.textContent = t; };
  var MAPS_KEY = 'openstrike.maps', PUB_KEY = 'openstrike.publishedSlots', DRAFT_KEY = 'openstrike.adminDraft';

  function getJSON(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(r.status + ' ' + url); return r.json(); });
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

  // ------------------------------------------------------------ download the wasm with progress
  function fetchWasm(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url + ': ' + r.status);
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

  function start(buf, mods) {
    if (mods) mergeCustomMaps(mods);
    Module.wasmBinary = buf;
    status('Starting...');
    var s = document.createElement('script'); s.src = 'openstrike.js'; document.body.appendChild(s);
  }
  function fail(e) { status('Could not load the game: ' + e.message); console.error(e); }

  status('Loading...');
  var draft = null;
  if (params.get('draft') === '1') { try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { } }
  if (params.get('vanilla') === '1') {
    fetchWasm('data/openstrike.original.wasm').then(function (buf) { start(buf, null); }).catch(fail);
  } else if (draft) {
    // build the draft exactly the way publishing will
    Promise.all([fetchWasm('data/openstrike.original.wasm'), getJSON('data/defaults.json'), import('./bake.js')]).then(function (r) {
      var out = r[2].bake(r[0], draft, r[1]);
      console.info('[mods] playing the admin draft', out.stats);
      start(out.wasm.buffer, draft);
    }).catch(fail);
  } else {
    Promise.all([fetchWasm('openstrike.wasm'), getJSON('data/mods.json').catch(function () { return null; })])
      .then(function (r) { start(r[0], r[1]); }).catch(fail);
  }
})();
