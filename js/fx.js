// fx.js - graphics and feel upgrade for OpenStrike, done from outside the compiled game (no source needed).
//
//  1. Full resolution: the game renders at CSS pixels, so on phones/retina screens everything was upscaled and
//     blocky. The canvas gets a backing store of CSS size x scale; the game still sees CSS sizes (so its UI,
//     mouse and touch maths don't change) and its viewport/scissor calls are scaled up to match.
//  2. Better shader: the game draws everything with raylib's default shader (texture x colour). It's swapped for
//     one that adds surface relief from the textures and distance haze in 3D (2D UI is left untouched).
//  3. Weapon feel: the view model (drawn after a depth clear) gets CS2-style sway when you turn, bob and tilt
//     when you move, and a dip when you land. Stepping up onto a box no longer snaps the camera.
//  4. Post-processing before the HUD: bloom, filmic colour grading, sharpening, FXAA and a light vignette.
// URL flags: ?fx=0 turns all of this off, ?post=0 only the post-processing, ?res=1.5 sets the render scale.
(function () {
  'use strict';
  var params = new URLSearchParams(location.search);
  if (params.get('fx') === '0' || params.get('vanilla') === '1' && params.get('fx') !== '1') return;
  var touch = (navigator.maxTouchPoints || 0) > 0;
  var dpr = window.devicePixelRatio || 1;
  var SCALE = +params.get('res') || Math.min(dpr, touch ? 1.5 : 2);
  SCALE = Math.max(1, Math.min(3, SCALE));
  var POST = params.get('post') !== '0';
  var FX = window.OSFx = { scale: SCALE, post: POST, stats: { frames: 0, post: 0, vm: 0 }, cam: null, sway: [0, 0, 0, 0] };
  var isGame = function (gl) { return gl && gl.canvas && gl.canvas.id === 'canvas'; };

  // ------------------------------------------------------------------ 1. resolution
  var CP = HTMLCanvasElement.prototype, dW = Object.getOwnPropertyDescriptor(CP, 'width'), dH = Object.getOwnPropertyDescriptor(CP, 'height');
  var logical = new WeakMap();                      // canvas -> {w, h} as the game set them
  function lg(c) { var l = logical.get(c); if (!l) { l = { w: dW.get.call(c), h: dH.get.call(c) }; logical.set(c, l); } return l; }
  if (SCALE > 1) {
    Object.defineProperty(CP, 'width', { configurable: true, enumerable: true,
      get: function () { return this.id === 'canvas' ? lg(this).w : dW.get.call(this); },
      set: function (v) { if (this.id === 'canvas') { lg(this).w = v; v = Math.round(v * SCALE); } dW.set.call(this, v); } });
    Object.defineProperty(CP, 'height', { configurable: true, enumerable: true,
      get: function () { return this.id === 'canvas' ? lg(this).h : dH.get.call(this); },
      set: function (v) { if (this.id === 'canvas') { lg(this).h = v; v = Math.round(v * SCALE); } dH.set.call(this, v); } });
  }
  function ratio(gl) { var l = lg(gl.canvas); return l.w ? gl.drawingBufferWidth / l.w : 1; }

  // ------------------------------------------------------------------ shaders
  var VS = [
    '#version 100', 'precision highp float;',
    'attribute vec3 vertexPosition; attribute vec2 vertexTexCoord; attribute vec4 vertexColor;',
    'varying vec2 fragTexCoord; varying vec4 fragColor; varying float fxDepth; varying float fx3d;',
    'uniform mat4 mvp;',
    'uniform vec4 fxSway;    // view model: x,y screen shift, z roll, w on/off',
    'uniform vec4 fxCamOff;  // world: clip-space offset that smooths camera height snaps',
    'void main() {',
    '  fragTexCoord = vertexTexCoord; fragColor = vertexColor;',
    '  vec4 p = mvp * vec4(vertexPosition, 1.0);',
    '  float persp = mvp[2][3] != 0.0 ? 1.0 : 0.0;',
    '  if (persp > 0.5) {',
    '    if (fxSway.w > 0.5) {',
    '      vec2 n = p.xy / p.w - vec2(0.35, -0.7); float c = cos(fxSway.z), s = sin(fxSway.z);',
    '      n = vec2(c * n.x - s * n.y, s * n.x + c * n.y) + vec2(0.35, -0.7) + fxSway.xy;',
    '      p.xy = n * p.w;',
    '    } else p -= fxCamOff;',
    '  }',
    '  fxDepth = p.w; fx3d = persp;',
    '  gl_Position = p;',
    '}'].join('\n');
  var FS = [
    '#version 100', 'precision mediump float;',
    'varying vec2 fragTexCoord; varying vec4 fragColor; varying float fxDepth; varying float fx3d;',
    'uniform sampler2D texture0; uniform vec4 colDiffuse;',
    'uniform vec4 fxFog;     // rgb haze colour, a density',
    'uniform vec4 fxRelief;  // x strength, y texel offset, z view model',
    'void main() {',
    '  vec4 t = texture2D(texture0, fragTexCoord);',
    '  vec4 c = t * colDiffuse * fragColor;',
    '  if (fx3d > 0.5) {',
    '    vec3 L = vec3(0.299, 0.587, 0.114);',
    '    float a = dot(t.rgb, L), b = dot(texture2D(texture0, fragTexCoord + vec2(-fxRelief.y, fxRelief.y)).rgb, L);',
    '    c.rgb *= 1.0 + clamp((a - b) * fxRelief.x, -0.22, 0.22);',
    '    if (fxRelief.z < 0.5) { float f = 1.0 - exp(-fxFog.a * max(fxDepth - 10.0, 0.0)); c.rgb = mix(c.rgb, fxFog.rgb, f * 0.55); }',
    '  }',
    '  gl_FragColor = c;',
    '}'].join('\n');
  var isDefaultVS = function (s) { return /uniform\s+mat4\s+mvp/.test(s) && /fragColor\s*=\s*vertexColor/.test(s) && /attribute\s+vec3\s+vertexPosition/.test(s) && !/fxSway/.test(s); };
  var isDefaultFS = function (s) { return /gl_FragColor\s*=\s*texelColor\s*\*\s*colDiffuse\s*\*\s*fragColor/.test(s); };

  // ------------------------------------------------------------------ per-context state
  var S = new WeakMap();
  function st(gl) {
    var s = S.get(gl);
    if (!s) S.set(gl, s = { fb: null, prog: null, ours: new WeakMap(), shaders: new WeakMap(), clear: [0.6, 0.75, 0.9],
      frame: { drew3d: false, vm: false, post: false, camSeen: false }, sent: {} });
    return s;
  }

  var P = WebGLRenderingContext.prototype;
  var o = {};
  ['shaderSource', 'linkProgram', 'useProgram', 'bindFramebuffer', 'viewport', 'scissor', 'clear', 'clearColor', 'uniformMatrix4fv', 'drawArrays', 'drawElements', 'getUniformLocation', 'uniform4f']
    .forEach(function (k) { o[k] = P[k]; });

  P.shaderSource = function (sh, src) {
    if (isGame(this)) {
      var s = st(this);
      if (isDefaultVS(src)) { s.shaders.set(sh, 'vs'); src = VS; }
      else if (isDefaultFS(src)) { s.shaders.set(sh, 'fs'); src = FS; }
    }
    return o.shaderSource.call(this, sh, src);
  };
  P.linkProgram = function (prog) {
    var r = o.linkProgram.call(this, prog);
    if (isGame(this)) {
      var s = st(this), sh = this.getAttachedShaders(prog) || [], kinds = sh.map(function (x) { return s.shaders.get(x); });
      if (kinds.indexOf('vs') >= 0 && kinds.indexOf('fs') >= 0 && this.getProgramParameter(prog, this.LINK_STATUS)) {
        var gl = this, u = function (n) { return o.getUniformLocation.call(gl, prog, n); };
        s.ours.set(prog, { sway: u('fxSway'), cam: u('fxCamOff'), fog: u('fxFog'), relief: u('fxRelief'), v: {} });
      }
    }
    return r;
  };
  P.useProgram = function (prog) { if (isGame(this)) st(this).prog = prog; return o.useProgram.call(this, prog); };
  P.bindFramebuffer = function (t, fb) { if (isGame(this)) st(this).fb = fb; return o.bindFramebuffer.call(this, t, fb); };
  P.viewport = function (x, y, w, h) {
    if (isGame(this) && !st(this).fb && SCALE > 1) { var k = ratio(this); return o.viewport.call(this, Math.round(x * k), Math.round(y * k), Math.round(w * k), Math.round(h * k)); }
    return o.viewport.call(this, x, y, w, h);
  };
  P.scissor = function (x, y, w, h) {
    if (isGame(this) && !st(this).fb && SCALE > 1) { var k = ratio(this); return o.scissor.call(this, Math.round(x * k), Math.round(y * k), Math.round(w * k), Math.round(h * k)); }
    return o.scissor.call(this, x, y, w, h);
  };
  P.clearColor = function (r, g, b, a) { if (isGame(this) && !st(this).fb) st(this).clear = [r, g, b]; return o.clearColor.call(this, r, g, b, a); };
  P.clear = function (bits) {
    if (isGame(this)) {
      var s = st(this);
      // a depth-only clear after the 3D world = the game is about to draw the view model
      if (!s.fb && bits === this.DEPTH_BUFFER_BIT && s.frame.drew3d) s.frame.vm = true;
    }
    return o.clear.call(this, bits);
  };
  P.uniformMatrix4fv = function (loc, tr, m) {
    if (isGame(this) && !this.__fxBusy) {
      var s = st(this);
      if (!s.fb && m && m.length === 16) {
        if (m[11] !== 0) {                                         // perspective
          if (!s.frame.camSeen && !s.frame.vm) { s.frame.camSeen = true; camFrame(m); }
          s.frame.drew3d = true;
        } else if (s.frame.drew3d && !s.frame.post) {               // first 2D draw after the 3D scene: post-process now
          s.frame.post = true; if (POST) post(this, s);
        }
      }
    }
    return o.uniformMatrix4fv.call(this, loc, tr, m);
  };
  function beforeDraw(gl) {
    if (!isGame(gl) || gl.__fxBusy) return;
    var s = st(gl), u = s.prog && s.ours.get(s.prog); if (!u) return;
    var vm = !s.fb && s.frame.vm, v = u.v;
    var sw = vm ? FX.sway : ZERO4, cam = (!s.fb && !vm) ? FX.camOff : ZERO4, fog = s.fb ? ZERO4 : FX.fog, rel = vm ? REL_VM : REL;
    set4(gl, u.sway, v, 'sway', sw[0], sw[1], sw[2], vm ? 1 : 0);
    set4(gl, u.cam, v, 'cam', cam[0], cam[1], cam[2], cam[3]);
    set4(gl, u.fog, v, 'fog', s.clear[0], s.clear[1], s.clear[2], s.fb ? 0 : fog[3]);
    set4(gl, u.relief, v, 'rel', rel[0], rel[1], vm ? 1 : 0, 0);
    if (vm) FX.stats.vm++;
  }
  var ZERO4 = [0, 0, 0, 0], REL = [1.6, 1 / 512], REL_VM = [0.8, 1 / 512];
  function set4(gl, loc, cache, k, a, b, c, d) {
    if (!loc) return; var p = cache[k];
    if (p && p[0] === a && p[1] === b && p[2] === c && p[3] === d) return;
    cache[k] = [a, b, c, d]; o.uniform4f.call(gl, loc, a, b, c, d);
  }
  P.drawArrays = function (a, b, c) { beforeDraw(this); return o.drawArrays.call(this, a, b, c); };
  P.drawElements = function (a, b, c, d) { beforeDraw(this); return o.drawElements.call(this, a, b, c, d); };

  // ------------------------------------------------------------------ 3. camera tracking -> sway, bob, smoothing
  FX.fog = [0, 0, 0, 0.0085]; FX.camOff = [0, 0, 0, 0];
  var cam = { has: false, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, t: 0 }, feel = { sx: 0, sy: 0, vx: 0, vy: 0, roll: 0, phase: 0, speed: 0, dip: 0, dipV: 0, vyPrev: 0, yOff: 0, air: 0 };
  function det3(a) { return a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]); }
  function camPos(m) {                                   // eye = point with clip x = y = w = 0
    var R = [[m[0], m[4], m[8], m[12]], [m[1], m[5], m[9], m[13]], [m[3], m[7], m[11], m[15]]];
    var M = R.map(function (r) { return r.slice(0, 3); }), b = R.map(function (r) { return -r[3]; }), D = det3(M);
    if (Math.abs(D) < 1e-12) return null;
    return [0, 1, 2].map(function (k) { return det3(M.map(function (row, i) { return row.map(function (v, j) { return j === k ? b[i] : v; }); })) / D; });
  }
  function angDiff(a, b) { var d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }
  function camFrame(m) {
    var now = performance.now(), p = camPos(m); if (!p) return;
    var fl = Math.hypot(m[3], m[7], m[11]); if (!fl) return;
    var fx = m[3] / fl, fy = m[7] / fl, fz = m[11] / fl;                       // camera forward (world)
    var yaw = Math.atan2(fx, -fz), pitch = Math.asin(Math.max(-1, Math.min(1, fy)));
    var dt = cam.has ? Math.min(0.1, Math.max(0.001, (now - cam.t) / 1000)) : 0.016;
    if (cam.has) {
      var dx = p[0] - cam.x, dy = p[1] - cam.y, dz = p[2] - cam.z, jump = Math.hypot(dx, dy, dz) > 3;   // respawn / spectator switch
      if (jump) { feel.yOff = 0; feel.sx = feel.sy = feel.vx = feel.vy = feel.roll = feel.dip = feel.dipV = 0; }
      else {
        // stepping up onto boxes/stairs moves the camera up in one frame: absorb that and ease it out
        // (jumps and crouching are already smooth in the game, and start below this threshold)
        if (dy > 0.25 && dy < 0.9 && dy / dt > 14 && feel.vyPrev > -0.5 && feel.vyPrev < 0.5 && feel.air < 0.1) feel.yOff -= dy;
        feel.yOff *= Math.exp(-dt / 0.06);
        var hs = Math.hypot(dx, dz) / dt; feel.speed += (Math.min(hs, 8) - feel.speed) * Math.min(1, dt * 12);
        // landing: vertical speed going from falling to stopped
        var vy = dy / dt; if (feel.vyPrev < -3 && vy > -0.5) feel.dipV -= Math.min(0.06, -feel.vyPrev * 0.006);
        feel.air = Math.abs(vy) > 0.5 ? Math.min(1, feel.air + dt * 6) : Math.max(0, feel.air - dt * 6); feel.vyPrev = vy;
        // look sway: the gun lags behind turns
        var dyaw = angDiff(yaw, cam.yaw) / dt, dpit = (pitch - cam.pitch) / dt;
        var tx = Math.max(-0.07, Math.min(0.07, -dyaw * 0.012)), ty = Math.max(-0.06, Math.min(0.06, dpit * 0.012));
        var k = 140, c = 2 * Math.sqrt(k) * 0.75;                               // springy, slightly underdamped
        feel.vx += ((tx - feel.sx) * k - feel.vx * c) * dt; feel.sx += feel.vx * dt;
        feel.vy += ((ty - feel.sy) * k - feel.vy * c) * dt; feel.sy += feel.vy * dt;
        // strafe tilt
        var right = [Math.cos(yaw), Math.sin(yaw)], lat = (dx * right[0] + dz * right[1]) / dt;
        feel.roll += (Math.max(-0.06, Math.min(0.06, -lat * 0.011)) - feel.roll) * Math.min(1, dt * 8);
        // landing dip spring
        feel.dipV += (-feel.dip * 160 - feel.dipV * 18) * dt; feel.dip += feel.dipV * dt;
      }
    }
    cam.has = true; cam.x = p[0]; cam.y = p[1]; cam.z = p[2]; cam.yaw = yaw; cam.pitch = pitch; cam.t = now;
    var amt = Math.min(1, feel.speed / 6) * (1 - feel.air);
    feel.phase += feel.speed * dt * 1.55;
    var bobX = Math.sin(feel.phase) * 0.018 * amt, bobY = -Math.abs(Math.cos(feel.phase)) * 0.016 * amt + 0.008 * amt;
    FX.sway = [feel.sx + bobX, feel.sy + bobY + feel.dip, feel.roll + Math.sin(feel.phase) * 0.012 * amt, 1];
    // clip-space shift for the world = height offset x the world's up axis in clip space (column 1)
    var yo = feel.yOff; FX.camOff = Math.abs(yo) < 1e-4 ? ZERO4 : [-m[4] * yo, -m[5] * yo, -m[6] * yo, -m[7] * yo];
    FX.cam = { pos: p, yaw: yaw, pitch: pitch, speed: feel.speed, yOff: yo };
  }

  // ------------------------------------------------------------------ frame boundaries
  var raf = window.requestAnimationFrame.bind(window), ctxs = [];
  window.requestAnimationFrame = function (cb) {
    return raf(function (t) {
      ctxs.forEach(function (gl) { var s = st(gl); s.frame = { drew3d: false, vm: false, post: false, camSeen: false }; });
      cb(t);
      ctxs.forEach(function (gl) { var s = st(gl); if (POST && s.frame.drew3d && !s.frame.post) { s.frame.post = true; post(gl, s); } });
      FX.stats.frames++;
    });
  };
  var gc = CP.getContext;
  CP.getContext = function (type, attrs) {
    if (this.id === 'canvas' && /webgl/.test(type)) { attrs = Object.assign({}, attrs || {}, { antialias: true }); }
    var gl = gc.call(this, type, attrs);
    if (gl && this.id === 'canvas' && /webgl/.test(type) && ctxs.indexOf(gl) < 0) { ctxs.push(gl); gl.getExtension('OES_standard_derivatives'); }
    return gl;
  };

  // ------------------------------------------------------------------ 4. post-processing
  var PVS = 'attribute vec2 p; varying vec2 uv; void main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }';
  var BRIGHT = 'precision mediump float; varying vec2 uv; uniform sampler2D src; uniform vec2 px;' +
    'vec3 s(vec2 o){ vec3 c = texture2D(src, uv + o * px).rgb; float l = max(c.r, max(c.g, c.b)); return c * smoothstep(0.62, 0.95, l); }' +
    'void main(){ vec3 c = s(vec2(-1.0,-1.0)) + s(vec2(1.0,-1.0)) + s(vec2(-1.0,1.0)) + s(vec2(1.0,1.0)); gl_FragColor = vec4(c * 0.25, 1.0); }';
  var BLUR = 'precision mediump float; varying vec2 uv; uniform sampler2D src; uniform vec2 dir;' +
    'void main(){ vec3 c = texture2D(src, uv).rgb * 0.227;' +
    ' c += (texture2D(src, uv + dir * 1.385).rgb + texture2D(src, uv - dir * 1.385).rgb) * 0.316;' +
    ' c += (texture2D(src, uv + dir * 3.231).rgb + texture2D(src, uv - dir * 3.231).rgb) * 0.070;' +
    ' gl_FragColor = vec4(c, 1.0); }';
  var COMP = 'precision highp float; varying vec2 uv; uniform sampler2D src; uniform sampler2D bloom; uniform vec2 px; uniform float sharp;' +
    'float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }' +
    'vec3 fxaa(){' +
    ' vec3 rgbNW = texture2D(src, uv + vec2(-1.0,-1.0) * px).rgb, rgbNE = texture2D(src, uv + vec2(1.0,-1.0) * px).rgb;' +
    ' vec3 rgbSW = texture2D(src, uv + vec2(-1.0,1.0) * px).rgb, rgbSE = texture2D(src, uv + vec2(1.0,1.0) * px).rgb, rgbM = texture2D(src, uv).rgb;' +
    ' float lNW = lum(rgbNW), lNE = lum(rgbNE), lSW = lum(rgbSW), lSE = lum(rgbSE), lM = lum(rgbM);' +
    ' float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE))), lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));' +
    ' vec2 d = vec2(-((lNW + lNE) - (lSW + lSE)), ((lNW + lSW) - (lNE + lSE)));' +
    ' float red = max((lNW + lNE + lSW + lSE) * 0.03125, 0.0078125); float rc = 1.0 / (min(abs(d.x), abs(d.y)) + red);' +
    ' d = clamp(d * rc, -8.0, 8.0) * px;' +
    ' vec3 a = 0.5 * (texture2D(src, uv + d * (1.0/3.0 - 0.5)).rgb + texture2D(src, uv + d * (2.0/3.0 - 0.5)).rgb);' +
    ' vec3 b = a * 0.5 + 0.25 * (texture2D(src, uv - d * 0.5).rgb + texture2D(src, uv + d * 0.5).rgb);' +
    ' float lb = lum(b); return (lb < lMin || lb > lMax) ? a : b; }' +
    'vec3 filmic(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }' +
    'void main(){' +
    ' vec3 c = fxaa();' +
    ' vec3 n = texture2D(src, uv + vec2(px.x, 0.0)).rgb + texture2D(src, uv - vec2(px.x, 0.0)).rgb + texture2D(src, uv + vec2(0.0, px.y)).rgb + texture2D(src, uv - vec2(0.0, px.y)).rgb;' +
    ' c = max(c + (c - n * 0.25) * sharp, 0.0);' +
    ' c += texture2D(bloom, uv).rgb * 0.42;' +
    ' c = mix(c, filmic(c * 1.12), 0.65);' +
    ' float l = lum(c); c = mix(vec3(l), c, 1.12);' +                                      // saturation
    ' c = (c - 0.5) * 1.06 + 0.5;' +                                                         // contrast
    ' c *= mix(vec3(0.96, 0.99, 1.05), vec3(1.04, 1.0, 0.94), smoothstep(0.15, 0.85, l));' + // cool shadows, warm highlights
    ' vec2 q = uv - 0.5; c *= 1.0 - dot(q, q) * 0.45;' +                                     // vignette
    ' gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0); }';

  function makeProg(gl, fs) {
    var c = function (t, s) { var x = gl.createShader(t); o.shaderSource.call(gl, x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
    var p = gl.createProgram(); gl.attachShader(p, c(gl.VERTEX_SHADER, PVS)); gl.attachShader(p, c(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'p'); o.linkProgram.call(gl, p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    var u = {}; ['src', 'bloom', 'px', 'dir', 'sharp'].forEach(function (n) { u[n] = o.getUniformLocation.call(gl, p, n); });
    return { p: p, u: u };
  }
  function tex(gl, w, h) {
    var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]
      .forEach(function (x) { gl.texParameteri(gl.TEXTURE_2D, x[0], x[1]); });
    return t;
  }
  function target(gl, w, h) { var t = tex(gl, w, h), f = gl.createFramebuffer(); o.bindFramebuffer.call(gl, gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); return { t: t, f: f, w: w, h: h }; }

  var PS = new WeakMap(), postBroken = false;
  function setup(gl, w, h) {
    var p = PS.get(gl);
    if (p && p.w === w && p.h === h) return p;
    if (!p) {
      var vao = gl.getExtension('OES_vertex_array_object');
      p = { bright: makeProg(gl, BRIGHT), blur: makeProg(gl, BLUR), comp: makeProg(gl, COMP), vaoExt: vao, buf: gl.createBuffer() };
      gl.bindBuffer(gl.ARRAY_BUFFER, p.buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      if (vao) { p.vao = vao.createVertexArrayOES(); vao.bindVertexArrayOES(p.vao); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); }
      PS.set(gl, p);
    } else [p.scene, p.a, p.b].forEach(function (x) { gl.deleteTexture(x.t); if (x.f) gl.deleteFramebuffer(x.f); });
    p.w = w; p.h = h;
    p.scene = { t: tex(gl, w, h) };
    var bw = Math.max(1, w >> 2), bh = Math.max(1, h >> 2);
    p.a = target(gl, bw, bh); p.b = target(gl, bw, bh);
    return p;
  }
  function post(gl, s) {
    if (postBroken || s.fb) return;
    var w = gl.drawingBufferWidth, h = gl.drawingBufferHeight; if (w < 2 || h < 2) return;
    gl.__fxBusy = true;
    var save = saveState(gl);
    try {
      var p = setup(gl, w, h);
      if (p.vao) p.vaoExt.bindVertexArrayOES(p.vao); else { gl.bindBuffer(gl.ARRAY_BUFFER, p.buf); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); }
      [gl.DEPTH_TEST, gl.BLEND, gl.CULL_FACE, gl.SCISSOR_TEST, gl.STENCIL_TEST].forEach(function (c) { gl.disable(c); });
      gl.depthMask(false); gl.colorMask(true, true, true, true);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, p.scene.t);
      o.bindFramebuffer.call(gl, gl.FRAMEBUFFER, null);
      gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, w, h);
      // bloom: bright pass at 1/4 size, then a two-pass blur
      o.bindFramebuffer.call(gl, gl.FRAMEBUFFER, p.a.f); o.viewport.call(gl, 0, 0, p.a.w, p.a.h);
      o.useProgram.call(gl, p.bright.p); gl.uniform1i(p.bright.u.src, 0); gl.uniform2f(p.bright.u.px, 1.5 / w, 1.5 / h);
      o.drawArrays.call(gl, gl.TRIANGLES, 0, 3);
      o.useProgram.call(gl, p.blur.p); gl.uniform1i(p.blur.u.src, 0);
      for (var i = 0; i < 2; i++) {
        o.bindFramebuffer.call(gl, gl.FRAMEBUFFER, p.b.f); gl.bindTexture(gl.TEXTURE_2D, p.a.t); gl.uniform2f(p.blur.u.dir, (1 + i) / p.a.w, 0); o.drawArrays.call(gl, gl.TRIANGLES, 0, 3);
        o.bindFramebuffer.call(gl, gl.FRAMEBUFFER, p.a.f); gl.bindTexture(gl.TEXTURE_2D, p.b.t); gl.uniform2f(p.blur.u.dir, 0, (1 + i) / p.a.h); o.drawArrays.call(gl, gl.TRIANGLES, 0, 3);
      }
      // composite back onto the screen
      o.bindFramebuffer.call(gl, gl.FRAMEBUFFER, null); o.viewport.call(gl, 0, 0, w, h);
      o.useProgram.call(gl, p.comp.p);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, p.a.t); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, p.scene.t);
      gl.uniform1i(p.comp.u.src, 0); gl.uniform1i(p.comp.u.bloom, 1); gl.uniform2f(p.comp.u.px, 1 / w, 1 / h); gl.uniform1f(p.comp.u.sharp, SCALE > 1.2 ? 0.18 : 0.28);
      o.drawArrays.call(gl, gl.TRIANGLES, 0, 3);
      FX.stats.post++;
    } catch (e) { postBroken = true; console.warn('[fx] post-processing off:', e); }
    restoreState(gl, save);
    gl.__fxBusy = false;
  }
  function saveState(gl) {
    var vao = gl.getExtension('OES_vertex_array_object');
    var s = {
      prog: gl.getParameter(gl.CURRENT_PROGRAM), ab: gl.getParameter(gl.ARRAY_BUFFER_BINDING), vao: vao ? gl.getParameter(vao.VERTEX_ARRAY_BINDING_OES) : null,
      at: gl.getParameter(gl.ACTIVE_TEXTURE), viewport: gl.getParameter(gl.VIEWPORT), fb: gl.getParameter(gl.FRAMEBUFFER_BINDING),
      caps: [gl.DEPTH_TEST, gl.BLEND, gl.CULL_FACE, gl.SCISSOR_TEST, gl.STENCIL_TEST].map(function (c) { return [c, gl.isEnabled(c)]; }),
      depthMask: gl.getParameter(gl.DEPTH_WRITEMASK), colorMask: gl.getParameter(gl.COLOR_WRITEMASK), vaoExt: vao,
    };
    gl.activeTexture(gl.TEXTURE0); s.t0 = gl.getParameter(gl.TEXTURE_BINDING_2D); gl.activeTexture(gl.TEXTURE1); s.t1 = gl.getParameter(gl.TEXTURE_BINDING_2D);
    if (!vao || !s.vao) {                                    // attribute 0 of the default vertex array (we may change it)
      s.attr0 = { on: gl.getVertexAttrib(0, gl.VERTEX_ATTRIB_ARRAY_ENABLED), buf: gl.getVertexAttrib(0, gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING),
        size: gl.getVertexAttrib(0, gl.VERTEX_ATTRIB_ARRAY_SIZE), type: gl.getVertexAttrib(0, gl.VERTEX_ATTRIB_ARRAY_TYPE), norm: gl.getVertexAttrib(0, gl.VERTEX_ATTRIB_ARRAY_NORMALIZED),
        stride: gl.getVertexAttrib(0, gl.VERTEX_ATTRIB_ARRAY_STRIDE), off: gl.getVertexAttribOffset(0, gl.VERTEX_ATTRIB_ARRAY_POINTER) };
    }
    return s;
  }
  function restoreState(gl, s) {
    if (s.vaoExt) s.vaoExt.bindVertexArrayOES(s.vao);
    if (s.attr0) {
      if (s.attr0.buf) { gl.bindBuffer(gl.ARRAY_BUFFER, s.attr0.buf); gl.vertexAttribPointer(0, s.attr0.size, s.attr0.type, s.attr0.norm, s.attr0.stride, s.attr0.off); }
      if (s.attr0.on) gl.enableVertexAttribArray(0); else gl.disableVertexAttribArray(0);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, s.ab);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, s.t1); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, s.t0); gl.activeTexture(s.at);
    o.useProgram.call(gl, s.prog);
    o.bindFramebuffer.call(gl, gl.FRAMEBUFFER, s.fb);
    o.viewport.call(gl, s.viewport[0], s.viewport[1], s.viewport[2], s.viewport[3]);
    s.caps.forEach(function (c) { if (c[1]) gl.enable(c[0]); else gl.disable(c[0]); });
    gl.depthMask(s.depthMask); gl.colorMask(s.colorMask[0], s.colorMask[1], s.colorMask[2], s.colorMask[3]);
  }
})();
