/* QA: 용과 외형 — 잎 돌기(원본 실측 11장 + 뒷면) · 깎으면 잎 제거 · 과육에만 보이는 검은 씨앗 · 회전 안정 · 결과 화면/저장 이미지의 씨앗.
 * 사용: node tools/qa-dragonfruit.js */
'use strict';
const { chromium } = require('C:/Users/thkim/Desktop/code-work/260624/build/node_modules/playwright-core');
const png = require('./png.js');
let failures = 0;
function ok(l, c, d) { if (c) console.log('  OK  ', l); else { failures++; console.log('  FAIL', l, d !== undefined ? JSON.stringify(d) : ''); } }
const URL = 'file:///C:/Users/thkim/Desktop/code-work/04_꼬직/261014_apple game/index.html';
const LAUNCH = { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] };

/* 장면 스냅샷(칼 제외)에서: 씨앗 화소 = 무채색의 어두운 점(밝기 < 75, 채도 낮음) · 과육 화소 = 밝은 크림 */
function analyze(buf) {
  const im = png.decode(buf), W = im.width, H = im.height, d = im.data;
  const seed = new Uint8Array(W * H), cream = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) { const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2]; if (Math.max(r, g, b) < 75 && Math.abs(r - b) < 30 && Math.abs(r - g) < 30) seed[i] = 1; else if (r > 175 && g > 150 && b > 130 && r - b < 70 && Math.abs(r - g) < 40 && !(r > 246 && g > 246 && b > 246)) cream[i] = 1; }
  let seeds = 0, onFlesh = 0, cr = 0;
  for (let i = 0; i < W * H; i++) { if (cream[i]) cr++; }
  // 씨앗 화소가 과육(크림) 화소 옆(반경 5px)에 있는지
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (seed[y * W + x]) { seeds++; let near = false; for (let dy = -5; dy <= 5 && !near; dy++) for (let dx = -5; dx <= 5; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H && cream[yy * W + xx]) { near = true; break; } } if (near) onFlesh++; }
  return { seeds, onFlesh, cream: cr, W, H };
}

