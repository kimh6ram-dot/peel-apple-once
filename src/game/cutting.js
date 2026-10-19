/* AppleCuttingSystem — 날(bladeEdge)과 칼 쪽 자오선의 접촉 → 셀 절삭(껍질 제거 · 반복 절삭 · 과육 손실 · 표면 상태 저장).
 *
 * 매 프레임:
 *  1) 지금 칼 앞(월드각 0, +x)을 지나는 로컬 섹터 = rotation.sectorAtWorld(0). 지난 프레임 섹터부터 이번 섹터까지 회전 방향으로 전부 처리
 *     (프레임이 느려도 섹터를 건너뛰지 않는다).
 *  2) **활성 절삭점 = 칼 피벗(날 위의 고정점, Q/E 회전 중심)**. 피벗 높이 ±WINDOW_HALF(px) 안이면서 피벗 행과 원래 반경 차가 WINDOW_HALF 이내인
 *     셀 행만 판정한다(급경사에서는 구간이 저절로 좁아진다) → 칼을 내리면 구간이 따라온다.
 *     행마다: 행 중앙 높이의 스테이지 y → 그 높이에서의 날 x(**현재 기울기로 회전한** bladeEdge 폴리라인 보간, 날 범위 밖이면 접촉 없음)
 *     → 날 반경 rBlade = (날 x − 사과 중심 x) / 화면 배율. depth0 = r0 − rBlade(원래 껍질 기준, 구간 안 최대값을 보고).
 *  3) 구간 안의 행: 현재 셀 반경 r = r0 − rec 가 rBlade 보다 크면 그 차이만큼 깎여 r = rBlade (선반과 같다).
 *     기울기를 표면 경사에 맞추면 구간 위아래 행이 고르게 깎이고, 세워 두면 넓은 쪽 행이 더 깊이 파인다(곡면에 맞춰 각도·깊이 조절).
 *     → 깊이는 **날의 실제 위치**로만 정해진다. 같은 위치에 오래 두면 한 바퀴 뒤엔 더 깎이지 않고, 더 밀어 넣어야(←) 더 깊어진다.
 *     창 밖의 행은 날이 겹쳐도 깎지 않는다(날의 평평한 면이 표면 위를 지나는 것으로 본다) → 같은 높이에 두면 얇은 띠, 천천히 내리면 나선.
 *     손잡이·bolster·등·힐은 폴리라인에 없으므로 어떤 높이에서 사과와 겹쳐도 절삭되지 않는다.
 *  4) 셀 상태: rec ≥ skin×PEEL_MIN_FRAC → peeled(상태 1, 면적 1회만 집계) · rec > skin → fleshLoss = rec − skin 누적(상태 2, 부피 집계).
 *  5) 변형된 셀을 apple.markDirty → flushDirty 로 메시 갱신(코너 공유 규칙으로 실제 파임). 접촉점(contact.x/y)은 껍질 조각 생성 위치.
 * 집계: 껍질 제거율 = peeledArea/totalArea, 과육 손실률 = fleshVolume(Σ 손실 깊이×면적)/몸통 부피(Σ 면적×r0/2), 둘 다 상한 100%.
 *
 * 절삭은 칼 쪽 실루엣(월드각 0)에서 일어나고 정면 표면은 왼쪽→오른쪽으로 움직이므로, 막 깎인 셀은 뒤쪽으로 넘어간다(물리대로).
 * 즉시 피드백은 실루엣의 홈(메시 변형)·접촉점 껍질 조각·HUD 수치·위에서 내려다보는 카메라가 보여주는 윗반쪽 뒷면이다. */
'use strict';
window.AP = window.AP || {};

