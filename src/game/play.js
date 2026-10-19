/* GameStateSystem — 단 한 번의 절삭: intro → ready → playing → ended → (다시 깎기) ready.
 *   READY   : 사과 자동 회전 · 칼 이동/각도 조절 가능 · 절삭·리본·점수 기록 없음(칼이 닿기 전)
 *   PLAYING : 회색 칼날의 실제 엣지가 사과 표면에 **처음 닿는 프레임**에 시작(그 프레임부터 절삭). 타이머 없음.
 *   ENDED   : 칼날이 표면과 떨어진 채 CONTACT_GRACE_MS 를 넘기면 종료 → 입력 중단 · 표면 확정 · 리본 정리 · 점수. 같은 판에서 재접촉 불가.
 * 접촉 = 날 폴리라인(bladeEdge)과 칼 쪽 자오선의 간격(probe.gap). 시작: 겹침(maxDepth > CONTACT_EPS). 유지: gap ≤ CONTACT_TOL(깎인 홈에 맞닿은 상태 포함).
 * 손잡이·연결부·등은 폴리라인에 없으므로 접촉에 쓰이지 않는다. 껍질 리본이 끊겨도(새 껍질 없음) 접촉만 있으면 종료하지 않는다. 모든 갱신은 deltaTime(상한 1/20s) 기반. */
'use strict';
window.AP = window.AP || {};

