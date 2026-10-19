/* PeelRibbonSystem — 실제 절삭 데이터에 연결된 연속 껍질 리본.
 *
 * 입력은 cutting.contact 뿐이다(칼 좌표·절삭 판정은 건드리지 않는다):
 *   newlyPeeled > 0 인 프레임에만 길이가 늘고(이미 깎인 곳·과육만 파는 동작·공중에서는 0 → 생성 없음),
 *   peelX/peelY = 이번 프레임에 새로 벗겨진 셀들의 무게중심(실제 절삭점, 스테이지 px),
 *   peelLen = 새로 벗겨진 껍질의 경로 길이(사과 단위 px: 가장 많이 벗겨진 행의 셀 수 × 셀 호 길이).
 * 화면의 리본과 기록(현재/최장 껍질 길이)은 같은 peelLen 에서 나온다. 화면에는 마디 수 상한(MAX_POINTS)이 있어 꼬리가 잘릴 수 있지만 기록은 정확하다.
 *
 * 리본 = 마디 사슬(verlet). 머리(pts[0])는 절삭점에 고정, 나머지는 중력·표면 쪽 끌림·거리 구속(늘어나지 않는 줄)으로 따라온다 → 칼이 움직이면
 *   머리만 따라가고 몸통은 부드럽게 뒤따른다. 새 껍질이 SEG_LEN 만큼 나올 때마다 머리에 마디 1개를 삽입 → 껍질이 나오는 만큼 길어진다.
 * 끊김: 새 껍질이 BREAK_GRACE(0.2s) 동안 나오지 않으면(칼이 떨어짐·경로 단절·깎인 영역 통과) 사슬 전체가 떨어지는 리본이 되고
 *   현재 길이는 0 으로, 다음 새 껍질에서 새 리본이 시작된다. 게임오버 없음. 떨어지는 리본은 화면 아래로 나가거나 FALL_LIFE 후 제거.
 * 렌더: 오버레이 장면의 삼각형 띠(폭이 비틀림으로 변함), 무광 MeshBasicMaterial + 마디별 두 가지 명암(로우폴리), 칼 위에 그린다. */
'use strict';
window.AP = window.AP || {};