(async () => {
  const b = await chromium.launch(LAUNCH);
  const p = await b.newPage({ viewport: { width: 430, height: 932 } });
  const errors = []; p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(URL); await p.waitForFunction(() => window.AP_READY === true, null, { timeout: 60000 });
  const begin = () => p.evaluate(() => { AP_DEBUG.setPaused(true); AP_DEBUG.goIntro(); AP_DEBUG.selectFruit('dragonfruit'); document.getElementById('btn-start').click(); document.getElementById('btn-select-next').click(); return AP_DEBUG.snapshot().state; });
  const snap = (deg) => p.evaluate((deg) => { AP_DEBUG.apple.setAngle(deg * Math.PI / 180); const S = AP_DEBUG.apple.surface, cx = AP.scene.appleCx, vs = AP_DEBUG.apple.viewScale, R = S.R + S.decorReach; const top = AP.scene.project(new THREE.Vector3(0, (S.topExtent + S.decorReach) * vs, 0)).y, bot = AP.scene.project(new THREE.Vector3(0, (S.bottomY - S.decorReach - S.capExtraBottom) * vs, 0)).y; return AP.scene.renderSnapshot(540, 540, { x0: cx - 160, x1: cx + 160, y0: (top + bot) / 2 - 160, y1: (top + bot) / 2 + 160 }, { bg: '#FFFFFF', hideOverlay: true }).toDataURL('image/png'); }, deg);
  const dec = (u) => Buffer.from(u.split(',')[1], 'base64');

  console.log('=== 1. 잎 돌기(원본 PNG 실측) ===');
  ok('용과 선택 시 정상 로딩 · READY', (await begin()) === 'ready');
  const L = await p.evaluate(() => { const A = AP.assets.fruits.dragonfruit, d = AP_DEBUG.apple.decor, P = AP.fruits.params('dragonfruit'); return { measured: A.leaves.length, built: d.items.length, front: d.items.filter((i) => i.tag === 'front').length, back: d.items.filter((i) => i.tag === 'back').length, stops: A.leafStops, colors: P.colors, ids: A.leaves.map((l) => l.id), lens: A.leaves.map((l) => Math.round(l.len)), wids: A.leaves.map((l) => l.wid), vis: d.items.filter((i) => i.mesh.visible).length, reach: AP_DEBUG.apple.surface.decorReach }; });
  ok('원본에서 실측한 잎 ' + L.measured + '장(길이 ' + Math.min.apply(null, L.lens) + '~' + Math.max.apply(null, L.lens) + 'px · 밑동 폭 ' + Math.min.apply(null, L.wids) + '~' + Math.max.apply(null, L.wids) + 'px) → 3D 앞면 ' + L.front + '장 + 뒷면 ' + L.back + '장(이전 가시 24개보다 적고 크다) · 시작 시 전부 보임(' + L.vis + ')', L.measured === 11 && L.front === 11 && L.back >= 3 && L.built < 24 && L.vis === L.built, L);
  ok('잎 색 단계는 원본 실측: 노랑 ' + L.stops.yellow + ' · 초록 ' + L.stops.green + ' (밑동은 껍질 분홍과 섞임)', L.stops.yellow[0] > 150 && L.stops.yellow[1] > 140 && L.stops.green[1] > L.stops.green[0] && L.stops.green[1] > L.stops.green[2] * 2, L.stops);

  console.log('=== 2. 깎으면 잎도 제거 · 과육 위에 잎이 남지 않음 ===');
  const prog = await p.evaluate(() => {
    const out = [], d = () => AP_DEBUG.apple.decor, S = () => AP_DEBUG.apple.surface;
    const check = () => { const dd = d(), SS = S(); let bad = 0, hidden = 0; dd.items.forEach((it) => { const anyPeeled = it.cells.some((c) => SS.state[c] !== 0); if (!it.mesh.visible) hidden++; if (it.mesh.visible && anyPeeled) bad++; if (!it.mesh.visible && !anyPeeled) bad++; }); return { visible: dd.items.length - hidden, hidden, bad, peel: AP_DEBUG.snapshot().peelPct }; };
    out.push(check());
    for (let k = 0; k < 4; k++) { AP_DEBUG.runAutopilot(k === 0 ? 4 : 5, { single: true, dur: 30, depthFrac: 0.6, pretilt: true }); out.push(check()); }
    return out;
  });
  ok('깎는 동안 매 시점: 보이는 잎은 밑동 표면 셀이 모두 껍질 상태 · 숨은 잎은 밑동 셀이 벗겨짐(불일치 ' + prog.map((x) => x.bad).join('/') + ') · 남은 잎 ' + prog.map((x) => x.visible).join(' → ') + ' · 제거율 ' + prog.map((x) => Math.round(x.peel)).join(' → ') + '%', prog.every((x) => x.bad === 0) && prog[prog.length - 1].visible < prog[0].visible && prog.every((x, i) => i === 0 || x.visible <= prog[i - 1].visible), prog);

  console.log('=== 3. 검은 씨앗: 흰 과육에만 · 껍질·잎에는 없음 · 회전해도 과육에 고정 ===');
  await begin();
  const whole = analyze(dec(await snap(0)));
  ok('껍질이 그대로인 용과(분홍 + 잎): 씨앗 화소 ' + whole.seeds + '개(0 에 가까움 ≤ 12) — 껍질·잎 위에 점 없음', whole.seeds <= 12, whole);
  await p.evaluate(() => { AP_DEBUG.runAutopilot(18, { single: true, dur: 30, depthFrac: 0.6, pretilt: true }); });
  const peeled0 = analyze(dec(await snap(0))), peeled90 = analyze(dec(await snap(90))), peeled360 = analyze(dec(await snap(360)));
  ok('깎은 뒤 앞면: 과육 화소 ' + peeled0.cream + '개 위에 씨앗 화소 ' + peeled0.seeds + '개(≥ 60) — 그중 과육 곁(5px 이내) ' + peeled0.onFlesh + '개(' + Math.round(100 * peeled0.onFlesh / Math.max(1, peeled0.seeds)) + '% ≥ 90%)', peeled0.seeds >= 60 && peeled0.onFlesh / peeled0.seeds >= 0.9, peeled0);
  ok('씨앗 밀도가 과하지 않음: 과육 화소 대비 씨앗 화소 ' + (100 * peeled0.seeds / Math.max(1, peeled0.cream)).toFixed(1) + '% (원본 PNG 1.3% · 허용 0.8~3%)', peeled0.seeds / peeled0.cream >= 0.008 && peeled0.seeds / peeled0.cream <= 0.03, peeled0);
  ok('회전해도 씨앗은 과육에 고정: 90° 에서도 씨앗 ' + peeled90.seeds + '개(과육 곁 ' + Math.round(100 * peeled90.onFlesh / Math.max(1, peeled90.seeds)) + '%) · 360° = 0° (씨앗 ' + peeled360.seeds + ' = ' + peeled0.seeds + ')', peeled90.seeds >= 40 && peeled90.onFlesh / peeled90.seeds >= 0.9 && Math.abs(peeled360.seeds - peeled0.seeds) <= 2, { peeled0, peeled90, peeled360 });

  console.log('=== 4. 결과 화면 · 저장 이미지에도 씨앗 ===');
  await p.evaluate(() => { AP_DEBUG.setPaused(false); });
  await p.click('#btn-start').catch(() => {});
  const res = await p.evaluate(() => { AP_DEBUG.setPaused(true); AP_DEBUG.goIntro(); AP_DEBUG.selectFruit('dragonfruit'); document.getElementById('btn-start').click(); document.getElementById('btn-select-next').click(); AP_DEBUG.runAutopilot(200, { single: true, dur: 30, depthFrac: 0.6, pretilt: true }); AP_DEBUG.setPaused(false); return AP_DEBUG.snapshot().state; });
  await p.waitForFunction(() => document.getElementById('screen-result').classList.contains('active'), null, { timeout: 10000 });
  const shown = await p.evaluate(() => {
    const cv = document.getElementById('result-canvas'), ctx = cv.getContext('2d'), d = ctx.getImageData(0, 0, cv.width, cv.height).data; let seeds = 0, cream = 0;
    for (let i = 0; i < d.length; i += 4) { const r = d[i], g = d[i + 1], b = d[i + 2]; if (Math.max(r, g, b) < 75 && Math.abs(r - b) < 30 && Math.abs(r - g) < 30) seeds++; else if (r > 175 && g > 150 && b > 130 && r - b < 70 && Math.abs(r - g) < 40 && !(r > 246 && g > 246 && b > 246)) cream++; }
    const im = AP.share.buildImage(AP_DEBUG.snapshot()), c2 = im.getContext('2d').getImageData(140, 520, 800, 900).data; let s2 = 0, cr2 = 0;
    for (let i = 0; i < c2.length; i += 4) { const r = c2[i], g = c2[i + 1], b = c2[i + 2]; if (Math.max(r, g, b) < 75 && Math.abs(r - b) < 30 && Math.abs(r - g) < 30) s2++; else if (r > 175 && g > 150 && b > 130 && r - b < 70 && Math.abs(r - g) < 40 && !(r > 246 && g > 246 && b > 246)) cr2++; }
    return { resultCanvas: [cv.width, cv.height, seeds, cream], share: [s2, cr2], title: document.getElementById('result-title').textContent };
  });
  ok('결과 화면(' + shown.title + ') 과일 이미지: 씨앗 화소 ' + shown.resultCanvas[2] + '개 · 과육 ' + shown.resultCanvas[3] + '개 / 저장 이미지(1080×1920): 씨앗 ' + shown.share[0] + '개 · 과육 ' + shown.share[1] + '개', shown.resultCanvas[2] >= 20 && shown.share[0] >= 60 && shown.share[1] > 3000, shown);

  ok('페이지 오류 없음(셰이더 컴파일 포함)', errors.length === 0, errors);
  await b.close(); console.log(failures === 0 ? '\n모든 검사 통과' : '\n실패 ' + failures + '건'); process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
