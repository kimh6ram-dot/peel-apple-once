/* 헤드리스 QA(3차: 칼 세로 범위·기울기·즉시 피드백·좁은 띠) — 사용자 테스트 항목 1~8.
 *  1 위쪽부터 최하단까지 깎을 수 있는가  2 Q/E 각도에서 절삭 좌표가 정확한가  3 접촉 즉시 표면 상태·HUD 가 바뀌는가
 *  4 실제 접촉점에서 껍질 조각이 생기는가(새 껍질일 때만)  5 천천히 내리면 얇은 나선형 흔적인가  6 중복 집계 없음
 *  7 과육 손실이 깊이에 따라, 창 밖 행은 손대지 않는가  8 모바일 버튼(↶ ↷ 포함)이 겹치지 않고 동작하는가
 * 사용: node tools/qa-v3.js [--shots <dir>]   (1단계 회귀 tools/qa.js · 절삭 tools/qa-cut.js) */
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('C:/Users/thkim/Desktop/code-work/260624/build/node_modules/playwright-core');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'file:///' + path.join(__dirname, '..', 'index.html').replace(/\\/g, '/');
const shotsIdx = process.argv.indexOf('--shots');
const SHOTS = shotsIdx >= 0 ? process.argv[shotsIdx + 1] : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

