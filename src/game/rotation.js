/* AppleRotationSystem — 회전 속도·각도·방향, 표면 좌표(셀 섹터) 동기화.
 *
 * 각도 φ(rad) 는 사과 그룹의 rotation.y 에 그대로 들어간다. Three.js 의 +y 축 회전은 +z(카메라 쪽) 를 +x(화면 오른쪽)로 보내므로
 * φ 가 커지면 정면(z>0) 표면이 화면 왼쪽→오른쪽으로 움직인다(명세 방향). 검증은 tools/qa.js 의 마커 추적.
 *
 * 월드 각 ↔ 로컬 각: 로컬 각 θ(x→z 방향으로 잰 각)의 점은 회전 후 월드 각 θ - φ 에 온다. 따라서 "칼이 있는 쪽"(월드 각 0, +x)에
 * 지금 와 있는 표면의 로컬 각은 φ 다 → sectorAtWorld(0) 이 지금 칼 앞을 지나는 셀 열. */
'use strict';
window.AP = window.AP || {};

AP.rotation = (function () {
  var C = AP.CONFIG;
  var S = { angle: 0, omega: 0, dir: C.ROTATION_DIR, period: C.ROTATION_PERIOD, turns: 0 };
  var TAU = Math.PI * 2;

  function reset() { S.angle = 0; S.turns = 0; S.omega = S.dir * TAU / S.period; }
  function update(dt) { S.angle += S.omega * dt; S.turns = S.angle / TAU; }
  function localAngleAtWorld(worldAngle) { var a = (worldAngle + S.angle) % TAU; return a < 0 ? a + TAU : a; }
  function sectorAtWorld(worldAngle, sectors) { return Math.floor(localAngleAtWorld(worldAngle) / TAU * sectors) % sectors; }

  reset();
  return {
    reset: reset, update: update, localAngleAtWorld: localAngleAtWorld, sectorAtWorld: sectorAtWorld,
    get angle() { return S.angle; }, set angle(v) { S.angle = v; S.turns = v / TAU; },
    get omega() { return S.omega; }, get turns() { return S.turns; },
    get period() { return S.period; }, set period(v) { S.period = v; S.omega = S.dir * TAU / v; },
  };
})();
