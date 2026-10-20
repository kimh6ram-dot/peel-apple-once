/* QA: 친구 도전장(주차하기와 같은 흐름) — 링크 토큰 왕복·방어 · 보내기(닉네임·공유 문구·링크) · 받는 화면(도전장) · 도전 시작 · 결과의 [대결 결과 보기] · 대결 결과(점수 VS 점수·승패 문구) · 서로 다른 과일 · 버튼 높이.
 * 제품 기본 규칙(이탈 종료)으로 실행. 사용: node tools/qa-challenge.js */
'use strict';
const { chromium } = require('C:/Users/thkim/Desktop/code-work/260624/build/node_modules/playwright-core');
let failures = 0;
function ok(l, c, d) { if (c) console.log('  OK  ', l); else { failures++; console.log('  FAIL', l, d !== undefined ? JSON.stringify(d) : ''); } }
const URL = 'file:///C:/Users/thkim/Desktop/code-work/04_꼬직/261014_apple game/index.html';
const LAUNCH = { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] };
const DUR = { apple: 40, pear: 32, kiwi: 24, dragonfruit: 30 };

(async () => {
  const b = await chromium.launch(LAUNCH);
  const errors = [];
  const open = async (hash, vp) => {
    const ctx = await b.newContext({ viewport: vp || { width: 390, height: 844 }, hasTouch: true, isMobile: true }), p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/countapi|ERR_FAILED/.test(m.text())) errors.push(m.text()); });
    await p.goto(URL + (hash || '')); await p.waitForFunction(() => window.AP_READY === true, null, { timeout: 60000 }); await p.waitForTimeout(250);
    return p;
  };
  const playToResult = async (p, fruit, o, viaUi) => {
    if (viaUi) { await p.click('#btn-select-next'); }
    else { await p.click('#btn-start'); await p.click('.fruit-cell[data-fruit="' + fruit + '"]'); await p.click('#btn-select-next'); }
    await p.evaluate(({ dur, o }) => { AP_DEBUG.setPaused(true); AP_DEBUG.runAutopilot(200, Object.assign({ single: true, dur, depthFrac: 0.6, pretilt: true }, o)); AP_DEBUG.setPaused(false); }, { dur: DUR[fruit], o: o || {} });
    await p.waitForFunction(() => document.getElementById('screen-result').classList.contains('active'), null, { timeout: 12000 });
    return p.evaluate(() => AP_DEBUG.snapshot().score.total);
  };
  const tokenFor = (p, rec) => p.evaluate((rec) => AP.battle.makeToken(Object.assign({ surface: AP.apple.current.surface }, rec)), rec);

  console.log('=== 1. 링크 토큰: 왕복 · 길이 · 잘못된 링크 방어 ===');
  let p = await open('');
  const tk = await p.evaluate(() => {
    const out = {};
    for (const f of AP.fruits.ORDER) {
      AP_DEBUG.goIntro(); AP_DEBUG.selectFruit(f); document.getElementById('btn-start').click(); document.getElementById('btn-select-next').click();
      AP_DEBUG.setPaused(true); AP_DEBUG.runAutopilot(9, { single: true, dur: 30, depthFrac: 0.6, pretilt: true });
      const S = AP.apple.current.surface, tok = AP.battle.makeToken({ nickname: '껍질장인', total: 73, fruit: f, peelPct: 41.6, fleshPct: 2.34, surface: S }), rec = AP.battle.parseToken(tok);
      const enc = AP.battle.encodeSurface(S), dec = AP.battle.decodeGrid(enc);
      let mism = 0, peeledCoarse = 0; for (let cr = 0; cr < 24; cr++) for (let cs = 0; cs < 48; cs++) { let pc = 0; for (let dr = 0; dr < 2; dr++) for (let dc = 0; dc < 2; dc++) if (S.state[(cr * 2 + dr) * 96 + cs * 2 + dc] >= 1) pc++; const v = dec[cr * 48 + cs]; if ((pc >= 2) !== (v >= 1)) mism++; if (v) peeledCoarse++; }
      out[f] = { len: tok.length, nick: rec && rec.nickname, total: rec && rec.total, fruit: rec && rec.fruit, peel: rec && rec.peelPct, flesh: rec && rec.fleshPct, mism, peeledCoarse };
    }
    const good = AP.battle.makeToken({ nickname: 'a', total: 50, fruit: 'apple', peelPct: 1, fleshPct: 1, surface: AP.apple.current.surface });
    const enc = (o) => 'v1.' + btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const g = AP.battle.encodeSurface(AP.apple.current.surface);
    out.bad = { empty: AP.battle.parseToken(''), garbage: AP.battle.parseToken('v1.@@@'), ver: AP.battle.parseToken('v2.' + good.slice(3)), unknownFruit: AP.battle.parseToken(enc({ n: 'x', s: 10, f: 'banana', p: 1, l: 1, g })), over: AP.battle.parseToken(enc({ n: 'x', s: 999, f: 'apple', p: 1, l: 1, g })), shortGrid: AP.battle.parseToken(enc({ n: 'x', s: 10, f: 'apple', p: 1, l: 1, g: 'AAAA' })), noGrid: AP.battle.parseToken(enc({ n: 'x', s: 10, f: 'apple' })) };
    const xss = AP.battle.parseToken(enc({ n: '<img src=x onerror=alert(1)>길고긴닉네임이름', s: 10, f: 'apple', p: 1, l: 1, g })); out.xss = xss && xss.nickname;
    return out;
  });
  ok('4종 모두 토큰 왕복 정확(닉네임·점수·과일·제거율·손실률) · 압축 표면 ↔ 실제 표면 불일치 셀 0 · 링크 길이 ' + Object.values(tk).filter((x) => x.len).map((x) => x.len).join('/') + '자(≤ 700)', ['apple', 'pear', 'kiwi', 'dragonfruit'].every((f) => tk[f].nick === '껍질장인' && tk[f].total === 73 && tk[f].fruit === f && tk[f].peel === 42 && Math.abs(tk[f].flesh - 2.3) < 0.01 && tk[f].mism === 0 && tk[f].peeledCoarse > 20 && tk[f].len <= 700), tk);
  ok('잘못된 링크는 모두 무시(null): 빈 값·깨진 값·다른 버전·모르는 과일·점수 범위 밖·짧은 상태·상태 없음', Object.values(tk.bad).every((v) => v === null), tk.bad);
  ok('닉네임 정리: 태그 문자(<>) 제거·12자 제한("' + tk.xss + '")', tk.xss && tk.xss.indexOf('<') < 0 && tk.xss.indexOf('>') < 0 && tk.xss.length <= 12, tk.xss);
  await p.context().close();

  console.log('=== 2. 보내기: 결과 → [친구에게 도전장 보내기] → 닉네임 → 링크 ===');
  p = await open('');
  const myScore = await playToResult(p, 'dragonfruit', { stopAt: 0.6 });
  await p.evaluate(() => { window.__s = null; navigator.share = (d) => { window.__s = d; return Promise.resolve(); }; });
  const noBattleBtn = await p.evaluate(() => document.getElementById('btn-battle-result').hidden);
  ok('내가 먼저 하는 판: [대결 결과 보기] 없음 · [도전장 보내기] 가 주요 버튼(활성)', noBattleBtn && !(await p.evaluate(() => document.getElementById('btn-challenge').disabled)));
  await p.click('#btn-challenge'); await p.waitForTimeout(150);
  const modalOn = await p.evaluate(() => !document.getElementById('modal').classList.contains('hidden'));
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  const canceled = await p.evaluate(() => ({ modal: !document.getElementById('modal').classList.contains('hidden'), shared: window.__s }));
  ok('닉네임 입력창이 뜨고, 취소(Esc)하면 아무것도 보내지 않음', modalOn && !canceled.modal && canceled.shared === null, { modalOn, canceled });
  await p.click('#btn-challenge'); await p.fill('#modal-input', ''); await p.click('#modal-ok'); await p.waitForTimeout(400);
  const dflt = await p.evaluate(() => window.__s);
  ok('닉네임을 비우면 "친구"로 도전장 생성', dflt && AP_PARSE(dflt.url) === '친구' , dflt && dflt.url.length);
  function AP_PARSE(u) { return u && u.indexOf('#battle/') > 0 ? '친구' : null; }
  await p.click('#btn-challenge'); await p.fill('#modal-input', '껍질장인'); await p.click('#modal-ok'); await p.waitForTimeout(400);
  const sent = await p.evaluate(() => window.__s);
  ok('공유 시트: 제목 "' + sent.title + '" · 문구 "' + sent.text + '" · 링크 = 배포 주소 + #battle/v1.…', sent.title === '나보다 잘 깎을 수 있어?' && sent.text === '내 용과 깎기 기록 ' + myScore + '점. 이길 수 있으면 해보세요.' && sent.url.indexOf('https://kimh6ram-dot.github.io/peel-apple-once/#battle/v1.') === 0, sent);
  const back = await p.evaluate((u) => { const rec = AP.battle.parseToken(u.split('#battle/')[1]); return rec && { n: rec.nickname, s: rec.total, f: rec.fruit }; }, sent.url);
  ok('링크에 내 기록이 정확히: 닉네임 "' + (back && back.n) + '" · ' + (back && back.s) + '점 · ' + (back && back.f), back && back.n === '껍질장인' && back.s === myScore && back.f === 'dragonfruit', back);
  const r7 = await p.evaluate(async () => { navigator.share = undefined; window.__c = null; Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t) => { window.__c = t; return Promise.resolve(); } }, configurable: true }); const pr = AP.share.challenge(); await new Promise((r) => setTimeout(r, 120)); document.getElementById('modal-input').value = '복사테스트'; document.getElementById('modal-ok').click(); return pr; });
  const cp = await p.evaluate(() => ({ c: window.__c, t: document.getElementById('toast').textContent }));
  ok('공유 시트가 없으면(PC) 문구+링크를 클립보드에 복사 · 토스트 "' + cp.t + '"', r7 === 'copied' && cp.c.indexOf('내 용과 깎기 기록 ') >= 0 && cp.c.indexOf('#battle/v1.') > 0 && cp.t === '도전장 링크가 복사됐어요!', cp);
  await p.context().close();

  console.log('=== 3. 받는 쪽: 링크를 열면 도전장 화면 → 도전 시작 → 플레이 → 결과 → 대결 결과 ===');
  /* 친구 기록 만들기: 배로 40% 깎은 기록(점수 X) */
  p = await open('');
  await playToResult(p, 'pear', { stopAt: 0.4 });
  const friend = await p.evaluate(() => ({ s: AP_DEBUG.snapshot().score.total }));
  const friendTok = await tokenFor(p, { nickname: '배달인', total: friend.s, fruit: 'pear', peelPct: 40, fleshPct: 0.2 });
  await p.context().close();
  /* INTRO 기준 버튼 높이(여러 화면 크기) */
  const sizes = [[390, 844], [320, 568], [430, 932], [375, 667]];
  for (const vp of sizes) {
    const base = await open('', { width: vp[0], height: vp[1] });
    const introTop = await base.evaluate(() => document.getElementById('btn-start').getBoundingClientRect().top); await base.context().close();
    const q = await open('#battle/' + friendTok, { width: vp[0], height: vp[1] });
    const st = await q.evaluate(() => ({ active: [...document.querySelectorAll('.screen.active')].map((e) => e.id), boot: document.documentElement.classList.contains('boot-challenge'), name: document.getElementById('challenge-name').textContent, score: document.getElementById('challenge-score').textContent, hint: document.querySelector('.battle-hint').textContent, top: document.getElementById('btn-challenge-start').getBoundingClientRect().top, title: document.querySelector('#screen-challenge .slot-title').textContent, ch: document.getElementById('challenge-canvas').getBoundingClientRect().height, overflow: document.scrollingElement.scrollWidth > innerWidth }));
    ok(vp.join('×') + ': 링크로 열면 도전장 화면만(메인 아님) · "' + st.title + '" · "' + st.name + '" · ' + st.score + ' · "' + st.hint + '" · [도전 시작] 상단 ' + st.top.toFixed(1) + ' = 메인 [시작하기] ' + introTop.toFixed(1), st.active.join() === 'screen-challenge' && !st.boot && st.title === '도전장이 도착했습니다' && st.name === '배달인의 배 깎기 기록' && st.score === friend.s + '점' && st.hint === '이길 수 있으면 해보세요.' && Math.abs(st.top - introTop) <= 1 && !st.overflow, { st, introTop });
    await q.context().close();
  }
  /* 도전 시작 → 같은 과일 미리 선택 → 플레이 → 결과(대결 버튼) → 대결 결과 */
  p = await open('#battle/' + friendTok);
  const px = await p.evaluate(() => { const cv = document.getElementById('challenge-canvas'), d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let i = 0; i < d.length; i += 16) if (d[i] < 235 || d[i + 1] < 235 || d[i + 2] < 235) n++; return n; });
  ok('도전장 화면에 친구의 최종 모습(과일)이 그려짐(비어있지 않은 화소 ' + px + ')', px > 300, px);
  await p.click('#btn-challenge-start'); await p.waitForTimeout(200);
  const sel = await p.evaluate(() => ({ sel: AP_DEBUG.previewFruit(), picked: document.querySelector('.fruit-cell.is-selected').getAttribute('data-fruit'), screen: [...document.querySelectorAll('.screen.active')].map((e) => e.id).join() }));
  ok('[도전 시작] → 과일 선택 화면, 친구와 같은 과일(배)이 미리 선택됨', sel.screen === 'screen-select' && sel.sel === 'pear' && sel.picked === 'pear', sel);
  const mine = await playToResult(p, 'pear', { depthFrac: 0.6 }, true);                       // 나는 끝까지 깎는다(친구보다 높은 점수)
  const res = await p.evaluate(() => { const a = document.querySelector('#screen-result .slot-actions'), first = a.querySelector(':scope > button:not([hidden])'); return { has: document.getElementById('screen-result').classList.contains('has-battle'), firstId: first.id, battleTop: document.getElementById('btn-battle-result').getBoundingClientRect().top, chTop: document.getElementById('btn-challenge').getBoundingClientRect().top, chH: document.getElementById('btn-challenge').getBoundingClientRect().height }; });
  const introTop844 = 546;
  ok('도전으로 들어온 판의 결과: [대결 결과 보기] 가 주요 버튼 자리(' + res.battleTop.toFixed(0) + ', 메인 [시작하기] ' + introTop844 + ')에 · [도전장 보내기]는 보조 버튼 모양으로 그 아래', res.has && res.firstId === 'btn-battle-result' && Math.abs(res.battleTop - introTop844) <= 1 && res.chTop > res.battleTop + 40 && res.chH < 46, res);
  await p.click('#btn-battle-result'); await p.waitForTimeout(500);
  const bt = await p.evaluate(() => ({ screen: [...document.querySelectorAll('.screen.active')].map((e) => e.id).join(), a: document.getElementById('vs-a-score').textContent, bb: document.getElementById('vs-b-score').textContent, an: document.getElementById('vs-a-name').textContent, bn: document.getElementById('vs-b-name').textContent, win: document.getElementById('vs-winner').textContent, top: document.getElementById('btn-rematch').getBoundingClientRect().top, cA: (() => { const cv = document.getElementById('vs-a-canvas'), d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let i = 0; i < d.length; i += 16) if (d[i] < 235 || d[i + 1] < 235 || d[i + 2] < 235) n++; return n; })(), cB: (() => { const cv = document.getElementById('vs-b-canvas'), d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let i = 0; i < d.length; i += 16) if (d[i] < 235 || d[i + 1] < 235 || d[i + 2] < 235) n++; return n; })() }));
  ok('대결 결과: ' + bt.an + ' ' + bt.a + ' VS ' + bt.bb + ' ' + bt.bn + ' · "' + bt.win + '" · 양쪽 최종 모습 그려짐(' + bt.cA + '/' + bt.cB + ') · [다시 붙기] 상단 ' + bt.top.toFixed(0) + ' = 메인 [시작하기] ' + introTop844,
    bt.screen === 'screen-battle' && bt.a === String(friend.s) && bt.bb === String(mine) && bt.an === '배달인' && bt.bn === '나' && bt.win === (mine > friend.s ? '이겼습니다. ' + (mine - friend.s) + '점 차이.' : (mine < friend.s ? '졌습니다. ' + (friend.s - mine) + '점 부족.' : '무승부. 한 번 더.')) && bt.cA > 300 && bt.cB > 300 && Math.abs(bt.top - introTop844) <= 1, bt);
  /* 내 모델은 그대로(상대를 따로 그렸을 뿐): 저장 이미지는 여전히 내 결과 */
  const intact = await p.evaluate(() => ({ fruit: AP.apple.current.fruitId, visible: AP.apple.current.group.visible, state: AP_DEBUG.snapshot().state, img: AP.share.buildImage(AP_DEBUG.snapshot()).width }));
  ok('대결 화면을 그린 뒤에도 내 판은 그대로(과일 ' + intact.fruit + ' · 모델 보임 · 상태 ' + intact.state + ' · 저장 이미지 생성 ' + intact.img + 'px)', intact.fruit === 'pear' && intact.visible && intact.state === 'ended' && intact.img === 1080, intact);
  await p.click('#btn-vs-detail'); await p.waitForTimeout(150);
  ok('[내 결과 자세히 보기] → 내 결과 화면으로 복귀', await p.evaluate(() => document.getElementById('screen-result').classList.contains('active') && !document.getElementById('screen-battle').classList.contains('active')));
  await p.click('#btn-battle-result'); await p.waitForTimeout(300); await p.click('#btn-rematch'); await p.waitForTimeout(300);
  const rm = await p.evaluate(() => ({ st: AP_DEBUG.snapshot().state, fruit: AP.fruits.current.id, ch: !!AP_DEBUG.challenge(), screens: document.querySelectorAll('.screen.active').length }));
  ok('[다시 붙기] → 같은 과일로 새 판(READY) · 친구 기록은 유지', rm.st === 'ready' && rm.fruit === 'pear' && rm.ch && rm.screens === 0, rm);
  await p.context().close();

  console.log('=== 4. 승패 문구 3종(이김 · 짐 · 무승부) · 서로 다른 과일 ===');
  /* 내 점수를 먼저 구해서(결정적 시뮬레이션) 친구 점수를 낮게/높게/같게 만든 링크로 연다 */
  p = await open(''); const my = await playToResult(p, 'kiwi', { stopAt: 0.5 }); await p.context().close();
  const cases = [['이김', Math.max(0, my - 13), (d) => '이겼습니다. ' + d + '점 차이.'], ['짐', Math.min(100, my + 9), (d) => '졌습니다. ' + d + '점 부족.'], ['무승부', my, () => '무승부. 한 번 더.']];
  for (const [name, fs, text] of cases) {
    const maker = await open(''); await maker.evaluate(() => { AP_DEBUG.goIntro(); AP_DEBUG.selectFruit('apple'); document.getElementById('btn-start').click(); document.getElementById('btn-select-next').click(); AP_DEBUG.setPaused(true); AP_DEBUG.runAutopilot(8, { single: true, dur: 40, depthFrac: 0.6, pretilt: true }); });
    const tok = await tokenFor(maker, { nickname: '사과왕', total: fs, fruit: 'apple', peelPct: 30, fleshPct: 0 }); await maker.context().close();
    const q = await open('#battle/' + tok);                                                       // 친구는 사과, 나는 키위로 도전(서로 다른 과일)
    await q.click('#btn-challenge-start'); await q.click('.fruit-cell[data-fruit="kiwi"]');
    await playToResult(q, 'kiwi', { stopAt: 0.5 }, true);
    await q.click('#btn-battle-result'); await q.waitForTimeout(400);
    const r = await q.evaluate(() => ({ a: document.getElementById('vs-a-score').textContent, b: document.getElementById('vs-b-score').textContent, win: document.getElementById('vs-winner').textContent, fruit: AP.apple.current.fruitId, ca: AP.fruits.current.id }));
    const diff = Math.abs(my - fs);
    ok(name + ': 친구(사과) ' + r.a + ' VS 나(키위) ' + r.b + ' → "' + r.win + '" · 내 과일 ' + r.fruit + ' 유지', r.a === String(fs) && r.b === String(my) && r.win === text(diff) && r.fruit === 'kiwi' && r.ca === 'kiwi', r);
    await q.context().close();
  }

  console.log('=== 5. 도전장 링크가 아닌 접속은 메인 그대로 ===');
  p = await open('');
  ok('일반 접속: 메인 화면 · 도전장 없음', await p.evaluate(() => document.getElementById('screen-intro').classList.contains('active') && !AP_DEBUG.challenge() && !document.documentElement.classList.contains('boot-challenge')));
  await p.context().close();
  p = await open('#battle/v1.garbage');
  ok('깨진 도전장 링크: 오류 없이 메인 화면', await p.evaluate(() => document.getElementById('screen-intro').classList.contains('active') && !AP_DEBUG.challenge() && !document.documentElement.classList.contains('boot-challenge')));
  await p.context().close();

  ok('페이지 오류 없음', errors.length === 0, errors);
  await b.close(); console.log(failures === 0 ? '\n모든 검사 통과' : '\n실패 ' + failures + '건'); process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
