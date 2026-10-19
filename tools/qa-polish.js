/* 헤드리스 QA(완성도 개선) — 껍질 시작점 · 날 엣지 따라 들림 · 휨/말림 · 폭 · 칼에 안 붙음 · 절삭 경계 매끈함 · 기존 판정 불변.
 * 사용: node tools/qa-polish.js [--shots <dir>] */
'use strict';
const path = require('path');
const fs = require('fs');
const png = require('./png.js');
const { chromium } = require('C:/Users/thkim/Desktop/code-work/260624/build/node_modules/playwright-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'file:///' + path.join(__dirname, '..', 'index.html').replace(/\\/g, '/');
const si = process.argv.indexOf('--shots'); const SHOTS = si >= 0 ? process.argv[si + 1] : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
let failures = 0;
function ok(label, cond, detail) { if (cond) console.log('  OK  ', label); else { failures++; console.log('  FAIL', label, detail !== undefined ? JSON.stringify(detail) : ''); } }
const fmt = (n, d) => (typeof n === 'number' ? n.toFixed(d === undefined ? 1 : d) : String(n));
async function shot(page, name) { if (!SHOTS) return; try { await page.screenshot({ path: path.join(SHOTS, name + '.png'), timeout: 90000 }); } catch (e) { /* skip */ } }
const step = (page, dt) => page.evaluate((dt) => AP_DEBUG.step(dt), dt);
const run = (page, s, fps) => page.evaluate(({ s, fps }) => AP_DEBUG.run(s, fps), { s, fps: fps || 60 });
const setDirs = (page, dx, dy, rot) => page.evaluate(({ dx, dy, rot }) => AP_DEBUG.setDirs(dx, dy, rot), { dx, dy, rot: rot || 0 });
const newGame = async (page) => { await page.evaluate(() => { AP_DEBUG.goIntro(); AP_DEBUG.start(); }); return step(page, 0); };
async function approach(page, target) { await setDirs(page, -1, 0); let s; for (let i = 0; i < 900; i++) { s = await step(page, 1 / 60); if (s.cut && s.cut.depth0 >= target) break; } await setDirs(page, 0, 0); return step(page, 1 / 60); }
const turn = (a, b, c) => { const v1 = [b[0] - a[0], b[1] - a[1]], v2 = [c[0] - b[0], c[1] - b[1]]; const d = Math.atan2(v1[0] * v2[1] - v1[1] * v2[0], v1[0] * v2[0] + v1[1] * v2[1]); return Math.abs(d) * 180 / Math.PI; };

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => { errors.push(e.message); console.log('  [pageerror]', e.message); });
  page.on('console', (m) => { if (m.type() === 'error') { errors.push(m.text()); console.log('  [console.error]', m.text().slice(0, 200)); } });
  await page.goto(URL); await page.waitForFunction(() => window.AP_READY === true, null, { timeout: 60000 }); await page.evaluate(() => AP_DEBUG.setLegacy(true));   /* 기계 동작 테스트: 호환 모드를 명시(제품 기본은 실제 규칙) */
  await page.evaluate(() => AP_DEBUG.setPaused(true));
  const C = await page.evaluate(() => AP.CONFIG); const R = C.RIBBON;

  console.log('=== 1·4·5. 껍질 시작점 = 실제 칼날 접촉점 · 기울여도 추적 · 칼 옆면/손잡이에 안 붙음 ===');
  for (const deg of [-40, 0, 25, 40]) {
    await newGame(page);
    await page.evaluate((d) => AP_DEBUG.setKnifeAngleDeg(d), deg);
    await page.evaluate(() => { const k = AP.knife; k.setOrigin(k.x, k.y); });
    let s = await approach(page, 3.5);
    for (let q = 0; q < 90 && !(s.cut && s.cut.newlyPeeled > 0 && s.cut.peelLen > 0); q++) s = await step(page, 1 / 60);   // 새 껍질이 막 벗겨진 프레임에서 측정
    const r = await page.evaluate(() => {
      const c = AP_DEBUG.contact(), pts = AP_DEBUG.ribbonPoints(), e = AP.cutting.edgeStage(), reg = AP_DEBUG.regions();
      // 머리 → 날 폴리라인 최단 거리
      let best = Infinity; for (let i = 0; i < e.length - 1; i++) { const a = e[i], b = e[i + 1], vx = b[0] - a[0], vy = b[1] - a[1], L = vx * vx + vy * vy || 1; let t = ((pts[0][0] - a[0]) * vx + (pts[0][1] - a[1]) * vy) / L; t = Math.max(0, Math.min(1, t)); best = Math.min(best, Math.hypot(pts[0][0] - (a[0] + t * vx), pts[0][1] - (a[1] + t * vy))); }
      // 날 구간 안의 모든 마디가 엣지보다 왼쪽(칼 몸통 밖)인가 · 손잡이/연결부 다각형 안의 마디 수
      let inside = 0, worst = -Infinity; for (let i = 1; i < pts.length; i++) { const ex = AP.cutting.edgeXAt(pts[i][1]); if (ex !== null) { worst = Math.max(worst, pts[i][0] - ex); if (pts[i][0] > ex - 1.49) inside++; } }
      const inPoly = (p, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { if (((poly[i][1] > p[1]) !== (poly[j][1] > p[1])) && (p[0] < (poly[j][0] - poly[i][0]) * (p[1] - poly[i][1]) / (poly[j][1] - poly[i][1]) + poly[i][0])) c = !c; } return c; };
      let inHandle = 0; for (const p of pts) if (inPoly(p, reg.handleRegionPoly) || inPoly(p, reg.bolsterPoly)) inHandle++;
      return { headToEdge: best, headToPeel: Math.hypot(pts[0][0] - c.peelX, pts[0][1] - c.peelY), n: pts.length, inside, worst, inHandle, peelY: c.peelY, pivotY: AP.knife.py, tilt: AP.knife.angleDeg };
    });
    ok('기울기 ' + fmt(r.tilt, 0) + '°: 머리 ↔ 새로 벗겨진 셀 위치 ' + fmt(r.headToPeel, 3) + 'px · 머리 ↔ 날 엣지 폴리라인 ' + fmt(r.headToEdge, 2) + 'px (≤ 1) · 날 구간 마디가 엣지 안쪽(칼 몸통)에 든 개수 ' + r.inside + ' · 손잡이/연결부 위 마디 ' + r.inHandle, r.headToPeel < 0.01 && r.headToEdge <= 1 && r.inside === 0 && r.inHandle === 0, r);
    if (deg === 0 || deg === 40) await shot(page, 'p-01-tilt' + deg);
  }

  console.log('=== 2·3. 날 엣지를 따라 들렸다가 처짐 · 휨 · 끝 말림 · 톱니 없음 · 폭 ===');
  await newGame(page);
  let s = await approach(page, 3.5);
  s = await run(page, 2.0);
  const g = await page.evaluate(() => { const p = AP_DEBUG.ribbonPoints(); return { p, head: p[0], c: AP_DEBUG.contact() }; });
  const P = g.p, n = P.length;
  const lift = g.head[1] - Math.min(...P.slice(0, 9).map((q) => q[1]));
  ok('갓 분리된 처음 마디가 헤드보다 위로 들림(아치 높이 ' + fmt(lift, 1) + 'px ≥ 3) 후 아래로 늘어짐(꼬리 y − 머리 y = ' + fmt(P[n - 1][1] - g.head[1], 0) + ')', lift >= 3 && P[n - 1][1] > g.head[1] + 40, { lift, n });
  let path_ = 0; for (let i = 1; i < n; i++) path_ += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
  const chord = Math.hypot(P[n - 1][0] - P[0][0], P[n - 1][1] - P[0][1]);
  let maxTurn = 0; for (let i = 1; i < n - 1; i++) maxTurn = Math.max(maxTurn, turn(P[i - 1], P[i], P[i + 1]));
  const dirMid = Math.atan2(P[Math.floor(n * 0.5) + 1][1] - P[Math.floor(n * 0.5)][1], P[Math.floor(n * 0.5) + 1][0] - P[Math.floor(n * 0.5)][0]);
  const dirEnd = Math.atan2(P[n - 1][1] - P[n - 4][1], P[n - 1][0] - P[n - 4][0]);
  const endCurl = Math.abs(dirEnd - dirMid) * 180 / Math.PI;
  ok('직선이 아님: 직선거리/경로 ' + fmt(chord / path_, 3) + ' < 0.985 · 끝 방향이 중간과 ' + fmt(endCurl, 0) + '° 다름(말림 ≥ 8°) · 마디 사이 최대 꺾임 ' + fmt(maxTurn, 0) + '° < 35°(톱니 없음)', chord / path_ < 0.985 && endCurl >= 8 && maxTurn < 35, { ratio: chord / path_, endCurl, maxTurn });
  ok('폭 ' + R.WIDTH + 'px (이전 6px 대비 −13%, 얇은 리본이되 실처럼 보이지 않는 4.8~5.6px)', R.WIDTH >= 4.8 && R.WIDTH <= 5.6);
  await shot(page, 'p-02-ribbon');
  // 관성: 칼을 위로 빠르게 움직이면 머리가 먼저 가고 몸통은 늦게 따라온다
  const before = await page.evaluate(() => AP_DEBUG.ribbonPoints());
  await setDirs(page, 0, -1);
  for (let i = 0; i < 6; i++) await step(page, 1 / 60);
  const after = await page.evaluate(() => AP_DEBUG.ribbonPoints());
  await setDirs(page, 0, 0);
  const nn = Math.min(before.length, after.length);
  const dHead = Math.hypot(after[0][0] - before[0][0], after[0][1] - before[0][1]);
  const dTail = Math.hypot(after[nn - 1][0] - before[nn - 1][0], after[nn - 1][1] - before[nn - 1][1]);
  let shape = 0; for (let i = 1; i < nn; i++) shape += Math.hypot((after[i][0] - after[0][0]) - (before[i][0] - before[0][0]), (after[i][1] - after[0][1]) - (before[i][1] - before[0][1]));
  shape /= (nn - 1);
  ok('칼 이동(6프레임) 시 리본 전체가 칼과 똑같이 움직이지 않음: 머리 ' + fmt(dHead, 1) + 'px · 꼬리 ' + fmt(dTail, 1) + 'px · 머리 기준 모양 변화 평균 ' + fmt(shape, 2) + 'px (> 0.3, 몸통이 뒤따르며 휨)', shape > 0.3 && Math.abs(dTail - dHead) > 0.3, { dHead, dTail, shape });

  console.log('=== 5. 끊김 · 낙하(구부러지며) · 순간이동 없음 ===');
  await newGame(page); s = await approach(page, 3.5); s = await run(page, 1.0);
  await setDirs(page, 1, 0);
  let fp = null, steps = [], prev = null;
  for (let i = 0; i < 80; i++) { s = await step(page, 1 / 60); const f = await page.evaluate(() => AP.ribbon.fallPoints()[0] || null); if (f) { if (prev && prev.length === f.length) { let m = 0; for (let k = 0; k < f.length; k++) m = Math.max(m, Math.hypot(f[k][0] - prev[k][0], f[k][1] - prev[k][1])); steps.push(m); } if (!fp) fp = f; prev = f; } }
  await setDirs(page, 0, 0);
  ok('끊어진 리본이 사라지거나 순간이동하지 않음: 프레임당 마디 이동 최대 ' + fmt(Math.max(...steps), 1) + 'px (< 25) · 낙하 구간 ' + steps.length + '프레임', steps.length > 20 && Math.max(...steps) < 25, { steps: steps.length });
  await shot(page, 'p-03-falling');

  console.log('=== 4(경계). 절삭 경계: 셀 계단 vs 등치선 렌더 — 같은 판정 데이터 ===');
  await newGame(page);
  const sp = await page.evaluate(() => AP_DEBUG.runAutopilot(10, { dur: 20, depthFrac: 0.6 }));   // 빠른 나선(대각선 경계가 많음)
  await page.evaluate(() => { AP_DEBUG.finish('button'); });
  const stBefore = await page.evaluate(() => AP_DEBUG.dumpSurface());
  async function snapMode(smooth) {
    await page.evaluate((b) => AP_DEBUG.setSmoothPeel(b), smooth);
    const url = await page.evaluate(() => AP_DEBUG.appleSnapshotDataUrl(720));
    if (SHOTS) fs.writeFileSync(path.join(SHOTS, 'p-04-boundary-' + (smooth ? 'smooth' : 'cell') + '.png'), Buffer.from(url.split(',')[1], 'base64'));
    return png.decode(Buffer.from(url.split(',')[1], 'base64'));
  }
  const imgCell = await snapMode(false), imgSmooth = await snapMode(true);
  const stAfter = await page.evaluate(() => AP_DEBUG.dumpSurface());
  /* 띠의 아래쪽 경계(과육→껍질로 바뀌는 마지막 화소)를 열마다 추적해 인접 열 사이 점프(≥ 2px)와 두 번째 차분 합을 센다 — 계단은 점프가 몰려 있고 매끈한 곡선은 없다 */
  function jaggedness(img) {
    const { width: W, height: H, data } = img;
    const cls = (x, y) => { const o = (y * W + x) * 4; if (data[o + 3] < 200 || (data[o] > 240 && data[o + 1] > 240 && data[o + 2] > 240)) return 0; return data[o] > data[o + 1] * 1.9 && data[o] > data[o + 2] * 1.9 ? 1 : 2; };
    const trace = [];
    for (let x = Math.floor(W * 0.12); x < Math.floor(W * 0.88); x++) { let yb = -1; for (let y = 1; y < H - 1; y++) if (cls(x, y) === 2 && cls(x, y + 1) === 1) yb = y; trace.push(yb); }
    let jumps = 0, tv = 0, sd = 0, n = 0;
    for (let i = 2; i < trace.length; i++) { if (trace[i] < 0 || trace[i - 1] < 0 || trace[i - 2] < 0) continue; const d = trace[i] - trace[i - 1]; n++; tv += Math.abs(d); if (Math.abs(d) >= 2) jumps++; sd += Math.abs(trace[i] - 2 * trace[i - 1] + trace[i - 2]); }
    return { n, jumps, jumpRate: jumps / Math.max(1, n), secondDiff: sd / Math.max(1, n), boundary: n };
  }
  const jc = jaggedness(imgCell), js = jaggedness(imgSmooth);
  ok('판정 데이터 동일(렌더 모드만 바뀜): 셀 그리드 덤프 불변', stBefore === stAfter);
  ok('경계 계단 지표(열 사이 2px 이상 점프 비율 / 2차 차분 평균): 셀 단위 ' + fmt(jc.jumpRate, 3) + ' / ' + fmt(jc.secondDiff, 3) + ' → 등치선 ' + fmt(js.jumpRate, 3) + ' / ' + fmt(js.secondDiff, 3) + ' (점프 40% 이상 감소) · 추적 열 ' + jc.n, js.jumpRate <= jc.jumpRate * 0.6, { jc, js });
  // 깜빡임: 회전각만 바꿔 두 장 렌더 후 경계 화소 수 변화
  async function boundaryAt(angle) { await page.evaluate((a) => { AP.rotation.angle = a; AP_DEBUG.apple.setAngle(a); }, angle); const url = await page.evaluate(() => AP_DEBUG.appleSnapshotDataUrl(720)); return jaggedness(png.decode(Buffer.from(url.split(',')[1], 'base64'))).secondDiff; }
  const b0 = await boundaryAt(0.00), b1 = await boundaryAt(0.01), b2 = await boundaryAt(0.02);
  ok('회전해도 경계가 안정(깜빡임 없음): 미세 회전(0.5°·1°)에서 2차 차분 ' + fmt(b0, 3) + ' → ' + fmt(b1, 3) + ' → ' + fmt(b2, 3) + ' (±0.3 이내)', Math.abs(b1 - b0) < 0.3 && Math.abs(b2 - b0) < 0.3, { b0, b1, b2 });

  console.log('=== 성능 · 기존 시스템 불변 ===');
  await newGame(page);
  const perf = await page.evaluate(() => AP_DEBUG.runAutopilot(14, { dur: 60, depthFrac: 0.6 }));
  ok('갱신(절삭+리본) 평균 ' + fmt(perf.rib.sumMs / perf.rib.frames, 3) + 'ms · 최대 ' + fmt(perf.rib.maxMs, 2) + 'ms (< 4ms) · "길이 증가 ⇔ 새 껍질 제거" 위반 ' + perf.rib.badEmit, perf.rib.sumMs / perf.rib.frames < 1.5 && perf.rib.maxMs < 4 && perf.rib.badEmit === 0, perf.rib);
  ok('자동조종 14초 결과(껍질 ' + fmt(perf.stats.peelPct, 1) + '% · 과육 ' + fmt(perf.stats.fleshPct, 3) + '%)', perf.stats.peelPct > 15 && perf.stats.fleshPct < 0.1, perf.stats);
  await page.evaluate(() => AP_DEBUG.setSmoothPeel(true));
  await step(page, 0); await shot(page, 'p-05-spiral');
  ok('셰이더 오류·페이지 오류 없음', errors.length === 0, errors);
  await browser.close();
  console.log(failures === 0 ? '\n모든 검사 통과' : '\n실패 ' + failures + '건');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
