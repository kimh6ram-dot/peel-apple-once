/* 입력 — 키보드(방향키 + Q/W 기울기) + 화면 하단 패드(Pointer Events). 둘 다 같은 dirs() 로 합쳐져 knife.js 로 간다.
 *  - 패드 버튼마다 자기 pointerId 를 기억 → 멀티터치로 ←+↓, ←+↶ 같은 조합이 된다. 떼면(up/cancel/capture 상실) 즉시 멈춘다.
 *  - 패드에 touch-action:none + touchstart preventDefault 로 스크롤/확대를 막는다.
 *  - 창 blur 시 모든 입력을 지운다. QA 용 setOverride 로 입력을 대신 넣을 수 있다. */
'use strict';
window.AP = window.AP || {};

AP.input = (function () {
  var DIRS = ['up', 'down', 'left', 'right', 'ccw', 'cw'];
  var keys = {}, pad = {}, btnOf = {};
  DIRS.forEach(function (d) { keys[d] = false; pad[d] = null; });
  var override = null;
  var KEYMAP = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', KeyQ: 'ccw', KeyW: 'cw' };

  function clear() {
    DIRS.forEach(function (d) { keys[d] = false; pad[d] = null; if (btnOf[d]) btnOf[d].classList.remove('is-down'); });
  }

  function attach(padEl) {
    window.addEventListener('keydown', function (e) {
      var tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      var d = KEYMAP[e.code]; if (!d) return;
      keys[d] = true; e.preventDefault();
    });
    window.addEventListener('keyup', function (e) { var d = KEYMAP[e.code]; if (d) keys[d] = false; });
    window.addEventListener('blur', clear);

    var btns = padEl.querySelectorAll('[data-dir]');
    Array.prototype.forEach.call(btns, function (btn) {
      var dir = btn.getAttribute('data-dir');
      btnOf[dir] = btn;
      btn.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        if (pad[dir] !== null) return;
        pad[dir] = e.pointerId;
        btn.classList.add('is-down');
        try { btn.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
      }, { passive: false });
      function release(e) { if (pad[dir] !== e.pointerId) return; pad[dir] = null; btn.classList.remove('is-down'); }
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('lostpointercapture', release);
      btn.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    });
    padEl.addEventListener('touchstart', function (e) { e.preventDefault(); }, { passive: false });
    padEl.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });
  }

  function on(d) { return keys[d] || pad[d] !== null; }
  function dirs() {
    if (override) return { dx: override.dx || 0, dy: override.dy || 0, rot: override.rot || 0 };
    return { dx: (on('right') ? 1 : 0) - (on('left') ? 1 : 0), dy: (on('down') ? 1 : 0) - (on('up') ? 1 : 0), rot: (on('cw') ? 1 : 0) - (on('ccw') ? 1 : 0) };
  }
  function isTouchPrimary() {
    try { return window.matchMedia('(pointer: coarse)').matches; } catch (e) { return 'ontouchstart' in window; }
  }

  return {
    attach: attach, dirs: dirs, clear: clear, isTouchPrimary: isTouchPrimary,
    setOverride: function (o) { override = o || null; },
    get keys() { return keys; }, get pad() { return pad; },
  };
})();
