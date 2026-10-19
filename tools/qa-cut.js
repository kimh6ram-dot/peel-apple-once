/* 헤드리스 QA(2단계 절삭) — 공중/손잡이 접촉 무반응, 얕은 절삭(껍질만)·중복 집계 없음·시간만으로 손실 없음, 회전 후 유지,
 * 깊은 절삭(과육 손실·실제 메시 파임)·더 밀어야 더 깊어짐, 낮은 fps 에서 섹터 누락 없음, 자동조종 나선형 플레이, HUD 갱신, 재시작 초기화, 디버그 표시.
 * 사용: node tools/qa-cut.js [--shots <dir>]   (1단계 회귀는 tools/qa.js) */
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
const setDirs = (page, dx, dy) => page.evaluate(({ dx, dy }) => window.AP_DEBUG.setDirs(dx, dy), { dx, dy });
const stats = (page) => page.evaluate(() => window.AP_DEBUG.cellStats());
const cellsAt = (page, sec) => page.evaluate((sec) => window.AP_DEBUG.cellsAt(sec), sec);
const newGame = async (page) => { await page.evaluate(() => { window.AP_DEBUG.goIntro(); window.AP_DEBUG.start(); }); return step(page, 0); };
/* ← 를 눌러 원래 껍질 기준 깊이(cut.depth0)가 target 이상이 될 때까지 접근 → 정지 */
async function approach(page, target) {
  await setDirs(page, -1, 0);
  let s = null;
  for (let i = 0; i < 900; i++) { s = await step(page, 1 / 60); if (s.cut && s.cut.depth0 >= target) break; }
  await setDirs(page, 0, 0); s = await step(page, 1 / 60);
  return s;
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => { errors.push(e.message); console.log('  [pageerror]', e.message); });
  page.on('console', (m) => { if (m.type() === 'error') console.log('  [console.error]', m.text()); });
  await page.goto(URL);
  await page.waitForFunction(() => window.AP_READY === true, null, { timeout: 60000 }); await page.evaluate(() => AP_DEBUG.setLegacy(true));   /* 기계 동작 테스트: 호환 모드를 명시(제품 기본은 실제 규칙) */
  await page.evaluate(() => window.AP_DEBUG.setPaused(true));
  const C = await page.evaluate(() => window.AP.CONFIG);
  const SURF = await page.evaluate(() => window.AP_DEBUG.surface());
  let s = await newGame(page);
  const L = await page.evaluate(() => AP_DEBUG.layout());
  const x0 = s.knife.x, y0 = s.knife.y;
  const eq = await page.evaluate(() => { const S = AP_DEBUG.apple.surface; let w = 0; for (let i = 1; i < S.NR; i++) if (S.ringR0[i] > S.ringR0[w]) w = i; return w; });   // 적도 링 → 행 eq-1/eq
  console.log('   표면: 셀', SURF.NR + '×' + SURF.NS, '· 적도 행', eq, '· 껍질 두께(법선)', C.SKIN_THICKNESS, '· 적도 셀 껍질(반경)', fmt((await cellsAt(page, 0))[eq].skin, 2));

  console.log('=== A. 칼이 공중: 아무 변화 없음 ===');
  s = await run(page, 3);
  let st = await stats(page);
  ok('시작 위치에서 3초(1.2회전): 절삭 셀 0 · 제거율 0% · 손실률 0% · 접촉 행 0', st.peeled === 0 && st.flesh === 0 && st.peelPct === 0 && st.fleshPct === 0 && s.cut.rows === 0 && s.cut.inRange > 0, { st, cut: s.cut });
  ok('페이지 오류 없음', errors.length === 0, errors);

  console.log('=== B. 손잡이/연결부만 사과에 겹침: 절삭 없음 ===');
  // 절삭점(피벗)을 위 한계(능선 − 4)에 두고 E +40° 로 기울이면 손잡이·연결부가 사과 윗몸통 위로 겹친다. 피벗 x 는 사과 중심 + 85 → 활성 구간 행(46~47)의 날은 실루엣 밖(+40° 는 피벗 아래 날을 왼쪽으로 8px 옮긴다)
  await page.evaluate(() => { const L = AP_DEBUG.layout(); AP_DEBUG.setKnifeAngleDeg(40); const k = AP.knife; k.setOrigin(k.x + (L.appleCx + 85 - k.px), k.y + (k.bounds.minY - k.py)); });
  s = await step(page, 1 / 60);
  const Rg = await page.evaluate(() => AP_DEBUG.regions());
  const hx = Math.min(...Rg.handleRegionPoly.map((p) => p[0])), hy0 = Math.min(...Rg.handleRegionPoly.map((p) => p[1])), hy1 = Math.max(...Rg.handleRegionPoly.map((p) => p[1]));
  ok('배치 확인: 손잡이 다각형이 사과 몸통과 겹침(손잡이 왼쪽 x ' + fmt(hx, 0) + ' < 사과 오른쪽 ' + fmt(L.appleCx + L.appleR, 0) + ', y ' + fmt(hy0, 0) + '~' + fmt(hy1, 0) + ' vs 몸통 ' + fmt(L.bodyTopY, 0) + '~' + fmt(L.bodyBottomY, 0) + ') · 활성 구간 행의 날은 접촉 없음(depth0 ' + fmt(s.cut.depth0, 1) + ' ≤ 0)', hx < L.appleCx + L.appleR * 0.8 && hy1 > L.bodyTopY + 20 && hy0 < L.bodyBottomY && s.cut.depth0 <= 0, { hx, hy0, hy1, cut: s.cut });
  s = await run(page, 3);
  st = await stats(page);
  ok('3초 회전 동안 절삭 셀 0 · 접촉 행 0 (손잡이·연결부는 판정 밖)', st.peeled === 0 && st.flesh === 0 && s.cut.rows === 0 && s.cut.cutCells === 0, { st, cut: s.cut });
  await page.evaluate(() => AP_DEBUG.setDebug(true)); await step(page, 0); await shot(page, 'cut-01-handle-only'); await page.evaluate(() => AP_DEBUG.setDebug(false));

  console.log('=== C. 얕은 절삭: 껍질만 · 중복 집계 없음 · 시간만으로 손실 없음 ===');
  s = await newGame(page);
  s = await approach(page, 3.2);
  const xShallow = s.knife.x;
  ok('← 로 접근: 원래 껍질 기준 깊이 ' + fmt(s.cut.depth0, 2) + 'px (껍질 두께 ' + C.SKIN_THICKNESS + ' 안) · 접촉 행 ' + s.cut.iMin + '~' + s.cut.iMax, s.cut.depth0 >= 3.2 && s.cut.depth0 < C.SKIN_THICKNESS && s.cut.rows > 0, s.cut);
  s = await run(page, 2.6);
  st = await stats(page);
  const P1 = st.peelPct;
  ok('한 바퀴 후: 껍질 제거 셀 ' + st.peeled + ' · 과육 파임 셀 0 · 제거율 ' + fmt(P1, 1) + '% · 손실률 0%', st.peeled > 100 && st.flesh === 0 && st.fleshPct === 0 && P1 > 3, st);
  let band = true;
  for (const sec of [0, 24, 48, 72, 95]) { const cells = await cellsAt(page, sec); if (!cells.some((c) => c.state === 1)) band = false; }
  ok('띠가 둘레 전체(섹터 0·24·48·72·95 모두에 상태 1 행 있음) — 회전과 결합된 같은 높이 띠', band);
  const c0 = (await cellsAt(page, 0)).filter((c) => c.state === 1);
  const deepest = c0.reduce((a, b) => (b.rec > a.rec ? b : a), c0[0]);
  const mr = await page.evaluate((idx) => AP_DEBUG.cellMeshRadius(idx), deepest.row * SURF.NS);
  ok('가장 깊은 셀 rec ' + fmt(deepest.rec, 2) + ' ≈ 날 깊이(±0.3) · 껍질(' + fmt(deepest.skin, 2) + ') 안 · 메시 정점도 실제로 안쪽(평균 반경 ' + fmt(mr, 2) + ' ≈ r0 ' + fmt(deepest.r0, 2) + ' - rec)', Math.abs(deepest.rec - s.cut.depth0) < 0.3 && deepest.rec < deepest.skin && Math.abs(mr - (deepest.r0 - deepest.rec)) < 1.0, { deepest, mr, depth0: s.cut.depth0 });
  s = await run(page, 5);
  st = await stats(page);
  ok('같은 위치 5초(2회전) 더: 제거율 그대로 ' + fmt(st.peelPct, 1) + '% (중복 없음) · 손실률 여전히 0% (시간만으로 과육 손실 없음) · 이번 프레임 절삭 셀 0', Math.abs(st.peelPct - P1) < 1e-9 && st.fleshPct === 0 && s.cut.cutCells === 0, { P1, st, cut: s.cut });
  await page.evaluate(() => AP_DEBUG.setDebug(true)); await step(page, 0); await shot(page, 'cut-02-shallow-band'); await page.evaluate(() => AP_DEBUG.setDebug(false));
  const dumpBefore = await page.evaluate(() => AP_DEBUG.dumpSurface());

  console.log('=== D. 칼을 떼고 한 바퀴: 깎인 자리 유지 ===');
  await setDirs(page, 1, 0); s = await run(page, 1); await setDirs(page, 0, 0);
  s = await run(page, 2.6);
  const dumpAfter = await page.evaluate(() => AP_DEBUG.dumpSurface());
  st = await stats(page);
  ok('칼을 뗀 뒤 한 바퀴: 셀 상태 그리드 동일 · 제거율 ' + fmt(st.peelPct, 1) + '% 유지 · 접촉 행 0', dumpBefore === dumpAfter && Math.abs(st.peelPct - P1) < 1e-9 && s.cut.rows === 0);

  console.log('=== E. 깊은 절삭: 과육 손실 · 실제 파임 · 더 밀어야 더 깊어짐 ===');
  await page.evaluate((x) => AP_DEBUG.setKnifePos(x, AP_DEBUG.snapshot().knife.y), xShallow);
  s = await approach(page, 11.5);
  ok('← 로 더 밀어 넣음: 원래 껍질 기준 깊이 ' + fmt(s.cut.depth0, 2) + 'px (껍질 두께 ' + C.SKIN_THICKNESS + ' 초과)', s.cut.depth0 >= 11.5, s.cut);
  s = await run(page, 2.6);
  st = await stats(page);
  const F1 = st.fleshPct;
  const cd = (await cellsAt(page, 30)).reduce((a, b) => (b.rec > a.rec ? b : a));
  const mr2 = await page.evaluate((idx) => AP_DEBUG.cellMeshRadius(idx), cd.row * SURF.NS + 30);
  ok('한 바퀴 후: 과육 파임 셀 ' + st.flesh + ' > 0 · 손실률 ' + fmt(F1, 2) + '% > 0 · 가장 깊은 셀 rec ' + fmt(cd.rec, 2) + ' ≈ 날 깊이, 과육 손실 ' + fmt(cd.fleshLoss, 2) + ' = rec - 껍질(' + fmt(cd.skin, 2) + ') · 메시 평균 반경 ' + fmt(mr2, 2) + ' ≈ r0 - rec', st.flesh > 50 && F1 > 0.3 && Math.abs(cd.rec - s.cut.depth0) < 0.3 && Math.abs(cd.fleshLoss - (cd.rec - cd.skin)) < 0.02 && cd.state === 2 && Math.abs(mr2 - (cd.r0 - cd.rec)) < 1.0, { st, cd, mr2, depth0: s.cut.depth0 });
  s = await run(page, 5);
  st = await stats(page);
  ok('같은 깊이로 5초 더: 손실률 그대로 ' + fmt(st.fleshPct, 2) + '% (머문 시간이 아니라 날 위치가 깊이를 정함)', Math.abs(st.fleshPct - F1) < 1e-9, { F1, st });
  await setDirs(page, -1, 0); s = await run(page, 0.4); await setDirs(page, 0, 0); s = await run(page, 2.6);
  st = await stats(page);
  ok('← 를 0.4초 더 누름(더 깊이) → 손실률 증가 ' + fmt(F1, 2) + '% → ' + fmt(st.fleshPct, 2) + '%', st.fleshPct > F1 + 0.3, { F1, now: st.fleshPct });
  await page.evaluate(() => AP_DEBUG.setDebug(true)); await step(page, 0); await shot(page, 'cut-03-deep-groove'); await page.evaluate(() => AP_DEBUG.setDebug(false));
  const hudTxt = await page.evaluate(() => ({ peel: document.getElementById('hud-peel').textContent, flesh: document.getElementById('hud-flesh').textContent }));
  ok('HUD 실시간 반영: 껍질 ' + hudTxt.peel + ' · 과육 ' + hudTxt.flesh, hudTxt.peel === Math.round(st.peelPct) + '%' && hudTxt.flesh === Math.round(st.fleshPct) + '%', { hudTxt, st });

  console.log('=== F. 낮은 프레임(20fps)에서도 섹터 누락 없음 ===');
  s = await newGame(page);
  s = await approach(page, 4);
  s = await run(page, 2.6, 20);
  const rowSets = [];
  for (let sec = 0; sec < SURF.NS; sec++) { const cells = await cellsAt(page, sec); rowSets.push(cells.filter((c) => c.state >= 1).map((c) => c.row).join(',')); }
  const allSame = rowSets.every((r) => r === rowSets[0] && r.length > 0);
  ok('20fps(한 프레임에 1.9섹터 회전)로 한 바퀴: 96개 섹터 모두 같은 행 집합이 깎임(건너뛴 섹터 없음)', allSame, { sample: rowSets.slice(0, 5) });

  console.log('=== G. 재시작: 절삭 상태 완전 초기화 ===');
  s = await newGame(page);
  s = await approach(page, 5); s = await run(page, 2.6);
  const gRow = s.cut.iDeep, gIdx = gRow * SURF.NS + 10;
  const cutAgain = await page.evaluate((idx) => AP_DEBUG.cellMeshRadius(idx), gIdx);
  const before = await page.evaluate(({ row, sec }) => AP_DEBUG.cellState(row, sec), { row: gRow, sec: 10 });
  s = await newGame(page);
  const fresh = await page.evaluate((idx) => AP_DEBUG.cellMeshRadius(idx), gIdx);
  st = await stats(page);
  const after = await page.evaluate(({ row, sec }) => AP_DEBUG.cellState(row, sec), { row: gRow, sec: 10 });
  const dumpReset = await page.evaluate(() => AP_DEBUG.dumpSurface());
  ok('다시 깎기: 셀 전부 상태 0 · 제거율/손실률 0 · 깎였던 셀(행 ' + gRow + ', rec ' + fmt(before.rec, 2) + ', 메시 반경 ' + fmt(cutAgain, 2) + ')의 메시 반경이 시작 상태(' + fmt(fresh, 2) + ')로 복귀', st.peeled === 0 && st.flesh === 0 && st.peelPct === 0 && st.fleshPct === 0 && before.rec > 1 && after.rec === 0 && cutAgain < fresh - 1 && Math.abs(after.meshR - fresh) < 1e-4 && !/[oX]/.test(dumpReset), { before: before.rec, after: after.rec, meshR: after.meshR, fresh, cutAgain });

  console.log('=== H. 자동조종(사람 흉내): 위→아래 나선형으로 껍질만 ===');
  s = await newGame(page);
  const auto = await page.evaluate(() => AP_DEBUG.runAutopilot(58, { dur: 52, depthFrac: 0.6 }));
  ok('58초 자동조종(절삭점을 능선→바닥으로 내리며 경사에 맞춰 기울임): 껍질 제거율 ' + fmt(auto.stats.peelPct, 1) + '% ≥ 55 · 과육 손실률 ' + fmt(auto.stats.fleshPct, 2) + '% < 1 · 파임 셀 ' + auto.stats.flesh, auto.stats.peelPct >= 55 && auto.stats.fleshPct < 1, auto.stats);
  console.log('   자동조종 결과 셀: 껍질 ' + auto.stats.unpeeled + ' · 제거 ' + auto.stats.peeled + ' · 파임 ' + auto.stats.flesh + ' · 최대 rec ' + fmt(auto.stats.maxRec, 2));
  const dumpAuto = await page.evaluate(() => AP_DEBUG.dumpSurface());
  if (SHOTS) fs.writeFileSync(path.join(SHOTS, 'cut-04-autopilot-surface.txt'), dumpAuto);
  await step(page, 0); await shot(page, 'cut-04-autopilot-spiral');
  await page.evaluate(() => AP_DEBUG.finish('button')); await step(page, 0); await shot(page, 'cut-05-autopilot-result');

  console.log('=== I. 나쁜 플레이: 한 높이에서 깊이 누르고 조금씩 내려가며 파기 ===');
  s = await newGame(page);
  s = await approach(page, 14);
  s = await run(page, 2.6);
  await setDirs(page, 0, 1); s = await run(page, 0.25); await setDirs(page, 0, 0); s = await run(page, 2.6);
  await setDirs(page, -1, 1); s = await run(page, 0.3); await setDirs(page, 0, 0); s = await run(page, 3);
  st = await stats(page);
  ok('깊게 누른 플레이: 파임 셀 ' + st.flesh + ' · 손실률 ' + fmt(st.fleshPct, 2) + '% · 최대 rec ' + fmt(st.maxRec, 1), st.flesh > 200 && st.fleshPct > 0.5);
  await step(page, 0); await shot(page, 'cut-06-bad-play');
  await page.evaluate(() => AP_DEBUG.finish('button')); await step(page, 0); await shot(page, 'cut-07-bad-result');

  console.log('=== J. 디버그 표시 ===');
  s = await newGame(page); s = await approach(page, 4);
  await page.evaluate(() => AP_DEBUG.setDebug(true)); s = await step(page, 1 / 60);
  const readout = await page.evaluate(() => document.getElementById('debug-readout').textContent);
  ok('#debug: 읽기 표시에 섹터/행/깊이/집계가 있음', /sector \d+/.test(readout) && /rows (d+~d+|-)/.test(readout) && /peel [\d.]+%/.test(readout), readout);
  await shot(page, 'cut-08-debug-contact');
  await page.evaluate(() => { AP_DEBUG.logCuts(true); AP_DEBUG.step(1 / 60); AP_DEBUG.logCuts(false); AP_DEBUG.setDebug(false); });
  ok('페이지 오류 없음(전체)', errors.length === 0, errors);

  await browser.close();
  console.log(failures === 0 ? '\n모든 검사 통과' : '\n실패 ' + failures + '건');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
