/* 용과: 원본 PNG(dragonfruit_unpeeled.png)와 게임 속 3D 용과를 같은 크기·같은 좌표계로 나란히 비교하는 이미지를 만든다.
 *  1행: 원본 | 게임(앞면, 회전 0°) | 실루엣 차이(회색 = 겹침, 빨강 = 원본에만, 파랑 = 게임에만)
 *  2행: 게임을 90° · 180° · 270° 회전한 모습(회전해도 형태가 유지되는지)
 *  3행: 깎은 뒤(껍질·잎이 벗겨지고 흰 과육 + 검은 씨앗) 앞면 · 90° · 180°
 * 같은 좌표계: PNG 의 몸통 축·몸통 위 끝이 게임 화면의 몸통 축·위 끝과 같은 곳에 오도록 렌더 사각형을 잡고, 가로 배율은 PNG px = 월드 k.
 * 사용: node tools/compare-dragonfruit.js [출력.png]   (기본 screenshot/dragonfruit_compare.png) */
'use strict';
const { chromium } = require('C:/Users/thkim/Desktop/code-work/260624/build/node_modules/playwright-core');
const fs = require('fs');
const path = require('path');
const png = require('./png.js');
const OUT = process.argv[2] || path.join(__dirname, '..', 'screenshot', 'dragonfruit_compare.png');
const URL = 'file:///C:/Users/thkim/Desktop/code-work/04_꼬직/261014_apple game/index.html';
const LAUNCH = { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] };

