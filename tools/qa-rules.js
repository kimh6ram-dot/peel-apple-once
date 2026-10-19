/* QA: 단 한 번의 절삭 규칙 — READY / PLAYING / FINISHED, 첫 접촉, 접촉 유지, 이탈 종료, 유예, 재시작, 화면(제한 시간 삭제·HUD·시작 문구).
 * 실제 규칙으로 돌린다(AP_DEBUG.setLegacy(false)). 사용: node tools/qa-rules.js */
'use strict';
const { chromium } = require('C:/Users/thkim/Desktop/code-work/260624/build/node_modules/playwright-core');
let failures = 0;
function ok(l, c, d) { if (c) console.log('  OK  ', l); else { failures++; console.log('  FAIL', l, d !== undefined ? JSON.stringify(d) : ''); } }
const f = (n, d) => n.toFixed(d === undefined ? 1 : d);
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  await p.goto('file:///C:/Users/thkim/Desktop/code-work/04_꼬직/261014_apple game/index.html');
  await p.waitForFunction(() => window.AP_READY === true, null, { timeout: 60000 });
  await p.evaluate(() => { AP_DEBUG.setPaused(true); AP_DEBUG.setLegacy(false); });
  const R = await p.evaluate(() => {
    const out = {};
    const snap = () => AP_DEBUG.snapshot();
    const fresh = () => { AP_DEBUG.goIntro(); AP_DEBUG.start(); return snap(); };
    const touch = (depth) => { AP_DEBUG.setDirs(-1, 0, 0); let s; for (let i = 0; i < 900; i++) { s = AP_DEBUG.step(1 / 60); if (s.cut && s.cut.depth0 >= depth) break; } AP_DEBUG.setDirs(0, 0, 0); return s; };
    // A 시작 전
    let s = fresh(); out.A0 = s.state;
    AP_DEBUG.setDirs(0, 1, 0); s = AP_DEBUG.run(1.0, 60); AP_DEBUG.setDirs(0, 0, 0);
    const angle0 = s.angle, py0 = s.knife.py; s = AP_DEBUG.run(5, 60);
    out.A = { state: s.state, peel: s.peelPct, flesh: s.fleshPct, score: s.score.total, emitted: s.ribbon.emittedPx, rotated: s.angle > angle0 + 4, moved: py0 > 0, playT: s.playT };
    fresh(); AP_DEBUG.setKnifeAngleDeg(40); out.AhandleGeom = null;
    { const L = AP_DEBUG.layout(), k = AP.knife;   // 날은 사과 밖, 손잡이는 사과 몸통과 겹치는 자세를 찾는다
      search: for (const fy of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]) for (let off = 10; off <= 200; off += 5) {
        k.setOrigin(k.x + (L.appleCx + L.appleR + off - k.px), k.y + (L.bodyTopY + L.bodyH * fy - k.py));
        const pr = AP.blade.probe(AP.apple.silhouetteX), R = AP_DEBUG.regions(), hl = Math.min.apply(null, R.handleRegionPoly.map((q) => q[0]));
        const hy0 = Math.min.apply(null, R.handleRegionPoly.map((q) => q[1])), hy1 = Math.max.apply(null, R.handleRegionPoly.map((q) => q[1]));
        if (pr.maxDepth <= 0 && hl < L.appleCx + L.appleR - 15 && hy1 > L.bodyTopY + 20 && hy0 < L.bodyBottomY - 20) { out.AhandleGeom = { handleLeft: hl, appleRight: L.appleCx + L.appleR, edgeMaxDepth: pr.maxDepth, fy: fy, off: off }; break search; }
      } }
    s = AP_DEBUG.run(3, 60);
    const cs0 = AP_DEBUG.cellStats();
    out.Ahandle = { state: s.state, cutCells: cs0.peeled + cs0.flesh, probeDepth: s.probe.maxDepth };
    // B 첫 접촉
    fresh(); AP_DEBUG.setDirs(-1, 0, 0); let prev = snap(), first = null;
    for (let i = 0; i < 900; i++) { prev = snap(); s = AP_DEBUG.step(1 / 60); if (s.state === 'playing') { first = { prevState: prev.state, prevDepth: prev.probe.maxDepth, depth: s.probe && s.probe.maxDepth, cutCells: s.cut && s.cut.cutCells }; break; } }
    out.B = first; s = AP_DEBUG.run(0.3, 60); out.B2 = { peel: s.peelPct, state: s.state };
    // C 접촉 유지(제한 시간 없음): 한 바퀴 뒤 90초 더
    fresh(); touch(3);
    s = AP_DEBUG.run(2.7, 60); const peelRev = s.peelPct; s = AP_DEBUG.run(90, 60);
    out.C = { state: s.state, playT: s.playT, peelRev: peelRev, peel: s.peelPct, breaks: s.ribbon.breaks, contact: s.contact };
    // D/E 접촉 공백
    const gapTest = (ms) => { fresh(); touch(3); AP_DEBUG.run(0.5, 60);
      AP_DEBUG.setDirs(1, 0, 0); let t = 0, endAt = null, maxNo = 0; const n = Math.round(ms / (1000 / 60));
      for (let i = 0; i < n; i++) { s = AP_DEBUG.step(1 / 60); t += 1000 / 60; maxNo = Math.max(maxNo, s.noContactMs); if (s.state === 'ended' && endAt === null) endAt = t; }
      AP_DEBUG.setDirs(-1, 0, 0); for (let i = 0; i < 30 && s.state === 'playing'; i++) s = AP_DEBUG.step(1 / 60); AP_DEBUG.setDirs(0, 0, 0);
      return { state: s.state, endAt: endAt, maxNo: maxNo, reason: s.endReason }; };
    out.E = [gapTest(80), gapTest(130)];
    out.D = gapTest(400);
    s = snap(); const kx = s.knife.px, peelEnd = s.peelPct, st1 = AP_DEBUG.cellStats().peeled;
    AP_DEBUG.setDirs(-1, 0, 0); s = AP_DEBUG.run(3, 60); AP_DEBUG.setDirs(0, 0, 0);
    out.F = { state: s.state, moved: Math.abs(s.knife.px - kx), peelEnd: peelEnd, peelAfter: s.peelPct, cells: [st1, AP_DEBUG.cellStats().peeled], active: s.ribbon.active };
    fresh(); const r = AP_DEBUG.runAutopilot(200, { single: true, dur: 40, depthFrac: 0.6 });
    out.Spiral = { state: r.snap.state, playT: r.snap.playT, peel: r.snap.peelPct, breaks: r.snap.ribbon.breaks, longest: r.snap.ribbon.longestCm };
    return out;
  });
  console.log('=== A 시작 전(READY) ===');
  ok('시작 후 READY · 칼 이동/사과 회전 · 절삭/점수/리본 기록 0 · 접촉 전 playT 0', R.A0 === 'ready' && R.A.state === 'ready' && R.A.rotated && R.A.peel === 0 && R.A.flesh === 0 && R.A.score === 0 && R.A.emitted === 0 && R.A.playT === 0, R.A);
  ok('갈색 손잡이만 사과와 겹쳐도(' + JSON.stringify(R.AhandleGeom) + ') 시작하지 않음(READY 유지 · 절삭 0)', R.AhandleGeom && R.AhandleGeom.edgeMaxDepth <= 0 && R.Ahandle.state === 'ready' && R.Ahandle.cutCells === 0, { a: R.Ahandle, g: R.AhandleGeom });
  console.log('=== B 첫 접촉 ===');
  ok('칼날이 처음 겹친 프레임에 PLAYING(직전 READY, 겹침 ' + (R.B && f(R.B.depth, 2)) + 'px) · 이어서 절삭 시작', R.B && R.B.prevState === 'ready' && R.B.prevDepth <= 0.05 && R.B.depth > 0.05, R.B);
  ok('시작 직후 껍질이 제거됨(제거율 ' + f(R.B2.peel, 2) + '%)', R.B2.peel > 0 && R.B2.state === 'playing');
  console.log('=== C 접촉 유지 — 제한 시간 없음 ===');
  ok('깎인 홈에 닿은 채 92초(36바퀴) 경과: 여전히 PLAYING · 제거율 정체(' + f(R.C.peelRev) + '% → ' + f(R.C.peel) + '%) · 리본은 끊겼지만(breaks ' + R.C.breaks + ') 종료 아님', R.C.state === 'playing' && R.C.playT > 90 && R.C.peel === R.C.peelRev && R.C.breaks >= 1 && R.C.contact, R.C);
  console.log('=== D·E 이탈 종료 · 접촉 유예 150ms ===');
  ok('E: 80ms·130ms 떨어졌다 다시 닿으면 종료 안 함(최대 무접촉 ' + f(R.E[0].maxNo, 0) + '·' + f(R.E[1].maxNo, 0) + 'ms)', R.E.every((e) => e.state === 'playing' && e.endAt === null), R.E);
  ok('D: 400ms 떼면 종료(detach), 접촉 상실이 150ms 를 넘긴 뒤(최대 무접촉 ' + f(R.D.maxNo, 0) + 'ms)', R.D.state === 'ended' && R.D.reason === 'detach' && R.D.maxNo > 150, R.D);
  ok('종료 후: 입력 중단(칼 이동 ' + f(R.F.moved, 2) + 'px) · 재접촉해도 절삭 없음(제거 셀 ' + R.F.cells.join('→') + ') · 점수 확정 · 진행 중 리본 없음', R.F.state === 'ended' && R.F.moved < 1e-6 && R.F.peelEnd === R.F.peelAfter && R.F.cells[0] === R.F.cells[1] && !R.F.active, R.F);
  ok('정상 나선 절삭은 도중에 끝나지 않음: 끝난 시점 playT ' + f(R.Spiral.playT) + 's(하강 40초 + 칼을 뺀 뒤) · 제거 ' + f(R.Spiral.peel, 0) + '% · 최장 ' + f(R.Spiral.longest, 0) + 'cm · 끊김 ' + R.Spiral.breaks + '회', R.Spiral.state === 'ended' && R.Spiral.playT > 40 && R.Spiral.playT < 46 && R.Spiral.peel > 85, R.Spiral);
  console.log('=== 화면 · H 재시작 ===');
  await p.evaluate(() => { AP_DEBUG.setLegacy(false); AP_DEBUG.goIntro(); });
  const intro = await p.evaluate(() => ({ h1: document.querySelector('#screen-intro h1').textContent, copy: Array.from(document.querySelectorAll('#screen-intro .intro-copy')).map((e) => e.textContent), timer: !!document.getElementById('hud-time'), fin: !!document.getElementById('btn-finish') }));
  ok('시작 화면: 메인 카피 "한번에 깎으세요" · "껍질만 얇게 한번에 깎으세요. / 너무 깊게 깎으면 과육이 파입니다." · 시작 화면에는 조작 안내 없음 · 타이머/완료 버튼 없음', intro.h1 === '한번에 깎으세요' && intro.copy[0] === '껍질만 얇게 한번에 깎으세요.\n너무 깊게 깎으면 과육이 파입니다.' && intro.copy.length === 1 && !intro.timer && !intro.fin, intro);
  await p.evaluate(() => { for (const id of ['btn-start', 'btn-select-next']) document.getElementById(id).click(); });
  let hud = await p.evaluate(() => ({ labels: Array.from(document.querySelectorAll('.hud-label')).map((e) => e.textContent), hintVisible: !document.getElementById('hint').classList.contains('ui-hidden'), hint: document.getElementById('hint').textContent, st: AP_DEBUG.snapshot().state }));
  ok('READY 화면: HUD = 껍질 제거 · 과육 손실 · 연속 껍질, 조작 안내 표시 · 시작 클릭은 READY 로만 진입(' + hud.st + ')', hud.labels.join('|') === '껍질 제거|과육 손실|연속 껍질' && hud.hintVisible && hud.hint === '방향키로 이동 · Q/W로 각도 조절 · 칼을 떼면 끝!' && hud.st === 'ready', hud);
  await p.evaluate(() => { AP_DEBUG.setDirs(-1, 0, 0); for (let i = 0; i < 900; i++) { const s = AP_DEBUG.step(1 / 60); if (s.state === 'playing') break; } AP_DEBUG.run(0.4, 60); AP_DEBUG.setDirs(0, 0, 0); });
  hud = await p.evaluate(() => ({ hintVisible: !document.getElementById('hint').classList.contains('ui-hidden'), ribbon: document.getElementById('hud-ribbon').textContent, peel: document.getElementById('hud-peel').textContent, st: AP_DEBUG.snapshot().state }));
  ok('PLAYING 화면: 안내 문구 사라짐(화면 안 가림) · 연속 껍질 ' + hud.ribbon + ' · 제거 ' + hud.peel, !hud.hintVisible && hud.st === 'playing' && /^\d+cm$/.test(hud.ribbon), hud);
  await p.evaluate(() => { AP_DEBUG.setDirs(1, 0, 0); AP_DEBUG.run(3.0, 60); AP_DEBUG.setDirs(0, 0, 0); AP_DEBUG.run(1.0, 60); }); await p.waitForTimeout(200);
  ok('이탈 종료 → 결과 화면 표시', await p.evaluate(() => AP_DEBUG.snapshot().state === 'ended' && document.getElementById('screen-result').classList.contains('active')));
  await p.click('#btn-restart');
  const H = await p.evaluate(() => { const s = AP_DEBUG.snapshot(), st = AP_DEBUG.cellStats(); return { state: s.state, score: s.score.total, peel: st.peeled, flesh: st.flesh, ribbon: s.ribbon, angle: s.knife.angleDeg, gap: s.probe.gap, playT: s.playT, resultOpen: document.getElementById('screen-result').classList.contains('active') }; });
  ok('H 다시 깎기: READY · 점수 0 · 절삭 0 · 리본/기록 0 · 칼 시작 간격 26 · 결과 화면 닫힘', H.state === 'ready' && H.score === 0 && H.peel === 0 && H.flesh === 0 && H.ribbon.emittedPx === 0 && H.ribbon.longestPx === 0 && H.ribbon.falling === 0 && Math.abs(H.gap - 26) < 0.5 && H.playT === 0 && !H.resultOpen, H);
  ok('페이지 오류 없음', errors.length === 0, errors);
  await b.close(); console.log(failures === 0 ? '\n모든 검사 통과' : '\n실패 ' + failures + '건'); process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
