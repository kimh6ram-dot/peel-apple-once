/* QA: 칼을 떼면 끝난다 — 실제 브라우저·실시간(rAF) 검증. 사과·배·키위·용과 각각에서 아홉 가지 상황.
 *
 * 제품과 같은 조건: AP_DEBUG.setLegacy 를 켜지 않고(= 기본값 그대로), 일시정지·시간 스텝 없이, 클릭과 실제 키보드(playwright keyboard)로 진행한다.
 * 정밀한 접촉 거리 조절이 필요한 상황(재접촉·회전 해제)만 AP_DEBUG.setDirs(= 키 입력과 같은 override 경로)를 쓴다.
 * 매 프레임 상태를 rAF 로 기록해(상태·접촉·이탈 시간) 종료 시점이 150ms 를 넘긴 뒤였는지 확인한다.
 * 사용: node tools/qa-end.js [fruit ...] */
'use strict';
const { chromium } = require('C:/Users/thkim/Desktop/code-work/260624/build/node_modules/playwright-core');
let failures = 0;
function ok(l, c, d) { if (c) console.log('  OK  ', l); else { failures++; console.log('  FAIL', l, d !== undefined ? JSON.stringify(d) : ''); } }
const f = (n, d) => (n === null || n === undefined ? '-' : n.toFixed(d === undefined ? 0 : d));
const FRUITS = process.argv.slice(2).length ? process.argv.slice(2) : ['apple', 'pear', 'kiwi', 'dragonfruit'];
const NAMES = { apple: '사과', pear: '배', kiwi: '키위', dragonfruit: '용과' };
const URL = 'file:///C:/Users/thkim/Desktop/code-work/04_꼬직/261014_apple game/index.html';

