/* 한번에 깎으세요 — 친구 도전장 (기록을 링크 해시에 직접 담는다. 서버 없음. 주차하기와 같은 방식)
 * 링크: <공개 주소>#battle/v1.<base64url JSON>
 * JSON: { n: 닉네임(≤12), s: 총점, f: 과일 id, p: 제거율(정수 %), l: 과육 손실(×10 정수 %), g: 깎인 표면 상태(압축) }
 * g = 표면 셀(96×48)을 2×2 로 묶은 48×24 격자, 셀당 2비트(0 껍질 · 1 벗겨짐 · 2 과육 파임) → 288바이트 → base64url 384자.
 *     상대 기기에서 같은 과일 모델의 표면을 이 상태로 만들어 "최종 모습"을 다시 그린다(점수·결과는 거짓 없이 실제 기록 그대로). */
'use strict';
window.AP = window.AP || {};

AP.battle = (function () {
  var CS = 48, CR = 24;          // 압축 격자: 섹터 48 × 행 24
  var PREFIX = 'v1.';

  function b64uFromBytes(bytes) {
    var s = ''; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function bytesFromB64u(str) {
    var b = str.replace(/-/g, '+').replace(/_/g, '/'); while (b.length % 4) b += '=';
    var s = atob(b), out = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out;
  }
  function b64uEncodeObj(o) { var j = unescape(encodeURIComponent(JSON.stringify(o))), a = new Uint8Array(j.length); for (var i = 0; i < j.length; i++) a[i] = j.charCodeAt(i); return b64uFromBytes(a); }
  function b64uDecodeObj(str) { var bytes = bytesFromB64u(str), s = ''; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return JSON.parse(decodeURIComponent(escape(s))); }

  /* 현재 표면 → 압축 문자열 */
  function encodeSurface(S) {
    var NS = S.NS, NR = S.NR, bytes = new Uint8Array(Math.ceil(CS * CR * 2 / 8));
    for (var cr = 0; cr < CR; cr++) for (var cs = 0; cs < CS; cs++) {
      var peeled = 0, deep = 0;
      for (var dr = 0; dr < 2; dr++) for (var dc = 0; dc < 2; dc++) { var st = S.state[(cr * 2 + dr) * NS + cs * 2 + dc]; if (st >= 1) peeled++; if (st === 2) deep++; }
      var v = deep >= 2 ? 2 : (peeled >= 2 ? 1 : 0), bit = (cr * CS + cs) * 2;
      bytes[bit >> 3] |= v << (bit & 7);
    }
    return b64uFromBytes(bytes);
  }
  function decodeGrid(g) {
    var bytes = bytesFromB64u(g); if (bytes.length !== Math.ceil(CS * CR * 2 / 8)) return null;
    var grid = new Uint8Array(CS * CR); for (var i = 0; i < grid.length; i++) { var bit = i * 2; grid[i] = (bytes[bit >> 3] >> (bit & 7)) & 3; }
    return grid;
  }
  /* 압축 상태를 (새로 만든) 표면에 적용: 벗겨짐 = 껍질 두께만큼 깎임, 파임 = 껍질 + 1.8px */
  function applyGrid(S, grid) {
    var NS = S.NS;
    for (var cr = 0; cr < CR; cr++) for (var cs = 0; cs < CS; cs++) {
      var v = grid[cr * CS + cs]; if (!v) continue;
      for (var dr = 0; dr < 2; dr++) for (var dc = 0; dc < 2; dc++) {
        var idx = (cr * 2 + dr) * NS + cs * 2 + dc, skin = S.skin[idx];
        S.peeled[idx] = 1; S.state[idx] = v === 2 ? 2 : 1; S.rec[idx] = skin + (v === 2 ? 1.8 : 0.05 * skin); S.fleshLoss[idx] = v === 2 ? 1.8 : 0;
      }
    }
  }

  /* rec: { nickname, total, fruit, peelPct, fleshPct, surface } */
  function makeToken(rec) {
    return PREFIX + b64uEncodeObj({ n: (rec.nickname || '').slice(0, 12), s: rec.total, f: rec.fruit, p: Math.round(rec.peelPct), l: Math.round(rec.fleshPct * 10), g: encodeSurface(rec.surface) });
  }
  function parseToken(token) {
    try {
      if (!token || token.indexOf(PREFIX) !== 0) return null;
      var d = b64uDecodeObj(token.slice(PREFIX.length));
      if (typeof d.s !== 'number' || d.s < 0 || d.s > 100 || !AP.fruits.CONFIGS[d.f] || !AP.fruits.available(d.f) || typeof d.g !== 'string') return null;
      var grid = decodeGrid(d.g); if (!grid) return null;
      return { nickname: String(d.n || '친구').replace(/[\u0000-\u001f<>]/g, '').slice(0, 12) || '친구', total: Math.round(d.s), fruit: d.f, peelPct: +d.p || 0, fleshPct: (+d.l || 0) / 10, grid: grid };
    } catch (e) { return null; }
  }
  function buildUrl(token) { var base = AP.CONFIG.SHARE.URL || (location.href.split('#')[0]); return base.split('#')[0] + '#battle/' + token; }
  function parseHash() { var m = location.hash.match(/^#battle\/(.+)$/); return m ? m[1] : null; }

  /* 상대 기록의 최종 모습을 다시 그린 캔버스(boxW×boxH 안에 비율 유지) — 지금 플레이 중인 모델은 건드리지 않는다(숨기고 따로 만든 모델로 렌더) */
  function snapshotOf(rec, boxW, boxH) {
    var main = AP.apple.current; if (main) main.group.visible = false;
    var det = AP.apple.create(rec.fruit, { detached: true });
    try {
      applyGrid(det.surface, rec.grid); det.body.rebuildAll(); det.syncDecor();
      AP.scene.addApple(det.group); det.setAngle(0.35);
      var S = det.surface, cx = AP.scene.appleCx, rch = S.decorReach || 0, P = AP.scene, pad = 10;
      var top = P.project(new THREE.Vector3(0, S.topExtent + rch, 0)).y, bottom = P.project(new THREE.Vector3(0, S.bottomY - rch - (S.capExtraBottom || 0), 0)).y;
      var rect = { x0: cx - (S.R + rch) - pad, x1: cx + (S.R + rch) + pad, y0: top - pad, y1: bottom + pad };
      var rw = rect.x1 - rect.x0, rh = rect.y1 - rect.y0, k = Math.min(boxW / rw, boxH / rh);
      return P.renderSnapshot(Math.max(2, Math.round(rw * k)), Math.max(2, Math.round(rh * k)), rect, { bg: '#FFFFFF', hideOverlay: true });
    } finally {
      AP.scene.removeApple(det.group); det.dispose(); if (main) main.group.visible = true;
    }
  }

  return { makeToken: makeToken, parseToken: parseToken, buildUrl: buildUrl, parseHash: parseHash, snapshotOf: snapshotOf, encodeSurface: encodeSurface, decodeGrid: decodeGrid };
})();
