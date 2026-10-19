/* 헤드리스 QA(1단계) — 로드/시작 화면 정지, 회전(세로축·정면 왼→오·중심 고정·2.5s/회전), 칼(방향·배치·간격·날/손잡이 영역),
 * 조작(키보드·패드 멀티터치·즉시 정지·대각선·범위 제한), 흐름(완료/시간 종료/다시 깎기), 레이아웃(5 폭 + 320×568), 색 밴드 비교.
 * 사용: node tools/qa.js [--shots <dir>]
 * 하네스: 260624/build 의 playwright-core + 로컬 Chrome(SwiftShader 로 WebGL). file:// 로 연다. 시뮬레이션은 AP_DEBUG.step/run(고정 dt). */
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('C:/Users/thkim/Desktop/code-work/260624/build/node_modules/playwright-core');
const png = require('./png.js');

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
const isActive = (page, sel) => page.evaluate((sel) => document.querySelector(sel).classList.contains('active'), sel);
const uiHidden = (page, sel) => page.evaluate((sel) => document.querySelector(sel).classList.contains('ui-hidden'), sel);
function decodeDataUrl(url) { return png.decode(Buffer.from(url.split(',')[1], 'base64')); }
function bandColors(img, bands) {
  const { width: W, height: H, data } = img; const out = [];
  // 사과 bbox: 흰색이 아닌 픽셀
  let minY = H, maxY = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 4; if (data[o] < 240 || data[o + 1] < 240 || data[o + 2] < 240) { if (y < minY) minY = y; if (y > maxY) maxY = y; } }
  for (let b = 0; b < bands; b++) {
    const y0 = minY + Math.floor((maxY - minY + 1) * b / bands), y1 = minY + Math.floor((maxY - minY + 1) * (b + 1) / bands) - 1;
    let r = 0, g = 0, bl = 0, n = 0;
    for (let y = y0; y <= y1; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 4; if (data[o] < 240 || data[o + 1] < 240 || data[o + 2] < 240) { r += data[o]; g += data[o + 1]; bl += data[o + 2]; n++; } }
    out.push(n ? [Math.round(r / n), Math.round(g / n), Math.round(bl / n)] : null);
  }
  return { bands: out, minY, maxY };
}

async function openPage(browser, viewport, opts) {
  const ctx = await browser.newContext(Object.assign({ viewport }, opts || {}));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => { errors.push(e.message); console.log('  [pageerror]', e.message); });
  page.on('console', (m) => { if (m.type() === 'error') console.log('  [console.error]', m.text()); });
  await page.goto(URL);
  await page.waitForFunction(() => window.AP_READY === true, null, { timeout: 60000 }); await page.evaluate(() => AP_DEBUG.setLegacy(true));   /* 기계 동작 테스트: 호환 모드를 명시(제품 기본은 실제 규칙) */
  await page.evaluate(() => window.AP_DEBUG.setPaused(true));   // rAF 는 돌지만 시뮬레이션은 step/run 으로만
  return { ctx, page, errors };
}

