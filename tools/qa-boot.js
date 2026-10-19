/* QA: 첫 접속·새로고침 때 비정상적으로 큰 과일이 순간적으로 나타나지 않는다 — 브라우저가 그리는 모든 프레임(CDP 스크린캐스트)을 캡처해 분석한다.
 * 시나리오: 첫 접속 · 일반 새로고침(F5) · 강력 새로고침(캐시 끔) · 캐시 없는 최초 접속 · 모바일(터치·DPR3) 새로고침 · 느린 네트워크(http) · 다른 과일 선택 후 새로고침(?fruit=).
 * 판정(프레임마다, 마지막 정상 프레임 기준):
 *   1) 과일 색(빨강·분홍) 화소 수 ≤ 정상의 1.15배 — 큰 사과·유령(반투명) 사과가 없다
 *   2) 정상 프레임에는 없는 "과일색" 화소 ≤ 60 (위치·크기가 다른 과일이 잠깐 보이지 않는다)
 *   3) 과일이 처음 나타난 프레임의 크기·위치 = 최종 프레임과 같다(처음부터 정상 크기)
 * 사용: node tools/qa-boot.js */
'use strict';
const { chromium } = require('C:/Users/thkim/Desktop/code-work/260624/build/node_modules/playwright-core');
const png = require('./png.js');
const { spawn } = require('child_process');
const path = require('path');
let failures = 0;
function ok(l, c, d) { if (c) console.log('  OK  ', l); else { failures++; console.log('  FAIL', l, d !== undefined ? JSON.stringify(d) : ''); } }
const FILE = 'file:///C:/Users/thkim/Desktop/code-work/04_꼬직/261014_apple game/index.html';
const LAUNCH = { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] };

/* 과일(빨강~분홍~주황) 화소: 사과 본체·반투명 사과. 흰 배경·검정 글씨·회색 칼은 제외 */
function fruitMask(im) {
  const W = im.width, H = im.height, d = im.data, m = new Uint8Array(W * H);
  for (let i = 0, p = 0; i < W * H; i++, p += 4) { const r = d[p], g = d[p + 1], b = d[p + 2]; if (r > 190 && r - g > 28 && r - b > 28) m[i] = 1; }
  return m;
}
function stats(m, W, H) { let n = 0, x0 = W, x1 = -1, y0 = H, y1 = -1; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (m[y * W + x]) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return { n, x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 }; }

async function capture(page, ctx, action, readyMs) {
  const cdp = await ctx.newCDPSession(page);
  const frames = []; let commitTs = 0;
  /* 새 문서가 확정된 시각 이후의 프레임만 분석한다(그 전 프레임은 이전 문서 = 새로고침 전 화면) */
  cdp.on('Page.frameNavigated', (e) => { if (!e.frame.parentId) commitTs = Date.now() / 1000; });
  cdp.on('Page.screencastFrame', (e) => { frames.push({ ts: e.metadata.timestamp, buf: Buffer.from(e.data, 'base64') }); cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {}); });
  await cdp.send('Page.enable');
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  await action(cdp);
  await page.waitForFunction(() => window.AP_READY === true, null, { timeout: readyMs || 90000 });
  await page.waitForTimeout(900);
  await cdp.send('Page.stopScreencast');
  return frames.filter((f) => f.ts >= commitTs - 0.03).map((f) => f.buf);
}
function analyze(frames) {
  const ims = frames.map((b) => png.decode(b)), W = ims[0].width, H = ims[0].height;
  const masks = ims.map(fruitMask), last = masks[masks.length - 1], fin = stats(last, W, H);
  let maxN = 0, ghostMax = 0, firstAppear = -1, firstStats = null, dupFrames = 0;
  masks.forEach((m, i) => {
    const s = stats(m, W, H); if (s.n > maxN) maxN = s.n;
    let ghost = 0; for (let k = 0; k < m.length; k++) if (m[k] && !last[k]) ghost++;
    if (ghost > ghostMax) ghostMax = ghost;
    if (firstAppear < 0 && s.n > fin.n * 0.2) { firstAppear = i; firstStats = s; }
  });
  return { n: frames.length, W, H, fin, maxN, ghostMax, firstAppear, firstStats, ratio: maxN / Math.max(1, fin.n) };
}