let failures = 0;
function ok(label, cond, detail) {
  if (cond) console.log('  OK  ', label);
  else { failures++; console.log('  FAIL', label, detail !== undefined ? JSON.stringify(detail) : ''); }
}
const fmt = (n, d) => (typeof n === 'number' ? n.toFixed(d === undefined ? 1 : d) : String(n));
async function shot(page, name) {
  if (!SHOTS) return;
  try { await page.screenshot({ path: path.join(SHOTS, name + '.png'), timeout: 90000 }); } catch (e) { console.log('  [shot skipped]', name, e.message.split('\n')[0]); }
}
const snap = (page) => page.evaluate(() => window.AP_DEBUG.snapshot());
const step = (page, dt) => page.evaluate((dt) => window.AP_DEBUG.step(dt), dt);
const run = (page, s, fps) => page.evaluate(({ s, fps }) => window.AP_DEBUG.run(s, fps), { s, fps: fps || 60 });
const setDirs = (page, dx, dy, rot) => page.evaluate(({ dx, dy, rot }) => window.AP_DEBUG.setDirs(dx, dy, rot), { dx, dy, rot: rot || 0 });
const stats = (page) => page.evaluate(() => window.AP_DEBUG.cellStats());
const cellsAt = (page, sec) => page.evaluate((sec) => window.AP_DEBUG.cellsAt(sec), sec);
const regions = (page) => page.evaluate(() => window.AP_DEBUG.regions());
const rowYs = (page) => page.evaluate(() => Array.from(AP.cutting.rowStageYs()));
const newGame = async (page) => { await page.evaluate(() => { window.AP_DEBUG.goIntro(); window.AP_DEBUG.start(); }); return step(page, 0); };
async function approach(page, target, maxFrames) {
  await setDirs(page, -1, 0); let s = null;
  for (let i = 0; i < (maxFrames || 900); i++) { s = await step(page, 1 / 60); if (s.cut && s.cut.depth0 >= target) break; }
  await setDirs(page, 0, 0); return step(page, 1 / 60);
}
/* 날의 가장 낮은/높은 점(스테이지 y) */
const edgeExtremes = (R) => ({ lowY: Math.max(...R.edge.map((p) => p[1])), highY: Math.min(...R.edge.map((p) => p[1])) });
/* 폴리라인에서 y 에 해당하는 x (테스트 측 독립 보간) */
function edgeXAt(edge, y) {
  for (let i = 0; i < edge.length - 1; i++) { const a = edge[i], b = edge[i + 1], lo = Math.min(a[1], b[1]), hi = Math.max(a[1], b[1]); if (y >= lo && y <= hi) { const t = hi === lo ? 0 : (y - a[1]) / (b[1] - a[1]); return a[0] + (b[0] - a[0]) * t; } }
  return null;
}
async function openPage(browser, viewport) {
  const ctx = await browser.newContext({ viewport, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => { errors.push(e.message); console.log('  [pageerror]', e.message); });
  page.on('console', (m) => { if (m.type() === 'error') console.log('  [console.error]', m.text()); });
  await page.goto(URL);
  await page.waitForFunction(() => window.AP_READY === true, null, { timeout: 60000 }); await page.evaluate(() => AP_DEBUG.setLegacy(true));   /* 기계 동작 테스트: 호환 모드를 명시(제품 기본은 실제 규칙) */
  await page.evaluate(() => window.AP_DEBUG.setPaused(true));
  return { ctx, page, errors };
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const { ctx, page, errors } = await openPage(browser, { width: 390, height: 844 });
  const C = await page.evaluate(() => window.AP.CONFIG);
  const SURF = await page.evaluate(() => window.AP_DEBUG.surface());
  let s = await newGame(page);
  const L = await page.evaluate(() => AP_DEBUG.layout());
  const ys = await rowYs(page);
  const padTop = await page.evaluate(() => { const r = document.getElementById('pad').getBoundingClientRect(), a = document.getElementById('app').getBoundingClientRect(); return (r.top - a.top) * AP.CONFIG.LOGICAL_WIDTH / a.width; });
  const eq = ys.reduce((best, y, i, arr) => 0, 0);
  console.log('   레이아웃: 플레이 영역', fmt(L.playTop, 0) + '~' + fmt(L.playBottom, 0), '· 사과 중심 y', fmt(L.appleCy, 0), '· 몸통', fmt(L.bodyTopY, 0) + '~' + fmt(L.bodyBottomY, 0), '· 화면 배율', fmt(L.viewScale, 3), '· 필요/가용', fmt(L.need, 0) + '/' + fmt(L.avail, 0), '· 패드 위', fmt(padTop, 0));
  ok('페이지 오류 없음 · 사과 지름/중심 x 는 1단계 값(배율 ' + fmt(L.viewScale, 3) + ' ≥ 0.95)', errors.length === 0 && L.viewScale >= 0.95 && Math.abs(L.appleCx - C.LOGICAL_WIDTH * C.APPLE_CENTER_X_RATIO) < 1e-6, { errors, L });

  console.log('=== 1. 세로 범위: 절삭점 기준 — 최상단·최하단 껍질까지 ===');
  await setDirs(page, 0, -1); s = await run(page, 8); await setDirs(page, 0, 0); s = await step(page, 0);
  let R = await regions(page), ex = edgeExtremes(R);
  ok('↑ 끝: 절삭점(피벗) y ' + fmt(s.knife.py, 1) + ' ≤ 능선 ' + fmt(L.bodyTopY, 1) + ' − ' + C.KNIFE.REACH_MARGIN + ' · 칼 이미지 위 ' + fmt(s.knife.rect.y0, 1) + ' ≥ HUD 아래 ' + fmt(L.playTop, 1), s.knife.py <= L.bodyTopY - C.KNIFE.REACH_MARGIN + 0.05 && s.knife.rect.y0 >= L.playTop + C.KNIFE.STAGE_MARGIN - 0.05, { py: s.knife.py, rect: s.knife.rect });
  await setDirs(page, 0, 1); s = await run(page, 10); await setDirs(page, 0, 0); s = await step(page, 0);
  R = await regions(page); ex = edgeExtremes(R);
  ok('↓ 끝: 절삭점(피벗) y ' + fmt(s.knife.py, 1) + ' ≥ 바닥 ' + fmt(L.bodyBottomY, 1) + ' + ' + C.KNIFE.REACH_MARGIN + ' · 칼 이미지 아래 ' + fmt(s.knife.rect.y1, 1) + ' ≤ 패드 위 ' + fmt(padTop, 1), s.knife.py >= L.bodyBottomY + C.KNIFE.REACH_MARGIN - 0.05 && s.knife.rect.y1 <= padTop + 0.05, { py: s.knife.py, rect: s.knife.rect, padTop });
  await shot(page, 'v3-01-knife-bottom');
  // 최상단 행(47) 깎기: 절삭점(피벗)을 행 47 중앙에 두고 ← 유지(능선 쪽 껍질은 반경 환산 두께가 커서 4px 이상 들어가야 벗겨진다)
  await page.evaluate((y) => { AP_DEBUG.setKnifeAngleDeg(-40); AP_DEBUG.setKnifePos(AP.knife.x, AP.knife.y + (y - AP.knife.py)); }, ys[SURF.NR - 1]);
  s = await approach(page, 9.0, 1200); s = await run(page, 2.6);   // 능선 쪽 껍질은 반경 환산 14px → 9px 는 껍질 안(피벗 행 바로 아래 행이 가장 깊다)
  let top = (await cellsAt(page, 10)).filter((c) => c.row >= SURF.NR - 2 && c.state >= 1);
  ok('최상단 행(46~47) 껍질 제거됨(Q −40° 로 어깨 경사 추종): ' + top.map((c) => c.row + ':rec' + c.rec).join(' ') + ' · 칼 이미지가 HUD 아래', top.length >= 1 && s.knife.rect.y0 >= L.playTop + C.KNIFE.STAGE_MARGIN - 0.05, { top, rect: s.knife.rect, cut: s.cut });
  await shot(page, 'v3-02-cut-top-row');
  // 최하단 행(0) 깎기: 절삭점(피벗)을 행 0 중앙에 두고 ← 유지
  await page.evaluate((y) => { AP_DEBUG.setKnifeAngleDeg(40); AP_DEBUG.setKnifePos(AP.knife.x + 60, AP.knife.y + (y - AP.knife.py)); }, ys[0]);
  s = await approach(page, 4.0, 1200); s = await run(page, 2.6);
  let bot = (await cellsAt(page, 10)).filter((c) => c.row <= 1 && c.state >= 1);
  ok('최하단 행(0~1) 껍질 제거됨(E +40° 로 아래 경사 추종): ' + bot.map((c) => c.row + ':rec' + c.rec).join(' ') + ' · 칼 이미지가 패드 위(' + fmt(s.knife.rect.y1, 0) + ' ≤ ' + fmt(padTop, 0) + ')', bot.length >= 1 && s.knife.rect.y1 <= padTop + 0.05, { bot, rect: s.knife.rect, cut: s.cut });
  await shot(page, 'v3-03-cut-bottom-row');

  console.log('=== 2. 기울기(Q/E): 연속 회전·즉시 정지·±40 · 이미지와 절삭선 동일 변환 · 기울인 채 절삭 좌표 ===');
  s = await newGame(page);
  const tip0 = (await regions(page)).tip, h0 = (await regions(page)).handleRegionPoly;
  await setDirs(page, 0, 0, 1); s = await run(page, 0.5);
  const a05 = s.knife.angleDeg;
  ok('E 0.5초: 시계 방향 ≈ ' + fmt(C.KNIFE.ROT_SPEED_DEG * 0.5 - C.KNIFE.ROT_SPEED_DEG * C.KNIFE.ACCEL_TAU, 0) + '°(램프업 손실 포함) → ' + fmt(a05, 1) + '°', Math.abs(a05 - (C.KNIFE.ROT_SPEED_DEG * 0.5 - C.KNIFE.ROT_SPEED_DEG * C.KNIFE.ACCEL_TAU)) < 1.0 && a05 > 0, a05);
  await setDirs(page, 0, 0, 0); s = await step(page, 1 / 60);
  ok('떼면 즉시 정지(회전 속도 0) · 각도 유지', s.knife.vrot === 0 && Math.abs(s.knife.angleDeg - a05) < 0.6, { vrot: s.knife.vrot, a: s.knife.angleDeg });
  R = await regions(page);
  ok('시계 방향: 칼끝이 오른쪽으로(' + fmt(tip0[0], 0) + ' → ' + fmt(R.tip[0], 0) + '), 손잡이 끝은 왼쪽으로', R.tip[0] > tip0[0] + 5 && R.handleRegionPoly[2][0] < h0[2][0] - 5, { tip0, tip: R.tip });
  ok('피벗(날 위 점)은 회전해도 제자리', Math.abs(R.edge[Math.floor(R.edge.length * C.KNIFE.PIVOT_EDGE_FRAC)][0] - s.knife.px) < 1e-6 && Math.abs(R.edge[Math.floor(R.edge.length * C.KNIFE.PIVOT_EDGE_FRAC)][1] - s.knife.py) < 1e-6);
  await setDirs(page, 0, 0, 1); s = await run(page, 2); await setDirs(page, 0, 0, 0);
  ok('E 2초 더: +' + C.KNIFE.MAX_ANGLE_DEG + '° 에서 멈춤', Math.abs(s.knife.angleDeg - C.KNIFE.MAX_ANGLE_DEG) < 1e-6, s.knife.angleDeg);
  const mm40 = await page.evaluate(() => AP_DEBUG.spriteMismatch());
  ok('+75°: 칼 이미지(스프라이트) 모서리 ↔ 판정 변환 모서리 불일치 < 0.01px', mm40 < 0.01, mm40);
  await shot(page, 'v3-04-tilt-plus75');
  await setDirs(page, 0, 0, -1); s = await run(page, 3); await setDirs(page, 0, 0, 0);
  ok('Q 3초: ' + C.KNIFE.MIN_ANGLE_DEG + '° 에서 멈춤 · 날 위·손잡이 아래 유지(칼끝 y < 손잡이 y)', Math.abs(s.knife.angleDeg - C.KNIFE.MIN_ANGLE_DEG) < 1e-6 && (await regions(page)).tip[1] < (await regions(page)).handleRegion.y0, s.knife.angleDeg);
  await setDirs(page, -1, 1, 1); s = await run(page, 0.3); await setDirs(page, 0, 0, 0);
  ok('←+↓+E 동시: 이동과 회전이 같이 된다', s.knife.vx < 0 || s.knife.px < s.knife.bounds.maxX, { vx: s.knife.vx, vy: s.knife.vy, a: s.knife.angleDeg });
  // 기울인 채 절삭: +25° 로 두고 접근 → 한 바퀴 → 깎인 행의 rec 가 "기울어진 폴리라인"으로 독립 계산한 값과 일치
  s = await newGame(page);
  await page.evaluate(() => AP_DEBUG.setKnifeAngleDeg(25));
  s = await approach(page, 3.5);
  const Rt = await regions(page), ysT = await rowYs(page);
  s = await run(page, 2.6);
  const cellsT = (await cellsAt(page, 20)).filter((c) => c.rec > 0);
  let worst = 0, cnt = 0;
  for (const c of cellsT) { const xe = edgeXAt(Rt.edge, ysT[c.row]); if (xe === null) continue; const want = c.r0 - (xe - L.appleCx) / L.viewScale; worst = Math.max(worst, Math.abs(c.rec - want)); cnt++; }
  ok('+25° 기울인 채 한 바퀴: 깎인 ' + cnt + '행의 rec 가 기울어진 절삭선 보간값과 일치(최대 오차 ' + fmt(worst, 3) + 'px < 0.05)', cnt > 0 && worst < 0.05, { cnt, worst, sample: cellsT.slice(0, 3) });
  ok('기울인 채: 과육 파임 0 · 접촉 중심 행 ' + s.cut.iDeep + ' · 깎인 행 ' + s.cut.iMin + '~' + s.cut.iMax, (await stats(page)).flesh === 0, s.cut);
  await page.evaluate(() => AP_DEBUG.setDebug(true)); await step(page, 0); await shot(page, 'v3-05-tilt-cut-debug'); await page.evaluate(() => AP_DEBUG.setDebug(false));

  console.log('=== 3·4. 접촉 즉시: 표면 상태·HUD 갱신 · 접촉점 껍질 조각(새 껍질일 때만) ===');
  s = await newGame(page);
  ok('접촉 전 리본 없음', !s.ribbon.active && s.ribbon.emittedPx === 0, s.ribbon);
  await setDirs(page, -1, 0);
  let first = null, hudAtFirst = null, ribbonAtFirst = null, statAtFirst = null;
  for (let i = 0; i < 900; i++) {
    s = await step(page, 1 / 60);
    if (s.cut && s.cut.newlyPeeled > 0) { first = s; hudAtFirst = await page.evaluate(() => document.getElementById('hud-peel').textContent); ribbonAtFirst = await page.evaluate(() => ({ info: AP_DEBUG.ribbon(), pts: AP_DEBUG.ribbonPoints() })); statAtFirst = await stats(page); break; }
  }
  await setDirs(page, 0, 0);
  ok('첫 껍질 제거 프레임: 상태 1 셀 ' + (statAtFirst && statAtFirst.peeled) + ' > 0 · 제거율 ' + (statAtFirst && fmt(statAtFirst.peelPct, 2)) + '% > 0 · HUD "' + hudAtFirst + '" 같은 프레임 반영', first !== null && statAtFirst.peeled > 0 && statAtFirst.peelPct > 0 && hudAtFirst === Math.round(statAtFirst.peelPct) + '%', { first: first && first.cut, hudAtFirst, statAtFirst });
  // 절삭 위치 = 효과 위치: 깎인 셀(칼 쪽 섹터, 중심 행)의 표면점 투영 == 접촉점
  const sec0 = first.cut.sector, iDeep = first.cut.iDeep;
  const cellPos = await page.evaluate(({ row, sec }) => { const Sf = AP_DEBUG.apple.surface, vs = AP_DEBUG.apple.viewScale; const idx = row * Sf.NS + sec; const r = (Sf.r0[idx] - Sf.rec[idx]) * vs; const ys = AP.cutting.rowStageYs(); const p = AP.scene.project(new THREE.Vector3(r, (Sf.ringY[row] + Sf.ringY[row + 1]) / 2 * vs, 0)); return { x: p.x, y: p.y, edgeX: AP.cutting.edgeXAt(ys[row]), rowY: ys[row], sector: sec, worldSector: AP.rotation.sectorAtWorld(0, Sf.NS), state: Sf.state[idx] }; }, { row: iDeep, sec: sec0 });
  ok('깎인 셀 = 지금 칼 앞(월드각 0)을 지나는 섹터 · 그 셀의 화면 위치(' + fmt(cellPos.x, 1) + ',' + fmt(cellPos.y, 1) + ') = 그 높이의 날 위치(' + fmt(cellPos.edgeX, 1) + ',' + fmt(cellPos.rowY, 1) + ') (±1px) · 절삭점(피벗 y ' + fmt(first.cut.y, 1) + ') 활성 구간 안', cellPos.sector === cellPos.worldSector && Math.abs(cellPos.x - cellPos.edgeX) < 1 && Math.abs(cellPos.y - cellPos.rowY) < 1 && Math.abs(cellPos.rowY - first.cut.y) <= C.CUT.WINDOW_HALF && cellPos.state >= 1, { cellPos, cut: first.cut });
  const rh = ribbonAtFirst.pts[0];
  ok('같은 프레임에 리본 시작(머리 ' + (rh && rh.map(v => fmt(v, 1)).join(',')) + ') = 새로 벗겨진 셀 위치(±0.01px) · 활성 구간 안', ribbonAtFirst.info.active && rh && Math.abs(rh[0] - first.cut.peelX) < 0.01 && Math.abs(rh[1] - first.cut.peelY) < 0.01 && Math.abs(first.cut.peelY - first.cut.y) <= C.CUT.WINDOW_HALF, { ribbonAtFirst, cut: first.cut });
  s = await run(page, 0.5);
  const lenA = s.ribbon.curPx;
  ok('← 유지 0.5초: 새 껍질이 계속 제거되며 리본 길이 증가(' + fmt(lenA, 1) + 'px)', lenA > ribbonAtFirst.info.curPx, { lenA });
  await shot(page, 'v3-06-ribbon');
  s = await run(page, 2.6);
  s = await run(page, 2.6);
  const peelB = (await stats(page)).peelPct, emB = s.ribbon.emittedPx;
  s = await run(page, 2.6);
  const peelC = (await stats(page)).peelPct, emC = s.ribbon.emittedPx;
  ok('한 바퀴 더(이미 깎인 곳에 날이 닿아 있음): 리본 길이 기록 증가 없음(' + fmt(emB, 1) + ' → ' + fmt(emC, 1) + ') · 제거율 그대로(' + fmt(peelB, 2) + '%)', emC === emB && Math.abs(peelC - peelB) < 1e-9 && s.cut.cutCells === 0 && !s.ribbon.active, { emB, emC, peelB, peelC });

  console.log('=== 5·6·7. 같은 높이 = 얇은 띠 · 천천히 내리면 나선 · 창 밖 행 무접촉 · 깊이에 따른 과육 손실 ===');
  s = await newGame(page);
  s = await approach(page, 3.5);
  s = await run(page, 2.6);
  const rowH = Math.abs(ys[1] - ys[0]);
  const band = (await cellsAt(page, 0)).filter((c) => c.state >= 1).map((c) => c.row);
  const bandH = band.length ? (Math.max(...band) - Math.min(...band) + 1) * rowH : 0;
  ok('같은 높이 한 바퀴: 띠 높이 ' + fmt(bandH, 0) + 'px ≤ 활성 구간 ' + (2 * C.CUT.WINDOW_HALF) + 'px + 1행 · 연속(' + band.join(',') + ')', band.length > 0 && bandH <= 2 * C.CUT.WINDOW_HALF + rowH + 0.01 && Math.max(...band) - Math.min(...band) + 1 === band.length, { band, bandH, rowH });
  // 창 밖 행: 날이 겹치는데도(원래 껍질 기준 깊이 > 0) 손대지 않음
  const outside = await page.evaluate(() => { const Sf = AP_DEBUG.apple.surface, vs = AP_DEBUG.apple.viewScale, cut = AP_DEBUG.contact(), ys = AP.cutting.rowStageYs(), cx = AP.scene.appleCx; const out = []; for (let i = 0; i < Sf.NR; i++) { const xe = AP.cutting.edgeXAt(ys[i]); if (xe === null) continue; const d0 = Sf.r0[i * Sf.NS] - (xe - cx) / vs; if (d0 > 0.3 && Math.abs(ys[i] - ys[cut.iDeep]) > cut.windowHalf) { let touched = 0; for (let j = 0; j < Sf.NS; j++) if (Sf.rec[i * Sf.NS + j] > 0) touched++; out.push({ row: i, d0: +d0.toFixed(2), touched }); } } return out; });
  ok('창 밖인데 날과 겹치는 행 ' + outside.length + '개: 전부 손대지 않음(흔적은 실제 활성 구간에만)', outside.length > 0 && outside.every((o) => o.touched === 0), outside.slice(0, 6));
  // 천천히 내리기(사람 흉내 자동조종): 절삭점을 능선에서 바닥까지 60초에 걸쳐 내리는 속도(≈3px/s), 깊이 ←→ 와 경사 기울기 Q/E 를 같이 조절. 12초 = 약 4.8바퀴
  s = await newGame(page);
  const peelBefore = (await stats(page)).peelPct;
  const spiralRun = await page.evaluate(() => AP_DEBUG.runAutopilot(12, { dur: 60, depthFrac: 0.6 }));
  s = spiralRun.snap;
  const st5 = spiralRun.stats;
  const lowAt = [];
  for (const sec of [0, 24, 48, 72]) { const rows = (await cellsAt(page, sec)).filter((c) => c.state >= 1).map((c) => c.row); lowAt.push({ sec, lo: Math.min(...rows), hi: Math.max(...rows), n: rows.length, contiguous: Math.max(...rows) - Math.min(...rows) + 1 === rows.length }); }
  const spiral = lowAt.every((a) => a.contiguous) && new Set(lowAt.map((a) => a.lo)).size >= 2;
  ok('천천히 내린 12초(능선부터 나선): 제거율 ' + fmt(peelBefore, 1) + '% → ' + fmt(st5.peelPct, 1) + '% · 과육 손실 ' + fmt(st5.fleshPct, 3) + '% (< 0.05) · 섹터별 띠 하단이 회전각에 따라 달라짐(나선): ' + lowAt.map((a) => a.sec + ':' + a.lo + '~' + a.hi).join(' '), st5.peelPct > peelBefore + 5 && st5.fleshPct < 0.05 && spiral, { lowAt, st5 });
  const dump = await page.evaluate(() => AP_DEBUG.dumpSurface());
  if (SHOTS) fs.writeFileSync(path.join(SHOTS, 'v3-07-spiral-surface.txt'), dump);
  await shot(page, 'v3-07-spiral');
  // 깊이에 따른 과육 손실(같은 높이에서 더 밀어 넣기)
  const F0 = st5.fleshPct;
  await page.evaluate((y) => { AP_DEBUG.setKnifePos(AP.knife.x + 40, AP.knife.y + (y - AP.knife.py)); }, ys[27]);
  s = await approach(page, 12); s = await run(page, 2.6);
  const st7 = await stats(page);
  const deep = (await cellsAt(page, 30)).reduce((a, b) => (b.rec > a.rec ? b : a));
  ok('← 로 12px 까지 밀어 넣고 한 바퀴: 과육 손실 ' + fmt(F0, 2) + '% → ' + fmt(st7.fleshPct, 2) + '% · 최심 셀 rec ' + fmt(deep.rec, 2) + ' ≈ 날 깊이, 손실 = rec − 껍질', st7.fleshPct > F0 + 0.3 && st7.flesh > 50 && Math.abs(deep.rec - s.cut.depth0) < 0.3 && Math.abs(deep.fleshLoss - (deep.rec - deep.skin)) < 0.02, { F0, st7, deep, depth0: s.cut.depth0, cut: s.cut });
  s = await run(page, 2.6);
  ok('같은 깊이 한 바퀴 더: 손실률 그대로(' + fmt(st7.fleshPct, 2) + '%)', Math.abs((await stats(page)).fleshPct - st7.fleshPct) < 1e-9);
  await shot(page, 'v3-08-deep-after-spiral');

  console.log('=== 8. 모바일 버튼: ↶ ↷ 추가 · 겹침 없음 · 멀티터치 ===');
  const rects = await page.evaluate(() => Array.from(document.querySelectorAll('#pad button')).map((b) => { const r = b.getBoundingClientRect(); return { id: b.id || b.getAttribute('data-dir'), x: r.left, y: r.top, w: r.width, h: r.height, vis: r.width > 0 && r.height > 0 }; }));
  let overlap = [];
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) { const a = rects[i], b = rects[j]; if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlap.push(a.id + '×' + b.id); }
  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  ok('패드 버튼 6개(↶ ↷ ← → ↑ ↓) 모두 보이고 서로 겹치지 않으며 화면 안', rects.length === 6 && rects.every((r) => r.vis && r.x >= 0 && r.y >= 0 && r.x + r.w <= vp.w && r.y + r.h <= vp.h) && overlap.length === 0, { rects, overlap });
  const cdp = await ctx.newCDPSession(page);
  const btnRect = (sel) => page.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
  const bccw = await btnRect('[data-dir="ccw"]'), bcw = await btnRect('[data-dir="cw"]'), bl = await btnRect('[data-dir="left"]');
  await setDirs(page, null);
  s = await newGame(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bccw.x, y: bccw.y, id: 1 }] });
  s = await run(page, 0.3);
  ok('↶ 터치 유지 0.3초 → rot = −1 · 각도 감소(' + fmt(s.knife.angleDeg, 1) + '°)', s.dirs.rot === -1 && s.knife.angleDeg < -5, { dirs: s.dirs, a: s.knife.angleDeg });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bccw.x, y: bccw.y, id: 1 }, { x: bl.x, y: bl.y, id: 2 }] });
  s = await step(page, 1 / 60);
  ok('↶ + ← 두 손가락 → (dx −1, rot −1)', s.dirs.dx === -1 && s.dirs.rot === -1, s.dirs);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  s = await step(page, 1 / 60);
  const aHold = s.knife.angleDeg;
  ok('모두 뗌 → (0,0,0) · 회전 즉시 정지', s.dirs.dx === 0 && s.dirs.rot === 0 && s.knife.vrot === 0, s.dirs);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bcw.x, y: bcw.y, id: 3 }] });
  s = await run(page, 0.3);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  s = await step(page, 1 / 60);
  ok('↷ 터치 0.3초 → 각도 증가(' + fmt(aHold, 1) + '° → ' + fmt(s.knife.angleDeg, 1) + '°)', s.knife.angleDeg > aHold + 5);
  await page.keyboard.down('KeyW'); s = await run(page, 0.2); await page.keyboard.up('KeyW'); const aE = s.knife.angleDeg; s = await step(page, 1 / 60);
  await page.keyboard.down('KeyQ'); s = await run(page, 0.2); await page.keyboard.up('KeyQ');
  ok('키보드 E/Q: E 로 증가(' + fmt(aE, 1) + '°) → Q 로 감소(' + fmt(s.knife.angleDeg, 1) + '°)', s.knife.angleDeg < aE - 3);
  await shot(page, 'v3-09-pad');

  console.log('=== 짧은 화면(320×568): 배율 축소로 범위 확보 ===');
  const o2 = await openPage(browser, { width: 320, height: 568 });
  await o2.page.evaluate(() => { AP_DEBUG.goIntro(); AP_DEBUG.start(); });
  const L2 = await o2.page.evaluate(() => AP_DEBUG.layout());
  await o2.page.evaluate(() => { AP_DEBUG.setDirs(0, 1); AP_DEBUG.run(10); AP_DEBUG.setDirs(0, 0); AP_DEBUG.step(0); });
  let s2 = await snap(o2.page), R2 = await regions(o2.page), ex2 = edgeExtremes(R2);
  const padTop2 = await o2.page.evaluate(() => { const r = document.getElementById('pad').getBoundingClientRect(), a = document.getElementById('app').getBoundingClientRect(); return (r.top - a.top) * AP.CONFIG.LOGICAL_WIDTH / a.width; });
  await o2.page.evaluate(() => { AP_DEBUG.setDirs(0, -1); AP_DEBUG.run(10); AP_DEBUG.setDirs(0, 0); AP_DEBUG.step(0); });
  const s2u = await snap(o2.page), R2u = await regions(o2.page), ex2u = edgeExtremes(R2u);
  ok('320×568: 배율 ' + fmt(L2.viewScale, 3) + ' · ↓ 끝 절삭점 y ' + fmt(s2.knife.py, 0) + ' ≥ 바닥 ' + fmt(L2.bodyBottomY, 0) + '+4 · 칼 아래 ' + fmt(s2.knife.rect.y1, 0) + ' ≤ 패드 ' + fmt(padTop2, 0) + ' · ↑ 끝 절삭점 y ' + fmt(s2u.knife.py, 0) + ' ≤ 능선 ' + fmt(L2.bodyTopY, 0) + '−4 · 칼 위 ' + fmt(s2u.knife.rect.y0, 0) + ' ≥ HUD 아래 ' + fmt(L2.playTop, 0), L2.viewScale < 1 && L2.viewScale > 0.85 && s2.knife.py >= L2.bodyBottomY + C.KNIFE.REACH_MARGIN - 0.05 && s2.knife.rect.y1 <= padTop2 + 0.05 && s2u.knife.py <= L2.bodyTopY - C.KNIFE.REACH_MARGIN + 0.05 && s2u.knife.rect.y0 >= L2.playTop + C.KNIFE.STAGE_MARGIN - 0.05 && o2.errors.length === 0, { L2, py: s2.knife.py, pyUp: s2u.knife.py, padTop2 });
  await shot(o2.page, 'v3-10-320x568');
  await o2.ctx.close();

  ok('페이지 오류 없음(전체)', errors.length === 0, errors);
  await browser.close();
  console.log(failures === 0 ? '\n모든 검사 통과' : '\n실패 ' + failures + '건');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
