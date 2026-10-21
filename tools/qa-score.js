/* QA: 점수 재설계 — 실제 코드의 AP.score.compute 로 시나리오 A~G, 의미 없는 플레이 상한, 단조성·구간별 감점, 실제 자동조종 플레이, 과일 4종 정규화를 검증하고
 * 이전 공식(OLD, 재설계 전 코드 그대로)과 비교한다.
 * 사용: node tools/qa-score.js */
'use strict';
const { chromium } = require('C:/Users/thkim/Desktop/code-work/260624/build/node_modules/playwright-core');
let failures = 0;
function ok(l, c, d) { if (c) console.log('  OK  ', l); else { failures++; console.log('  FAIL', l, d !== undefined ? JSON.stringify(d) : ''); } }
const f = (n, d) => (n === null || n === undefined ? '-' : n.toFixed(d === undefined ? 0 : d));
const URL = 'file:///C:/Users/thkim/Desktop/code-work/04_꼬직/261014_apple game/index.html';

/* ── 이전 공식(재설계 전 scoring.js + config.SCORE 값 그대로) ── */
const OLD = { BASE: 8, MIN_PEEL: 3, MIN_PATH_CM: 15, W_PEEL: 0.45, ACC_PER_FLESH: 10, W_ACC: 0.28, W_CONT: 0.17, Q_FULL_PEEL: 60, LEN_REF_CM: 100, CAPS: [[5, 20], [15, 45], [30, 65], [50, 85]] };
function oldScore(m, o) {
  o = o || {}; const accPer = o.accPer || OLD.ACC_PER_FLESH, lenRef = o.lenRef || OLD.LEN_REF_CM, minPath = o.minPath || OLD.MIN_PATH_CM, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const peel = m.peelPct, flesh = m.fleshPct, accuracy = clamp(100 - flesh * accPer, 0, 100);
  const continuity = m.emittedCm > 0 ? 100 * (0.6 * Math.min(1, m.longestCm / lenRef) + 0.4 * Math.min(1, m.longestCm / m.emittedCm)) : 0;
  const q = clamp(peel / OLD.Q_FULL_PEEL, 0, 1), gate = peel >= OLD.MIN_PEEL && m.emittedCm >= minPath;
  const base = gate ? OLD.BASE : 0, pe = OLD.W_PEEL * peel * (0.5 + 0.5 * accuracy / 100), ac = q * OLD.W_ACC * accuracy, co = q * OLD.W_CONT * continuity;
  const raw = base + pe + ac + co; let cap = 100; for (const c of OLD.CAPS) if (peel < c[0]) { cap = c[1]; break; }
  return { total: Math.round(clamp(Math.min(raw, cap), 0, 100)), raw, cap, base, pe, ac, co };
}

