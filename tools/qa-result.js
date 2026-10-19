/* QA: Q/W 각도 키 · 결과 화면 문구/경계값/레이아웃 · PNG 저장 · 친구 도전장 공유/복사 · 다시 깎기 초기화.
 * 공개 URL 은 설정되지 않았으므로(config.SHARE.URL 빈 값) 공유 경로 테스트는 자리표시 URL 을 임시로 주입한다(제품 값 아님).
 * 사용: node tools/qa-result.js [--shots <dir>] */
'use strict';
const path = require('path'); const fs = require('fs');
const png = require('./png.js');
const { chromium } = require('C:/Users/thkim/Desktop/code-work/260624/build/node_modules/playwright-core');
const si = process.argv.indexOf('--shots'); const SHOTS = si >= 0 ? process.argv[si + 1] : null; if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
let failures = 0;
function ok(l, c, d) { if (c) console.log('  OK  ', l); else { failures++; console.log('  FAIL', l, d !== undefined ? JSON.stringify(d) : ''); } }
const URL = 'file:///C:/Users/thkim/Desktop/code-work/04_꼬직/261014_apple game/index.html';
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL); await page.waitForFunction(() => window.AP_READY === true, null, { timeout: 60000 }); await page.evaluate(() => AP_DEBUG.setLegacy(true));   /* 기계 동작 테스트: 호환 모드를 명시(제품 기본은 실제 규칙) */
  await page.evaluate(() => AP_DEBUG.setPaused(true));
  const snap = () => page.evaluate(() => AP_DEBUG.snapshot());
  const step = (dt) => page.evaluate((dt) => AP_DEBUG.step(dt), dt);

  console.log('=== 1. 키: Q 반시계 · W 시계 · E 무반응 · 방향키 동시 ===');
  await page.evaluate(() => { AP_DEBUG.goIntro(); AP_DEBUG.start(); }); await step(0);
  await page.keyboard.down('KeyQ'); await page.evaluate(() => AP_DEBUG.run(0.4, 60)); await page.keyboard.up('KeyQ'); let s = await step(1 / 60);
  const aQ = s.knife.angleDeg; ok('Q: 반시계(각도 감소 ' + aQ.toFixed(1) + '°) · 떼면 즉시 정지(vrot 0)', aQ < -10 && s.knife.vrot === 0, aQ);
  await page.keyboard.down('KeyW'); await page.evaluate(() => AP_DEBUG.run(0.6, 60)); await page.keyboard.up('KeyW'); s = await step(1 / 60);
  const aW = s.knife.angleDeg; ok('W: 시계(각도 증가 ' + aQ.toFixed(1) + '° → ' + aW.toFixed(1) + '°)', aW > aQ + 10 && s.knife.vrot === 0, aW);
  await page.keyboard.down('KeyE'); await page.evaluate(() => AP_DEBUG.run(0.5, 60)); await page.keyboard.up('KeyE'); s = await step(1 / 60);
  ok('E: 각도 변화 없음(' + aW.toFixed(1) + '° → ' + s.knife.angleDeg.toFixed(1) + '°)', Math.abs(s.knife.angleDeg - aW) < 1e-9, s.knife.angleDeg);
  const x0 = s.knife.px, y0 = s.knife.py;
  await page.keyboard.down('ArrowDown'); await page.keyboard.down('KeyQ'); await page.evaluate(() => AP_DEBUG.run(0.3, 60)); await page.keyboard.up('ArrowDown'); await page.keyboard.up('KeyQ'); s = await step(1 / 60);
  ok('방향키(↓) + Q 동시: 이동 ' + (s.knife.py - y0).toFixed(1) + 'px · 회전 ' + (s.knife.angleDeg - aW).toFixed(1) + '°', s.knife.py > y0 + 5 && s.knife.angleDeg < aW - 5, s.knife);
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8') + fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8') + fs.readFileSync(path.join(__dirname, '..', 'src', 'game', 'input.js'), 'utf8');
  ok('코드/화면에 Q/E 안내 없음 · 모바일 안내 문구 = "방향 버튼으로 이동 · 회전 버튼으로 각도 조절 · 칼을 떼면 끝!"', !/Q\/E|Q E |\(E\)|KeyE/.test(html.replace(/기울기\(Q\/W\)/g, '')) && (await page.evaluate(() => document.getElementById('hint').textContent)) === '방향 버튼으로 이동 · 회전 버튼으로 각도 조절 · 칼을 떼면 끝!');

  console.log('=== 2. 평가 문구 · 경계값 ===');
  const g = await page.evaluate(() => { const out = {}; for (const n of [100, 80, 79, 72, 71, 55, 54, 35, 34, 0]) { out[n] = [n, AP.score.gradeOf(n)]; } return out; });
  const want = { 100: '사과 깎기 국가대표', 80: '사과 깎기 국가대표', 79: '아까 조금만 잘했어도 80점인데', 72: '아까 조금만 잘했어도 80점인데', 71: '제법 깎음. (시집가라는 건 ❌)', 55: '제법 깎음. (시집가라는 건 ❌)', 54: ['이거보다 잘할 수 있잖아요', '웃기려고 그런거죠?'], 35: ['이거보다 잘할 수 있잖아요', '웃기려고 그런거죠?'], 34: '내 사과가 죽었어', 0: '내 사과가 죽었어' };
  for (const n of Object.keys(want)) { const w = want[n], okk = g[n][0] === +n && (Array.isArray(w) ? w.includes(g[n][1]) : g[n][1] === w); ok(n + '점 → ' + (Array.isArray(w) ? '둘 중 하나(랜덤) "' + w.join('" / "') + '"' : '"' + w + '"'), okk, g[n]); }

  console.log('=== 3. 결과 화면 구성 · 레이아웃 · 이미지 ===');
  async function playTo(opts) { return page.evaluate((o) => { AP_DEBUG.goIntro(); AP_DEBUG.start(); AP_DEBUG.runAutopilot(59.0, o); AP_DEBUG.finish('button'); AP_DEBUG.run(1.0, 60); return AP_DEBUG.snapshot(); }, opts); }
  const good = await playTo({ dur: 40, depthFrac: 0.6 }); await page.waitForTimeout(200);
  const R = await page.evaluate(() => { const q = (id) => document.getElementById(id); const r = (el) => { const b = el.getBoundingClientRect(); return [b.top, b.bottom, b.left, b.right]; }; return { title: q('result-title').textContent, score: q('result-score').textContent, grade: q('result-grade').textContent, detail: q('result-detail').textContent, mark: document.querySelector('.result-mark').textContent, btns: ['btn-save', 'btn-challenge', 'btn-restart'].map((id) => [q(id).textContent, ...r(q(id))]), vis: r(q('result-canvas')), ih: window.innerHeight, iw: window.innerWidth, sw: document.scrollingElement.scrollWidth, mk: r(document.querySelector('.result-mark')) }; });
  ok('구성: 제목 "' + R.title + '" · 점수 "' + R.score + '" · 문구 "' + R.grade + '" · ' + R.detail + ' · ' + R.mark, R.title === '사과 깎기 완료!' && R.score === good.score.total + '점' && R.grade === good.score.grade && /껍질 제거 \d+% · 과육 손실 [\d.]+% · 최장 껍질 \d+cm/.test(R.detail) && R.mark === '@ccojik.dh', R);
  ok('버튼 구성: 주요 CTA(도전장) 아래에 [저장][다시 깎기] 나란히 — ' + R.btns.map((b) => b[0]).join(' / '), R.btns.map((b) => b[0]).join('|') === '내 사과 저장|친구에게 도전장 보내기|다시 깎기' && R.btns[0][1] > R.btns[1][2] && Math.abs(R.btns[0][1] - R.btns[2][1]) < 0.5);
  const overlap = R.btns.some((a, i) => R.btns.some((b, j) => j > i && a[1] < b[2] && b[1] < a[2] && a[3] < b[4] && b[3] < a[4]));   // 2차원 교차(저장·다시 깎기는 같은 줄에 나란히)
  ok('390×844: 버튼 겹침 없음 · 화면 안(마지막 하단 ' + R.mk[1].toFixed(0) + '/' + R.ih + ') · 가로 스크롤 없음', !overlap && R.mk[1] <= R.ih && R.sw <= R.iw, R);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'res-390.png') });
  const img = await page.evaluate((o) => { const cv = AP.share.buildImage(AP_DEBUG.snapshot()); const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let appleRed = 0, appleCream = 0, dark = 0; for (let y = 560; y < 1360; y += 2) for (let x = 100; x < 980; x += 2) { const i = (y * cv.width + x) * 4; if (d[i] > d[i + 1] * 1.9 && d[i] > d[i + 2] * 1.9 && d[i] > 120) appleRed++; else if (d[i] > 200 && d[i + 1] > 170 && d[i + 2] < d[i] - 25 && d[i + 2] > 100) appleCream++; } for (let y = 1440; y < 1760; y += 2) for (let x = 100; x < 980; x += 2) { const i = (y * cv.width + x) * 4; if (d[i] < 100) dark++; } return { w: cv.width, h: cv.height, appleRed, appleCream, dark, url: cv.toDataURL('image/png') }; });
  ok('저장 이미지 1080×1920 · 실제 깎은 사과(과육 크림 ' + img.appleCream + ' / 남은 껍질 빨강 ' + img.appleRed + ' 화소) · 통계 글자 있음', img.w === 1080 && img.h === 1920 && img.appleCream > 20000 && img.dark > 500, img);
  if (SHOTS) fs.writeFileSync(path.join(SHOTS, 'res-image-good.png'), Buffer.from(img.url.split(',')[1], 'base64'));
  const bad = await playTo({ dur: 40, depthFrac: 2.2 });
  const imgBad = await page.evaluate(() => { const cv = AP.share.buildImage(AP_DEBUG.snapshot()); return cv.toDataURL('image/png'); });
  if (SHOTS) fs.writeFileSync(path.join(SHOTS, 'res-image-bad.png'), Buffer.from(imgBad.split(',')[1], 'base64'));
  const dG = png.decode(Buffer.from(img.url.split(',')[1], 'base64')), dB = png.decode(Buffer.from(imgBad.split(',')[1], 'base64'));
  const widthAt = (im, y) => { let l = -1, r = -1; for (let x = 0; x < im.width; x++) { const i = (y * im.width + x) * 4; if (im.data[i] < 235 || im.data[i + 1] < 235 || im.data[i + 2] < 235) { if (l < 0) l = x; r = x; } } return r - l; };
  ok('플레이 결과 반영: 깊게 깎은 사과는 점수 ' + bad.score.total + '점(좋은 플레이 ' + good.score.total + '점)이고 이미지의 사과 몸통 폭이 더 좁음(' + widthAt(dB, 960) + 'px < ' + widthAt(dG, 960) + 'px)', bad.score.total < good.score.total && widthAt(dB, 960) < widthAt(dG, 960) - 20, { g: widthAt(dG, 960), b: widthAt(dB, 960) });

  console.log('=== 4. 내 사과 저장: 다운로드 · 공유 시트 · 실패 안내 ===');
  await playTo({ dur: 40, depthFrac: 0.6 }); await page.waitForTimeout(150);
  await page.evaluate(() => { window.__dl = null; HTMLAnchorElement.prototype.click = function () { window.__dl = { name: this.download, href: this.href.slice(0, 5) }; }; });
  const r1 = await page.evaluate(() => { navigator.canShare = () => false; return AP.share.save(); });
  const dl = await page.evaluate(() => window.__dl);
  ok('다운로드 경로: 결과 "' + r1 + '" · 파일명 ' + (dl && dl.name) + ' · blob URL · 토스트 표시', r1 === 'saved' && dl && dl.name === 'ccojik-apple-result.png' && dl.href === 'blob:' && (await page.evaluate(() => !document.getElementById('toast').hidden)), { r1, dl });
  const r2 = await page.evaluate(async () => { window.__shared = null; navigator.canShare = () => true; navigator.share = (d) => { window.__shared = { n: d.files && d.files[0].name, type: d.files && d.files[0].type, size: d.files && d.files[0].size }; return Promise.resolve(); }; return AP.share.save(); });
  const sh = await page.evaluate(() => window.__shared);
  ok('터치 기기 파일 공유 경로: 결과 "' + r2 + '" · ' + JSON.stringify(sh), r2 === 'shared' && sh && sh.n === 'ccojik-apple-result.png' && sh.type === 'image/png' && sh.size > 20000, sh);
  const r3 = await page.evaluate(async () => { navigator.share = () => Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' })); return AP.share.save(); });
  ok('공유 취소: 오류 없이 복귀("' + r3 + '")', r3 === 'cancelled');
  await page.evaluate(() => { HTMLCanvasElement.prototype.toBlob = function (cb) { cb(null); }; });
  const r4 = await page.evaluate(() => AP.share.save().then(() => 'ok', () => 'rejected'));
  ok('이미지 생성 실패: 오류 토스트 표시("' + (await page.evaluate(() => document.getElementById('toast').textContent)) + '")', r4 === 'rejected' && /만들지 못했어요/.test(await page.evaluate(() => document.getElementById('toast').textContent)));

  console.log('=== 5. 친구에게 도전장 보내기 ===');
  await page.reload(); await page.waitForFunction(() => window.AP_READY === true, null, { timeout: 60000 }); await page.evaluate(() => AP_DEBUG.setLegacy(true));   /* 기계 동작 테스트: 호환 모드를 명시(제품 기본은 실제 규칙) */
  await page.evaluate(() => AP_DEBUG.setPaused(true));
  const sc = await playTo({ dur: 40, depthFrac: 0.6 }); await page.waitForTimeout(150);
  await page.evaluate(() => { AP.CONFIG.SHARE.URL = ''; AP.share.refresh(); });      // 배포 주소가 설정된 제품 기본값과 별개로, 미설정 상태의 안전장치(버튼 비활성)를 검증
  const off = await page.evaluate(() => ({ disabled: document.getElementById('btn-challenge').disabled, note: document.getElementById('challenge-note').textContent, hidden: document.getElementById('challenge-note').hidden, url: AP.CONFIG.SHARE.URL }));
  ok('공개 URL 미설정(' + JSON.stringify(off.url) + '): 버튼 비활성 + "' + off.note + '" 표시(임의 주소 없음)', off.disabled && !off.hidden && off.url === '' && /테스트 상태/.test(off.note), off);
  await page.evaluate(() => { AP.CONFIG.SHARE.URL = 'https://example.test/apple/'; AP.share.refresh(); });
  ok('URL 설정 시 버튼 활성', !(await page.evaluate(() => document.getElementById('btn-challenge').disabled)));
  const r5 = await page.evaluate(async () => { window.__s = null; navigator.share = (d) => { window.__s = d; return Promise.resolve(); }; return AP.share.challenge(); });
  const sd = await page.evaluate(() => window.__s);
  ok('Web Share(터치): 제목·본문(점수 ' + sc.score.total + ')·URL 정확', r5 === 'shared' && sd.title === '나보다 잘 깎을 수 있어?' && sd.text === '나는 한 번에 깎으세요 [사과]에서 ' + sc.score.total + '점 나왔어.\n너는 몇 점 나올지 궁금한데?' && sd.url === 'https://example.test/apple/?fruit=apple', sd);
  const r6 = await page.evaluate(async () => { navigator.share = () => Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' })); return AP.share.challenge(); });
  ok('공유 취소: 오류 없이 복귀("' + r6 + '")', r6 === 'cancelled');
  const r7 = await page.evaluate(async () => { navigator.share = undefined; window.__c = null; Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t) => { window.__c = t; return Promise.resolve(); } }, configurable: true }); return AP.share.challenge(); });
  const cp = await page.evaluate(() => ({ c: window.__c, t: document.getElementById('toast').textContent }));
  ok('Web Share 미지원: 클립보드에 문구+링크 복사 · 토스트 "' + cp.t + '"', r7 === 'copied' && cp.c.includes('나보다 잘 깎을 수 있어?') && cp.c.includes(sc.score.total + '점') && cp.c.includes('https://example.test/apple/?fruit=apple') && cp.t === '도전장 링크가 복사됐어요!', cp);
  const r8 = await page.evaluate(async () => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) }, configurable: true }); return AP.share.challenge(); });
  ok('복사 실패: 오류 없이 안내 토스트("' + r8 + '")', r8 === 'failed');
  ok('공유 링크 = 게임 루트 주소 → 시작 화면(intro)이 첫 화면', (await page.evaluate(() => { AP_DEBUG.goIntro(); return document.getElementById('screen-intro').classList.contains('active'); })));

  console.log('=== 6. 다시 깎기 초기화 ===');
  await playTo({ dur: 40, depthFrac: 0.6 }); await page.evaluate(() => AP_DEBUG.setKnifeAngleDeg(20)); await page.waitForTimeout(100);
  await page.click('#btn-restart'); s = await step(0);
  const st = await page.evaluate(() => AP_DEBUG.cellStats());
  ok('다시 깎기: ready · 점수 0 · 제거/손실 0 · 리본·기록·떨어지는 리본 0 · 칼 각도 0 · 결과 화면 닫힘', s.state === 'ready' && s.score.total === 0 && st.peeled === 0 && st.flesh === 0 && s.ribbon.curPx === 0 && s.ribbon.longestPx === 0 && s.ribbon.falling === 0 && s.knife.angleDeg === 0 && !(await page.evaluate(() => document.getElementById('screen-result').classList.contains('active'))), { state: s.state, st, ribbon: s.ribbon });

  console.log('=== 7. 320×568 레이아웃 ===');
  const p2 = await browser.newPage({ viewport: { width: 320, height: 568 } });
  await p2.goto(URL); await p2.waitForFunction(() => window.AP_READY === true, null, { timeout: 60000 }); await p2.evaluate(() => AP_DEBUG.setLegacy(true));   /* 기계 동작 테스트: 호환 모드를 명시(제품 기본은 실제 규칙) */
  await p2.evaluate(() => { AP_DEBUG.setPaused(true); AP_DEBUG.start(); AP_DEBUG.runAutopilot(59.0, { dur: 40, depthFrac: 0.6 }); AP_DEBUG.finish('button'); AP_DEBUG.run(1.0, 60); }); await p2.waitForTimeout(200);
  const L = await p2.evaluate(() => { const r = (id) => document.getElementById(id).getBoundingClientRect(); const sc = document.getElementById('screen-result'); const scrollable = sc.scrollHeight > sc.clientHeight + 1; sc.scrollTop = sc.scrollHeight; const m = document.querySelector('.result-mark').getBoundingClientRect(); const mk = m.bottom; sc.scrollTop = 0; return { top: r('result-title').top, mark: mk, ih: window.innerHeight, scrollable, ids: ['btn-save', 'btn-challenge', 'btn-restart'].map((id) => { const q = r(id); return [q.top, q.bottom, q.left, q.right]; }), sw: document.scrollingElement.scrollWidth, iw: window.innerWidth }; });
  ok('320×568: 내용이 화면보다 길어 ' + (L.scrollable ? '세로 스크롤(압축하지 않음)' : '스크롤 없음') + ' — 끝까지 내리면 @ccojik.dh 까지 보임(하단 ' + L.mark.toFixed(0) + '/' + L.ih + ') · 버튼 안 겹침 · 가로 스크롤 없음', L.top >= 0 && L.mark <= L.ih && L.ids[1][1] <= L.ids[0][0] && L.ids[0][2] < L.ids[2][2] && L.ids[0][3] <= L.ids[2][2] && L.sw <= L.iw, L);
  if (SHOTS) await p2.screenshot({ path: path.join(SHOTS, 'res-320.png') });
  ok('페이지 오류 없음', errors.length === 0, errors);
  await browser.close(); console.log(failures === 0 ? '\n모든 검사 통과' : '\n실패 ' + failures + '건'); process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
