/* 점수 밸런스(단 한 번의 절삭 규칙) — 자동조종 시나리오로 점수 구간을 비교한다. 실제 사람 플레이 데이터가 아니라 모델이다.
 * 사용: node tools/qa-balance.js */
'use strict';
const { chromium } = require('C:/Users/thkim/Desktop/code-work/260624/build/node_modules/playwright-core');
let failures = 0;
function ok(l, c, d) { if (c) console.log('  OK  ', l); else { failures++; console.log('  FAIL', l, d !== undefined ? JSON.stringify(d) : ''); } }
const f = (n, d) => n.toFixed(d === undefined ? 0 : d);
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  await p.goto('file:///C:/Users/thkim/Desktop/code-work/04_꼬직/261014_apple game/index.html');
  await p.waitForFunction(() => window.AP_READY === true, null, { timeout: 60000 });
  await p.evaluate(() => { AP_DEBUG.setPaused(true); AP_DEBUG.setLegacy(false); });
  const run = (o) => p.evaluate((o) => { AP_DEBUG.goIntro(); AP_DEBUG.start(); const r = AP_DEBUG.runAutopilot(200, Object.assign({ single: true, dur: 40, depthFrac: 0.6 }, o)); const s = r.snap; return { state: s.state, why: s.endReason, playT: s.playT, peel: s.peelPct, flesh: s.fleshPct, longest: s.ribbon.longestCm, total: s.ribbon.emittedPx / 26, score: s.score.total, acc: s.score.accuracy, cont: s.score.continuity, cap: s.score.cap, grade: s.score.grade }; }, o);
  const rows = [['잠깐 대고 뗌(0.2s)', { tapMs: 200 }], ['1초', { tapMs: 1000 }], ['한 바퀴만', { tapMs: 2700 }], ['하강 10%에서 뗌', { stopAt: 0.1 }], ['25%', { stopAt: 0.25 }], ['40%', { stopAt: 0.4 }], ['60%', { stopAt: 0.6 }], ['80%', { stopAt: 0.8 }], ['정확·끝까지', {}], ['서툰 깊이(오차 큼)', { depthFrac: 1.0, tol: 1.6 }], ['보통 깊이', { depthFrac: 0.85, tol: 1.1 }], ['깊게 2.0×·끝까지', { depthFrac: 2.0 }], ['깊게 1.5×·끝까지', { depthFrac: 1.5 }], ['과육만 깊게(4×, 한 바퀴)', { depthFrac: 4.0, tapMs: 2700 }], ['빠른 흔들기', { oscHz: 1.5, dur: 12 }], ['빠른 하강(8s)', { dur: 8 }], ['빠른 하강(20s)', { dur: 20 }]];
  const R = {};
  console.log('시나리오'.padEnd(26) + ' 종료    제거  손실  최장cm  전체cm  정확  연속  상한  점수  문구');
  for (const [name, o] of rows) {
    const r = await run(o); R[name] = r;
    console.log(name.padEnd(24) + ' ' + (r.state + '/' + r.why).padEnd(14) + String(f(r.peel)).padStart(4) + '% ' + f(r.flesh, 1).padStart(5) + '% ' + String(f(r.longest)).padStart(6) + ' ' + String(f(r.total)).padStart(7) + ' ' + String(f(r.acc)).padStart(5) + ' ' + String(f(r.cont)).padStart(5) + ' ' + String(r.cap).padStart(5) + ' ' + String(r.score).padStart(5) + '  ' + r.grade);
  }
  console.log('=== 검증 ===');
  const sc = (n) => R[n].score;
  ok('F 점수 상향: 40% 깎기 ' + sc('40%') + '점 · 60% ' + sc('60%') + '점 · 80% ' + sc('80%') + '점 · 정확 ' + sc('정확·끝까지') + '점', sc('40%') >= 50 && sc('60%') >= 75 && sc('정확·끝까지') >= 90, R);
  ok('구간(재설계): 조금 깎음 50~74(40% 깎기 ' + sc('40%') + ') · 절반 이상 75~89(60%: ' + sc('60%') + ') · 80% ' + sc('80%') + '(≥ 85) · 정교 95+(' + sc('정확·끝까지') + ')', sc('40%') >= 50 && sc('40%') <= 74 && sc('60%') >= 75 && sc('60%') <= 89 && sc('80%') >= 85 && sc('정확·끝까지') >= 95);
  ok('G 편법: 잠깐 대고 뗌 0.2s/1s/한 바퀴 점수 ' + sc('잠깐 대고 뗌(0.2s)') + '/' + sc('1초') + '/' + sc('한 바퀴만') + ' 모두 ≤ 20', sc('잠깐 대고 뗌(0.2s)') <= 20 && sc('1초') <= 20 && sc('한 바퀴만') <= 20);
  ok('G 편법: 과육만 깊게 파고 뗌 ' + sc('과육만 깊게(4×, 한 바퀴)') + '점 ≤ 20', sc('과육만 깊게(4×, 한 바퀴)') <= 20);
  ok('깊게 밀어 넣기: 1.5× ' + sc('깊게 1.5×·끝까지') + '점(손실 ' + R['깊게 1.5×·끝까지'].flesh.toFixed(1) + '%, 완만한 감점) < 정확 ' + sc('정확·끝까지') + '점 · 2.0× ' + sc('깊게 2.0×·끝까지') + '점(손실 ' + R['깊게 2.0×·끝까지'].flesh.toFixed(0) + '%, 큰 감점 −' + (sc('정확·끝까지') - sc('깊게 2.0×·끝까지')) + ') · 제거율은 비슷', sc('정확·끝까지') - sc('깊게 2.0×·끝까지') >= 25 && sc('깊게 1.5×·끝까지') < sc('정확·끝까지') && sc('깊게 1.5×·끝까지') > sc('깊게 2.0×·끝까지') && Math.abs(R['깊게 2.0×·끝까지'].peel - R['정확·끝까지'].peel) < 10);
  ok('서툰 깊이(손실 ' + f(R['서툰 깊이(오차 큼)'].flesh, 1) + '%) 점수 ' + sc('서툰 깊이(오차 큼)') + ' ≤ 정확, 깊게(2.0×)보다 높음', sc('서툰 깊이(오차 큼)') <= sc('정확·끝까지') && sc('서툰 깊이(오차 큼)') > sc('깊게 2.0×·끝까지'));
  ok('빠른 흔들기 ' + sc('빠른 흔들기') + '점 ≤ 20 · 빠른 하강(8s) ' + sc('빠른 하강(8s)') + '점 < 정확 − 30', sc('빠른 흔들기') <= 20 && sc('빠른 하강(8s)') < sc('정확·끝까지') - 30);
  ok('점수 단조: 10% < 25% < 40% < 60% < 80% < 정확', sc('하강 10%에서 뗌') < sc('25%') && sc('25%') < sc('40%') && sc('40%') < sc('60%') && sc('60%') < sc('80%') && sc('80%') < sc('정확·끝까지'));
  ok('페이지 오류 없음', errors.length === 0, errors);
  await b.close(); console.log(failures === 0 ? '\n모든 검사 통과' : '\n실패 ' + failures + '건'); process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
