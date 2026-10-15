// mobile.js - phone fixes for the game page.
// iPhone Safari has no fullscreen for web pages, so the only real fullscreen is running the game from the
// home screen (manifest.webmanifest + apple-mobile-web-app-capable). This shows a one-time hint on iPhone,
// and stops the page from scrolling, bouncing or zooming under your thumbs.
(function () {
  'use strict';
  var ua = navigator.userAgent, ios = /iPhone|iPod/.test(ua) || (/iPad|Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  var standalone = window.navigator.standalone === true || window.matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;
  document.documentElement.classList.toggle('standalone', standalone);
  // no pinch-zoom / double-tap zoom / rubber-band scrolling
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (t) { document.addEventListener(t, function (e) { e.preventDefault(); }, { passive: false }); });
  document.addEventListener('touchmove', function (e) { if (e.target.closest && e.target.closest('#prompt')) return; e.preventDefault(); }, { passive: false });
  var lastTouch = 0;
  document.addEventListener('touchend', function (e) { var now = Date.now(); if (now - lastTouch < 350 && !(e.target.closest && e.target.closest('#prompt'))) e.preventDefault(); lastTouch = now; }, { passive: false });
  // keep the canvas matching the visible area when Safari's bars show/hide or the phone rotates
  function fit() { window.dispatchEvent(new Event('resize')); }
  window.addEventListener('orientationchange', function () { setTimeout(fit, 300); });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', fit);

  if (!ios || standalone) return;
  var seen = 0; try { seen = +localStorage.getItem('openstrike.iosHint') || 0; } catch (e) { }
  if (seen >= 3) return;
  try { localStorage.setItem('openstrike.iosHint', String(seen + 1)); } catch (e) { }
  var tip = document.createElement('div');
  tip.id = 'iosHint';
  tip.innerHTML = '<b>Play fullscreen on iPhone:</b> tap <span class="share">Share</span> then <b>Add to Home Screen</b>, and open OpenStrike from your home screen. <button type="button" aria-label="Close">×</button>';
  document.body.appendChild(tip);
  var close = function () { tip.remove(); };
  tip.querySelector('button').addEventListener('click', function (e) { e.stopPropagation(); close(); try { localStorage.setItem('openstrike.iosHint', '3'); } catch (_) { } });
  setTimeout(close, 12000);
})();
