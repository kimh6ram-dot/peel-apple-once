/* QA: 과일 선택 흐름(INTRO → SELECT → READY(튜토리얼 화면 없음)) · AppShell 레이아웃 · 과일 설정 인터페이스 · 마무리(SETTLING) · 동적 문구.
 * 사과 외 과일은 이미지가 없어 "준비 중"이므로, 인터페이스 검증에서만 임시로 선택 가능 상태를 주입하고 끝나면 되돌린다(제품 데이터 아님).
 * 사용: node tools/qa-fruits.js [--shots <dir>] */
'use strict';
const path = require('path'); const fs = require('fs');
const { chromium } = require('C:/Users/thkim/Desktop/code-work/260624/build/node_modules/playwright-core');
const si = process.argv.indexOf('--shots'); const SHOTS = si >= 0 ? process.argv[si + 1] : null; if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
let failures = 0;
function ok(l, c, d) { if (c) console.log('  OK  ', l); else { failures++; console.log('  FAIL', l, d !== undefined ? JSON.stringify(d) : ''); } }
const f = (n, d) => n.toFixed(d === undefined ? 1 : d);
const URL = 'file:///C:/Users/thkim/Desktop/code-work/04_꼬직/261014_apple game/index.html';
const click = (page, id) => page.evaluate((id) => document.getElementById(id).click(), id);
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];
  async function open(w, h, query, opts) {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: w, height: h } }, opts || {}));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/countapi|ERR_FAILED/.test(m.text())) errors.push('console: ' + m.text().slice(0, 120)); });
    await page.goto(URL + (query || '')); await page.waitForFunction(() => window.AP_READY === true, null, { timeout: 60000 });
    await page.evaluate(() => AP_DEBUG.setPaused(true));
    return page;
  }

  console.log('=== 1. 흐름 · 과일 선택 화면(2×2) ===');
  let page = await open(390, 844);
  const intro = await page.evaluate(() => ({ active: document.getElementById('screen-intro').classList.contains('active'), cells: document.querySelectorAll('#screen-intro .fruit-cell').length, h1: document.querySelector('#screen-intro h1').textContent }));
  ok('INTRO: 과일 4종을 보여주지 않고 메인 카피만("' + intro.h1 + '")', intro.active && intro.cells === 0 && intro.h1 === '한번에 깎으세요', intro);
  await click(page, 'btn-start'); await page.waitForTimeout(100);
  const meas = () => page.evaluate(() => {
    /* 화면에 보이는 실루엣 길이·위치 — 이미지 캔버스가 아니라 실측 bbox × 표시 배율(k = img.width / 원본 폭) */
    const info = (img, id, kind, box) => { const m = AP.fruits.measure(id), k = img.getBoundingClientRect().width / m[kind].w, b = m.whole.bbox, bb = box.getBoundingClientRect(), ir = img.getBoundingClientRect();
      const sx0 = ir.left + b.x * k, sy0 = ir.top + b.y * k; return { k, long: (m.sizeLongest || m.whole.longest) * k, w: b.w * k, h: b.h * k, left: sx0 - bb.left, top: sy0 - bb.top, right: bb.right - (sx0 + b.w * k), bottom: bb.bottom - (sy0 + b.h * k), cx: sx0 + b.w * k / 2 - (bb.left + bb.width / 2), cy: sy0 + b.h * k / 2 - (bb.top + bb.height / 2) }; };
    const cells = {}; document.querySelectorAll('#fruit-grid .fruit-img').forEach((box) => { const id = box.getAttribute('data-fruit'), im = box.querySelector('img'); if (im) cells[id] = info(im, id, 'whole', box); });
    const pv = document.querySelector('#select-preview'), pim = pv.querySelector('img'); const prev = pim ? info(pim, AP_DEBUG.previewFruit(), 'whole', pv) : null;
    return { cells, prev, fruit: AP_DEBUG.previewFruit() };
  });
  const sel = await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('#fruit-grid .fruit-cell')), r = (e) => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; };
    return { active: document.getElementById('screen-select').classList.contains('active'), title: document.getElementById('select-title').textContent, rects: cells.map(r), names: cells.map((c) => c.querySelector('.fruit-name').textContent), texts: cells.map((c) => c.textContent), disabled: cells.map((c) => c.disabled), selected: cells.map((c) => c.classList.contains('is-selected')), imgs: cells.map((c) => !!c.querySelector('img')), nextDisabled: document.getElementById('btn-select-next').disabled };
  });
  ok('SELECT 화면 · 제목 "' + sel.title + '" · 과일 4개: ' + sel.names.join(' · '), sel.active && sel.title === '과일을 선택하세요' && sel.names.join('|') === '사과|배|키위|용과' && sel.texts.join('|') === '사과|배|키위|용과' && !/난이도|준비/.test(sel.texts.join('')), sel);
  const R = sel.rects;
  ok('2×2 그리드: 1행 [사과 배] · 2행 [키위 용과] (같은 열 x 정렬, 같은 행 y 정렬, 열 간격 8px)', Math.abs(R[0][0] - R[2][0]) < 0.5 && Math.abs(R[1][0] - R[3][0]) < 0.5 && Math.abs(R[0][1] - R[1][1]) < 0.5 && Math.abs(R[2][1] - R[3][1]) < 0.5 && Math.abs(R[1][0] - R[0][2] - 8) < 0.5 && R[2][1] > R[0][3], R);
  ok('4종 모두 실제 이미지 표시 · 사과 선택(검정 테두리) · 사과는 [다음] 활성', sel.imgs.every(Boolean) && sel.selected.join() === 'true,false,false,false' && sel.disabled.every((d) => !d) && !sel.nextDisabled, sel);
  const M = await meas(), C = M.cells, ap = C.apple.long;
  const rel = (id) => C[id].long / ap;
  ok('카드 크기(실루엣 기준, 사과=1): 배 ' + f(rel('pear'), 3) + '(목표 1.08) · 키위 ' + f(rel('kiwi'), 3) + '(0.72) · 용과 ' + f(rel('dragonfruit'), 3) + '(1.00)', Math.abs(rel('pear') - 1.08) < 0.01 && Math.abs(rel('kiwi') - 0.72) < 0.01 && Math.abs(rel('dragonfruit') - 1.00) < 0.01, C);
  ok('배는 사과보다 작아 보이지 않음(길이 +' + f((rel('pear') - 1) * 100, 0) + '%, 높이·너비 모두 ≥ 사과) · 키위는 사과보다 확실히 작음(' + f(rel('kiwi') * 100, 0) + '%) · 용과는 사과와 비슷한 크기이고 키위보다 큼(' + f(C.dragonfruit.long, 0) + 'px, 사과 ' + f(ap, 0) + 'px, 키위 ' + f(C.kiwi.long, 0) + 'px)', C.pear.w >= C.apple.w * 0.99 && C.pear.h >= C.apple.h * 0.99 && rel('kiwi') < 0.8 && C.kiwi.w < C.apple.w * 0.8 && Math.abs(rel('dragonfruit') - 1) < 0.1 && C.dragonfruit.long > C.kiwi.long * 1.2, C);
  ok('카드 안에서 잘리지 않고 중앙 정렬(여백 ≥ 0, 중심 오차 ≤ 1px)', Object.values(C).every((c) => c.left >= 0 && c.top >= 0 && c.right >= 0 && c.bottom >= 0 && Math.abs(c.cx) <= 1 && Math.abs(c.cy) <= 1), C);
  const pr = {};
  for (const id of ['apple', 'pear', 'kiwi', 'dragonfruit']) { await page.evaluate((id) => document.querySelector('#fruit-grid .fruit-cell[data-fruit="' + id + '"]').click(), id); const m = await meas(); pr[id] = m.prev; pr[id].nextDisabled = await page.evaluate(() => document.getElementById('btn-select-next').disabled); pr[id].noteHidden = await page.evaluate(() => document.getElementById('select-note').hidden); }
  ok('상단 미리보기 크기(사과=1): 배 ' + f(pr.pear.long / pr.apple.long, 3) + '(1.08) · 키위 ' + f(pr.kiwi.long / pr.apple.long, 3) + '(0.72) · 용과 ' + f(pr.dragonfruit.long / pr.apple.long, 3) + '(1.00) — 모두 프레임 안에 잘림 없이(여백 ≥ 4px)', Math.abs(pr.pear.long / pr.apple.long - 1.08) < 0.01 && Math.abs(pr.kiwi.long / pr.apple.long - 0.72) < 0.01 && Math.abs(pr.dragonfruit.long / pr.apple.long - 1.00) < 0.01 && Object.values(pr).every((p) => p.left >= 4 && p.top >= 4 && p.right >= 4 && p.bottom >= 4 && Math.abs(p.cx) <= 1 && Math.abs(p.cy) <= 1), pr);
  ok('4종 모두 플레이 가능: 어느 과일을 골라도 [시작하기] 활성 · 안내문 없음', ['apple', 'pear', 'kiwi', 'dragonfruit'].every((id) => !pr[id].nextDisabled && pr[id].noteHidden === true), pr);
  ok('고른 과일이 곧 플레이 과일(마지막으로 고른 용과)', (await page.evaluate(() => AP_DEBUG.selectedFruit())) === 'dragonfruit');
  const pe = await page.evaluate(() => { const out = {}; /* 용과는 제외: 껍질 PNG 에는 돌기(장식)가 있고 본체 위치도 껍질/과육 PNG 가 서로 다르다 — 게임은 PNG 를 겹쳐 쓰지 않고 본체 윤곽으로 3D 를 만든다(qa-dragonfruit.js) */ for (const id of ['apple', 'pear', 'kiwi']) { const m = AP.fruits.measure(id), k = AP.fruits.previewK(id, 124); const bw = m.whole.bbox, bp = m.peeled.bbox; out[id] = { dxPx: ((bp.x + bp.w / 2) - (bw.x + bw.w / 2)) * k, dyPx: ((bp.y + bp.h / 2) - (bw.y + bw.h / 2)) * k, dwPct: 100 * (bp.w - bw.w) / bw.w, dhPct: 100 * (bp.h - bw.h) / bw.h }; } return out; });
  const peMax = Math.max.apply(null, Object.values(pe).map((p) => Math.hypot(p.dxPx, p.dyPx)));
  ok('껍질/과육(peeled) 이미지는 같은 배율·같은 기준점(껍질 버전 bbox 중심)에 놓임 — 위치 겹침 오차(원본 그림 차이) 최대 ' + f(peMax, 1) + 'px @길이 124px, 크기 차이 최대 ' + f(Math.max.apply(null, Object.values(pe).map((p) => Math.max(Math.abs(p.dwPct), Math.abs(p.dhPct)))), 1) + '%', peMax < 4 && Object.values(pe).every((p) => Math.abs(p.dwPct) < 12 && Math.abs(p.dhPct) < 5), pe);
  const pl = await page.evaluate(() => { const o = {}; for (const id of ['apple', 'pear', 'kiwi', 'dragonfruit']) { o[id] = AP.fruits.longest(id) * AP.fruits.playK(id); } const a = AP.fruits.measure('apple'); o.engineApple = a.whole.longest * (AP.CONFIG.APPLE_DIAMETER / 2) / (a.whole.bbox.w / 2); return o; });
  ok('플레이 scale(사과=1): 배 ' + f(pl.pear / pl.apple, 3) + '(1.12) · 키위 ' + f(pl.kiwi / pl.apple, 3) + '(0.68) · 용과 ' + f(pl.dragonfruit / pl.apple, 3) + '(1.03) · 사과 표시 길이 ' + f(pl.apple, 1) + 'px = 엔진 사과 실루엣 ' + f(pl.engineApple, 1) + 'px(기존과 동일)', Math.abs(pl.pear / pl.apple - 1.12) < 0.005 && Math.abs(pl.kiwi / pl.apple - 0.68) < 0.005 && Math.abs(pl.dragonfruit / pl.apple - 1.03) < 0.005 && Math.abs(pl.apple - pl.engineApple) < 0.01, pl);
  await page.evaluate(() => document.querySelector('#fruit-grid .fruit-cell[data-fruit="apple"]').click());
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'fr-select-390.png') });
  await click(page, 'btn-select-next'); await page.waitForTimeout(100);
  const rd = await page.evaluate(() => ({ state: AP_DEBUG.snapshot().state, ui: document.querySelectorAll('.screen.active').length, hud: !document.getElementById('hud').classList.contains('ui-hidden'), fruit: AP.fruits.current.id, tut: !!document.getElementById('screen-tutorial') || !!document.getElementById('btn-tutorial-start'), label: document.getElementById('btn-select-next').textContent, hint: document.getElementById('hint').textContent, hintVis: !document.getElementById('hint').classList.contains('ui-hidden') }));
  ok('과일 선택 [시작하기] → 곧바로 READY(튜토리얼 화면·버튼 DOM 없음) · 안내 한 줄 표시 · 선택 과일 ' + rd.fruit, rd.state === 'ready' && rd.ui === 0 && rd.hud && rd.fruit === 'apple' && !rd.tut && rd.label === '시작하기' && rd.hintVis && rd.hint === '방향키로 이동 · Q/W로 각도 조절 · 칼을 떼면 끝!', rd);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'fr-ready-390.png') });
  await page.close();
  const pm = await open(390, 844, '', { hasTouch: true, isMobile: true });
  await pm.evaluate(() => { document.getElementById('btn-start').click(); document.getElementById('btn-select-next').click(); });
  const tm = await pm.evaluate(() => ({ st: AP_DEBUG.snapshot().state, t: document.getElementById('hint').textContent }));
  ok('모바일 READY 안내: "' + tm.t + '"', tm.st === 'ready' && tm.t === '방향 버튼으로 이동 · 회전 버튼으로 각도 조절 · 칼을 떼면 끝!', tm);
  await pm.close();
  for (const vw of [320, 360, 390, 430]) {
    for (const touch of [false, true]) {
      const hp = await open(vw, 800, '', touch ? { hasTouch: true, isMobile: true } : {});
      await hp.evaluate(() => { document.getElementById('btn-start').click(); document.getElementById('btn-select-next').click(); });
      const h = await hp.evaluate(() => { const e = document.getElementById('hint'), r = e.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(e); const tr = range.getBoundingClientRect(); return { lines: tr.height < parseFloat(getComputedStyle(e).fontSize) * 1.9 ? 1 : 2, left: tr.left, right: tr.right, iw: window.innerWidth, fs: parseFloat(getComputedStyle(e).fontSize), sw: document.scrollingElement.scrollWidth }; });
      ok(vw + 'px ' + (touch ? '모바일' : 'PC') + ' 안내 한 줄 · 글자 ' + f(h.fs, 1) + 'px · 화면 안(' + f(h.left, 0) + '~' + f(h.right, 0) + '/' + h.iw + ') · 가로 스크롤 없음', h.lines <= 1 && h.left >= 0 && h.right <= h.iw && h.sw <= h.iw, h);
      await hp.close();
    }
  }

  console.log('=== 2. AppShell(§37): 같은 토큰 · 같은 y · CTA 바닥 고정 없음 (320~430) ===');
  for (const vp of [[320, 568], [360, 800], [375, 812], [390, 844], [430, 932]]) {
    const p = await open(vp[0], vp[1]);
    const g = await p.evaluate(() => {
      const q = (s) => document.querySelector(s).getBoundingClientRect(), out = {};
      out.intro = { v: q('#screen-intro .slot-visual').top, t: q('#screen-intro .slot-title').top, c: q('#btn-start').top, vh: q('#screen-intro .slot-visual').height, vw: q('#screen-intro .slot-visual').width };
      document.getElementById('btn-start').click();
      const grid = q('#fruit-grid'), cta = q('#btn-select-next');
      out.sel = { v: q('#screen-select .slot-visual').top, t: q('#screen-select .slot-title').top, vh: q('#screen-select .slot-visual').height, vw: q('#screen-select .slot-visual').width, gridBottom: grid.bottom, ctaTop: cta.top, ctaBottom: cta.bottom, ih: window.innerHeight, sw: document.scrollingElement.scrollWidth, iw: window.innerWidth };
      out.pos = ['btn-start', 'btn-select-next'].map((id) => getComputedStyle(document.getElementById(id)).position);
      out.gap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gap-content-cta'));
      return out;
    });
    ok(vp.join('×') + ': SELECT CTA 는 그리드 바로 아래(간격 ' + f(g.sel.ctaTop - g.sel.gridBottom, 1) + ' = 토큰 ' + g.gap + ') · 화면 안(' + f(g.sel.ctaBottom, 0) + '/' + g.sel.ih + ') · 가로 스크롤 없음 · position ' + g.pos.join('/'),
      Math.abs(g.sel.ctaTop - g.sel.gridBottom - g.gap) < 1.5 && g.sel.ctaBottom <= g.sel.ih && g.sel.sw <= g.sel.iw && g.pos.every((x) => x === 'static' || x === 'relative'), g);
    await p.close();
  }

  console.log('=== 3. 과일 설정 인터페이스 · 에셋 오류 처리 · 점수 정규화 · 동적 문구 ===');
  page = await open(390, 844);
  const cfg = await page.evaluate(async () => {
    const out = {}, F = AP.fruits;
    out.keys = F.ORDER.map((id) => id + ':' + Object.keys(F.CONFIGS[id]).filter((k) => k !== 'decor').sort().join(',')   /* decor 는 장식이 있는 과일(용과)만 가지는 선택 항목 */).filter((s, i, a) => s.split(':')[1] === a[0].split(':')[1]).length;
    out.status = F.ORDER.map((id) => id + '=' + F.status(id)).join(' ');
    // 이미지가 "전달됐다고" 표시했는데 파일이 없는 경우: 오류 없이 준비 중
    const w0 = F.CONFIGS.pear.assets.whole; F.CONFIGS.pear.assets.whole = 'assets/does_not_exist.png'; await new Promise((res) => F.probe(res)); out.missingFile = { avail: F.available('pear'), status: F.status('pear') }; F.CONFIGS.pear.assets.whole = w0; await new Promise((res) => F.probe(res));
    // 가짜로 준비 상태 주입(인터페이스 검증용)
    const orig = { rot: F.CONFIGS.pear.rotation.period, ws: F.CONFIGS.pear.cutting.widthScale, lr: F.CONFIGS.pear.scoring.lenRefCm };
    F.CONFIGS.pear.rotation.period = 3.0; F.CONFIGS.pear.cutting.widthScale = 0.9; F.CONFIGS.pear.scoring.lenRefCm = 50;
    const m = { peelPct: 80, fleshPct: 0, longestCm: 50, emittedCm: 50 }; const sApple = AP.score.compute(m).continuity;
    out.selectOk = F.select('pear'); out.rot = AP.rotation.period; out.width = AP.CONFIG.CUT.WIDTH_SCALE; const sPear = AP.score.compute(m).continuity;
    out.cont = [sApple, sPear]; out.pearGrade = AP.score.gradeOf(95); out.url = (AP.CONFIG.SHARE.URL = 'https://example.test/g/', AP.share.shareUrl());
    AP_DEBUG.selectFruit('pear'); out.label = document.getElementById('btn-save').textContent; out.sel = AP_DEBUG.selectedFruit();
    // 되돌리기
    F.select('apple'); AP.rotation.period = 2.5; AP.CONFIG.CUT.WIDTH_SCALE = 0.8; AP.CONFIG.CUT.WINDOW_HALF = 12; F.CONFIGS.pear.rotation.period = orig.rot; F.CONFIGS.pear.cutting.widthScale = orig.ws; F.CONFIGS.pear.scoring.lenRefCm = orig.lr; AP.CONFIG.SHARE.URL = '';
    AP_DEBUG.selectFruit('apple'); out.back = { fruit: F.current.id, label: document.getElementById('btn-save').textContent, appleGrade: AP.score.gradeOf(95), rot: AP.rotation.period, width: AP.CONFIG.CUT.WIDTH_SCALE };
    return out;
  });
  const expected404 = errors.splice(0).filter((e) => !/ERR_FILE_NOT_FOUND/.test(e));   // 이 구간의 404 는 "없는 파일" 오류 처리 검증을 위해 일부러 요청한 것
  if (expected404.length) errors.push.apply(errors, expected404);
  ok('과일 설정 4종이 같은 스키마(assets/shape/rotation/cutting/scoring/grades) · 상태 ' + cfg.status, cfg.keys === 4 && /apple=ready pear=ready kiwi=ready dragonfruit=ready/.test(cfg.status), cfg);
  ok('이미지 파일이 없거나 로드 실패해도 오류 없이 "준비 중"(no-assets)', cfg.missingFile.avail === false && cfg.missingFile.status === 'no-assets', cfg.missingFile);
  ok('설정만으로 과일 전환: 회전 주기 ' + cfg.rot + 's · 절삭 폭 ' + cfg.width + ' 적용(엔진 코드 수정 없음)', cfg.selectOk && cfg.rot === 3.0 && cfg.width === 0.9, cfg);
  ok('점수 정규화: 같은 최장 50cm 의 연속성 — 사과(기준 100cm) ' + f(cfg.cont[0], 0) + ' < 배(기준 50cm) ' + f(cfg.cont[1], 0) + ' (과일별 기준 길이)', cfg.cont[1] > cfg.cont[0] + 10, cfg.cont);
  ok('문구는 사과 문구의 "사과"만 과일 이름으로("' + cfg.pearGrade + '") · 공유 링크에 과일 ID(' + cfg.url + ') · 저장 버튼 "' + cfg.label + '"', cfg.pearGrade === '배 깎기 국가대표' && cfg.url === 'https://example.test/g/?fruit=pear' && cfg.label === '내 배 저장' && cfg.sel === 'pear', cfg);
  ok('사과로 되돌리면 확정 문구·"내 사과 저장"·회전 2.5·폭 0.8 복원', cfg.back.fruit === 'apple' && cfg.back.label === '내 사과 저장' && cfg.back.appleGrade === '사과 깎기 국가대표' && cfg.back.rot === 2.5 && cfg.back.width === 0.8, cfg.back);

  console.log('=== 4. SETTLING(마무리) → RESULT ===');
  const st = await page.evaluate(() => {
    AP_DEBUG.setLegacy(false); AP_DEBUG.goIntro(); AP_DEBUG.start();
    AP_DEBUG.runAutopilot(200, { single: true, dur: 40, depthFrac: 0.6, stopAt: 0.2 });
    const out = { ended: AP_DEBUG.snapshot().state === 'ended' };
    const open = () => document.getElementById('screen-result').classList.contains('active');
    out.at0 = open(); const f0 = AP.ribbon.info(); out.fall0 = f0.falling;
    const pts0 = AP.ribbon.fallPoints()[0]; AP_DEBUG.run(0.4, 60); out.at04 = open(); const pts1 = AP.ribbon.fallPoints()[0];
    out.fell = pts0 && pts1 ? pts1.reduce((a, p) => a + p[1], 0) / pts1.length - pts0.reduce((a, p) => a + p[1], 0) / pts0.length : null;
    AP_DEBUG.run(0.5, 60); out.at09 = open(); out.title = document.getElementById('result-title').textContent;
    const s = AP_DEBUG.snapshot(); out.angleFrozen = s.angle;
    return out;
  });
  ok('종료 직후엔 결과 화면이 아직 없고(0s/0.4s) 마지막 껍질이 분리돼 떨어지며(평균 y +' + (st.fell === null ? '?' : f(st.fell, 0)) + 'px) 0.8s 뒤 결과 화면', st.ended && !st.at0 && !st.at04 && st.at09 && st.fall0 >= 1 && st.fell > 5, st);
  ok('결과 제목 = 선택 과일의 제목("' + st.title + '")', st.title === '사과 깎기 완료!');
  ok('콘솔·페이지 오류 없음(없는 과일 이미지를 요청하지 않음)', errors.length === 0, errors);
  await page.close();

  console.log('=== 5. 공유 링크 ?fruit= 미리 선택 ===');
  let pa = await open(390, 844, '?fruit=apple'); ok('?fruit=apple → 사과 선택 · INTRO 로 시작', (await pa.evaluate(() => AP_DEBUG.selectedFruit() + '/' + document.getElementById('screen-intro').classList.contains('active'))) === 'apple/true'); await pa.close();
  pa = await open(390, 844, '?fruit=pear'); ok('?fruit=pear → 배가 미리 선택됨(플레이 과일 · 3D 모델도 배) · 오류 없음', (await pa.evaluate(() => AP_DEBUG.selectedFruit() === 'pear' && AP_DEBUG.apple.fruitId === 'pear')) && errors.length === 0, errors); await pa.close();
  await browser.close(); console.log(failures === 0 ? '\n모든 검사 통과' : '\n실패 ' + failures + '건'); process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