(async () => {
  const b = await chromium.launch(LAUNCH);
  /* 느린 네트워크용 정적 서버 */
  const srv = spawn('node', [path.join(__dirname, 'serve.js'), '8097'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1200));
  const results = {};
  const check = (name, a) => {
    results[name] = a;
    const f = a.firstStats, d = a.fin;
    ok(name + ': 프레임 ' + a.n + '개 · 과일색 최대 ' + a.maxN + ' / 정상 ' + d.n + '(' + a.ratio.toFixed(2) + '배 ≤ 1.15) · 정상에 없는 과일색 최대 ' + a.ghostMax + 'px ≤ 60 · 첫 등장 프레임 크기 ' + (f ? f.w + '×' + f.h : '-') + ' = 최종 ' + d.w + '×' + d.h + ' 위치 (' + (f ? f.x0 + ',' + f.y0 : '-') + ') = (' + d.x0 + ',' + d.y0 + ')',
      a.ratio <= 1.15 && a.ghostMax <= 60 && !!f && Math.abs(f.w - d.w) <= 2 && Math.abs(f.h - d.h) <= 2 && Math.abs(f.x0 - d.x0) <= 2 && Math.abs(f.y0 - d.y0) <= 2, a);
  };

  console.log('=== 1. 첫 페이지 접속 (캐시 없는 새 브라우저 컨텍스트) ===');
  {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 } }), p = await ctx.newPage();
    check('첫 접속', analyze(await capture(p, ctx, () => p.goto(FILE, { waitUntil: 'commit' }))));
    console.log('=== 2. 일반 새로고침(F5) ===');
    check('F5', analyze(await capture(p, ctx, () => p.reload({ waitUntil: 'commit' }))));
    console.log('=== 3. 강력 새로고침(Ctrl+Shift+R = 캐시 무시) ===');
    check('Ctrl+Shift+R', analyze(await capture(p, ctx, async (cdp) => { await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true }); await p.reload({ waitUntil: 'commit' }); })));
    await ctx.close();
  }
  console.log('=== 4. 캐시가 없는 상태의 최초 접속(캐시 비활성) ===');
  {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 } }), p = await ctx.newPage();
    check('캐시 없는 최초', analyze(await capture(p, ctx, async (cdp) => { await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true }); await p.goto(FILE, { waitUntil: 'commit' }); })));
    await ctx.close();
  }
  console.log('=== 5. 모바일 브라우저(터치 · DPR 3 · CPU 4배 느리게)에서 새로고침 ===');
  {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }), p = await ctx.newPage();
    await p.goto(FILE); await p.waitForFunction(() => window.AP_READY === true, null, { timeout: 90000 });
    const cdp0 = await ctx.newCDPSession(p); await cdp0.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    check('모바일 새로고침', analyze(await capture(p, ctx, () => p.reload({ waitUntil: 'commit' }))));
    await ctx.close();
  }
  console.log('=== 6. 느린 네트워크(http · 지연 300ms · 대역폭 약 300KB/s) ===');
  {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 } }), p = await ctx.newPage();
    check('느린 네트워크', analyze(await capture(p, ctx, async (cdp) => {
      await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 300, downloadThroughput: 300 * 1024, uploadThroughput: 300 * 1024 });
      await p.goto('http://127.0.0.1:8097/index.html', { waitUntil: 'commit' });
    }, 120000)));
    await ctx.close();
  }
  console.log('=== 7. 다른 과일을 선택한 뒤 새로고침 ===');
  {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 } }), p = await ctx.newPage();
    await p.goto(FILE); await p.waitForFunction(() => window.AP_READY === true, null, { timeout: 90000 });
    await p.click('#btn-start'); await p.click('.fruit-cell[data-fruit="kiwi"]');
    /* 선택은 저장되지 않으므로 새로고침 = 새 로드. 이전 문서의 마지막 프레임이 섞이지 않도록 빈 문서를 거쳐 캡처한다 */
    await p.goto('about:blank'); await p.waitForTimeout(300);
    check('키위 선택 후 새로고침', analyze(await capture(p, ctx, () => p.goto(FILE, { waitUntil: 'commit' }))));
    await p.goto('about:blank'); await p.waitForTimeout(300);
    check('공유 링크(?fruit=pear) 새로고침', analyze(await capture(p, ctx, () => p.goto(FILE + '?fruit=pear', { waitUntil: 'commit' }))));
    const sel = await p.evaluate(() => ({ fruit: AP_DEBUG.selectedFruit(), mesh: AP_DEBUG.apple.fruitId }));
    ok('공유 링크로 열면 처음부터 그 과일(' + sel.fruit + ')로 한 번만 그림 — 사과가 먼저 나왔다가 바뀌지 않음', sel.fruit === 'pear' && sel.mesh === 'pear', sel);
    await ctx.close();
  }
  console.log('=== 8. 화면 전환: 애니메이션 없음 · 3D 스테이지는 메인/선택/결과에서 숨김, 플레이에서만 보임 ===');
  {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 } }), p = await ctx.newPage();
    await p.goto(FILE); await p.waitForFunction(() => window.AP_READY === true, null, { timeout: 90000 });
    const probe = () => p.evaluate(() => ({ anims: document.getAnimations().length, stage: getComputedStyle(document.getElementById('stage')).visibility, op: Array.from(document.querySelectorAll('.screen.active')).map((e) => getComputedStyle(e).opacity + '/' + getComputedStyle(e).transform) }));
    const intro = await probe();
    await p.click('#btn-start'); const sel = await probe();
    await p.click('#btn-select-next'); const play = await probe();
    await p.evaluate(() => { AP_DEBUG.setLegacy(true); AP_DEBUG.setPaused(true); AP_DEBUG.goIntro(); AP_DEBUG.start(); AP_DEBUG.finish('qa'); AP_DEBUG.setPaused(false); });
    await p.waitForFunction(() => document.getElementById('screen-result').classList.contains('active'), null, { timeout: 8000 });
    const res = await probe();
    ok('메인 · 선택 · 플레이 · 결과: 전환 직후에도 애니메이션 0개 · 화면 opacity 1 · transform 없음(' + [intro, sel, res].map((x) => x.op.join(',')).join(' | ') + ')', [intro, sel, play, res].every((x) => x.anims === 0) && [intro, sel, res].every((x) => x.op.every((o) => o === '1/none')), { intro, sel, play, res });
    ok('3D 스테이지: 메인 ' + intro.stage + ' · 선택 ' + sel.stage + ' · 플레이 ' + play.stage + ' · 결과 ' + res.stage + ' (화면이 켜져 있으면 숨김, 플레이에서만 보임)', intro.stage === 'hidden' && sel.stage === 'hidden' && play.stage === 'visible' && res.stage === 'hidden', { intro, sel, play, res });
    await ctx.close();
  }
  srv.kill(); await b.close();
  console.log(failures === 0 ? '\n모든 검사 통과' : '\n실패 ' + failures + '건'); process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
