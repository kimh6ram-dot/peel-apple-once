/* QA: 화면 전환 시 세로 중심 — INTRO 를 기준으로 과일 선택 · 플레이(READY) · SETTLING · 결과 화면의 같은 역할 요소 중심 Y 를 실측한다.
 * 측정: getBoundingClientRect (비주얼 프레임 · 콘텐츠 묶음 · CTA), 플레이는 과일(몸통)·칼 bbox 중심.
 * 사용: node tools/qa-layout.js [--report] [--shots <dir>]   (--report: 판정 없이 표만 출력)
 * 목표: 같은 역할의 주요 비주얼 중심 Y 편차 ≤ 10px. 못 맞추는 경우는 그 한계(칼 이동 범위 · 결과 상단 여백)가 실제로 걸렸을 때만 허용한다. */
'use strict';
const { chromium } = require('C:/Users/thkim/Desktop/code-work/260624/build/node_modules/playwright-core');
const path = require('path');
const REPORT = process.argv.includes('--report');
const si = process.argv.indexOf('--shots'), SHOTS = si > 0 ? process.argv[si + 1] : null;
let failures = 0;
function ok(l, c, d) { if (c) console.log('  OK  ', l); else { failures++; console.log('  FAIL', l, d !== undefined ? JSON.stringify(d) : ''); } }
const f = (n, d) => (n === null || n === undefined ? '-' : n.toFixed(d === undefined ? 0 : d));
const SIZES = [[320, 568], [375, 667], [390, 844], [430, 932], [1280, 800]];
const URL = 'file:///C:/Users/thkim/Desktop/code-work/04_꼬직/261014_apple game/index.html';
const NL = String.fromCharCode(10);

const MEASURE = `(() => {
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { t: b.top, b: b.bottom, l: b.left, rr: b.right, cy: (b.top + b.bottom) / 2, cx: (b.left + b.right) / 2, h: b.height, w: b.width }; };
  const q = (s) => document.querySelector(s), vis = (s) => { const e = q(s); return e && e.classList.contains('active'); };
  const app = r(q('#app'));
  const out = { app, ih: window.innerHeight, iw: window.innerWidth };
  if (vis('#screen-intro')) { out.screen = 'intro'; out.visual = r(q('#screen-intro .slot-visual')); out.title = r(q('#screen-intro .slot-title')); out.body = r(q('#screen-intro .slot-body')); out.cta = r(q('#btn-start')); out.first = out.visual.t; out.last = out.cta.b; }
  else if (vis('#screen-select')) { out.screen = 'select'; out.visual = r(q('#screen-select .slot-visual')); out.title = r(q('#screen-select .slot-title')); out.grid = r(q('#fruit-grid')); out.cta = r(q('#btn-select-next')); out.first = out.visual.t; out.last = out.cta.b; }
  else if (vis('#screen-result')) { const sc = q('#screen-result'); out.screen = 'result'; out.visual = r(q('#result-canvas').parentElement); out.title = r(q('#result-title')); out.body = r(q('.result-body')); out.score = r(q('#result-score')); out.detail = r(q('#result-detail')); out.cta = r(q('#btn-challenge')); out.save = r(q('#btn-save')); out.restart = r(q('#btn-restart')); out.mark = r(q('.result-mark')); out.first = out.visual.t; out.last = out.mark.b; out.scrollH = sc.scrollHeight; out.clientH = sc.clientHeight; out.scrollable = sc.scrollHeight > sc.clientHeight + 1; }
  else { out.screen = 'play'; const hud = r(q('#hud')), pad = r(q('#pad')); out.hud = hud; out.pad = pad;
    const sc = app.w / 375, S = AP_DEBUG.surface(), vs = AP_DEBUG.apple.viewScale, kr = AP_DEBUG.snapshot().knife.rect;
    const top = AP.scene.project(new THREE.Vector3(0, S.topY * vs, 0)).y, bot = AP.scene.project(new THREE.Vector3(0, S.bottomY * vs, 0)).y;
    out.fruit = { t: app.t + top * sc, b: app.t + bot * sc, cy: app.t + (top + bot) / 2 * sc };
    out.knife = { t: app.t + kr.y0 * sc, b: app.t + kr.y1 * sc };
    out.first = Math.min(out.fruit.t, out.knife.t); out.last = Math.max(out.fruit.b, out.knife.b); out.visual = { cy: out.fruit.cy, t: out.fruit.t, b: out.fruit.b }; }
  out.bundleCy = (out.first + out.last) / 2;
  return out; })()`;