AP.cutting = (function () {
  var C = AP.CONFIG, CUT = C.CUT;
  var S = { prevSec: null, contact: null, log: false, events: 0 };
  var rowY = null, rowKey = '';
  var edgeCache = { key: '', pts: null };
  var rowEdgeX = null;
  var _v = new THREE.Vector3();

  function reset() { S.prevSec = null; S.contact = null; S.events = 0; rowKey = ''; edgeCache.key = ''; }

  /* 셀 행 중앙 높이의 스테이지 y (레이아웃/배율이 바뀔 때만 다시 계산) */
  function rowStageYs(Sf) {
    var vs = AP.apple.current.viewScale;
    var key = AP.scene.appleCx + '|' + AP.scene.appleCy + '|' + AP.scene.logicalH + '|' + vs;
    if (key !== rowKey) {
      rowKey = key; rowY = new Float32Array(Sf.NR);
      for (var i = 0; i < Sf.NR; i++) rowY[i] = AP.scene.project(_v.set(0, (Sf.ringY[i] + Sf.ringY[i + 1]) / 2 * vs, 0)).y;
    }
    return rowY;
  }
  /* 현재 피벗·기울기·배율로 회전한 날 폴리라인(스테이지 px). 같은 자세면 재사용 */
  function edgeStage() {
    var k = AP.knife, key = k.px + '|' + k.py + '|' + k.angle + '|' + k.scale;
    if (key !== edgeCache.key) { edgeCache.key = key; edgeCache.pts = k.data.edge.map(k.toStage); }
    return edgeCache.pts;
  }
  /* 스테이지 y 에서 날(bladeEdge)의 x. 날 범위(팁~힐 시작) 밖이면 null. 기울어도 폴리라인을 그대로 따라간다 */
  function edgeXAt(stageY) {
    var e = edgeStage();
    for (var i = 0; i < e.length - 1; i++) {
      var a = e[i], b = e[i + 1], lo = a[1] < b[1] ? a[1] : b[1], hi = a[1] < b[1] ? b[1] : a[1];
      if (stageY >= lo && stageY <= hi) { var t = hi === lo ? 0 : (stageY - a[1]) / (b[1] - a[1]); return a[0] + (b[0] - a[0]) * t; }
    }
    return null;
  }

  function applyCut(Sf, apple, idx, recNew, contact) {
    var old = Sf.rec[idx];
    if (recNew <= old) return;
    Sf.rec[idx] = recNew;
    if (recNew > Sf.maxRec) Sf.maxRec = recNew;
    var skin = Sf.skin[idx];
    if (!Sf.peeled[idx] && recNew >= skin * CUT.PEEL_MIN_FRAC) { Sf.peeled[idx] = 1; Sf.peeledArea += Sf.area[idx]; contact.newlyPeeled++; contact.newRows[Math.floor(idx / Sf.NS)] = (contact.newRows[Math.floor(idx / Sf.NS)] || 0) + 1; }
    var loss = Math.max(0, recNew - skin), dLoss = loss - Sf.fleshLoss[idx];
    if (dLoss > 0) {
      var K = CUT.FLESH_CONVEX_REF, d0f = Sf.fleshLoss[idx];
      Sf.fleshLoss[idx] = loss; Sf.fleshVolume += dLoss * Sf.area[idx]; contact.fleshDelta += dLoss * Sf.area[idx];
      Sf.fleshIndex += (loss + loss * loss / K - d0f - d0f * d0f / K) * Sf.area[idx];     // 현재 표면 깊이 기준 증분(같은 곳 중복 없음)
    }
    Sf.state[idx] = Sf.fleshLoss[idx] >= CUT.FLESH_VISIBLE ? 2 : (Sf.peeled[idx] ? 1 : 0);
    apple.markDirty(idx);
    contact.cutCells++;
  }

  function update(dt) {
    var apple = AP.apple.current, Sf = apple.surface, NS = Sf.NS, NR = Sf.NR, vs = apple.viewScale;
    var sec = AP.rotation.sectorAtWorld(0, NS);
    var sectors = [];
    if (S.prevSec === null || S.prevSec === sec) sectors.push(sec);
    else {
      var dir = AP.rotation.omega >= 0 ? 1 : -1, k = S.prevSec, guard = 0;
      while (k !== sec && guard++ < NS) { k = (k + dir + NS) % NS; sectors.push(k); }
    }
    S.prevSec = sec;

    var WH = CUT.WINDOW_HALF * CUT.WIDTH_SCALE;      // 활성 절삭 구간 반폭(px): 판정 폭 = 화면 표시 폭(같은 셀 데이터)
    var ys = rowStageYs(Sf), cx = AP.scene.appleCx, pivotY = AP.knife.py;
    if (!rowEdgeX || rowEdgeX.length !== NR) rowEdgeX = new Float32Array(NR);
    var contact = { sector: sec, sectors: sectors.length, inRange: 0, iDeep: -1, depth0: 0, depthCur: 0, rows: 0, iMin: -1, iMax: -1, windowRows: 0, cutCells: 0, newlyPeeled: 0, fleshDelta: 0, x: AP.knife.px, y: pivotY, windowHalf: WH, newRows: {}, peelX: null, peelY: null, peelLen: 0, tier: 1, depthRatio: 0 };

    /* 1차: 활성 절삭 구간 = 피벗 높이 ±WINDOW_HALF 안이면서, 피벗에 가장 가까운 행과 원래 반경 차도 WINDOW_HALF 이내인 행
     * (능선·바닥처럼 급경사인 곳에서 세로 12px 안에 반경이 20px 넘게 달라지는 행까지 한 구간으로 묶이지 않게 — 날의 짧은 유효 구간이 표면을 따라간다).
     * 행마다 날 x · 원래 껍질 기준 깊이(구간 안 최대값 = depth0, 그 행 = iDeep) */
    var deep0 = -Infinity, refRow = -1, refDist = Infinity;
    for (var i = 0; i < NR; i++) {
      rowEdgeX[i] = NaN;
      if (Math.abs(ys[i] - pivotY) > WH) continue;
      var xe = edgeXAt(ys[i]);
      if (xe === null) continue;
      rowEdgeX[i] = xe;
      var dist = Math.abs(ys[i] - pivotY);
      if (dist < refDist) { refDist = dist; refRow = i; }
    }
    if (refRow >= 0) {
      var refR = Sf.r0[refRow * NS];
      for (var i2 = 0; i2 < NR; i2++) {
        if (isNaN(rowEdgeX[i2])) continue;
        if (Math.abs(Sf.r0[i2 * NS] - refR) > WH) { rowEdgeX[i2] = NaN; continue; }
        contact.inRange++;
        var d0 = Sf.r0[i2 * NS] - (rowEdgeX[i2] - cx) / vs;
        if (d0 > deep0) { deep0 = d0; contact.iDeep = i2; }
      }
    }
    if (contact.iDeep >= 0) contact.depth0 = deep0;
    /* 절삭 깊이 단계(1~4): 활성 구간에서 원래 껍질 기준 가장 깊은 침투 / 그 행의 껍질 두께 */
    contact.tier = 1;
    if (contact.iDeep >= 0 && deep0 > CUT.CONTACT_EPS) { var ratio0 = deep0 / Sf.skin[contact.iDeep * NS]; contact.depthRatio = ratio0; contact.tier = ratio0 > 1 ? 4 : (ratio0 >= CUT.PEEL_MIN_FRAC ? 3 : 2); }

    /* 2차: 구간 안의 행, 이번 프레임에 날 앞을 지난 섹터 전부 */
    if (contact.iDeep >= 0 && deep0 > CUT.CONTACT_EPS) {
      for (var r = 0; r < NR; r++) {
        if (isNaN(rowEdgeX[r])) continue;
        contact.windowRows++;
        var rBlade = (rowEdgeX[r] - cx) / vs, rowHit = false;
        for (var q = 0; q < sectors.length; q++) {
          var idx = r * NS + sectors[q];
          var depth = (Sf.r0[idx] - Sf.rec[idx]) - rBlade;        // 현재 표면 기준 겹침
          if (depth <= CUT.CONTACT_EPS) continue;
          rowHit = true;
          if (depth > contact.depthCur) contact.depthCur = depth;
          applyCut(Sf, apple, idx, Math.min(Sf.r0[idx] * CUT.MAX_REC_FRAC, Sf.r0[idx] - rBlade), contact);
        }
        if (rowHit) { contact.rows++; if (contact.iMin < 0) contact.iMin = r; contact.iMax = r; }
      }
    }
    /* 리본 입력: 이번 프레임에 새로 벗겨진 셀의 무게중심(실제 절삭점) · 새 껍질의 경로 길이 = (한 행에서 새로 벗겨진 셀 수) × 셀 호 길이(사과 단위 px, 가장 많이 벗겨진 행 기준 = 하나의 띠) */
    if (contact.newlyPeeled > 0) {
      var sx = 0, sy = 0, sw = 0, bestN = 0, bestRow = -1;
      for (var key in contact.newRows) { var rr = +key, nn = contact.newRows[key]; sx += rowEdgeX[rr] * nn; sy += ys[rr] * nn; sw += nn; if (nn > bestN) { bestN = nn; bestRow = rr; } }
      contact.peelX = sx / sw; contact.peelY = sy / sw;
      contact.peelLen = bestN * Sf.r0[bestRow * NS] * (Math.PI * 2 / NS);
    }
    S.contact = contact;
    var written = apple.flushDirty();
    if (S.log && contact.cutCells > 0) {
      S.events++;
      console.log('[cut] t=' + AP.play.getSnapshot().t.toFixed(2) + ' sec=' + sec + '(' + sectors.length + ') tilt=' + AP.knife.angleDeg.toFixed(1) + '° center=' + contact.iDeep + ' rows=' + contact.iMin + '~' + contact.iMax + ' depth=' + contact.depthCur.toFixed(2) + ' (orig ' + contact.depth0.toFixed(2) + ') cut=' + contact.cutCells + ' peeled+' + contact.newlyPeeled + ' fleshΔ=' + contact.fleshDelta.toFixed(1) + ' mesh=' + written + ' → peel ' + peelPct().toFixed(1) + '% flesh ' + fleshPct().toFixed(2) + '%');
    }
  }

  function peelPct() { var Sf = AP.apple.current.surface; return Math.min(100, 100 * Sf.peeledArea / Sf.totalArea); }
  function fleshPct() { var Sf = AP.apple.current.surface; return Math.min(100, 100 * Sf.fleshIndex / Sf.volume); }
  function fleshVolumePct() { var Sf = AP.apple.current.surface; return Math.min(100, 100 * Sf.fleshVolume / Sf.volume); }

  /* 개발용: 상태 집계 · 섹터 한 줄 덤프 · 전체 그리드 문자열(위→아래 행, 섹터 0..NS-1: . 미절삭 o 껍질 제거 X 과육 파임) */
  function cellStats() {
    var Sf = AP.apple.current.surface, c = [0, 0, 0], n = Sf.NR * Sf.NS;
    for (var q = 0; q < n; q++) c[Sf.state[q]]++;
    return { unpeeled: c[0], peeled: c[1], flesh: c[2], total: n, peelPct: peelPct(), fleshPct: fleshPct(), maxRec: Sf.maxRec, peeledArea: Sf.peeledArea, totalArea: Sf.totalArea, fleshVolume: Sf.fleshVolume, fleshIndex: Sf.fleshIndex, fleshVolumePct: fleshVolumePct() };
  }
  function cellsAt(sector) {
    var Sf = AP.apple.current.surface, out = [];
    for (var i = 0; i < Sf.NR; i++) { var idx = i * Sf.NS + sector; out.push({ row: i, r0: +Sf.r0[idx].toFixed(2), rec: +Sf.rec[idx].toFixed(2), skin: +Sf.skin[idx].toFixed(2), state: Sf.state[idx], fleshLoss: +Sf.fleshLoss[idx].toFixed(2) }); }
    return out;
  }
  function dumpSurface() {
    var Sf = AP.apple.current.surface, lines = [];
    for (var i = Sf.NR - 1; i >= 0; i--) { var row = ''; for (var j = 0; j < Sf.NS; j++) row += '.oX'[Sf.state[i * Sf.NS + j]]; lines.push((i < 10 ? ' ' : '') + i + ' ' + row); }
    return lines.join('\n');
  }

  return {
    reset: reset, update: update, peelPct: peelPct, fleshPct: fleshPct, fleshVolumePct: fleshVolumePct, edgeXAt: edgeXAt, edgeStage: edgeStage, rowStageYs: function () { return rowStageYs(AP.apple.current.surface); },
    cellStats: cellStats, cellsAt: cellsAt, dumpSurface: dumpSurface,
    get contact() { return S.contact; }, set log(v) { S.log = !!v; }, get log() { return S.log; },
  };
})();