(async () => {
  const b = await chromium.launch(LAUNCH);
  const p = await b.newPage({ viewport: { width: 430, height: 932 } });
  await p.goto(URL); await p.waitForFunction(() => window.AP_READY === true, null, { timeout: 60000 });
  const shots = await p.evaluate(() => {
    AP_DEBUG.setPaused(true); AP_DEBUG.goIntro(); AP_DEBUG.selectFruit('dragonfruit'); document.getElementById('btn-start').click(); document.getElementById('btn-select-next').click();
    const A = AP.assets.fruits.dragonfruit, k = AP_DEBUG.apple.surface.k, S = AP_DEBUG.apple.surface, cx = AP.scene.appleCx;
    const midRowY = S.yOfDy(A.bodyHeightPx / 2) * AP_DEBUG.apple.viewScale;                       // PNG 몸통 중간 행의 월드 y
    const cyStage = AP.scene.project(new THREE.Vector3(0, midRowY, 0)).y;
    const half = 540 * k;                                                                          // 1080px(PNG) 정사각형이 덮는 스테이지 폭/높이의 절반
    const rect = { x0: cx - (1080 - 0) / 2 * k + (540 - A.axisX) * k * 0 - (A.axisX - 540) * k, x1: 0, y0: cyStage - half, y1: cyStage + half };
    rect.x0 = cx - A.axisX * k; rect.x1 = rect.x0 + 1080 * k;                                    // PNG 의 몸통 축(axisX)이 게임의 몸통 축(cx)에 오도록
    rect.y0 = cyStage - (A.bodyTop + A.bodyHeightPx / 2) * k; rect.y1 = rect.y0 + 1080 * k;      // PNG 몸통 중간 행이 게임의 같은 행에 오도록
    const snap = (deg) => { AP_DEBUG.apple.setAngle(deg * Math.PI / 180); return AP.scene.renderSnapshot(1080, 1080, rect, { bg: '#FFFFFF', hideOverlay: true }).toDataURL('image/png'); };
    const out = { vs: AP_DEBUG.apple.viewScale, k: k, leaves: AP_DEBUG.apple.decor ? AP_DEBUG.apple.decor.items.length : 0, whole: [0, 90, 180, 270].map(snap) };
    AP_DEBUG.runAutopilot(16, { single: true, dur: 30, depthFrac: 0.6, pretilt: true });
    out.peeled = [0, 90, 180].map(snap); out.leavesAfter = AP_DEBUG.apple.decor.items.filter((i) => i.mesh.visible).length;
    return out;
  });
  const dec = (u) => png.decode(Buffer.from(u.split(',')[1], 'base64'));
  const orig = png.decode(fs.readFileSync(path.join(__dirname, '..', 'assets', 'dragonfruit_unpeeled.png')));
  const g0 = dec(shots.whole[0]);
  /* 실루엣 비교: 원본 알파 > 128 vs 게임(흰 배경이 아닌 화소) */
  let both = 0, onlyO = 0, onlyG = 0; const diff = new Uint8ClampedArray(1080 * 1080 * 4);
  for (let i = 0; i < 1080 * 1080; i++) {
    const o = orig.data[i * 4 + 3] > 128, gp = g0.data[i * 4] < 245 || g0.data[i * 4 + 1] < 245 || g0.data[i * 4 + 2] < 245;
    let c = [255, 255, 255];
    if (o && gp) { both++; c = [205, 205, 205]; } else if (o) { onlyO++; c = [230, 60, 60]; } else if (gp) { onlyG++; c = [60, 90, 230]; }
    diff[i * 4] = c[0]; diff[i * 4 + 1] = c[1]; diff[i * 4 + 2] = c[2]; diff[i * 4 + 3] = 255;
  }
  const iou = both / (both + onlyO + onlyG);
  const bbox = (test) => { let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1; for (let y = 0; y < 1080; y++) for (let x = 0; x < 1080; x++) if (test(y * 1080 + x)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return { w: x1 - x0 + 1, h: y1 - y0 + 1, x0, y0 }; };
  const bO = bbox((i) => orig.data[i * 4 + 3] > 128), bG = bbox((i) => g0.data[i * 4] < 245 || g0.data[i * 4 + 1] < 245 || g0.data[i * 4 + 2] < 245);
  console.log('전체 실루엣 일치율(IoU) ' + (iou * 100).toFixed(1) + '% · 겹침 ' + both + ' · 원본에만 ' + onlyO + ' · 게임에만 ' + onlyG);
  console.log('외곽 bbox 원본 ' + bO.w + '×' + bO.h + ' @(' + bO.x0 + ',' + bO.y0 + ') / 게임 ' + bG.w + '×' + bG.h + ' @(' + bG.x0 + ',' + bG.y0 + ')');
  console.log('잎 ' + shots.leaves + '장(앞면 11 + 뒷면 일부) · 깎은 뒤 남은 잎 ' + shots.leavesAfter + '장 · viewScale ' + shots.vs.toFixed(3));

  /* 합성 이미지 */
  const q = await b.newPage({ viewport: { width: 1700, height: 1450 } });
  const origUrl = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, '..', 'assets', 'dragonfruit_unpeeled.png')).toString('base64');
  const diffB64 = await q.evaluate(async (d) => { const c = document.createElement('canvas'); c.width = 1080; c.height = 1080; const x = c.getContext('2d'); x.putImageData(new ImageData(new Uint8ClampedArray(d), 1080, 1080), 0, 0); return c.toDataURL('image/png'); }, Array.from(diff));
  const cell = (u, t) => '<div style="margin:6px"><div style="font:600 15px sans-serif;margin-bottom:4px">' + t + '</div><img src="' + u + '" style="width:540px;height:540px;border:1px solid #888;background:#fff"></div>';
  const rowS = (items) => '<div style="display:flex">' + items.join('') + '</div>';
  const html = '<body style="margin:8px;background:#e8e8e8;font-family:sans-serif"><div style="font:700 18px sans-serif;margin:6px">용과 — 원본 PNG vs 게임 3D (같은 크기 1080×1080, 같은 좌표계) · 실루엣 일치율 ' + (iou * 100).toFixed(1) + '%</div>' +
    rowS([cell(origUrl, '원본 dragonfruit_unpeeled.png'), cell(shots.whole[0], '게임 · 앞면(회전 0°)'), cell('data:image/png;base64,' + diffB64.split(',')[1], '실루엣 차이(회색 겹침 · 빨강 원본에만 · 파랑 게임에만)')]) +
    '<div style="font:700 16px sans-serif;margin:10px 6px 0">회전해도 형태 유지(90° · 180° · 270°)</div>' +
    rowS([cell(shots.whole[1], '게임 · 90°'), cell(shots.whole[2], '게임 · 180°'), cell(shots.whole[3], '게임 · 270°')]) +
    '<div style="font:700 16px sans-serif;margin:10px 6px 0">깎은 뒤 — 껍질과 잎이 사라진 자리에 흰 과육 + 검은 씨앗(0° · 90° · 180°)</div>' +
    rowS([cell(shots.peeled[0], '깎은 뒤 · 0°'), cell(shots.peeled[1], '깎은 뒤 · 90°'), cell(shots.peeled[2], '깎은 뒤 · 180°')]) + '</body>';
  /* 잎 확대 비교(원본 | 게임): 같은 영역을 잘라 2배로 */
  const crop = (u, bx) => '<div style="width:' + bx[2] * 1.6 + 'px;height:' + bx[3] * 1.6 + 'px;overflow:hidden;border:1px solid #888;position:relative;background:#fff;margin:4px"><img src="' + u + '" style="position:absolute;left:' + (-bx[0] * 1.6) + 'px;top:' + (-bx[1] * 1.6) + 'px;width:' + 1080 * 1.6 + 'px"></div>';
  const BX = [['중앙 오른쪽 큰 잎', [560, 380, 320, 300]], ['맨 위 잎', [480, 90, 260, 200]], ['아래 중앙 큰 잎', [420, 660, 300, 220]]];
  const zoom = '<div style="font:700 16px sans-serif;margin:10px 6px 0">잎 확대 비교(위 원본 · 아래 게임)</div><div style="display:flex">' + BX.map((b2) => '<div style="margin:4px"><div style="font:600 13px sans-serif">' + b2[0] + '</div>' + crop(origUrl, b2[1]) + crop(shots.whole[0], b2[1]) + '</div>').join('') + '</div>';
  await q.setContent(html.replace('</body>', zoom + '</body>')); await q.waitForTimeout(500);
  await q.screenshot({ path: OUT, fullPage: true });
  console.log('저장: ' + OUT);
  await b.close();
})().catch((e) => { console.error(e); process.exit(2); });