AP.play = (function () {
  var C = AP.CONFIG, RU = C.RULES;
  var S = { state: 'intro', t: 0, playT: 0, endT: 0, endReason: null, paused: false, noContactT: 0, contact: false, qa: false };

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* 시작 화면 상태로 초기화: 표면·회전각·칼 시작 위치·입력·리본 */
  function reset() {
    S.state = 'intro'; S.t = 0; S.playT = 0; S.endT = 0; S.endReason = null; S.paused = false; S.noContactT = 0; S.contact = false;
    if (AP.score && AP.score.reroll) AP.score.reroll();            // 평가 문구(랜덤 구간)는 판마다 한 번
    AP.rotation.reset();
    AP.cutting.reset();
    AP.ribbon.reset();
    AP.input.clear();
    var apple = AP.apple.current;
    if (apple) { apple.resetSurface(); apple.setAngle(0); }
    if (AP.knife.layout && AP.knife.data) AP.knife.place(AP.apple.silhouetteX);
  }
  /* 시작하기 / 다시 깎기 → READY (절삭은 칼이 처음 닿을 때 시작) */
  function start() {
    if (S.state === 'ready' || S.state === 'playing') return false;
    reset();
    S.state = 'ready';
    return true;
  }
  /* QA 호환 모드(기계 동작 테스트용): 접촉 상실로 종료하지 않는다. 실제 규칙은 qa=false */
  function setQaMode(b) { S.qa = !!b; }
  function forcePlaying() { if (S.state === 'ready') S.state = 'playing'; }
  function finish(reason) {
    if (S.state !== 'playing') return false;
    S.state = 'ended'; S.endReason = reason || 'detach';
    AP.ribbon.cut();                              // 끝난 순간 이어져 있던 껍질은 떨어진다
    AP.input.clear();
    return true;
  }
  function setPaused(b) { S.paused = !!b; }

  function probe() { return AP.blade.probe(AP.apple.silhouetteX); }

  function update(dt) {
    dt = clamp(dt, 0, 1 / 20);
    if (dt <= 0 || S.paused) return;
    if (S.state === 'ended') { S.endT += dt; AP.ribbon.tick(dt, S.playT, null); return; }   // 마무리(SETTLING): 사과는 확정, 마지막 껍질 리본만 분리·낙하
    if (S.state !== 'ready' && S.state !== 'playing') return;
    S.t += dt;
    AP.rotation.update(dt);                       // AppleRotationSystem
    AP.apple.current.setAngle(AP.rotation.angle);
    AP.knife.update(dt, AP.input.dirs());         // KnifeControlSystem
    if (S.state === 'ready') {
      var p = probe();
      if (p.maxDepth !== null && p.maxDepth > C.CUT.CONTACT_EPS) { S.state = 'playing'; S.noContactT = 0; }   // 첫 접촉 → 같은 프레임부터 절삭
      else return;
    }
    S.playT += dt;
    AP.cutting.update(dt);                        // AppleCuttingSystem: 날 × 칼 쪽 자오선 → 셀 절삭(PLAYING 에서만)
    AP.ribbon.tick(dt, S.playT, AP.cutting.contact);
    var q = probe();                              // 방금 절삭한 표면 기준(홈에 맞닿아 있으면 gap ≈ 0)
    S.contact = q.gap <= RU.CONTACT_TOL;
    if (S.contact) S.noContactT = 0; else S.noContactT += dt;
    if (!S.qa && S.noContactT * 1000 > RU.CONTACT_GRACE_MS) finish('detach');
  }

  function metrics() {
    var info = AP.ribbon.info();
    return { peelPct: AP.cutting.peelPct(), fleshPct: AP.cutting.fleshPct(), longestCm: info.longestCm, emittedCm: info.emittedPx / C.RIBBON.PX_PER_CM };
  }

  function getSnapshot() {
    var k = AP.knife, pr = k.placed ? probe() : null;
    var m = AP.apple.current ? metrics() : null;
    var cutNow = AP.cutting.contact;
    var touching = S.state === 'playing' ? S.contact : (S.state === 'ready' && !!pr && pr.maxDepth !== null && pr.maxDepth > C.CUT.CONTACT_EPS);
    return {
      /* 접촉과 절삭은 다른 값: isBladeContacting = 날 엣지가 현재 표면에 닿아 있는가(probe.gap ≤ TOL, 이미 깎인 홈 포함) · isPeeling = 이번 프레임에 새 껍질이 벗겨졌는가 */
      isBladeContacting: touching, isPeeling: S.state === 'playing' && !!cutNow && cutNow.newlyPeeled > 0,
      contactDistance: pr ? pr.gap : null, contactLostMs: S.noContactT * 1000, graceMs: RU.CONTACT_GRACE_MS, contactCandidate: pr && pr.atX !== null ? { x: pr.atX, y: pr.atY } : null,
      selectedFruit: AP.fruits ? AP.fruits.current.id : null, qaMode: S.qa,
      state: S.state, t: S.t, playT: S.playT, endT: S.endT, endReason: S.endReason, paused: S.paused, contact: S.contact, noContactMs: S.noContactT * 1000,
      angle: AP.rotation.angle, turns: AP.rotation.turns, omega: AP.rotation.omega,
      knife: { x: k.x, y: k.y, px: k.px, py: k.py, angle: k.angle, angleDeg: k.angleDeg, vx: k.vx, vy: k.vy, vrot: k.vrot, scale: k.scale, tip: k.placed ? k.tipStage() : null, rect: k.placed ? k.rectStage() : null, bounds: { minX: k.bounds.minX, maxX: k.bounds.maxX, minY: k.bounds.minY, maxY: k.bounds.maxY } },
      ribbon: AP.ribbon.info(),
      probe: pr,
      score: m ? AP.score.compute(m) : null,
      fleshVolumePct: AP.apple.current ? AP.cutting.fleshVolumePct() : 0,
      peelPct: m ? m.peelPct : 0,
      fleshPct: m ? m.fleshPct : 0,
      cut: AP.cutting.contact,                    // 이번 프레임 접촉/절삭 요약(섹터·행 범위·깊이·셀 수)
      dirs: AP.input.dirs(),
    };
  }

  return { reset: reset, start: start, finish: finish, update: update, getSnapshot: getSnapshot, setPaused: setPaused, setQaMode: setQaMode, forcePlaying: forcePlaying, get state() { return S.state; }, get qa() { return S.qa; } };
})();
