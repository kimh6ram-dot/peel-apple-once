/* 절삭 폭 비교(100/85/80/75%) + 곡면(윗/아랫부분) · 반복 과육 · 빠른 이동 검증. 결정적 시뮬레이션이며 실제 사람 조작감 검증은 아니다.
 * 사용: node tools/qa-width.js */
'use strict';
const { chromium } = require('C:/Users/thkim/Desktop/code-work/260624/build/node_modules/playwright-core');
let failures = 0;
function ok(l, c, d) { if (c) console.log('  OK  ', l); else { failures++; console.log('  FAIL', l, d !== undefined ? JSON.stringify(d) : ''); } }
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  await p.goto('file:///C:/Users/thkim/Desktop/code-work/04_꼬직/261014_apple game/index.html');
  await p.waitForFunction(() => window.AP_READY === true, null, { timeout: 60000 }); await p.evaluate(() => AP_DEBUG.setLegacy(true));   /* 기계 동작 테스트: 호환 모드를 명시(제품 기본은 실제 규칙) */
  const res = await p.evaluate(() => {
    AP_DEBUG.setPaused(true);
    const NS = 96, out = { band: {}, sweep: {}, base: AP.CONFIG.CUT.WIDTH_SCALE };
    function fixedBand(row, w, tilt) {
      AP.CONFIG.CUT.WIDTH_SCALE = w; AP_DEBUG.goIntro(); AP_DEBUG.start();
      const ys = Array.from(AP.cutting.rowStageYs());
      if (tilt) AP_DEBUG.setKnifeAngleDeg(tilt);
      AP.knife.setOrigin(AP.knife.x, AP.knife.y + (ys[row] - AP.knife.py));
      AP_DEBUG.setDirs(-1, 0, 0); let s;
      for (let i = 0; i < 900; i++) { s = AP_DEBUG.step(1 / 60); const d = s.cut; if (d && d.iDeep >= 0 && d.depth0 >= 0.6 * AP_DEBUG.apple.surface.skin[d.iDeep * NS]) break; }
      AP_DEBUG.setDirs(0, 0, 0); s = AP_DEBUG.run(2.7, 60);
      const rowH = Math.abs(ys[1] - ys[0]);
      return { px: AP_DEBUG.cellsAt(0).filter((c) => c.state >= 1).length * rowH, peel: s.peelPct, snap: s };
    }
    for (const w of [1.0, 0.85, 0.8, 0.75]) {
      out.band[w] = [44, 36, 27, 18, 8, 2].map((r) => Math.round(fixedBand(r, w).px));
      out.sweep[w] = [22, 32, 40].map((dur) => { AP.CONFIG.CUT.WIDTH_SCALE = w; AP_DEBUG.goIntro(); AP_DEBUG.start(); const r = AP_DEBUG.runAutopilot(59.9, { dur, depthFrac: 0.6 }); return [dur, Math.round(r.snap.peelPct), r.snap.ribbon.breaks, r.snap.score.total, Math.round(r.snap.ribbon.longestCm)]; });
    }
    AP.CONFIG.CUT.WIDTH_SCALE = out.base;
    // A 고정: 한 바퀴 뒤 정체
    fixedBand(27, out.base, 0); const a1 = AP_DEBUG.snapshot().peelPct; const a2 = AP_DEBUG.run(10, 60).peelPct; out.A = [a1, a2];
    // E 반복 과육: 같은 높이에서 깊게 반복 접촉
    const before = AP_DEBUG.snapshot(); AP_DEBUG.setDirs(-1, 0, 0); let fl0 = before.fleshPct; AP_DEBUG.run(0.6, 60); AP_DEBUG.setDirs(0, 0, 0); const mid = AP_DEBUG.run(2.7, 60); const mid2 = AP_DEBUG.run(2.7, 60);
    out.E = { peel0: a2, peel1: mid.peelPct, peel2: mid2.peelPct, flesh0: fl0, flesh1: mid.fleshPct, flesh2: mid2.fleshPct, ribbonEm: mid2.ribbon.emittedPx };
    // C 아랫부분: 기울기 0 과 +40° 에서 행 0~5 제거 셀 수, 과도한 깊이는 과육 손실
    function bottomCells(tilt) { const r = fixedBand(2, out.base, tilt); let n = 0; for (let sec = 0; sec < NS; sec += 8) n += AP_DEBUG.cellsAt(sec).filter((c) => c.row <= 5 && c.state >= 1).length; return n; }
    out.C = { flat: bottomCells(0), tilt: bottomCells(40) };
    fixedBand(2, out.base, 40); AP_DEBUG.setDirs(-1, 0, 0); AP_DEBUG.run(1.2, 60); AP_DEBUG.setDirs(0, 0, 0); out.C.deepFlesh = AP_DEBUG.run(2.7, 60).fleshPct;
    // D 빠른 위아래
    AP_DEBUG.goIntro(); AP_DEBUG.start(); const d = AP_DEBUG.runAutopilot(59.9, { dur: 12, depthFrac: 0.6, oscHz: 1.5 }); out.D = { peel: d.snap.peelPct, longest: d.snap.ribbon.longestCm, breaks: d.snap.ribbon.breaks };
    return out;
  });
  console.log('=== 고정 높이 한 바퀴 띠 폭(px) — 행 44(윗)·36·27(적도)·18·8·2(아랫) ===');
  for (const w of Object.keys(res.band)) console.log('   폭 ' + Math.round(w * 100) + '%: ' + res.band[w].join(' / ') + '    60초 [하강시간s, 제거%, 끊김, 점수, 최장cm]: ' + res.sweep[w].map((r) => '[' + r.join(',') + ']').join(' '));
  console.log('   C(아랫부분 행0~5 제거 셀): 기울기 0° ' + res.C.flat + ' → +40° ' + res.C.tilt + ' · 과도한 깊이 손실 ' + res.C.deepFlesh.toFixed(2) + '% · D ' + JSON.stringify(res.D) + ' · E ' + JSON.stringify(res.E));
  const eq = (w) => res.band[w][2];
  ok('선택 폭(' + res.base * 100 + '%): 적도 띠 ' + eq(res.base) + 'px < 기존 100% ' + eq(1) + 'px (≥ 10% 감소) · 다른 높이 띠는 100% 보다 넓지 않음', eq(res.base) <= eq(1) * 0.9 && res.band[res.base].every((v, i) => v <= res.band[1][i]), res.band);
  ok('A: 한 높이 한 바퀴 뒤 제거율 정체(' + res.A[0].toFixed(1) + '% → ' + res.A[1].toFixed(1) + '%, 10초 더)', res.A[1] === res.A[0]);
  ok('E: 반복 과육 접촉 — 제거율 중복 증가 없음(' + res.E.peel0.toFixed(2) + '→' + res.E.peel2.toFixed(2) + ' 일부는 새 인접 행) · 과육 손실만 증가(' + res.E.flesh0.toFixed(2) + '→' + res.E.flesh2.toFixed(2) + '%)', res.E.flesh2 > res.E.flesh0 + 0.3 && res.E.peel2 - res.E.peel0 < 6, res.E);
  ok('C: 아랫부분 — 기울기를 맞추면 더 많이 제거(' + res.C.flat + ' → ' + res.C.tilt + ') · 과도한 깊이는 과육 손실(' + res.C.deepFlesh.toFixed(2) + '%)', res.C.tilt >= res.C.flat && res.C.deepFlesh > 0.2, res.C);
  ok('D: 빠른 위아래 — 껍질 대부분 남음(제거율 ' + res.D.peel.toFixed(1) + '% < 20) · 최장 ' + res.D.longest.toFixed(0) + 'cm 짧음', res.D.peel < 20 && res.D.longest < 30, res.D);
  const w80 = res.sweep[res.base].find((r) => r[0] === 32);
  ok('60초 시간 내 완료 가능(선택 폭, 5.7px/s 하강): 제거 ' + w80[1] + '% ≥ 85 · 점수 ' + w80[3], w80[1] >= 85);
  ok('페이지 오류 없음', errors.length === 0, errors);
  await b.close(); console.log(failures === 0 ? '\n모든 검사 통과' : '\n실패 ' + failures + '건'); process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