(async () => {
  const browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });

  console.log('=== 1. 로드 → 시작 화면(타이머·회전·절삭 정지, 미리보기) ===');
  const { ctx, page, errors } = await openPage(browser, { width: 390, height: 844 }, { hasTouch: true, isMobile: true });
  const C = await page.evaluate(() => window.AP.CONFIG);
  const A = await page.evaluate(() => ({ knife: Object.assign({}, window.AP_ASSETS.knife, { src: null, edge: window.AP_ASSETS.knife.edge.length, spine: null, heel: null }), red: Object.assign({}, window.AP_ASSETS.red, { profile: null }) }));
  ok('페이지 오류 없음', errors.length === 0, errors);
  ok('WebGL 렌더러 생성', await page.evaluate(() => !!AP.scene.renderer && !!AP.scene.renderer.getContext()));
  ok('에셋: 칼 PNG 내장 · 사과 PNG 는 실측값만(바이트 미내장)', A.knife.bbox && A.red.profile === null && (await page.evaluate(() => AP_ASSETS.red.src === null && AP_ASSETS.knife.src.length > 1000)));
  let s = await snap(page);
  ok('최초 상태 intro · 시작 화면 표시 · HUD/패드 숨김', s.state === 'intro' && (await isActive(page, '#screen-intro')) && (await uiHidden(page, '#hud')) && (await uiHidden(page, '#pad')), s.state);
  const introUrl = await page.evaluate(() => AP_DEBUG.introPreviewDataUrl());
  const introImg = decodeDataUrl(introUrl);
  { let nonWhite = 0, n = 0; for (let i = 0; i < introImg.data.length; i += 16) { n++; if (introImg.data[i] < 235 || introImg.data[i + 1] < 235 || introImg.data[i + 2] < 235) nonWhite++; }
    ok('시작 화면 미리보기에 장면이 그려짐(비흰 픽셀 > 15%)', nonWhite / n > 0.15, nonWhite / n); }
  s = await run(page, 2);
  ok('시작 전 2초: 타이머·회전각·칼 위치 변화 없음', s.state === 'intro' && s.angle === 0 && s.t === 0, { t: s.t, angle: s.angle });
  await shot(page, '01-intro');

  console.log('=== 2. 시작 → 타이머 · 회전(세로축 · 정면 왼→오 · 중심 고정 · 2.5s/회전) ===');
  await page.evaluate(() => { for (const id of ['btn-start', 'btn-select-next']) document.getElementById(id).click(); });
  s = await step(page, 0);
  ok('시작 클릭 → ready(절삭은 첫 접촉 때 시작) · 시작 화면 숨김 · HUD/패드 표시', s.state === 'ready' && !(await isActive(page, '#screen-intro')) && !(await uiHidden(page, '#hud')) && !(await uiHidden(page, '#pad')), s.state);
  const L = await page.evaluate(() => AP_DEBUG.layout());
  const SURF = await page.evaluate(() => AP_DEBUG.surface());
  console.log('   레이아웃: 논리 H', fmt(L.H, 0), '· 플레이 영역', fmt(L.playTop, 0) + '~' + fmt(L.playBottom, 0), '· 사과 중심', fmt(L.appleCx, 0) + ',' + fmt(L.appleCy, 0), '· 몸통 상단/하단', fmt(L.bodyTopY, 0) + '/' + fmt(L.bodyBottomY, 0), '· R', SURF.R, '· 셀', SURF.NR + '×' + SURF.NS);
  const c0 = await page.evaluate(() => AP_DEBUG.appleCenterStage());
  const omega = s.omega;
  ok('회전 각속도 = +2π/2.5 (정면 왼→오 방향)', Math.abs(omega - 2 * Math.PI / C.ROTATION_PERIOD) < 1e-9 && omega > 0, omega);
  // 마커 추적: 1/120 s 간격으로 2.5 초(한 바퀴)
  const track = [];
  for (let i = 0; i < 300; i++) { await step(page, 1 / 120); track.push(await page.evaluate(() => AP_DEBUG.marker())); }
  s = await snap(page);
  ok('2.5초 후 회전각 = 2π(한 바퀴)', Math.abs(s.angle - 2 * Math.PI) < 1e-6, { angle: s.angle });
  let frontInc = 0, frontDec = 0, backInc = 0, backDec = 0, maxDy = 0, maxZ = -1e9, minZ = 1e9;
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1], b = track[i];
    maxDy = Math.max(maxDy, Math.abs(b.sy - track[0].sy)); maxZ = Math.max(maxZ, b.wz); minZ = Math.min(minZ, b.wz);
    if (b.wz > SURF.R * 0.3) { if (b.sx > a.sx) frontInc++; else frontDec++; }
    if (b.wz < -SURF.R * 0.3) { if (b.sx < a.sx) backDec++; else backInc++; }
  }
  ok('[회전] 정면(z>0.3R)에 있을 때 마커의 화면 x 가 단조 증가(왼→오)', frontInc > 50 && frontDec === 0, { frontInc, frontDec });
  ok('[회전] 뒷면(z<-0.3R)에 있을 때는 오→왼(세로축 회전의 반대편)', backDec > 50 && backInc === 0, { backDec, backInc });
  ok('[회전] 마커가 앞뒤로 한 바퀴(z 가 ±R 근처까지)', maxZ > SURF.R * 0.95 && minZ < -SURF.R * 0.95, { maxZ, minZ });
  { const pitch = C.CAMERA_PITCH_DEG * Math.PI / 180, want = 2 * SURF.R * Math.sin(pitch);
    const xs = track.map((t) => t.sx), xRange = Math.max(...xs) - Math.min(...xs);
    ok('[회전] 마커 화면 x 범위 ≈ 2R(' + fmt(2 * SURF.R, 0) + ') · y 범위 ≈ 2R·sin(피치 ' + C.CAMERA_PITCH_DEG + '°) = ' + fmt(want, 0) + 'px(앞이 낮고 뒤가 높음) → 세로 중심축 회전(평면 시계방향 회전이면 y 범위도 2R)', Math.abs(xRange - 2 * SURF.R) < 4 && Math.abs(maxDy - want) < 3, { xRange, yRange: maxDy, want }); }
  const c1 = await page.evaluate(() => AP_DEBUG.appleCenterStage());
  ok('[회전] 사과 중심 화면 위치 고정', Math.abs(c1.x - c0.x) < 1e-6 && Math.abs(c1.y - c0.y) < 1e-6, { c0, c1 });
  console.log('   마커 궤적(정면 통과): ' + track.filter((t, i) => i % 30 === 0).map((t) => 'x' + fmt(t.sx, 0) + '/z' + fmt(t.wz, 0)).join(' → '));
  await shot(page, '02-play');

  console.log('=== 3. 칼: 방향(날 위·손잡이 아래) · 사과 오른쪽 · 간격 · 영역 분리 ===');
  const R = await page.evaluate(() => AP_DEBUG.regions());
  const K = s.knife;
  ok('칼 스프라이트 회전 0(이미지 방향 그대로)', await page.evaluate(() => AP_DEBUG.knifeMesh.rotation.x === 0 && AP_DEBUG.knifeMesh.rotation.y === 0 && AP_DEBUG.knifeMesh.rotation.z === 0));
  ok('칼끝이 맨 위 · 칼날 영역 아래에 bolster · 그 아래 손잡이 영역(세로 순서)', R.tip[1] < R.bladeRegion.y1 && R.bladeRegion.y0 === R.tip[1] && R.bolster.y0 < R.handleRegion.y0 && R.handleRegion.y0 < R.handleRegion.y1 && R.bladeRegion.y1 >= R.bolster.y0, { tip: R.tip, blade: R.bladeRegion, bolster: R.bolster, handle: R.handleRegion });
  ok('날 폴리라인 = 왼쪽(사과 쪽) 실루엣: 모든 점이 등(spine)보다 왼쪽, 손잡이 영역 위', R.edge.every((p, i) => p[0] < R.spine[Math.min(i, R.spine.length - 1)][0]) && R.edge[R.edge.length - 1][1] < R.handleRegion.y0, { edgeEnd: R.edge[R.edge.length - 1], handleTop: R.handleRegion.y0 });
  ok('날 길이(팁→힐) ≈ 칼날 영역의 ' + fmt(100 * (A.knife.edgeEndY - A.knife.tip[1]) / A.knife.bladeLen, 0) + '% · 힐/bolster/손잡이는 날에서 제외', R.edgeLen > 0.85 * (R.bladeRegion.y1 - R.bladeRegion.y0) && R.edgeLen < (R.bladeRegion.y1 - R.bladeRegion.y0), R.edgeLen);
  ok('칼이 사과 오른쪽(칼 bbox 왼쪽 > 사과 중심) · 스테이지 안(오른쪽 잘림 없음)', K.rect.x0 > L.appleCx && K.rect.x1 <= C.LOGICAL_WIDTH - C.KNIFE.STAGE_MARGIN + 0.01 && K.rect.y0 >= L.playTop && K.rect.y1 <= L.playBottom, K.rect);
  ok('시작 간격(날↔실루엣 최소 수평 거리) = ' + C.KNIFE.START_GAP + 'px(±0.5) · 접촉 0', s.probe && Math.abs(s.probe.gap - C.KNIFE.START_GAP) < 0.5 && s.probe.contacts === 0, s.probe);
  ok('칼끝 높이 = 몸통 상단 + 25%(±0.5px)', Math.abs(K.tip[1] - (L.bodyTopY + L.bodyH * C.KNIFE.START_TIP_RATIO)) < 0.5, { tip: K.tip, want: L.bodyTopY + L.bodyH * C.KNIFE.START_TIP_RATIO });
  console.log('   칼 배율', fmt(K.scale, 4), '· 칼 bbox', fmt(K.rect.x0, 0) + '~' + fmt(K.rect.x1, 0), '×', fmt(K.rect.y0, 0) + '~' + fmt(K.rect.y1, 0), '· 칼날 길이', fmt(R.bladeRegion.y1 - R.bladeRegion.y0, 0), '· 날 길이', fmt(R.edgeLen, 0), '· 간격', fmt(s.probe.gap, 2), '@y', fmt(s.probe.atY, 0));
  await page.evaluate(() => AP_DEBUG.setDebug(true));
  await step(page, 0);
  await shot(page, '03-debug-regions');
  await page.evaluate(() => AP_DEBUG.setDebug(false));

  console.log('=== 4. 조작: 램프업 · 즉시 정지 · 대각선 · ←로 접근 · 범위 제한 ===');
  const x0 = s.knife.x, y0 = s.knife.y, gap0 = s.probe.gap;
  await setDirs(page, -1, 0); s = await run(page, 0.5);
  const dxL = s.knife.x - x0;
  ok('← 0.5초: 왼쪽으로 ≈ ' + fmt(C.KNIFE.SPEED_X * 0.5 - C.KNIFE.SPEED_X * C.KNIFE.ACCEL_TAU, 0) + 'px(램프업 손실 포함) · y 불변 · 간격은 이동량만큼 감소하되 접촉 뒤엔 표면이 날까지 깎여 ≈ 0', Math.abs(dxL + (C.KNIFE.SPEED_X * 0.5 - C.KNIFE.SPEED_X * C.KNIFE.ACCEL_TAU)) < 0.6 && s.knife.y === y0 && (Math.abs((gap0 - s.probe.gap) + dxL) < 0.01 || (gap0 + dxL < 0 && s.probe.gap <= 0.1 && s.probe.gap > -0.6)), { dx: dxL, gap: s.probe.gap, gap0 });
  ok('← 중 속도 = -SPEED_X 에 수렴', Math.abs(s.knife.vx + C.KNIFE.SPEED_X) < 0.05, s.knife.vx);
  await setDirs(page, 0, 0); s = await step(page, 1 / 60);
  const xStop = s.knife.x;
  ok('떼면 즉시 정지(다음 프레임 속도 0)', s.knife.vx === 0 && s.knife.vy === 0, { vx: s.knife.vx });
  s = await run(page, 0.5);
  ok('정지 후 0.5초 위치 불변', s.knife.x === xStop, { x: s.knife.x, xStop });
  await setDirs(page, 0, 1); s = await run(page, 0.4);
  ok('↓ 0.4초: 아래로 ≈ ' + fmt(C.KNIFE.SPEED_Y * 0.4 - C.KNIFE.SPEED_Y * C.KNIFE.ACCEL_TAU, 0) + 'px · x 불변', Math.abs((s.knife.y - y0) - (C.KNIFE.SPEED_Y * 0.4 - C.KNIFE.SPEED_Y * C.KNIFE.ACCEL_TAU)) < 1.0 && s.knife.x === xStop, { dy: s.knife.y - y0 });
  const xb = s.knife.x, yb = s.knife.y;
  await setDirs(page, -1, -1); s = await run(page, 0.3);
  ok('←+↑ 동시: 대각선(x 감소, y 감소)', s.knife.x < xb - 10 && s.knife.y < yb - 10, { dx: s.knife.x - xb, dy: s.knife.y - yb });
  await setDirs(page, 1, 1); s = await run(page, 0.3);
  ok('→+↓: 반대 대각선(방향 반전 램프 손실 ≤ 6px)', s.knife.x > xb - 6 && s.knife.x < xb + 1 && s.knife.y > yb - 6 && s.knife.y < yb + 1, { x: s.knife.x - xb, y: s.knife.y - yb });
  await setDirs(page, 0, 0); await step(page, 1 / 60);
  // 접근 → 접촉(2단계 절삭 입력값이 양수가 되는지만 확인; 1단계는 절삭 없음)
  await page.evaluate(() => AP_DEBUG.setKnifePos(AP_DEBUG.snapshot().knife.x, AP_DEBUG.layout().bodyTopY + AP_DEBUG.layout().bodyH * 0.25 - AP_ASSETS.knife.tip[1] * AP.knife.scale));
  await setDirs(page, -1, 0);
  let contactAt = null, lastGap = null;
  for (let i = 0; i < 600 && contactAt === null; i++) { s = await step(page, 1 / 60); lastGap = s.probe.gap; if (s.probe.contacts > 0) contactAt = s.t; }
  ok('← 를 누르고 있으면 날이 실루엣에 닿는다(probe.contacts > 0) · 손잡이는 아직 사과 밖', contactAt !== null && s.probe.maxDepth > 0 && s.knife.rect.x0 > 0, { contactAt, probe: s.probe });
  await setDirs(page, 0, 0); await step(page, 0);
  await page.evaluate(() => AP_DEBUG.setDebug(true)); await step(page, 0);
  await shot(page, '04-contact-debug');
  await page.evaluate(() => AP_DEBUG.setDebug(false));
  console.log('   접촉 시 날 접촉점 y 범위', fmt(s.probe.yFirst, 0) + '~' + fmt(s.probe.yLast, 0), '· 최대 깊이', fmt(s.probe.maxDepth, 2));
  // 범위 제한
  await setDirs(page, 1, 0); s = await run(page, 8);
  { const Rr = await page.evaluate(() => AP_DEBUG.regions()); const edgeMaxX = Math.max(...Rr.edge.map((p) => p[0]));
    ok('→ 끝까지: px = maxX · 날 오른쪽 끝 ' + fmt(edgeMaxX, 1) + ' ≤ W − 여백 (손잡이는 화면 밖 허용)', s.knife.px === s.knife.bounds.maxX && edgeMaxX <= C.LOGICAL_WIDTH - C.KNIFE.STAGE_MARGIN + 0.01, { px: s.knife.px, max: s.knife.bounds.maxX, edgeMaxX, rectX1: s.knife.rect.x1 }); }
  await setDirs(page, -1, 0); s = await run(page, 8);
  const Rmin = await page.evaluate(() => AP_DEBUG.regions());
  ok('← 끝까지: x = minX · 날 왼쪽 끝 ≥ 사과 중심 - 0.5R', s.knife.px === s.knife.bounds.minX && Rmin.bladeRegion.x0 >= L.appleCx - L.appleR * C.KNIFE.MAX_DEPTH_RATIO - 0.01, { bladeX0: Rmin.bladeRegion.x0, limit: L.appleCx - SURF.R * C.KNIFE.MAX_DEPTH_RATIO });
  await setDirs(page, 0, -1); s = await run(page, 8);
  ok('↑ 끝까지: 칼 bbox 위 ≥ HUD 아래(플레이 영역 상단)', s.knife.py === s.knife.bounds.minY && s.knife.rect.y0 >= L.playTop + C.KNIFE.STAGE_MARGIN - 0.01, { rectY0: s.knife.rect.y0, playTop: L.playTop });
  await setDirs(page, 0, 1); s = await run(page, 8);
  const padTop = await page.evaluate(() => { const r = document.getElementById('pad').getBoundingClientRect(), a = document.getElementById('app').getBoundingClientRect(); return (r.top - a.top) * AP.CONFIG.LOGICAL_WIDTH / a.width; });
  ok('↓ 끝까지: 칼 bbox 아래 ≤ 패드 위(손잡이가 패드에 가려지지 않음)', s.knife.py === s.knife.bounds.maxY && s.knife.rect.y1 <= padTop + 0.01, { rectY1: s.knife.rect.y1, padTop });
  await setDirs(page, 0, 0); await step(page, 0);
  await shot(page, '05-knife-bottom');

  console.log('=== 5. 실제 입력 경로: 키보드 · 패드 멀티터치(CDP) · blur ===');
  await setDirs(page, null, null);
  await page.evaluate(() => AP_DEBUG.setKnifePos(AP_DEBUG.snapshot().knife.bounds.maxX - 10, (AP_DEBUG.snapshot().knife.bounds.minY + AP_DEBUG.snapshot().knife.bounds.maxY) / 2));
  await page.keyboard.down('ArrowLeft');
  s = await step(page, 1 / 60);
  ok('ArrowLeft keydown → dirs.dx = -1 · 칼 x 감소', s.dirs.dx === -1 && s.knife.vx < 0, s.dirs);
  await page.keyboard.down('ArrowUp');
  s = await step(page, 1 / 60);
  ok('ArrowLeft + ArrowUp 동시 → (-1, -1)', s.dirs.dx === -1 && s.dirs.dy === -1, s.dirs);
  await page.keyboard.up('ArrowLeft'); await page.keyboard.up('ArrowUp');
  s = await step(page, 1 / 60);
  ok('keyup → (0, 0) · 속도 0', s.dirs.dx === 0 && s.dirs.dy === 0 && s.knife.vx === 0 && s.knife.vy === 0, s.dirs);
  // 패드: CDP 터치 이벤트로 두 손가락 동시 누르기(← 와 ↓)
  const cdp = await ctx.newCDPSession(page);
  const btnRect = (sel) => page.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
  const bl = await btnRect('[data-dir="left"]'), bd = await btnRect('[data-dir="down"]'), bu = await btnRect('[data-dir="up"]');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bl.x, y: bl.y, id: 1 }] });
  s = await step(page, 1 / 60);
  ok('패드 ← 터치 다운 → dx = -1 · 버튼 눌림 표시', s.dirs.dx === -1 && (await page.evaluate(() => document.querySelector('[data-dir="left"]').classList.contains('is-down'))), s.dirs);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bl.x, y: bl.y, id: 1 }, { x: bd.x, y: bd.y, id: 2 }] });
  s = await step(page, 1 / 60);
  ok('두 번째 손가락 ↓ 추가(멀티터치) → (-1, +1) 대각선', s.dirs.dx === -1 && s.dirs.dy === 1, s.dirs);
  s = await run(page, 0.3);
  ok('멀티터치 유지 0.3초: 칼이 왼쪽 아래로 이동', s.knife.vx < 0 && s.knife.vy > 0, { vx: s.knife.vx, vy: s.knife.vy });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: bd.x, y: bd.y, id: 2 }] });
  s = await step(page, 1 / 60);
  ok('↓ 손가락만 뗌 → (-1, 0) · vy 즉시 0', s.dirs.dx === -1 && s.dirs.dy === 0 && s.knife.vy === 0, s.dirs);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  s = await step(page, 1 / 60);
  ok('모두 뗌 → (0, 0) · 눌림 표시 해제', s.dirs.dx === 0 && s.dirs.dy === 0 && !(await page.evaluate(() => document.querySelector('[data-dir="left"]').classList.contains('is-down'))), s.dirs);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bu.x, y: bu.y, id: 3 }] });
  await page.touchscreen.tap(10, 300);   // 스테이지 아무 곳 탭이 입력에 영향 없음
  s = await step(page, 1 / 60);
  ok('↑ 누른 채 스테이지 탭 → 여전히 (0, -1)', s.dirs.dx === 0 && s.dirs.dy === -1, s.dirs);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  s = await step(page, 1 / 60);
  ok('창 blur → 입력 전부 해제', s.dirs.dx === 0 && s.dirs.dy === 0, s.dirs);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const scrollW = await page.evaluate(() => ({ sw: document.scrollingElement.scrollWidth, iw: window.innerWidth, sh: document.scrollingElement.scrollHeight, ih: window.innerHeight }));
  ok('가로/세로 스크롤 없음', scrollW.sw <= scrollW.iw && scrollW.sh <= scrollW.ih, scrollW);

  console.log('=== 6. 흐름: 종료 → 결과 → 다시 깎기(초기화) ===');
  await page.evaluate(() => { AP.play.forcePlaying(); AP_DEBUG.finish('detach'); AP_DEBUG.run(1.0, 60); });
  s = await step(page, 0);
  ok('종료 → ended · 결과 화면 표시', s.state === 'ended' && (await isActive(page, '#screen-result')), s.state);
  const angleAtEnd = s.angle;
  s = await run(page, 1);
  ok('종료 후 회전 정지', s.angle === angleAtEnd && s.state === 'ended', { angle: s.angle, angleAtEnd });
  await shot(page, '06-result-skeleton');
  await page.click('#btn-restart');
  s = await step(page, 0);
  ok('다시 깎기 → ready · 회전각 0 · 칼 시작 위치(간격 ' + C.KNIFE.START_GAP + ')', s.state === 'ready' && s.angle === 0 && Math.abs(s.probe.gap - C.KNIFE.START_GAP) < 0.5 && Math.abs(s.knife.x - x0) < 1e-6 && Math.abs(s.knife.y - y0) < 1e-6, { angle: s.angle, gap: s.probe.gap });
  await page.evaluate(() => AP_DEBUG.goIntro());
  s = await step(page, 0);
  ok('goIntro → intro 화면 · 초기화', s.state === 'intro' && s.angle === 0 && (await isActive(page, '#screen-intro')), s.state);

  console.log('=== 7. 색: 렌더된 사과의 세로 색 밴드 vs 제공 PNG 밴드(참고) ===');
  await page.evaluate(() => { for (const id of ['btn-start', 'btn-select-next']) document.getElementById(id).click(); }); await step(page, 0);
  const appleUrl = await page.evaluate(() => AP_DEBUG.appleSnapshotDataUrl(300));
  const appleImg = decodeDataUrl(appleUrl);
  const bc = bandColors(appleImg, 10);
  const ref = A.red.colorBands;
  let redDominant = true, worst = 0;
  for (let b = 1; b < 9; b++) { const c = bc.bands[b], r = ref[b]; if (!c) continue; if (!(c[0] > c[1] * 1.8 && c[0] > c[2] * 1.8)) redDominant = false; worst = Math.max(worst, Math.abs(c[0] - r[0]), Math.abs(c[1] - r[1]), Math.abs(c[2] - r[2])); }
  ok('렌더 사과 색 밴드가 모두 빨강 우세(껍질) · 위가 밝고 아래가 어둡다(PNG 와 같은 경향)', redDominant && bc.bands[2][0] > bc.bands[8][0], bc.bands);
  console.log('   밴드   렌더            PNG');
  for (let b = 0; b < 10; b++) console.log('   ' + b + '     ' + JSON.stringify(bc.bands[b]).padEnd(16) + JSON.stringify(ref[b]));
  console.log('   밴드 1~8 최대 채널 오차', worst);
  if (SHOTS) fs.writeFileSync(path.join(SHOTS, '07-apple-only.png'), Buffer.from(appleUrl.split(',')[1], 'base64'));

  console.log('=== 8. 레이아웃: 폭 320/360/375/390/430 · 320×568 — 칼 전체·패드가 잘리지 않음, 시작 화면 fit ===');
  for (const vp of [[320, 844], [360, 800], [375, 812], [390, 844], [430, 932], [320, 568]]) {
    const o = await openPage(browser, { width: vp[0], height: vp[1] });
    const p = o.page;
    const intro = await p.evaluate(() => { const b = document.getElementById('btn-start').getBoundingClientRect(), v = document.querySelector('#screen-intro .slot-visual').getBoundingClientRect(); return { ctaBottom: b.bottom, visualTop: v.top, visualW: v.width, visualH: v.height, ih: window.innerHeight, sw: document.scrollingElement.scrollWidth, iw: window.innerWidth }; });
    await p.evaluate(() => { for (const id of ['btn-start', 'btn-select-next']) document.getElementById(id).click(); });
    await p.evaluate(() => { window.AP_DEBUG.setDirs(0, 1); window.AP_DEBUG.run(8); window.AP_DEBUG.setDirs(0, 0); });
    const r = await p.evaluate(() => { const s = AP_DEBUG.snapshot(), L = AP_DEBUG.layout(); const pad = document.getElementById('pad').getBoundingClientRect(), app = document.getElementById('app').getBoundingClientRect(); const k = AP.CONFIG.LOGICAL_WIDTH / app.width; return { rect: s.knife.rect, padTop: (pad.top - app.top) * k, L: { playTop: L.playTop, playBottom: L.playBottom, H: L.H, appleCx: L.appleCx, appleCy: L.appleCy, bodyH: L.bodyH }, gap0: null }; });
    await p.evaluate(() => AP_DEBUG.goIntro());
    await p.evaluate(() => { for (const id of ['btn-start', 'btn-select-next']) document.getElementById(id).click(); });
    const g = await p.evaluate(() => AP_DEBUG.snapshot().probe.gap);
    const fits = r.rect.x1 <= C.LOGICAL_WIDTH - C.KNIFE.STAGE_MARGIN + 0.01 && r.rect.y1 <= r.padTop + 0.01 && r.rect.y0 >= r.L.playTop - 0.01;
    ok(vp.join('×') + ': 칼 전체가 스테이지 안(오른쪽 ' + fmt(r.rect.x1, 0) + '/' + C.LOGICAL_WIDTH + ', 아래 ' + fmt(r.rect.y1, 0) + '/패드 ' + fmt(r.padTop, 0) + ') · 시작 간격 ' + fmt(g, 1) + ' · 시작 화면 CTA 화면 안(' + fmt(intro.ctaBottom, 0) + '/' + intro.ih + ') · 가로 스크롤 없음', fits && Math.abs(g - C.KNIFE.START_GAP) < 0.5 && intro.ctaBottom <= intro.ih && intro.sw <= intro.iw && o.errors.length === 0, { r, intro, g, errors: o.errors });
    if (SHOTS && (vp[0] === 320 || vp[0] === 430)) { await shot(p, '08-play-' + vp.join('x')); }
    await o.ctx.close();
  }

  await browser.close();
  console.log(failures === 0 ? '\n모든 검사 통과' : '\n실패 ' + failures + '건');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
