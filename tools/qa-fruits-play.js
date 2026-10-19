/* QA: 과일 4종 실제 플레이 — 보이는 크기 = 판정 크기 · 과일 전환 시 값이 섞이지 않음 · 과일별 설정 적용 · 껍질 리본 색 · 점수 정규화 · 끝까지 깎아 결과 화면/저장 이미지.
 * 제품 기본 규칙(이탈 종료)으로 실행한다(setLegacy 를 켜지 않음). 자동조종 = 사람처럼 나선으로 내려가며 껍질만 깎는 모델(실제 사람 데이터 아님).
 * 사용: node tools/qa-fruits-play.js */
'use strict';
const { chromium } = require('C:/Users/thkim/Desktop/code-work/260624/build/node_modules/playwright-core');
let failures = 0;
function ok(l, c, d) { if (c) console.log('  OK  ', l); else { failures++; console.log('  FAIL', l, d !== undefined ? JSON.stringify(d) : ''); } }
const f = (n, d) => (n === null || n === undefined ? '-' : n.toFixed(d === undefined ? 0 : d));
const IDS = ['apple', 'pear', 'kiwi', 'dragonfruit'], NAMES = { apple: '사과', pear: '배', kiwi: '키위', dragonfruit: '용과' };
const DUR = { apple: 40, pear: 32, kiwi: 24, dragonfruit: 30 };       // 나선 하강 시간(s): 회전 1바퀴당 하강량이 절삭 폭 안에 들도록 과일 높이·회전 주기에 맞춤
const PLAY = { apple: 1.0, pear: 1.12, kiwi: 0.68, dragonfruit: 1.03 }, PREVIEW = { apple: 1.0, pear: 1.08, kiwi: 0.72, dragonfruit: 1.0 };