(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const rows = {};
  for (const [w, h] of SIZES) {
    const key = w + '×' + h;
    const p = await b.newPage({ viewport: { width: w, height: h } });
    const errors = []; p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(URL);
    await p.waitForFunction(() => window.AP_READY === true, null, { timeout: 60000 });
    const M = { fade: {} };
    const shot = async (n) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'layout_' + key + '_' + n + '.png') }); };
    M.intro = await p.evaluate(MEASURE); await shot('1intro');
    M.anchor = await p.evaluate(() => document.getElementById('layout-probe').getBoundingClientRect().height);
    await p.click('#btn-start'); await p.waitForTimeout(25);
    const selEarly = await p.evaluate(MEASURE); await p.waitForTimeout(300);
    M.select = await p.evaluate(MEASURE); await shot('2select'); M.fade.d1 = Math.abs(selEarly.visual.cy - M.select.visual.cy);
    await p.click('#btn-select-next'); await p.waitForTimeout(25);
    const rdEarly = await p.evaluate(MEASURE); await p.waitForTimeout(300);
    M.ready = await p.evaluate(MEASURE); await shot('3ready'); M.fade.d2 = Math.abs(rdEarly.visual.cy - M.ready.visual.cy);
    M.lim = await p.evaluate(() => { const l = AP_DEBUG.layout(); return { limited: l.limited, slack: l.slack }; });
    /* SETTLING: 종료 직후(결과 화면이 열리기 전) 같은 플레이 화면 */
    await p.evaluate(() => { AP_DEBUG.setPaused(true); AP_DEBUG.runAutopilot(200, { single: true, dur: 40, depthFrac: 0.6, tapMs: 1500 }); });
    M.settle = await p.evaluate(MEASURE); M.settle.state = await p.evaluate(() => AP_DEBUG.snapshot().state); await shot('4settle');
    await p.evaluate(() => AP_DEBUG.setPaused(false));
    await p.waitForFunction(() => document.getElementById('screen-result').classList.contains('active'), null, { timeout: 10000 });
    await p.waitForTimeout(300);
    M.result = await p.evaluate(MEASURE); await shot('5result');
    M.resultPad = await p.evaluate(() => getComputedStyle(document.getElementById('screen-result')).paddingTop);
    M.resultBottomOk = await p.evaluate(() => { const sc = document.getElementById('screen-result'); sc.scrollTop = sc.scrollHeight; const m = document.querySelector('.result-mark').getBoundingClientRect(), a = document.getElementById('app').getBoundingClientRect(); const good = m.bottom <= a.bottom + 0.5 && m.top >= 0; sc.scrollTop = 0; return good; });
    M.fixedCtas = await p.evaluate(() => ['btn-start', 'btn-select-next', 'btn-save', 'btn-challenge', 'btn-restart'].map((id) => getComputedStyle(document.getElementById(id)).position));
    M.ctaTop = await p.evaluate(() => { const e = document.createElement('div'); e.style.cssText = 'position:absolute;left:0;top:0;width:1px;visibility:hidden;height:var(--cta-top)'; document.getElementById('app').appendChild(e); const h = e.getBoundingClientRect().height; e.remove(); return h; });
    M.gapCta = await p.evaluate(() => { const e = document.createElement('div'); e.style.cssText = 'position:absolute;visibility:hidden;height:var(--gap-content-cta)'; document.getElementById('app').appendChild(e); const h = e.getBoundingClientRect().height; e.remove(); return h; });
    const tokenPx = (name) => p.evaluate((n) => { const e = document.createElement('div'); e.style.cssText = 'position:absolute;visibility:hidden;width:1px;height:var(' + n + ')'; document.getElementById('app').appendChild(e); const h = e.getBoundingClientRect().height; e.remove(); return h; }, name);
    M.gaps = { pt: await tokenPx('--gap-preview-title'), tc: await tokenPx('--gap-title-content'), cc: await tokenPx('--gap-content-cta'), info: await tokenPx('--info-body-height') };
    M.minTop = await tokenPx('--min-top');
    M.selPad = await p.evaluate(() => { const e = document.getElementById('screen-select'), d = e.style.display; e.style.display = 'flex'; const v = getComputedStyle(e).paddingTop; e.style.display = d; return v; });
    M.resPad = await p.evaluate(() => getComputedStyle(document.getElementById('screen-result')).paddingTop);
    M.noHScroll = await p.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth);
    M.errors = errors; rows[key] = M; await p.close();
  }
  await b.close();

  console.log('=== 화면별 중심 Y (px, 뷰포트 기준) · 괄호 = INTRO 대비 편차 (플레이는 과일 몸통, 묶음 = 과일+칼) ===');
  console.log('크기'.padEnd(10) + '화면'.padEnd(8) + '비주얼cy'.padStart(9) + '(Δ)'.padStart(7) + ' 묶음cy'.padStart(8) + '(Δ)'.padStart(7) + ' CTA y'.padStart(8) + '(Δ)'.padStart(7) + '  묶음 top~bottom / 화면높이');
  for (const key of Object.keys(rows)) {
    const R = rows[key], base = R.intro;
    for (const s of ['intro', 'select', 'ready', 'settle', 'result']) {
      const m = R[s], ctaY = m.cta ? m.cta.cy : null;
      console.log(key.padEnd(10) + s.padEnd(8) + f(m.visual.cy).padStart(9) + ('(' + f(m.visual.cy - base.visual.cy) + ')').padStart(7) + f(m.bundleCy).padStart(8) + ('(' + f(m.bundleCy - base.bundleCy) + ')').padStart(7) + (ctaY === null ? '-' : f(ctaY)).padStart(8) + (ctaY === null || !base.cta ? '' : ('(' + f(ctaY - base.cta.cy) + ')')).padStart(7) + '  ' + f(m.first) + '~' + f(m.last) + ' / ' + m.ih + (m.scrollable ? '  [스크롤]' : ''));
    }
  }
  if (REPORT) { process.exit(0); }
  console.log(NL + '=== 판정 ===');
  /* 기준 = 원래 메인(INTRO) 레이아웃. 폴더가 git 이력에 없어서, 레이아웃 작업을 시작하기 전에 같은 앱에서 실측해 둔 값을 기준으로 쓴다(화면 크기별 [비주얼 중심, 묶음 top, 묶음 bottom, 시작하기 버튼 중심]) */
  const ORIG = { '320×568': [147, 72, 435, 414], '375×667': [184, 84, 535, 511], '390×844': [243, 143, 594, 570], '430×932': [272, 172, 623, 599], '1280×800': [228, 128, 579, 555] };
  const TOL = 10;
  for (const key of Object.keys(rows)) {
    const R = rows[key], base = R.intro, o = ORIG[key], dv = (s) => R[s].visual.cy - base.visual.cy;
    const dev = [base.visual.cy - o[0], base.first - o[1], base.last - o[2], base.cta.cy - o[3]];
    ok(key + ': INTRO = 원래 메인 레이아웃(비주얼 중심 ' + f(base.visual.cy) + ' · 묶음 ' + f(base.first) + '~' + f(base.last) + ' · [시작하기] 중심 ' + f(base.cta.cy) + ' / 원래 ' + o.join(' · ') + ', 최대 오차 ' + f(Math.max.apply(null, dev.map(Math.abs)), 1) + 'px)', dev.every((d) => Math.abs(d) <= 1.5), { dev, o });
    ok(key + ': INTRO 내부 간격 원래대로 — 비주얼→제목 ' + f(base.title.t - base.visual.b, 1) + ' · 제목→본문 ' + f(base.body.t - base.title.b, 1) + ' · 본문→버튼 ' + f(base.cta.t - base.body.b, 1) + 'px(= 토큰 ' + f(R.gaps.pt, 0) + '/' + f(R.gaps.tc, 0) + '/' + f(R.gaps.cc, 0) + ') · 본문 슬롯 ' + f(base.body.h, 0) + 'px(= 원래 ' + f(R.gaps.info, 0) + ')', Math.abs(base.title.t - base.visual.b - R.gaps.pt) < 0.6 && Math.abs(base.body.t - base.title.b - R.gaps.tc) < 0.6 && Math.abs(base.cta.t - base.body.b - R.gaps.cc) < 0.6 && Math.abs(base.body.h - R.gaps.info) < 0.6, { base, gaps: R.gaps });
    const selClamped = parseFloat(R.selPad) <= R.minTop + 0.5, resClamped = parseFloat(R.resPad) <= R.minTop + 0.5;
    const dS = R.select.cta.t - base.cta.t, dR = R.result.cta.t - base.cta.t;
    ok(key + ': 과일 선택 [시작하기] 상단 Y 오차 ' + f(dS, 1) + 'px' + (selClamped ? ' — 선택 화면은 내용(비주얼 ' + f(R.select.visual.h, 0) + ' + 제목 + 그리드 ' + f(R.select.grid.h, 0) + ')이 더 길어 시작점이 상단 최소 여백(' + R.minTop + 'px)까지 올라갔는데도 INTRO 버튼 위에 다 못 들어감' : ' ≤ 2'), selClamped ? dS >= 0 : Math.abs(dS) <= 2, { dS, selPad: R.selPad });
    ok(key + ': 결과 도전장 상단 Y 오차 ' + f(dR, 1) + 'px' + (resClamped ? ' — 상단 최소 여백에서 시작해도 못 맞춤' : ' ≤ 2'), resClamped ? dR >= 0 : Math.abs(dR) <= 2, { dR, resPad: R.resPad });
    ok(key + ': 선택·결과에서 콘텐츠와 버튼이 겹치지 않고 간격 토큰만큼 떨어짐(선택 ' + f(R.select.cta.t - R.select.grid.b, 1) + ' · 결과 ' + f(R.result.cta.t - R.result.body.b, 1) + 'px = ' + f(R.gaps.cc, 0) + ') · 결과 점수·평가·세부 기록이 본문 슬롯 안(' + f(R.result.detail.b - R.result.score.t, 0) + ' ≤ ' + f(R.result.body.h, 0) + ')', Math.abs(R.select.cta.t - R.select.grid.b - R.gaps.cc) < 0.6 && Math.abs(R.result.cta.t - R.result.body.b - R.gaps.cc) < 0.6 && R.result.score.t >= R.result.body.t - 0.5 && R.result.detail.b <= R.result.body.b + 0.5, R.result);
    ok(key + ': 결과 화면이 INTRO 보다 아래로 밀리지 않음(비주얼 중심 ' + f(dv('result'), 1) + 'px, 묶음 시작 ' + f(R.result.first) + ' ≥ 0) · 선택 화면 비주얼 중심 ' + f(dv('select'), 1) + 'px(내용이 길어 위로)', dv('result') <= 1.5 && R.result.first >= 0 && R.select.first >= 0, { result: dv('result'), select: dv('select') });
    ok(key + ': 플레이(READY) 과일 중심 편차 ' + f(Math.abs(dv('ready')), 1) + 'px' + (Math.abs(dv('ready')) <= TOL ? ' ≤ ' + TOL : ' > ' + TOL + ' — 칼 이동 범위 한계(칼날이 HUD 아래·패드 위에 들어가야 능선~바닥에 닿음): 과일이 가장 높은 위치(' + R.lim.limited + ', 여유 ' + f(R.lim.slack) + 'px)'), Math.abs(dv('ready')) <= TOL || R.lim.limited === 'top', R.lim);
    ok(key + ': SETTLING 중 과일 위치 = READY(' + f(Math.abs(R.ready.visual.cy - R.settle.visual.cy), 2) + 'px)', Math.abs(R.ready.visual.cy - R.settle.visual.cy) < 0.5 && R.settle.state === 'ended', { ready: R.ready.visual, settle: R.settle.visual, st: R.settle.state });
    const C3 = [R.intro.cta, R.select.cta, R.result.cta], ws = C3.map((c) => c.w), hs = C3.map((c) => c.h), cxs = C3.map((c) => c.cx), appCx = R.intro.app.l + R.intro.app.w / 2;
    ok(key + ': 주요 CTA 크기 동일(' + f(ws[0], 1) + '×' + f(hs[0], 1) + ') · 좌우 중심 = 앱 중심(오차 ' + f(Math.max.apply(null, cxs.map((c) => Math.abs(c - appCx))), 2) + 'px) · position fixed 없음', Math.max.apply(null, ws) - Math.min.apply(null, ws) < 0.5 && Math.max.apply(null, hs) - Math.min.apply(null, hs) < 0.5 && cxs.every((c) => Math.abs(c - appCx) < 0.6) && R.fixedCtas.every((x) => x !== 'fixed'), { ws, hs, cxs });
    ok(key + ': 결과 [저장][다시 깎기]는 주요 CTA 바로 아래 한 줄(y ' + f(R.result.save.t, 0) + ' > 도전장 아래 ' + f(R.result.cta.b, 0) + ') · 결과 화면 ' + (R.result.scrollable ? '세로 스크롤(내용 ' + f(R.result.scrollH) + ' > ' + f(R.result.clientH) + ')' : '스크롤 없이 한 화면(' + f(R.result.last) + '/' + R.result.ih + ')') + ' · 끝까지 내리면 @ccojik.dh 까지 보임', R.result.save.t > R.result.cta.b && Math.abs(R.result.save.t - R.result.restart.t) < 0.5 && R.resultBottomOk, R.result);
    ok(key + ': 화면 전환 fade 중 콘텐츠 이동 ≤ 4.5px(INTRO→SELECT ' + f(R.fade.d1, 1) + ' · SELECT→READY ' + f(R.fade.d2, 1) + 'px) · 가로 스크롤 없음 · 페이지 오류 없음', R.fade.d1 <= 4.5 && R.fade.d2 <= 4.5 && R.noHScroll && R.errors.length === 0, R.errors);
  }
  console.log(failures === 0 ? NL + '모든 검사 통과' : NL + '실패 ' + failures + '건'); process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
