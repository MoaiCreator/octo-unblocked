// texhook.js - HD textures for OpenStrike without touching the game's code.
//
// The game generates its textures in code and uploads them with gl.texImage2D. This hook recognises each one
// by a fingerprint of its pixels and uploads a better texture from textures/ instead, then turns on mipmaps and
// anisotropic filtering for it (that stops the shimmering/flicker on distant walls and floors).
// Load order: this file, then boot.js calls OSTex.load() before starting the game.
(function () {
  'use strict';
  var replacements = {};      // fingerprint -> { w, h, data: Uint8Array }
  var replaced = new WeakSet(), bound = new WeakMap(), log = [];
  window.OSTex = { replacements: replacements, log: log, enabled: true };

  function fingerprint(w, h, px) {               // FNV-1a over ~4k evenly spaced bytes + size
    var hsh = 2166136261 ^ w ^ (h << 16), n = px.length, step = Math.max(1, Math.floor(n / 4093));
    for (var i = 0; i < n; i += step) { hsh ^= px[i]; hsh = Math.imul(hsh, 16777619); }
    return (hsh >>> 0).toString(16) + '_' + w + 'x' + h;
  }
  function hook(proto) {
    if (!proto) return;
    var texImage2D = proto.texImage2D, texParameteri = proto.texParameteri, bindTexture = proto.bindTexture, generateMipmap = proto.generateMipmap;
    proto.bindTexture = function (target, tex) { bound.set(this, tex); return bindTexture.call(this, target, tex); };
    proto.texImage2D = function (target, level, ifmt, w, h, border, fmt, type, px) {
      if (level > 0) { var bt = bound.get(this); if (bt && replaced.has(bt)) return; }   // we made our own mipmaps
      if (arguments.length === 9 && level === 0 && target === this.TEXTURE_2D && fmt === this.RGBA && type === this.UNSIGNED_BYTE && px && px.length >= w * h * 4 && window.OSTex.enabled) {
        var fp = fingerprint(w, h, px), r = replacements[fp];
        log.push(fp);
        if (r) {
          texImage2D.call(this, target, 0, this.RGBA, r.w, r.h, 0, this.RGBA, this.UNSIGNED_BYTE, r.data);
          var t = bound.get(this); if (t) replaced.add(t);
          generateMipmap.call(this, target);
          texParameteri.call(this, target, this.TEXTURE_MIN_FILTER, this.LINEAR_MIPMAP_LINEAR);
          texParameteri.call(this, target, this.TEXTURE_MAG_FILTER, this.LINEAR);
          var an = this.getExtension('EXT_texture_filter_anisotropic') || this.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
          if (an) this.texParameterf(target, an.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, this.getParameter(an.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
          return;
        }
      }
      return texImage2D.apply(this, arguments);
    };
    // the game sets its own (lower quality) filters after uploading; keep ours on replaced textures
    proto.texParameteri = function (target, pname, value) {
      var t = bound.get(this);
      if (t && replaced.has(t) && (pname === this.TEXTURE_MIN_FILTER || pname === this.TEXTURE_MAG_FILTER)) return;
      return texParameteri.call(this, target, pname, value);
    };
  }
  hook(window.WebGLRenderingContext && WebGLRenderingContext.prototype);
  hook(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype);

  // Load textures/manifest.json ({ fingerprint: "file.jpg" }) and decode every image to RGBA pixels.
  window.OSTex.load = function (base) {
    base = base || 'textures/';
    return fetch(base + 'manifest.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error('no texture pack'); return r.json(); })
      .then(function (man) {
        return Promise.all(Object.keys(man.textures).map(function (fp) {
          return fetch(base + man.textures[fp], { cache: 'force-cache' }).then(function (r) { return r.blob(); })
            .then(function (b) { return createImageBitmap(b); })
            .then(function (img) {
              var c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
              var g = c.getContext('2d'); g.drawImage(img, 0, 0);
              replacements[fp] = { w: img.width, h: img.height, data: new Uint8Array(g.getImageData(0, 0, img.width, img.height).data.buffer) };
            }).catch(function (e) { console.warn('[textures] ' + man.textures[fp] + ' failed', e); });
        }));
      }).then(function () { console.info('[textures] HD pack ready: ' + Object.keys(replacements).length + ' textures'); })
      .catch(function (e) { console.info('[textures] using the game\'s own textures (' + e.message + ')'); });
  };
})();