(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto('file:///C:/Users/thkim/Desktop/code-work/04_꼬직/261014_apple game/index.html');
  await p.waitForFunction(() => window.AP_READY === true, null, { timeout: 60000 });
  await p.evaluate(() => { AP_DEBUG.setPaused(true); });     // 시간 스텝 테스트 구간: 루프 정지(setLegacy 는 건드리지 않는다 = 제품 기본 규칙)
  const startFruit = (id) => p.evaluate((id) => { AP_DEBUG.goIntro(); AP_DEBUG.selectFruit(id); document.getElementById('btn-start').click(); document.getElementById('btn-select-next').click(); return AP_DEBUG.snapshot().state; }, id);

  console.log('=== 1. 보이는 크기 = 판정 크기(3D 메시·절삭 표면·접촉 실루엣이 같은 데이터) ===');
  const geo = {};
  for (const id of IDS) {
    const st = await startFruit(id);
    geo[id] = await p.evaluate((id) => {
      const L = AP_DEBUG.layout(), S = AP_DEBUG.surface(), box = AP_DEBUG.meshBox(), m = AP.fruits.measure(id), k = AP.fruits.playK(id);
      const c = AP_DEBUG.appleCenterStage(), sx = AP_DEBUG.silhouetteX(c.y);
      const vs = box.vs;
      return { st: AP_DEBUG.snapshot().state, fruit: AP_DEBUG.apple.fruitId, w: (box.x1 - box.x0) / vs, h: (box.y1 - box.y0) / vs, expW: (m.shape ? m.shape.whole.maxWidth : window.AP_ASSETS.red.maxWidth) * k, expH: (m.shape ? m.shape.whole.bodyHeight : window.AP_ASSETS.red.bodyHeight) * k + (AP_DEBUG.apple.surface.capExtraTop || 0) + (AP_DEBUG.apple.surface.capExtraBottom || 0),   /* 돔 캡의 둥근 마감(위·아래)이 더한 높이 포함 */ imgLong: AP.fruits.longest(id) * k, R: S.R, silR: (sx - AP.scene.appleCx) / vs, vs, longest: Math.max((box.x1 - box.x0), (box.y1 - box.y0)) / vs };
    }, id);
    const g = geo[id];
    ok(NAMES[id] + ': READY · 3D 모델 ' + g.fruit + ' · 몸통 메시 ' + f(g.w, 1) + '×' + f(g.h, 1) + '(줄기 제외) = PNG 몸통 실루엣 × playK ' + f(g.expW, 1) + '×' + f(g.expH, 1) + '(오차 ' + f(100 * Math.abs(g.w / g.expW - 1), 1) + '%/' + f(100 * Math.abs(g.h / g.expH - 1), 1) + '%)',
      g.st === 'ready' && g.fruit === id && Math.abs(g.w / g.expW - 1) < 0.03 && Math.abs(g.h / g.expH - 1) < 0.05, g);
    ok(NAMES[id] + ': 접촉 판정 실루엣 반경 ' + f(g.silR, 2) + 'px = 절삭 표면 최대 반경 ' + f(g.R, 2) + 'px(오차 ' + f(Math.abs(g.silR - g.R), 2) + 'px, 24면 근사 허용 1.5px)', Math.abs(g.silR - g.R) <= 1.5, g);
  }
  const ap = geo.apple.imgLong;      // 크기 정의: PNG 불투명 실루엣 긴 변 × playK(사과=1)
  ok('플레이 크기(사과=1, 실루엣 긴 변 × 3D 배율): 배 ' + f(geo.pear.imgLong / ap, 3) + '(1.12) · 키위 ' + f(geo.kiwi.imgLong / ap, 3) + '(0.68) · 용과 ' + f(geo.dragonfruit.imgLong / ap, 3) + '(1.03)', Math.abs(geo.pear.imgLong / ap - PLAY.pear) < 0.005 && Math.abs(geo.kiwi.imgLong / ap - PLAY.kiwi) < 0.005 && Math.abs(geo.dragonfruit.imgLong / ap - PLAY.dragonfruit) < 0.005, geo);
  ok('배는 사과보다 작아 보이지 않음(폭 ' + f(geo.pear.w, 0) + ' ≥ ' + f(geo.apple.w, 0) + ') · 키위는 확실히 작음(높이 ' + f(geo.kiwi.h, 0) + ' < ' + f(geo.apple.h, 0) + ') · 용과는 둥근 타원(' + f(geo.dragonfruit.h, 0) + '×' + f(geo.dragonfruit.w, 0) + ', 세로/가로 ' + f(geo.dragonfruit.h / geo.dragonfruit.w, 2) + ', 사과 ' + f(geo.apple.h / geo.apple.w, 2) + ') · 키위보다 크고(' + f(geo.dragonfruit.h, 0) + ' > ' + f(geo.kiwi.h, 0) + ') 배보다 크지 않음', geo.pear.w >= geo.apple.w && geo.kiwi.h < geo.apple.h * 0.8 && geo.kiwi.w < geo.apple.w * 0.65 && geo.dragonfruit.h / geo.dragonfruit.w > 1.05 && geo.dragonfruit.h / geo.dragonfruit.w < 1.6 && geo.dragonfruit.h > geo.kiwi.h * 1.2 && geo.dragonfruit.w <= geo.pear.w, geo);

  console.log('=== 2. 과일 전환: 이전 과일의 값이 남지 않음 ===');
  const appleFirst = await p.evaluate(() => { AP_DEBUG.goIntro(); AP_DEBUG.selectFruit('apple'); const S = AP_DEBUG.surface(); return { area: S.totalArea, R: S.R, bodyH: S.bodyH, skin: AP.CONFIG.SKIN_COLOR.slice(), period: AP.CONFIG.ROTATION_PERIOD, ribbon: AP.CONFIG.RIBBON.WIDTH, win: AP.CONFIG.CUT.WINDOW_HALF, ws: AP.CONFIG.CUT.WIDTH_SCALE, thick: AP.CONFIG.SKIN_THICKNESS, convex: AP.CONFIG.CUT.FLESH_CONVEX_REF }; });
  const seq = [];
  for (const id of ['dragonfruit', 'kiwi', 'pear', 'apple', 'kiwi', 'apple']) {
    seq.push(await p.evaluate((id) => {
      AP_DEBUG.goIntro(); AP_DEBUG.selectFruit(id); document.getElementById('btn-start').click(); document.getElementById('btn-select-next').click();
      const S = AP_DEBUG.surface(), c = AP_DEBUG.appleCenterStage(), sx = AP_DEBUG.silhouetteX(c.y), cfg = AP.fruits.CONFIGS[id];
      const pr = AP_DEBUG.probe(), reg = AP_DEBUG.regions();
      return { id, mesh: AP_DEBUG.apple.fruitId, cur: AP.fruits.current.id, silR: (sx - AP.scene.appleCx) / AP_DEBUG.apple.viewScale, R: S.R, period: AP.rotation.period, cfgPeriod: cfg.rotation.period, omega: AP.rotation.omega, ribbon: AP.CONFIG.RIBBON.WIDTH, cfgRibbon: cfg.ribbon.width, win: AP.CONFIG.CUT.WINDOW_HALF, cfgWin: cfg.cutting.windowHalf, thick: AP.CONFIG.SKIN_THICKNESS, cfgThick: cfg.cutting.skinThickness, skinCell: AP_DEBUG.cellState(20, 0).skin, gap: pr.gap, state: AP_DEBUG.snapshot().state, qa: AP.play.qa };
    }, id));
  }
  ok('전환 순서 용과→키위→배→사과→키위→사과: 매번 3D 모델·현재 과일 일치 · 접촉 실루엣 반경 = 그 과일 표면 반경 · 시작 간격 26px · READY · 제품 규칙(qa 꺼짐)', seq.every((q) => q.mesh === q.id && q.cur === q.id && Math.abs(q.silR - q.R) <= 1.5 && Math.abs(q.gap - 26) < 0.5 && q.state === 'ready' && q.qa === false), seq);
  ok('과일별 독립 설정이 선택 때마다 적용: 회전 주기 · 껍질 두께 · 절삭 폭 · 리본 폭 = 그 과일 config(' + seq.map((q) => q.id.slice(0, 3) + ' ' + q.period + 's/' + q.thick + 'px/' + q.win + '/' + q.ribbon).join(' · ') + ')',
    seq.every((q) => q.period === q.cfgPeriod && Math.abs(q.omega * q.period - 2 * Math.PI) < 1e-9 && q.thick === q.cfgThick && q.win === q.cfgWin && q.ribbon === q.cfgRibbon), seq);
  const appleBack = await p.evaluate(() => { AP_DEBUG.goIntro(); AP_DEBUG.selectFruit('apple'); document.getElementById('btn-start').click(); document.getElementById('btn-select-next').click(); const S = AP_DEBUG.surface(); return { area: S.totalArea, R: S.R, bodyH: S.bodyH, skin: AP.CONFIG.SKIN_COLOR.slice(), period: AP.CONFIG.ROTATION_PERIOD, ribbon: AP.CONFIG.RIBBON.WIDTH, win: AP.CONFIG.CUT.WINDOW_HALF, ws: AP.CONFIG.CUT.WIDTH_SCALE, thick: AP.CONFIG.SKIN_THICKNESS, convex: AP.CONFIG.CUT.FLESH_CONVEX_REF }; });
  ok('다른 과일을 거쳐 사과로 돌아와도 사과 값 그대로(표면적 ' + f(appleBack.area, 3) + ' · 색 ' + appleBack.skin + ' · 회전 ' + appleBack.period + 's · 껍질 ' + appleBack.thick + 'px · 절삭 폭 ' + appleBack.win + '×' + appleBack.ws + ' · 리본 ' + appleBack.ribbon + ')', JSON.stringify(appleBack) === JSON.stringify(appleFirst) && appleBack.skin.join() === '226,42,40' && appleBack.period === 2.5 && appleBack.thick === 4 && appleBack.ribbon === 5.2, { appleFirst, appleBack });

  console.log('=== 3. 점수 정규화 · 공정성(같은 상대 수준의 플레이 = 비슷한 점수) ===');
  const runs = {};
  for (const id of IDS) {
    runs[id] = {};
    for (const [tag, o] of [['정확', { depthFrac: 0.6 }], ['살짝 깊게', { depthFrac: 1.2 }], ['깊게', { depthFrac: 1.5 }], ['40%에서 뗌', { stopAt: 0.4 }], ['60%에서 뗌', { stopAt: 0.6 }]]) {
      runs[id][tag] = await p.evaluate(({ id, dur, o }) => {
        AP_DEBUG.goIntro(); AP_DEBUG.selectFruit(id); document.getElementById('btn-start').click(); document.getElementById('btn-select-next').click();
        const r = AP_DEBUG.runAutopilot(200, Object.assign({ single: true, dur, depthFrac: 0.6 }, o)), s = r.snap;
        return { state: s.state, why: s.endReason, peel: s.peelPct, flesh: s.fleshPct, score: s.score.total, longest: s.ribbon.longestCm, lenRef: AP.fruits.lenRefCm(), sens: AP.fruits.fleshSensitivity(), minPath: AP.fruits.minPathCm(), grade: s.score.grade };
      }, { id, dur: DUR[id], o });
    }
  }
  console.log('과일'.padEnd(6) + ' 기준껍질cm 민감도  정확(제거/손실/점수)       살짝깊게  깊게  40%  60%');
  for (const id of IDS) { const R = runs[id]; console.log((NAMES[id]).padEnd(5) + ' ' + f(R['정확'].lenRef, 1).padStart(8) + ' ' + f(R['정확'].sens, 3).padStart(7) + '  ' + (f(R['정확'].peel, 1) + '% / ' + f(R['정확'].flesh, 2) + '% / ' + R['정확'].score + '점').padEnd(24) + String(R['살짝 깊게'].score).padStart(6) + String(R['깊게'].score).padStart(7) + String(R['40%에서 뗌'].score).padStart(6) + String(R['60%에서 뗌'].score).padStart(6)); }
  ok('모든 판이 이탈 종료(detach)로 끝남(자동조종이 칼을 뺄 때) · 정확한 플레이는 제거율 ≥ 85% · 과육 손실 < 0.5%', IDS.every((id) => Object.values(runs[id]).every((r) => r.state === 'ended' && r.why === 'detach')) && IDS.every((id) => runs[id]['정확'].peel >= 85 && runs[id]['정확'].flesh < 0.5), runs);
  ok('사과 기준값 불변: 기준 껍질 100cm · 과육 민감도 1', runs.apple['정확'].lenRef === 100 && runs.apple['정확'].sens === 1, runs.apple['정확']);
  ok('기준 껍질 길이는 과일의 표면적÷절삭 폭에 비례(배 > 사과 > 용과 > 키위): ' + IDS.map((id) => NAMES[id] + ' ' + f(runs[id]['정확'].lenRef, 0)).join(' · '), runs.pear['정확'].lenRef > 100 && runs.dragonfruit['정확'].lenRef < 100 && runs.kiwi['정확'].lenRef < runs.dragonfruit['정확'].lenRef, runs);
  const spread = (tag) => { const v = IDS.map((id) => runs[id][tag].score); return Math.max.apply(null, v) - Math.min.apply(null, v); };
  ok('같은 수준의 플레이면 과일별 점수 차가 작음(최대−최소): 정확 ' + spread('정확') + ' · 살짝 깊게 ' + spread('살짝 깊게') + ' · 깊게 ' + spread('깊게') + ' · 40% ' + spread('40%에서 뗌') + ' · 60% ' + spread('60%에서 뗌') + '점', spread('정확') <= 4 && spread('살짝 깊게') <= 6 && spread('깊게') <= 10 && spread('40%에서 뗌') <= 8 && spread('60%에서 뗌') <= 6, runs);
  ok('큰 과일이라고 점수가 높지 않음: 배(가장 큰 표면) ≤ 사과 + 6 · 키위(가장 작음) ≥ 사과 − 6(정확 플레이 ' + IDS.map((id) => runs[id]['정확'].score).join('/') + ')', runs.pear['정확'].score <= runs.apple['정확'].score + 6 && runs.kiwi['정확'].score >= runs.apple['정확'].score - 6, runs);
  ok('평가 문구: 90+ 는 "{과일} 깎기 국가대표" — ' + IDS.map((id) => runs[id]['정확'].grade).join(' / '), runs.apple['정확'].grade === '사과 깎기 국가대표' && runs.pear['정확'].grade === '배 깎기 국가대표' && runs.kiwi['정확'].grade === '키위 깎기 국가대표' && runs.dragonfruit['정확'].grade === '용과 깎기 국가대표', IDS.map((id) => runs[id]['정확'].grade));

  console.log('=== 4. 껍질 리본 색 · 폭 ===');
  const rib = {};
  for (const id of IDS) {
    rib[id] = await p.evaluate(({ id, dur }) => {
      AP_DEBUG.goIntro(); AP_DEBUG.selectFruit(id); document.getElementById('btn-start').click(); document.getElementById('btn-select-next').click();
      AP_DEBUG.runAutopilot(7, { single: true, dur, depthFrac: 0.6 });         // 껍질이 나오는 중간에 멈춰 활성 리본을 읽는다(종료 전)
      const cols = AP_DEBUG.ribbonColors(), st = AP_DEBUG.snapshot();
      const col = AP.fruits.params(id).colors;
      /* 기대 색: ribbon.js 와 같은 방식(겉 = 껍질색, 안 = 껍질→과육 0.45 보간, 마디별 명암 0.94) */
      const mk = (rgb) => new THREE.Color().setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace);
      const skin = mk(col.skin), inner = skin.clone().lerp(mk(col.flesh), 0.45), out = [], o = {};
      [[skin, 1], [skin, 0.94], [inner, 1], [inner, 0.94]].forEach(([c, sh]) => { const t = new THREE.Color(c.r * sh, c.g * sh, c.b * sh); t.getRGB(o, THREE.SRGBColorSpace); out.push([Math.round(o.r * 255), Math.round(o.g * 255), Math.round(o.b * 255)]); });
      return { state: st.state, active: AP_DEBUG.ribbon().active, n: cols.length, cols, expected: out, skin: col.skin, cfgSkin: AP.CONFIG.SKIN_COLOR.slice(), measured: AP.fruits.measure(id).shape ? AP.fruits.measure(id).shape.whole.colorFrontMid : null, width: AP.CONFIG.RIBBON.WIDTH };
    }, { id, dur: DUR[id] });
    const r = rib[id], near = (a, b) => Math.abs(a[0] - b[0]) <= 4 && Math.abs(a[1] - b[1]) <= 4 && Math.abs(a[2] - b[2]) <= 4;
    ok(NAMES[id] + ' 리본: 활성 리본 있음(PLAYING) · 정점 색 ' + r.n + '종이 모두 껍질색(' + r.skin + ')·안쪽색 계열 · 리본이 읽는 색 = 이 과일 껍질색', r.state === 'playing' && r.active && r.n > 0 && r.cols.every((c) => r.expected.some((e) => near(c, e))) && r.cfgSkin.join() === r.skin.join(), r);
    if (r.measured) ok(NAMES[id] + ' 껍질색 = PNG 정면 실측색 ' + r.measured + ' × 1.05 → ' + r.skin, r.skin.every((v, i) => Math.abs(v - Math.min(255, Math.round(r.measured[i] * 1.05))) <= 1), r);
  }
  const dom = (c) => { const m = Math.max.apply(null, c); return m === c[0] ? 'r' : (m === c[1] ? 'g' : 'b'); };
  ok('색 계열: 사과 빨강(r 우세·g,b 낮음) · 배 황갈색(r>g>b, 노랑 기운) · 키위 갈색(r>g>b, 어두움) · 용과 분홍·자홍(r 우세, b > g)', rib.apple.skin[0] > 200 && rib.apple.skin[1] < 80 && rib.pear.skin[0] > rib.pear.skin[1] && rib.pear.skin[1] > rib.pear.skin[2] + 40 && rib.pear.skin[0] > 200 && rib.kiwi.skin[0] > rib.kiwi.skin[1] && rib.kiwi.skin[1] > rib.kiwi.skin[2] && rib.kiwi.skin[0] < 200 && dom(rib.dragonfruit.skin) === 'r' && rib.dragonfruit.skin[0] - rib.dragonfruit.skin[1] > 100 && rib.dragonfruit.skin[2] > rib.dragonfruit.skin[1], IDS.map((id) => rib[id].skin));
  ok('리본 폭: 키위(' + rib.kiwi.width + ')·용과(' + rib.dragonfruit.width + ') < 사과(' + rib.apple.width + ') ≤ 배(' + rib.pear.width + ') — 작은 과일/좁은 절삭 폭에 맞춤', rib.kiwi.width < rib.apple.width * 0.8 && rib.dragonfruit.width < rib.apple.width && rib.dragonfruit.width > rib.kiwi.width && rib.pear.width >= rib.apple.width, IDS.map((id) => rib[id].width));

  console.log('=== 5. 끝까지 깎아 결과 화면 · 저장 이미지(선택한 과일 유지) ===');
  await p.evaluate(() => AP_DEBUG.setPaused(false));
  for (const id of IDS) {
    await p.evaluate((id) => { AP_DEBUG.goIntro(); }, id);
    await p.click('#btn-start'); await p.click('.fruit-cell[data-fruit="' + id + '"]'); await p.click('#btn-select-next');
    await p.evaluate((dur) => { AP_DEBUG.setPaused(true); AP_DEBUG.runAutopilot(200, { single: true, dur, depthFrac: 0.6 }); AP_DEBUG.setPaused(false); }, DUR[id]);
    await p.waitForFunction(() => document.getElementById('screen-result').classList.contains('active'), null, { timeout: 10000 });
    const R = await p.evaluate(async (id) => {
      const s = AP_DEBUG.snapshot(), cv = AP.share.buildImage(s), ctx = cv.getContext('2d'), col = AP.fruits.params(id).colors;
      const d = ctx.getImageData(140, 520, 800, 900).data; let skin = 0, flesh = 0, nonWhite = 0;
      const nearC = (i, c) => Math.abs(d[i] - c[0]) < 60 && Math.abs(d[i + 1] - c[1]) < 60 && Math.abs(d[i + 2] - c[2]) < 60;
      for (let i = 0; i < d.length; i += 16) { if (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245) nonWhite++; if (nearC(i, col.skin)) skin++; if (nearC(i, col.flesh)) flesh++; }
      return { title: document.getElementById('result-title').textContent, save: document.getElementById('btn-save').textContent, score: document.getElementById('result-score').textContent, grade: document.getElementById('result-grade').textContent, detail: document.getElementById('result-detail').textContent, img: [cv.width, cv.height], nonWhite, skin, flesh, state: s.state, why: s.endReason, fruit: AP.fruits.current.id, mesh: AP_DEBUG.apple.fruitId };
    }, id);
    ok(NAMES[id] + ': 결과 화면 "' + R.title + '" · 점수 ' + R.score + ' · 버튼 "' + R.save + '" · 선택 과일 유지(모델 ' + R.mesh + ') · 저장 이미지 ' + R.img.join('×') + '에 과일(과육색 화소 ' + R.flesh + ' · 껍질색 화소 ' + R.skin + ')',
      R.title === NAMES[id] + ' 깎기 완료!' && R.save === '내 ' + NAMES[id] + ' 저장' && R.fruit === id && R.mesh === id && R.img[0] === 1080 && R.img[1] === 1920 && R.nonWhite > 5000 && (R.flesh + R.skin) > 800 && R.why === 'detach', R);
  }
  ok('페이지 오류 없음', errors.length === 0, errors);
  await b.close(); console.log(failures === 0 ? '\n모든 검사 통과' : '\n실패 ' + failures + '건'); process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