AP.ribbon = (function () {
  var C = AP.CONFIG, R = C.RIBBON;
  var meshes = [], active = null, falls = [], inited = false;
  var st = { log: [], liftDir: [-0.5, -0.85], lenPx: 0, longestPx: 0, grow: 0, lastPeelT: -Infinity, head: [0, 0], breaks: 0, emitted: 0, idCounter: 0, lastDt: 1 / 60 };

  function srgb(rgb) { return new THREE.Color().setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace); }

  function makeMesh() {
    var N = R.MAX_POINTS + 2;
    var geo = new THREE.BufferGeometry();
    var pos = new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3), col = new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3);
    pos.setUsage(THREE.DynamicDrawUsage); col.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', pos); geo.setAttribute('color', col);
    var idx = new Uint16Array((N - 1) * 6), p = 0;
    for (var i = 0; i < N - 1; i++) { var a = i * 2; idx[p++] = a; idx[p++] = a + 1; idx[p++] = a + 2; idx[p++] = a + 1; idx[p++] = a + 3; idx[p++] = a + 2; }
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.setDrawRange(0, 0);
    var mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, depthTest: false, depthWrite: false });
    var m = new THREE.Mesh(geo, mat);
    m.renderOrder = 9;                                          // 칼(10)보다 아래: 손잡이·칼 몸통이 리본 위에 그려져 리본이 칼에 붙어 보이지 않는다 m.frustumCulled = false; m.visible = false;
    AP.scene.addOverlay(m);
    return m;
  }
  function init() {
    if (inited) return;
    inited = true;
    for (var i = 0; i < R.FALL_MAX + 1; i++) meshes.push(makeMesh());
  }

  function newPoint(x, y) { return { x: x, y: y, px: x, py: y, id: st.idCounter++ }; }

  function reset() {
    active = null; falls = [];
    st.lenPx = 0; st.longestPx = 0; st.grow = 0; st.lastPeelT = -Infinity; st.breaks = 0; st.log = []; st.emitted = 0; st.idCounter = 0;
    for (var i = 0; i < meshes.length; i++) { meshes[i].visible = false; meshes[i].geometry.setDrawRange(0, 0); }
  }

  /* 사슬을 떨어지는 리본으로 넘기고 현재 길이를 0 으로(최장은 유지) */
  function breakRibbon(why) {
    if (!active) return;
    st.log.push([+st.lastPeelT.toFixed(2), why || 'cut', Math.round(st.lenPx)]);
    if (active.length >= 3) {
      falls.push({ pts: active, age: 0 });
      if (falls.length > R.FALL_MAX) falls.shift();
    }
    active = null; st.lenPx = 0; st.grow = 0; st.breaks++;
  }

  function simulate(pts, dt, pinHead, free) {
    var dt2 = dt * dt, g = R.GRAVITY * dt2, drift = R.DRIFT_X * dt2, k = R.DAMP * (dt / st.lastDt), n = pts.length;
    var curlFrom = Math.floor(n * R.CURL_FROM);
    for (var i = pinHead ? 1 : 0; i < n; i++) {
      var p = pts[i], vx = (p.x - p.px) * k, vy = (p.y - p.py) * k, ax = drift, ay = g;
      if (pinHead && i < R.LIFT_N) {                              // 갓 분리된 껍질: 날 엣지를 따라 들려 나온 뒤 처진다
        var w = 1 - i / R.LIFT_N; ax += st.liftDir[0] * R.LIFT_ACC * w * dt2; ay += st.liftDir[1] * R.LIFT_ACC * w * dt2;
      }
      if (i >= Math.max(2, curlFrom)) {                           // 끝부분이 안쪽으로 말림(진행 방향의 왼쪽 수직)
        var q = pts[i - 1], dx = p.x - q.x, dy = p.y - q.y, l = Math.sqrt(dx * dx + dy * dy) || 1;
        var c = (i - curlFrom) / Math.max(1, n - curlFrom); c = c * c * R.CURL_ACC * dt2 * (free ? 0.6 : 1);
        ax += -dy / l * c; ay += dx / l * c;
      }
      p.px = p.x; p.py = p.y;
      p.x += vx + ax; p.y += vy + ay;
    }
    for (var it = 0; it < R.ITER; it++) {
      for (var j = 1; j < n; j++) {
        var a = pts[j - 1], b = pts[j], ddx = b.x - a.x, ddy = b.y - a.y, d = Math.sqrt(ddx * ddx + ddy * ddy);
        if (d <= R.SEG_LEN || d < 1e-6) continue;                 // 줄: 늘어나지 않지만 줄어들 수는 있다(말림)
        var diff = (d - R.SEG_LEN) / d;
        if (j - 1 === 0 && pinHead) { b.x -= ddx * diff; b.y -= ddy * diff; }
        else if (free) { a.x += ddx * diff * 0.5; a.y += ddy * diff * 0.5; b.x -= ddx * diff * 0.5; b.y -= ddy * diff * 0.5; }
        else { b.x -= ddx * diff; b.y -= ddy * diff; }
      }
    }
    if (R.SMOOTH > 0) for (var m = 2; m < n - 1; m++) {           // 지그재그 완화
      var pm = pts[m]; pm.x += R.SMOOTH * ((pts[m - 1].x + pts[m + 1].x) / 2 - pm.x); pm.y += R.SMOOTH * ((pts[m - 1].y + pts[m + 1].y) / 2 - pm.y);
    }
    if (pinHead) keepOutOfBlade(pts);
  }

  /* 리본이 날 엣지 안쪽(칼 몸 쪽)으로 파고들지 않게 한다 → 껍질이 칼 옆면에 붙어 보이지 않음.
   * 날 엣지(회전한 폴리라인)의 법선 기준: 법선은 칼과 함께 회전하므로 칼을 −75°~+75° 로 기울여도 같은 규칙이다(이전 규칙 "같은 높이의 날 x 보다 오른쪽 금지" 는 칼이 수직일 때만 맞고,
   * 크게 기울이면 날 선 반대편의 마디가 수십 px 순간이동했다). 엣지 구간 안쪽(투영 0~1)이고 칼 몸 쪽으로 BLADE_DEPTH 이내인 마디만 날 선 바깥(여유 BLADE_CLEAR)으로 밀어낸다. */
  function keepOutOfBlade(pts) {
    var e = AP.cutting.edgeStage(), segs = e.length - 1, clear = R.BLADE_CLEAR, depth = R.BLADE_DEPTH;
    for (var h = 1; h < pts.length; h++) {
      var p = pts[h];
      for (var q = 0; q < segs; q++) {
        var ax = e[q][0], ay = e[q][1], tx = e[q + 1][0] - ax, ty = e[q + 1][1] - ay, len2 = tx * tx + ty * ty;
        if (len2 < 1e-9) continue;
        var t = ((p.x - ax) * tx + (p.y - ay) * ty) / len2;
        if (t < 0 || t > 1) continue;
        var len = Math.sqrt(len2), nx = -ty / len, ny = tx / len;          // 팁→힐 방향의 접선을 90° 돌린 법선: 칼 몸의 반대쪽(과일 쪽)
        var d = (p.x - ax) * nx + (p.y - ay) * ny;                        // + = 과일 쪽
        if (d < clear && d > -depth) { p.x += nx * (clear - d); p.y += ny * (clear - d); }
        break;
      }
    }
  }

  function fill(mesh, src, alpha) {
    var n = Math.min(src.length, R.MAX_POINTS + 2);
    if (n < 2) { mesh.visible = false; return; }
    var pos = mesh.geometry.attributes.position.array, col = mesh.geometry.attributes.color.array;
    var skin = srgb(C.SKIN_COLOR), flesh = srgb(C.FLESH_COLOR), inner = skin.clone().lerp(flesh, 0.45);   // 겉 = 껍질 빨강, 안쪽 = 옅은 붉은색
    var pts = new Array(n);
    for (var a = 0; a < n; a++) {                                  // 렌더용 1회 평활(머리는 고정) — 가장자리 톱니 제거
      var p = src[a];
      pts[a] = (a === 0 || a === n - 1) ? { x: p.x, y: p.y, id: p.id } : { x: 0.25 * src[a - 1].x + 0.5 * p.x + 0.25 * src[a + 1].x, y: 0.25 * src[a - 1].y + 0.5 * p.y + 0.25 * src[a + 1].y, id: p.id };
    }
    for (var i = 0; i < n; i++) {
      var p0 = pts[Math.max(0, i - 1)], p1 = pts[Math.min(n - 1, i + 1)];
      var dx = p1.x - p0.x, dy = p1.y - p0.y, l = Math.sqrt(dx * dx + dy * dy) || 1;
      var nx = -dy / l, ny = dx / l;
      var sTw = Math.cos(pts[i].id * R.TWIST + 0.3);                // + 겉면 / − 안쪽면
      var tw = Math.max(R.WIDTH_MIN, Math.abs(sTw));
      var taper = Math.min(1, 0.45 + i / 3) * Math.min(1, 0.25 + (n - 1 - i) / 5);   // 머리(분리되는 곳)와 꼬리 끝은 가늘게
      var w = R.WIDTH * 0.5 * tw * taper;
      var o = i * 6;
      pos[o] = pts[i].x + nx * w; pos[o + 1] = -(pts[i].y + ny * w); pos[o + 2] = 0.6;
      pos[o + 3] = pts[i].x - nx * w; pos[o + 4] = -(pts[i].y - ny * w); pos[o + 5] = 0.6;
      var base = sTw >= 0 ? skin : inner, sh = (pts[i].id % 2) ? 1.0 : 0.94;   // 마디별 아주 약한 명암 = 로우폴리 면
      col[o] = col[o + 3] = base.r * sh; col[o + 1] = col[o + 4] = base.g * sh; col[o + 2] = col[o + 5] = base.b * sh;
    }
    mesh.geometry.attributes.position.needsUpdate = true; mesh.geometry.attributes.color.needsUpdate = true;
    mesh.geometry.setDrawRange(0, (n - 1) * 6);
    mesh.material.opacity = alpha;
    mesh.visible = true;
  }

  function tick(dt, t, contact) {
    if (!inited) return;
    var vs = AP.apple.current.viewScale;
    var peeled = contact && contact.newlyPeeled > 0 && contact.peelLen > 0 && contact.peelX !== null;
    if (peeled) {
      if (active && Math.hypot(contact.peelX - st.head[0], contact.peelY - st.head[1]) > R.JUMP_MAX) { breakRibbon('jump'); }
      st.head = [contact.peelX, contact.peelY];
      var e = AP.cutting.edgeStage(), kk = 0, bd = Infinity;       // 절삭점에 가장 가까운 날 구간의 접선(위쪽)·법선(날에서 멀어지는 쪽)
      for (var q = 0; q < e.length - 1; q++) { var dd = Math.abs((e[q][1] + e[q + 1][1]) / 2 - st.head[1]); if (dd < bd) { bd = dd; kk = q; } }
      var tx = e[kk][0] - e[kk + 1][0], ty = e[kk][1] - e[kk + 1][1], tl = Math.sqrt(tx * tx + ty * ty) || 1; tx /= tl; ty /= tl;
      var lx = tx + R.LIFT_SIDE * ty, ly = ty - R.LIFT_SIDE * tx, ll = Math.sqrt(lx * lx + ly * ly) || 1;
      st.liftDir = [lx / ll, ly / ll];
      if (!active) { active = [newPoint(st.head[0], st.head[1]), newPoint(st.head[0], st.head[1])]; st.grow = 0; }
      st.lastPeelT = t;
      st.lenPx += contact.peelLen; st.emitted += contact.peelLen;
      if (st.lenPx > st.longestPx) st.longestPx = st.lenPx;
      st.grow += contact.peelLen * vs;
      while (st.grow >= R.SEG_LEN) { st.grow -= R.SEG_LEN; active.unshift(newPoint(st.head[0], st.head[1])); }
    } else if (active && t - st.lastPeelT > R.BREAK_GRACE) {
      breakRibbon('grace');
    }
    if (active) {
      active[0].x = st.head[0]; active[0].y = st.head[1]; active[0].px = st.head[0]; active[0].py = st.head[1];
      simulate(active, dt, true, false);
      while (active.length > R.MAX_POINTS) active.pop();
    }
    for (var i = falls.length - 1; i >= 0; i--) {
      var f = falls[i]; f.age += dt;
      simulate(f.pts, dt, false, true);
      var allBelow = true;
      for (var q = 0; q < f.pts.length; q++) if (f.pts[q].y < AP.scene.logicalH + 30) { allBelow = false; break; }
      if (allBelow || f.age > R.FALL_LIFE) falls.splice(i, 1);
    }
    st.lastDt = Math.max(1e-4, dt);
    if (active) fill(meshes[0], active, 1); else meshes[0].visible = false;
    for (var m = 0; m < R.FALL_MAX; m++) {
      var fm = meshes[1 + m];
      if (falls[m]) fill(fm, falls[m].pts, Math.max(0, 1 - Math.pow(falls[m].age / R.FALL_LIFE, 3))); else fm.visible = false;
    }
  }

  function info() {
    return { active: !!active, curPx: st.lenPx, longestPx: st.longestPx, curCm: st.lenPx / R.PX_PER_CM, longestCm: st.longestPx / R.PX_PER_CM, emittedPx: st.emitted,
      points: active ? active.length : 0, falling: falls.length, breaks: st.breaks, log: st.log.slice(), head: active ? st.head.slice() : null };
  }
  function points() { return active ? active.map(function (p) { return [p.x, p.y]; }) : []; }

  /* QA: 지금 화면의 활성 리본 정점 색(sRGB 0~255, 중복 제거) — 과일별 껍질 색 검증용 */
  function colorsNow() {
    var m = meshes[0]; if (!m || !m.visible) return [];
    var a = m.geometry.attributes.color.array, n = m.geometry.drawRange.count, seen = {}, out = [], tmp = new THREE.Color(), o = {};
    for (var i = 0; i < Math.min(a.length / 3, n / 3 + 2); i++) { tmp.setRGB(a[i * 3], a[i * 3 + 1], a[i * 3 + 2], THREE.LinearSRGBColorSpace); tmp.getRGB(o, THREE.SRGBColorSpace); var c = [Math.round(o.r * 255), Math.round(o.g * 255), Math.round(o.b * 255)], k = c.join(','); if (!seen[k]) { seen[k] = 1; out.push(c); } }
    return out;
  }
  return { colorsNow: colorsNow, init: init, reset: reset, tick: tick, cut: breakRibbon, info: info, points: points, fallPoints: function () { return falls.map(function (f) { return f.pts.map(function (p) { return [p.x, p.y]; }); }); } };
})();
