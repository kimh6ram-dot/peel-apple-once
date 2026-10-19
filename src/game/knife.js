/* KnifeControlSystem — 칼 위치·기울기·속도·이동 범위. 입력(방향키/패드)은 input.js, 판정 기하는 blade.js.
 *
 * 상태: 피벗(px, py: 날 위의 한 점, 스테이지 px) + 기울기 angle(rad, + = 화면 시계 방향 = E) + 배율 scale.
 *   PNG px → 스테이지 px: toStage(p) = 피벗 + R(angle)·((p − pivotPNG)·scale).  이미지와 절삭선이 **같은 변환**을 쓴다.
 *   기본(angle 0)은 날 위·손잡이 아래. 조절 범위 MIN_ANGLE_DEG ~ MAX_ANGLE_DEG(−75°~+75°). 이동·회전 모두 램프업 ACCEL_TAU, 떼면 즉시 정지(명세).
 * 이동 범위(기울기마다 다시 계산):
 *   위   = max(칼 이미지 위가 HUD 아래 여백,  절삭점(피벗)이 능선 위 REACH_MARGIN)
 *   아래 = min(칼 이미지 아래가 패드 위 여백, 절삭점(피벗)이 바닥 아래 REACH_MARGIN)   ← 절삭점 기준(이미지 bbox 기준 아님)
 *   왼쪽 = 날의 가장 왼쪽 점이 사과 중심 − MAX_DEPTH_RATIO·R, 오른쪽 = 날의 가장 오른쪽 점이 스테이지 여백 안 (손잡이는 화면 밖 허용)
 * 레이아웃(main.js)은 기울기 0 의 칼이 이 범위 안에서 능선~바닥 전체에 닿도록 사과를 배치한다. */
'use strict';
window.AP = window.AP || {};