(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(URL); await p.waitForFunction(() => window.AP_READY === true, null, { timeout: 60000 });
  await p.evaluate(() => AP_DEBUG.setPaused(true));
  const newScore = (m) => p.evaluate((m) => AP.score.compute(m), m);
  const info = await p.evaluate(() => ({ lenRef: AP.fruits.lenRefCm(), minPath: AP.fruits.minPathCm(), sens: AP.fruits.fleshSensitivity(), layer: AP.fruits.skinLayerPct(), S: JSON.parse(JSON.stringify(AP.CONFIG.SCORE, (k, v) => v === Infinity ? 'Infinity' : v)) }));
  const FULL_CM = info.lenRef * 3.32;                       // 사과를 한 줄로 끝까지 깎았을 때의 전체 껍질 길이(자동조종 실측 ≈ 332cm)
  const Q = { 높음: 0.95, 보통: 0.5, 낮음: 0.2 };          // 연속 절삭 품질 = 최장 껍질 ÷ 전체 껍질
  const mk = (peel, flesh, q) => { const emitted = peel / 100 * FULL_CM; return { peelPct: peel, fleshPct: flesh, emittedCm: emitted, longestCm: emitted * Q[q] }; };

  console.log('현재 사과 기준: 기준 껍질 길이 ' + f(info.lenRef, 1) + 'cm · 유효 최소 경로 ' + f(info.minPath, 1) + 'cm · 과육 민감도 ' + f(info.sens, 3) + ' · 껍질 층 부피 ' + f(info.layer, 1) + '% · 한 줄 완주 ' + f(FULL_CM, 0) + 'cm');
  console.log('\n=== 1. 시나리오 A~G (실제 AP.score.compute) vs 이전 공식 ===');
  const SC = [['A', 90, 1, '높음', [95, 100]], ['B', 75, 3, '높음', [85, 94]], ['C', 60, 4, '보통', [65, 84]], ['D', 50, 5, '보통', [65, 80]], ['E', 35, 8, '낮음', [30, 60]], ['F', 10, 1, '낮음', [0, 30]], ['G', 5, 20, '낮음', [0, 30]]];
  console.log('      입력(제거/손실/연속)      │ 신규: 제거점수 정확도 연속 품질 승수 → 최종   │ 기여(제거점수에서 깎인 점수) 정확도 연속 과육 │ 이전 최종 │ 증감');
  const rows = [];
  for (const [id, pe, fl, qn, band] of SC) {
    const m = mk(pe, fl, qn), n = await newScore(m), o = oldScore(m); rows.push({ id, m, n, o, band });
    console.log('  ' + id + '  ' + (pe + '% / ' + fl + '% / ' + qn).padEnd(18) + '│ ' + f(n.coverage, 1).padStart(8) + f(n.accuracy, 0).padStart(7) + f(n.continuity, 0).padStart(5) + (' ×' + f(n.quality, 3)).padStart(8) + (' ×' + f(n.fleshMult, 2)).padStart(6) + ' → ' + String(n.total).padStart(3) + '        │ ' + ('−' + f(n.parts.accuracyLoss, 1)).padStart(14) + ('−' + f(n.parts.continuityLoss, 1)).padStart(7) + ('−' + f(n.parts.fleshLoss, 1)).padStart(7) + '       │ ' + String(o.total).padStart(4) + '      │ ' + ((n.total - o.total >= 0 ? '+' : '') + (n.total - o.total)));
  }
  for (const r of rows) ok('시나리오 ' + r.id + ' (' + r.m.peelPct + '% / ' + r.m.fleshPct + '% / ' + (r.m.longestCm / r.m.emittedCm >= 0.9 ? '높음' : (r.m.longestCm / r.m.emittedCm >= 0.4 ? '보통' : '낮음')) + '): 신규 ' + r.n.total + '점 ∈ 목표 ' + r.band[0] + '~' + r.band[1] + ' (이전 ' + r.o.total + '점)', r.n.total >= r.band[0] && r.n.total <= r.band[1], r.n);
  const up = rows.filter((r) => r.id <= 'E').map((r) => r.n.total - r.o.total);
  ok('A~E(의미 있게 깎은 플레이) 신규가 이전보다 모두 높음: 상승 ' + up.map((x) => '+' + x).join(' ') + ' (평균 +' + f(up.reduce((a, c) => a + c, 0) / up.length, 1) + '점)', up.every((x) => x > 0), up);

  console.log('\n=== 2. 의미 없는 플레이는 낮은 점수(별도 상한) ===');
  const D = {
    '잠깐 접촉(제거 1.5%, 경로 8cm)': { peelPct: 1.5, fleshPct: 0, emittedCm: 8, longestCm: 8 },
    '제거 3%·경로 14cm(유효 경로 미달)': { peelPct: 3, fleshPct: 0, emittedCm: 14, longestCm: 14 },
    '제거 2%·긴 경로(제거 미달)': { peelPct: 2, fleshPct: 0, emittedCm: 40, longestCm: 40 },
    '과육만 심하게(제거 4%, 손실 12%)': { peelPct: 4, fleshPct: 12, emittedCm: 20, longestCm: 20 },
    '과육만 심하게(제거 10%, 손실 25%)': { peelPct: 10, fleshPct: 25, emittedCm: 40, longestCm: 20 },
    '거의 다 깎았지만 과육을 심하게(제거 95%, 손실 25%)': { peelPct: 95, fleshPct: 25, emittedCm: 310, longestCm: 300 },
    '전부 깎고 과육을 매우 심하게(제거 98%, 손실 40%)': { peelPct: 98, fleshPct: 40, emittedCm: 320, longestCm: 320 },
  };
  const dres = {};
  for (const k of Object.keys(D)) { const o = oldScore(D[k]); dres[k] = { n: await newScore(D[k]), o }; console.log('  ' + k.padEnd(48) + '신규 ' + String(dres[k].n.total).padStart(3) + '점 (' + (dres[k].n.capWhy || '상한 없음') + ')  이전 ' + o.total + '점'); }
  const T = (k) => dres[k].n.total;
  ok('잠깐 접촉·유효 절삭 미달: 모두 ≤ 15 (CAP_NO_CUT ' + info.S.CAP_NO_CUT + ')', T('잠깐 접촉(제거 1.5%, 경로 8cm)') <= 15 && T('제거 3%·경로 14cm(유효 경로 미달)') <= 15 && T('제거 2%·긴 경로(제거 미달)') <= 15, dres);
  ok('과육만 심하게 판 플레이: ≤ 30 (' + T('과육만 심하게(제거 4%, 손실 12%)') + ' / ' + T('과육만 심하게(제거 10%, 손실 25%)') + ')', T('과육만 심하게(제거 4%, 손실 12%)') <= 30 && T('과육만 심하게(제거 10%, 손실 25%)') <= 30, dres);
  ok('거의 다 깎아도 과육을 심하게(손실 ≥ 25%) 판 플레이는 ≤ ' + info.S.CAP_HEAVY + ' (' + T('거의 다 깎았지만 과육을 심하게(제거 95%, 손실 25%)') + ' / ' + T('전부 깎고 과육을 매우 심하게(제거 98%, 손실 40%)') + ')', T('거의 다 깎았지만 과육을 심하게(제거 95%, 손실 25%)') <= info.S.CAP_HEAVY && T('전부 깎고 과육을 매우 심하게(제거 98%, 손실 40%)') <= info.S.CAP_HEAVY, dres);

  console.log('\n=== 3. 단조성 · 과육 손실 구간별 감점 ===');
  let incOk = true, prev = -1; const peelCurve = [];
  for (const pe of [3, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95]) { const t = (await newScore(mk(pe, 1, '높음'))).total; peelCurve.push(pe + '%→' + t); if (t < prev) incOk = false; prev = t; }
  console.log('  제거율 곡선(손실 1%, 연속 높음): ' + peelCurve.join('  '));
  ok('제거율이 늘수록 점수가 줄지 않음(초반에 빠르게 오르고 뒤로 갈수록 완만)', incOk);
  const c10 = (await newScore(mk(10, 1, '높음'))).total, c50 = (await newScore(mk(50, 1, '높음'))).total, c90 = (await newScore(mk(90, 1, '높음'))).total;
  ok('초반 증가가 더 가파름: 제거 0→10% ' + c10 + '점 · 10→50% 구간 평균 ' + f((c50 - c10) / 40, 2) + '점/% · 50→90% 구간 ' + f((c90 - c50) / 40, 2) + '점/%', c10 / 10 > (c50 - c10) / 40 && (c50 - c10) / 40 > (c90 - c50) / 40);
  const fl = {}; for (const x of [0, 3, 8, 15, 25]) fl[x] = (await newScore(mk(90, x, '높음'))).total;
  console.log('  과육 손실별 점수(제거 90%, 연속 높음): ' + Object.keys(fl).map((x) => x + '%→' + fl[x]).join('  '));
  const s1 = (fl[0] - fl[3]) / 3, s2 = (fl[3] - fl[8]) / 5, s3 = (fl[8] - fl[15]) / 7, s4 = (fl[15] - fl[25]) / 10;
  ok('구간별 감점(점/%): 0~3% ' + f(s1, 2) + ' < 3~8% ' + f(s2, 2) + ' < 8~15% ' + f(s3, 2) + ', 15% 이상 ' + f(s4, 2) + '(정확도가 0 에서 포화) ≥ 3~8% 구간 — 누적 감점: 3% −' + (fl[0] - fl[3]) + ' · 8% −' + (fl[0] - fl[8]) + ' · 15% −' + (fl[0] - fl[15]) + ' · 25% −' + (fl[0] - fl[25]) + '점 (0~3% 매우 적음 · 3~8% 완만 · 8~15% 눈에 띔 · 15%+ 큼)', s1 < s2 && s2 < s3 && s4 >= s2 && fl[0] - fl[3] <= 3 && fl[0] - fl[8] <= 10 && fl[0] - fl[15] >= 25 && fl[0] - fl[25] >= 45, { fl });

  console.log('\n=== 4. 실제 플레이(자동조종, 제품 기본 규칙) — 이전 공식 vs 신규 ===');
  const DUR = { apple: 40, pear: 32, kiwi: 24, dragonfruit: 30 };
  const play = async (id, o) => p.evaluate(({ id, dur, o }) => {
    AP_DEBUG.goIntro(); AP_DEBUG.selectFruit(id); document.getElementById('btn-start').click(); document.getElementById('btn-select-next').click();
    const r = AP_DEBUG.runAutopilot(200, Object.assign({ single: true, dur, depthFrac: 0.6, pretilt: true }, o)), s = r.snap;
    return { m: { peelPct: s.peelPct, fleshPct: s.fleshPct, longestCm: s.ribbon.longestCm, emittedCm: s.ribbon.emittedPx / AP.CONFIG.RIBBON.PX_PER_CM }, total: s.score.total, grade: s.score.grade, state: s.state, why: s.endReason, lenRef: AP.fruits.lenRefCm(), minPath: AP.fruits.minPathCm(), sens: AP.fruits.fleshSensitivity() };
  }, { id, dur: DUR[id], o });
  const SCEN = [['정확하게 끝까지', {}], ['살짝 깊게(1.2×)', { depthFrac: 1.2 }], ['깊게(1.5×)', { depthFrac: 1.5 }], ['매우 깊게(2.0×)', { depthFrac: 2.0 }], ['60% 에서 뗌', { stopAt: 0.6 }], ['40% 에서 뗌', { stopAt: 0.4 }], ['25% 에서 뗌', { stopAt: 0.25 }], ['10% 에서 뗌', { stopAt: 0.1 }], ['잠깐 대고 뗌(0.2s)', { tapMs: 200 }], ['1초 대고 뗌', { tapMs: 1000 }]];
  const R = {};
  console.log('  ' + '사과 시나리오'.padEnd(20) + '제거   손실   최장cm  │ 이전  신규  증감  문구(신규)');
  for (const [name, o] of SCEN) {
    const r = await play('apple', o), od = oldScore(r.m); R[name] = { r, old: od.total }; console.log('  ' + name.padEnd(22) + (f(r.m.peelPct, 0) + '%').padStart(5) + (f(r.m.fleshPct, 1) + '%').padStart(7) + f(r.m.longestCm, 0).padStart(8) + '  │ ' + String(od.total).padStart(4) + String(r.total).padStart(6) + ((r.total - od.total >= 0 ? '+' : '') + (r.total - od.total)).padStart(6) + '  ' + r.grade);
  }
  const N = (k) => R[k].r.total;
  ok('정확하게 끝까지 ' + R['정확하게 끝까지'].old + ' → ' + N('정확하게 끝까지') + '점 (95~100)', N('정확하게 끝까지') >= 95, R['정확하게 끝까지']);
  ok('60% 에서 뗌 ' + R['60% 에서 뗌'].old + ' → ' + N('60% 에서 뗌') + ' · 40% ' + R['40% 에서 뗌'].old + ' → ' + N('40% 에서 뗌') + ' · 25% ' + R['25% 에서 뗌'].old + ' → ' + N('25% 에서 뗌') + ' (절반 정도·과육 손실 없음: 65~84 / 조금 깎음 30~60)', N('60% 에서 뗌') >= 65 && N('60% 에서 뗌') <= 84 && N('40% 에서 뗌') >= 50 && N('40% 에서 뗌') <= 75 && N('25% 에서 뗌') >= 30 && N('25% 에서 뗌') <= 60, R);
  ok('10% 에서 뗌 ' + N('10% 에서 뗌') + ' ≤ 40 · 0.2초·1초 접촉 ' + N('잠깐 대고 뗌(0.2s)') + '/' + N('1초 대고 뗌') + ' ≤ 20 (이전 ' + R['잠깐 대고 뗌(0.2s)'].old + '/' + R['1초 대고 뗌'].old + ')', N('10% 에서 뗌') <= 40 && N('잠깐 대고 뗌(0.2s)') <= 20 && N('1초 대고 뗌') <= 20, R);
  ok('과육을 깊게 팔수록 점수가 내려감: 정확 ' + N('정확하게 끝까지') + ' ≥ 1.2× ' + N('살짝 깊게(1.2×)') + ' > 1.5× ' + N('깊게(1.5×)') + ' > 2.0× ' + N('매우 깊게(2.0×)') + ' (손실 ' + f(R['살짝 깊게(1.2×)'].r.m.fleshPct, 1) + '/' + f(R['깊게(1.5×)'].r.m.fleshPct, 1) + '/' + f(R['매우 깊게(2.0×)'].r.m.fleshPct, 1) + '%)', N('정확하게 끝까지') >= N('살짝 깊게(1.2×)') && N('살짝 깊게(1.2×)') > N('깊게(1.5×)') && N('깊게(1.5×)') > N('매우 깊게(2.0×)'), R);
  ok('매우 깊게(손실 ' + f(R['매우 깊게(2.0×)'].r.m.fleshPct, 0) + '%, 제거율은 높음) ' + N('매우 깊게(2.0×)') + '점 ≤ 70 — 과육을 심하게 판 플레이는 고득점이 아님', N('매우 깊게(2.0×)') <= 70, R);
  const imp = ['정확하게 끝까지', '살짝 깊게(1.2×)', '깊게(1.5×)', '60% 에서 뗌', '40% 에서 뗌', '25% 에서 뗌'].map((k) => N(k) - R[k].old);
  ok('의미 있게 깎은 6개 플레이의 상승(신규 − 이전): ' + imp.map((x) => '+' + x).join(' ') + ' → 평균 +' + f(imp.reduce((a, c) => a + c, 0) / imp.length, 1) + '점', imp.every((x) => x > 0), imp);

  console.log('\n=== 5. 과일 4종 정규화 — 같은 수준의 플레이면 비슷한 점수 ===');
  const FR = ['apple', 'pear', 'kiwi', 'dragonfruit'], NM = { apple: '사과', pear: '배', kiwi: '키위', dragonfruit: '용과' }, FS = {};
  const LV = [['정확', {}], ['살짝 깊게', { depthFrac: 1.2 }], ['깊게', { depthFrac: 1.5 }], ['60%', { stopAt: 0.6 }], ['40%', { stopAt: 0.4 }]];
  console.log('  ' + '과일'.padEnd(6) + '기준껍질cm 민감도 층부피% │ ' + LV.map((x) => x[0].padStart(9)).join('') + '   (이전 공식: 정확/살짝깊게/깊게/60%/40%)');
  for (const id of FR) {
    FS[id] = {}; for (const [n, o] of LV) FS[id][n] = await play(id, o);
    const a = FS[id]['정확'], oldv = LV.map(([n]) => oldScore(FS[id][n].m, { accPer: 10 * FS[id][n].sens, lenRef: FS[id][n].lenRef, minPath: FS[id][n].minPath }).total);
    const layer = await p.evaluate((id) => AP.apple.stats(id).skinLayerPct, id);
    console.log('  ' + NM[id].padEnd(5) + f(a.lenRef, 1).padStart(9) + f(a.sens, 3).padStart(8) + f(layer, 1).padStart(8) + '   │ ' + LV.map(([n]) => String(FS[id][n].total).padStart(9)).join('') + '   (' + oldv.join('/') + ')');
  }
  for (const [n] of LV) { const v = FR.map((id) => FS[id][n].total), sp = Math.max.apply(null, v) - Math.min.apply(null, v); ok('수준 "' + n + '": 과일별 점수 ' + v.join('/') + ' — 최대 차이 ' + sp + '점 ≤ ' + (n === '정확' ? 5 : 8), sp <= (n === '정확' ? 5 : 8), v); }
  ok('큰 과일이라고 유리하지 않음: 정확 플레이에서 배·용과 ≤ 사과 + 4 · 작은 키위 ≥ 사과 − 4', FS.pear['정확'].total <= FS.apple['정확'].total + 4 && FS.dragonfruit['정확'].total <= FS.apple['정확'].total + 4 && FS.kiwi['정확'].total >= FS.apple['정확'].total - 4, FS);

  console.log('\n=== 6. 평가 문구 · 데이터 연결 ===');
  const gr = await p.evaluate(() => { AP_DEBUG.selectFruit('apple'); return [100, 80, 79, 72, 71, 55, 54, 35, 34, 0].map((n) => [n, AP.score.gradeOf(n)]); });
  const WANT = ['사과 깎기 국가대표', '사과 깎기 국가대표', '아까 조금만 잘했어도 80점인데', '아까 조금만 잘했어도 80점인데', '제법 깎음. (잘깎는다는 말은 ❌)', '제법 깎음. (잘깎는다는 말은 ❌)', ['이거보다 잘할 수 있잖아요', '웃기려고 그런거죠?'], ['이거보다 잘할 수 있잖아요', '웃기려고 그런거죠?'], '내 사과가 죽었어', '내 사과가 죽었어'];
  ok('평가 문구 5구간(80/72/55/35/0, 50~ 구간은 두 문구 중 랜덤): ' + gr.map((x) => x[0] + '→' + x[1]).join(' · '), gr.every((x, i) => (Array.isArray(WANT[i]) ? WANT[i].includes(x[1]) : x[1] === WANT[i])), gr);
  ok('페이지 오류 없음', errors.length === 0, errors);
  await b.close(); console.log(failures === 0 ? '\n모든 검사 통과' : '\n실패 ' + failures + '건'); process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