(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  for (const id of FRUITS) {
    console.log('=== ' + NAMES[id] + ' (' + id + ') ===');
    const p = await b.newPage({ viewport: { width: 390, height: 844 } });
    const errors = []; p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await p.goto(URL);
    await p.waitForFunction(() => window.AP_READY === true, null, { timeout: 60000 });
    /* 프레임 기록기: rAF 마다 상태 기록(게임 루프와 같은 스냅샷) */
    await p.evaluate(() => {
      window.__rec = [];
      (function loop() { const s = AP_DEBUG.snapshot(); window.__rec.push({ t: performance.now(), st: s.state, c: s.isBladeContacting, peel: s.isPeeling, lost: s.contactLostMs, gap: s.contactDistance, px: s.knife.px, py: s.knife.py, ang: s.knife.angleDeg, cells: AP_DEBUG.cellStats().peeled, res: document.getElementById('screen-result').classList.contains('active'), q: s.qaMode }); requestAnimationFrame(loop); })();
    });
    const snap = () => p.evaluate(() => { const s = AP_DEBUG.snapshot(); return { st: s.state, c: s.isBladeContacting, peel: s.isPeeling, gap: s.contactDistance, lost: s.contactLostMs, px: s.knife.px, py: s.knife.py, bounds: s.knife.bounds, ang: s.knife.angleDeg, peelPct: s.peelPct, why: s.endReason, fruit: s.selectedFruit, qa: s.qaMode, result: document.getElementById('screen-result').classList.contains('active'), endT: s.endT }; });
    const mark = () => p.evaluate(() => window.__rec.length);
    const waitFor = async (pred, ms, label) => { const t0 = Date.now(); for (;;) { const s = await snap(); if (pred(s)) return s; if (Date.now() - t0 > ms) return null; await p.waitForTimeout(16); } };
    const recSince = (m) => p.evaluate((m) => window.__rec.slice(m), m);
    /* 기록에서 종료 분석: 마지막 접촉 프레임 → 종료 프레임 */
    const analyze = (rec) => {
      const iEnd = rec.findIndex((r) => r.st === 'ended'); if (iEnd < 0) return null;
      let iLast = iEnd; while (iLast > 0 && !rec[iLast - 1].c) iLast--; iLast = Math.max(0, iLast - 1);
      const iRes = rec.findIndex((r) => r.res);
      return { lostAtEnd: rec[iEnd].lost, wallMs: rec[iEnd].t - rec[iLast].t, resultAfterEndMs: iRes >= 0 ? rec[iRes].t - rec[iEnd].t : null, flickerBack: rec.slice(iEnd).some((r) => r.st === 'playing' || r.st === 'ready') };
    };

    /* UI 로 과일 선택 → 시작 */
    await p.click('#btn-start'); await p.click('.fruit-cell[data-fruit="' + id + '"]'); await p.click('#btn-select-next');
    let s = await snap();
    ok('시작: ' + NAMES[id] + ' 선택 · READY · 제품 기본 규칙(QA 호환 모드 꺼짐)', s.st === 'ready' && s.fruit === id && s.qa === false, s);

    /* ① 시작 전 칼이 떨어져 있음 → READY 유지 */
    await p.waitForTimeout(2500); s = await snap();
    ok('① 칼이 떨어져 있으면 2.5초 뒤에도 READY(간격 ' + f(s.gap, 1) + 'px) · 결과 화면 없음', s.st === 'ready' && !s.result && s.gap > 20, s);

    /* ② 첫 접촉 → PLAYING ③ 접촉 유지 → PLAYING 유지 */
    let m = await mark();
    await p.keyboard.down('ArrowLeft');
    s = await waitFor((x) => x.st === 'playing', 8000);
    ok('② 칼날 첫 접촉 → PLAYING 진입', !!s, s);
    const firstRec = (await recSince(m)).find((r) => r.st === 'playing');
    ok('② 첫 접촉 프레임에서 접촉 중(isBladeContacting) · 직전 프레임은 READY', firstRec && firstRec.c === true, firstRec);
    await p.waitForTimeout(700); await p.keyboard.up('ArrowLeft');
    await p.waitForTimeout(600); s = await snap();
    ok('③ 칼을 멈춘 채 접촉 유지 1.3초 → PLAYING 유지 · 접촉 중 · 이탈 시간 ' + f(s.lost) + 'ms', s.st === 'playing' && s.c === true && s.lost < 50, s);

    /* ④ 이미 깎인 과일(껍질이 벗겨진 곳)에 접촉 → PLAYING 유지: 한 바퀴 넘게 가만히 두면 날 앞을 지나는 면이 이미 깎인 면 */
    m = await mark();
    await p.waitForTimeout(3600);                         // 가장 긴 회전 주기(2.7s)보다 길게
    const rec4 = await recSince(m), s4 = await snap();
    const noPeelFrames = rec4.filter((r) => r.c && !r.peel).length;
    ok('④ 이미 깎인 면에 3.6초 접촉: PLAYING 유지 · 접촉 true · 새 껍질 없는 프레임 ' + noPeelFrames + '/' + rec4.length + '(isBladeContacting ≠ isPeeling)', s4.st === 'playing' && rec4.every((r) => r.st === 'playing' && r.c) && noPeelFrames > rec4.length * 0.5, { s4, n: rec4.length, noPeelFrames });

    /* ⑧ 뗐다가 150ms 이내 재접촉 → PLAYING 유지 */
    /* 짧게 떼기(키를 누르는 동안만 움직이고 떼면 즉시 정지): 이탈 20ms 이상 → 정지 → 다시 밀어 재접촉. 이탈 시간은 유예(150ms)보다 짧아야 한다 */
    const r8 = await p.evaluate(() => new Promise((resolve) => {
      AP_DEBUG.setDirs(1, 0, 0);
      let maxLost = 0, phase = 'away', t0 = performance.now(), sawLost = false;
      (function loop() {
        const s = AP_DEBUG.snapshot(); maxLost = Math.max(maxLost, s.contactLostMs); if (s.contactLostMs > 0) sawLost = true;
        if (phase === 'away' && s.contactLostMs >= 20) { AP_DEBUG.setDirs(-1, 0, 0); phase = 'back'; }
        if (phase === 'back' && s.isBladeContacting) { AP_DEBUG.setDirs(null); return resolve({ maxLost, state: s.state, sawLost, ms: performance.now() - t0 }); }
        if (s.state === 'ended' || performance.now() - t0 > 3000) { AP_DEBUG.setDirs(null); return resolve({ maxLost, state: s.state, sawLost, ms: performance.now() - t0, timeout: true }); }
        requestAnimationFrame(loop);
      })();
    }));
    ok('⑧ 접촉이 ' + f(r8.maxLost) + 'ms(<150) 끊겼다가 재접촉 → PLAYING 유지', r8.sawLost && r8.maxLost > 0 && r8.maxLost <= 150 && r8.state === 'playing' && !r8.timeout, r8);
    await p.waitForTimeout(300);

    /* ⑤ 칼을 오른쪽으로 충분히 이동(실제 키보드) → 150ms 후 종료 → SETTLING → RESULT */
    m = await mark();
    await p.keyboard.down('ArrowRight');
    s = await waitFor((x) => x.st === 'ended', 6000);
    await p.keyboard.up('ArrowRight');
    ok('⑤ 칼을 오른쪽으로 빼면 종료(PLAYING → SETTLING)', !!s && s.why === 'detach', s);
    const res5 = await waitFor((x) => x.result, 4000);
    const A5 = analyze(await recSince(m));
    ok('⑤ 종료 시점 이탈 시간 ' + f(A5 && A5.lostAtEnd) + 'ms > 150 · 마지막 접촉 후 실시간 ' + f(A5 && A5.wallMs) + 'ms · 종료 뒤 상태가 되돌아가지 않음', A5 && A5.lostAtEnd > 150 && A5.lostAtEnd < 260 && A5.wallMs >= 140 && A5.wallMs < 1500 && !A5.flickerBack, A5);
    ok('⑤ SETTLING 뒤 결과 화면 자동 표시(종료 후 ' + f(A5 && A5.resultAfterEndMs) + 'ms)', !!res5 && A5 && A5.resultAfterEndMs !== null, A5);

    /* ⑨ 종료 후 다시 접촉 → 재시작 전까지 플레이 불가 */
    const e0 = await snap();
    await p.keyboard.down('ArrowLeft'); await p.waitForTimeout(900); await p.keyboard.up('ArrowLeft');
    const e1 = await snap();
    ok('⑨ 종료 후 칼을 다시 밀어도 이동·절삭·재시작 없음(칼 x ' + f(e0.px, 1) + '→' + f(e1.px, 1) + ', 제거율 ' + f(e0.peelPct, 1) + '→' + f(e1.peelPct, 1) + '%) · 상태 ended 유지', e1.st === 'ended' && Math.abs(e1.px - e0.px) < 0.01 && e1.peelPct === e0.peelPct, { e0, e1 });

    /* ⑥ 칼을 아래로 완전히 이동 → 150ms 후 종료. 다시 깎기로 새 판, 깎은 뒤 ↓ 끝까지 */
    await p.click('#btn-restart'); s = await snap();
    ok('다시 깎기 → READY(재시작 후에만 다시 플레이)', s.st === 'ready' && !s.result, s);
    await p.keyboard.down('ArrowLeft'); await waitFor((x) => x.st === 'playing', 8000); await p.waitForTimeout(500); await p.keyboard.up('ArrowLeft');
    m = await mark();
    await p.keyboard.down('ArrowDown');
    s = await waitFor((x) => x.st === 'ended' || x.py >= x.bounds.maxY - 0.01, 12000);
    const atBottom = s && s.st !== 'ended';
    if (atBottom) { await p.waitForTimeout(1200); }
    await p.keyboard.up('ArrowDown');
    s = await snap();
    const A6 = analyze(await recSince(m));
    const touchingAtBottom = (await snap()).c;
    if (s.st === 'ended') ok('⑥ 칼을 아래로 끝까지 내리면 종료(이탈 ' + f(A6 && A6.lostAtEnd) + 'ms > 150) → 결과 화면 ' + s.result, A6 && A6.lostAtEnd > 150 && !A6.flickerBack, A6);
    else ok('⑥ 아래 끝(칼 y 한계)까지 내렸는데 종료되지 않음 — 날이 아직 과일 표면에 겹쳐 있는가(접촉 거리 ' + f(s.gap, 2) + 'px, 접촉 ' + touchingAtBottom + ')', touchingAtBottom === true && s.gap <= 0.75, s);

    /* ⑥-b 표면에 살짝 닿은 상태(접촉 거리 ≈ 0)에서 아래 끝까지 내림: 날이 둥근 표면을 따라 내려가다 벗어나면 종료. 끝에서도 날이 과일에 겹쳐 있으면(= 실제 접촉) 종료되지 않는 것이 맞다 */
    if (s.st === 'ended') { await p.click('#btn-restart'); } else { await p.evaluate(() => { AP_DEBUG.finish('qa-reset'); }); await waitFor((x) => x.result, 4000); await p.click('#btn-restart'); }
    await p.keyboard.down('ArrowLeft'); await waitFor((x) => x.st === 'playing', 8000); await p.waitForTimeout(300); await p.keyboard.up('ArrowLeft');
    await p.evaluate(() => new Promise((resolve) => { AP_DEBUG.setDirs(1, 0, 0); const t0 = performance.now(); (function loop() { const q = AP_DEBUG.snapshot(); if (q.state !== 'playing' || q.contactDistance >= -0.15 || performance.now() - t0 > 4000) { AP_DEBUG.setDirs(null); return resolve(); } requestAnimationFrame(loop); })(); }));
    m = await mark();
    await p.keyboard.down('ArrowDown');
    const s6b = await waitFor((x) => x.st === 'ended' || x.py >= x.bounds.maxY - 0.01, 12000);
    if (s6b && s6b.st !== 'ended') await p.waitForTimeout(1200);
    await p.keyboard.up('ArrowDown');
    { const q = await snap(); if (q.st === 'ended') await waitFor((x) => x.result, 4000); }
    const s6c = await snap(), A6b = analyze(await recSince(m));
    if (s6c.st === 'ended') ok('⑥-b 살짝 닿은 채 아래 끝까지 내리면 종료(칼 y ' + f(s6c.py, 0) + '/' + f(s6c.bounds.maxY, 0) + ', 이탈 ' + f(A6b && A6b.lostAtEnd) + 'ms > 150) → 결과 화면 ' + s6c.result, A6b && A6b.lostAtEnd > 150 && !A6b.flickerBack, A6b);
    else ok('⑥-b 아래 끝(칼 y ' + f(s6c.py, 0) + ' = 한계 ' + f(s6c.bounds.maxY, 0) + ')에서도 날이 과일에 겹쳐 있어 종료되지 않음(접촉 거리 ' + f(s6c.gap, 2) + 'px, 접촉 ' + s6c.c + ')', s6c.c === true && s6c.gap <= 0.75, s6c);

    /* ⑦ Q/W 회전으로 접촉 해제 → 150ms 후 종료 */
    { const q0 = await snap(); if (q0.st === 'ended') { await waitFor((x) => x.result, 4000); await p.click('#btn-restart'); } else { await p.evaluate(() => { AP_DEBUG.finish('qa-reset'); }); await waitFor((x) => x.result, 4000); await p.click('#btn-restart'); } }
    await p.keyboard.down('ArrowLeft'); await waitFor((x) => x.st === 'playing', 8000); await p.waitForTimeout(400); await p.keyboard.up('ArrowLeft');
    /* 피벗이 표면에 막 닿을 만큼만 물러난 뒤(접촉 거리 ≈ 0) 회전: 한쪽 방향으로 기울이면 날이 표면에서 완전히 떨어진다 */
    const prep = await p.evaluate(() => new Promise((resolve) => {
      AP_DEBUG.setDirs(1, 0, 0); const t0 = performance.now();
      (function loop() {
        const s = AP_DEBUG.snapshot();
        if (s.state !== 'playing') { AP_DEBUG.setDirs(null); return resolve({ state: s.state, gap: s.contactDistance }); }
        if (s.contactDistance >= -0.15 || performance.now() - t0 > 4000) { AP_DEBUG.setDirs(null); return resolve({ state: s.state, gap: s.contactDistance, lost: s.contactLostMs }); }
        requestAnimationFrame(loop);
      })();
    }));
    let rotRes = null;
    for (const dir of [1, -1]) {
      if (rotRes && rotRes.ended) break;
      const sPrev = await snap(); if (sPrev.st !== 'playing') break;
      m = await mark();
      rotRes = await p.evaluate((dir) => new Promise((resolve) => {
        AP_DEBUG.setDirs(0, 0, dir); const t0 = performance.now();
        (function loop() {
          const s = AP_DEBUG.snapshot();
          if (s.state === 'ended') { AP_DEBUG.setDirs(null); return resolve({ ended: true, ang: s.knife.angleDeg, lost: s.contactLostMs, dir }); }
          if (performance.now() - t0 > 2500 || Math.abs(s.knife.angleDeg) >= 39.9) { AP_DEBUG.setDirs(null); return resolve({ ended: false, ang: s.knife.angleDeg, gap: s.contactDistance, dir }); }
          requestAnimationFrame(loop);
        })();
      }), dir);
      if (!rotRes.ended) { await p.evaluate(() => AP_DEBUG.setKnifeAngleDeg(0)); await p.waitForTimeout(100); }
    }
    s = await snap();
    const A7 = analyze(await recSince(m));
    if (rotRes && rotRes.ended) ok('⑦ Q/W 로 기울여 접촉을 풀면 종료(방향 ' + rotRes.dir + ', 각도 ' + f(rotRes.ang) + '°, 이탈 ' + f(rotRes.lost) + 'ms > 150) · 종료 뒤 되돌아가지 않음', rotRes.lost > 150 && !(A7 && A7.flickerBack), { rotRes, prep });
    else ok('⑦ Q/W 기울이기로는 접촉이 풀리지 않음(양방향 최대 ' + f(rotRes && rotRes.ang) + '°까지 기울여도 날이 표면 안으로 ' + f(rotRes && rotRes.gap, 1) + 'px 겹침 = 실제 접촉, 곧은 벽에 날을 기울이면 한쪽 끝이 파고드는 기하) → PLAYING 유지가 맞다', rotRes && s.st === 'playing' && s.c === true && s.gap <= 0.75, { rotRes, prep, s });

    const recAll = await p.evaluate(() => window.__rec);
    ok('전 구간 QA 호환 모드 꺼짐(제품 기본) · 페이지 오류 없음', recAll.every((r) => r.q === false) && errors.length === 0, errors);
    await p.close();
  }
  await b.close();
  console.log(failures === 0 ? '\n모든 검사 통과' : '\n실패 ' + failures + '건'); process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