AP.knife = (function () {
  var C = AP.CONFIG, K = C.KNIFE;
  var S = { px: 0, py: 0, angle: 0, vx: 0, vy: 0, vrot: 0, scale: 1, placed: false, layout: null, bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 } };
  var D = null, pivot = null;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function toStage(p) {
    var s = S.scale, c = Math.cos(S.angle), sn = Math.sin(S.angle), dx = (p[0] - pivot[0]) * s, dy = (p[1] - pivot[1]) * s;
    return [S.px + dx * c - dy * sn, S.py + dx * sn + dy * c];
  }
  function corners() {
    var bb = D.bbox;
    return [[bb.x, bb.y], [bb.x + bb.w, bb.y], [bb.x + bb.w, bb.y + bb.h], [bb.x, bb.y + bb.h]].map(toStage);
  }
  /* 현재 기울기에서 피벗 기준 상대 범위(이미지 bbox 4 모서리 · 날 폴리라인) — px/py 와 무관 */
  function extents() {
    var e = { minDx: Infinity, maxDx: -Infinity, minDy: Infinity, maxDy: -Infinity, edgeMinDy: Infinity, edgeMaxDy: -Infinity, edgeMinDx: Infinity, edgeMaxDx: -Infinity };
    var cs = corners();
    for (var i = 0; i < cs.length; i++) {
      var dx = cs[i][0] - S.px, dy = cs[i][1] - S.py;
      if (dx < e.minDx) e.minDx = dx; if (dx > e.maxDx) e.maxDx = dx; if (dy < e.minDy) e.minDy = dy; if (dy > e.maxDy) e.maxDy = dy;
    }
    for (var k = 0; k < D.edge.length; k++) {
      var q = toStage(D.edge[k]), ex = q[0] - S.px, ey = q[1] - S.py;
      if (ey < e.edgeMinDy) e.edgeMinDy = ey; if (ey > e.edgeMaxDy) e.edgeMaxDy = ey; if (ex < e.edgeMinDx) e.edgeMinDx = ex; if (ex > e.edgeMaxDx) e.edgeMaxDx = ex;
    }
    return e;
  }
  function computeBounds() {
    var L = S.layout, e = extents(), m = K.STAGE_MARGIN, rm = K.REACH_MARGIN;
    /* 가로는 "날"만 화면 안에 둔다. 손잡이는 기울이면 화면 밖으로 나갈 수 있다(허용) — 이미지 전체를 가두면 기울이는 순간 칼이 사과 속으로 떠밀린다 */
    S.bounds.minX = L.appleCx - L.appleR * K.MAX_DEPTH_RATIO - e.edgeMinDx;
    S.bounds.maxX = L.W - m - e.edgeMaxDx;
    S.bounds.minY = Math.max(L.playTop + m - e.minDy, L.bodyTopY - rm);          // 절삭점(피벗)이 능선 위 rm 까지(칼 이미지는 HUD 아래 여백 m 을 지킨다)
    S.bounds.maxY = Math.min(L.playBottom - m - e.maxDy, L.bodyBottomY + rm);    // 절삭점(피벗)이 바닥 아래 rm 까지
    if (S.bounds.maxX < S.bounds.minX) S.bounds.maxX = S.bounds.minX;
    if (S.bounds.maxY < S.bounds.minY) S.bounds.maxY = S.bounds.minY;
  }
  function clampPos() { computeBounds(); S.px = clamp(S.px, S.bounds.minX, S.bounds.maxX); S.py = clamp(S.py, S.bounds.minY, S.bounds.maxY); }

  /* L: { W, appleCx, appleR, bodyH, bodyTopY, bodyBottomY, playTop, playBottom } (스테이지 px) */
  function layout(L) {
    D = AP.assets.knife;
    pivot = D.edge[Math.floor(D.edge.length * K.PIVOT_EDGE_FRAC)];
    S.layout = L;
    S.scale = K.BLADE_LEN_RATIO * (L.knifeBodyH || L.bodyH) / D.bladeLen;   // 칼 크기는 과일과 무관(사과 몸통 높이 기준 × 화면 배율) — 키위·용과에서도 같은 칼
    if (S.placed) clampPos();
  }

  /* 시작 위치(기울기 0): 칼끝 y = 몸통 상단 + 몸통 높이×START_TIP_RATIO, x 는 날↔실루엣 최소 수평 간격 = START_GAP */
  function place(silhouetteX) {
    var L = S.layout, s = S.scale;
    S.angle = 0; S.vx = 0; S.vy = 0; S.vrot = 0;
    S.px = L.appleCx + L.appleR + 200;
    S.py = L.bodyTopY + L.bodyH * K.START_TIP_RATIO - (D.tip[1] - pivot[1]) * s;
    computeBounds();
    S.py = clamp(S.py, S.bounds.minY, S.bounds.maxY);      // 짧은 화면이면 먼저 y 를 범위에 넣고 그 높이에서 간격을 푼다
    var best = -Infinity;
    for (var k = 0; k < D.edge.length; k++) {
      var q = toStage(D.edge[k]), sx = silhouetteX(q[1]);
      if (sx === null) continue;
      best = Math.max(best, sx - (q[0] - S.px));
    }
    S.px = (isFinite(best) ? best : L.appleCx + L.appleR - (D.bladeRegion.x - pivot[0]) * s) + K.START_GAP;
    S.placed = true;
    clampPos();
  }

  function update(dt, dirs) {
    var a = 1 - Math.exp(-dt / K.ACCEL_TAU);
    var tx = dirs.dx * K.SPEED_X, ty = dirs.dy * K.SPEED_Y, tr = (dirs.rot || 0) * K.ROT_SPEED_DEG * Math.PI / 180;
    S.vx = tx === 0 ? 0 : S.vx + (tx - S.vx) * a;
    S.vy = ty === 0 ? 0 : S.vy + (ty - S.vy) * a;
    S.vrot = tr === 0 ? 0 : S.vrot + (tr - S.vrot) * a;
    S.px += S.vx * dt; S.py += S.vy * dt;
    S.angle = clamp(S.angle + S.vrot * dt, K.MIN_ANGLE_DEG * Math.PI / 180, K.MAX_ANGLE_DEG * Math.PI / 180);
    clampPos();
  }

  function rectStage() {
    var cs = corners(), b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (var i = 0; i < cs.length; i++) { b.x0 = Math.min(b.x0, cs[i][0]); b.x1 = Math.max(b.x1, cs[i][0]); b.y0 = Math.min(b.y0, cs[i][1]); b.y1 = Math.max(b.y1, cs[i][1]); }
    return b;
  }
  function originStage() { return toStage([0, 0]); }

  return {
    layout: layout, place: place, update: update, toStage: toStage, extents: extents,
    rectStage: rectStage, cornersStage: corners, tipStage: function () { return toStage(D.tip); },
    /* QA: PNG 원점(좌상단) 기준 위치 지정(현재 기울기 유지) · 기울기 직접 지정 */
    setOrigin: function (x, y) { var o = originStage(); S.px += x - o[0]; S.py += y - o[1]; clampPos(); },
    setPos: function (x, y) { this.setOrigin(x, y); },
    setAngle: function (rad) { S.angle = clamp(rad, K.MIN_ANGLE_DEG * Math.PI / 180, K.MAX_ANGLE_DEG * Math.PI / 180); clampPos(); },
    get x() { return originStage()[0]; }, get y() { return originStage()[1]; },
    get px() { return S.px; }, get py() { return S.py; }, get angle() { return S.angle; }, get angleDeg() { return S.angle * 180 / Math.PI; },
    get vx() { return S.vx; }, get vy() { return S.vy; }, get vrot() { return S.vrot; },
    get scale() { return S.scale; }, get bounds() { return S.bounds; }, get placed() { return S.placed; }, get data() { return D; }, get pivotPNG() { return pivot; },
    get pngSize() { return { w: D.w, h: D.h }; },
  };
})();
