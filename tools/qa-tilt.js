/* QA: 칼 회전 범위 확대(−75°~+75°) — 각도 범위·속도, 이미지/절삭 엣지/판정 영역의 같은 회전, 피벗 고정, 손잡이 제외, 접촉 연속성, 이탈 종료,
 * 모바일 회전 버튼, 윗면(꼭지 주변) 절삭. 제품 기본 규칙으로 실행한다(setLegacy 를 켜지 않음).
 * 사용: node tools/qa-tilt.js */
'use strict';
const { chromium } = require('C:/Users/thkim/Desktop/code-work/260624/build/node_modules/playwright-core');
let failures = 0;
function ok(l, c, d) { if (c) console.log('  OK  ', l); else { failures++; console.log('  FAIL', l, d !== undefined ? JSON.stringify(d) : ''); } }
const f = (n, d) => (n === null || n === undefined ? '-' : n.toFixed(d === undefined ? 0 : d));
const IDS = ['apple', 'pear', 'kiwi', 'dragonfruit'], NAMES = { apple: '사과', pear: '배', kiwi: '키위', dragonfruit: '용과' };
const DUR = { apple: 40, pear: 32, kiwi: 24, dragonfruit: 30 };
const URL = 'file:///C:/Users/thkim/Desktop/code-work/04_꼬직/261014_apple game/index.html';
const LAUNCH = { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] };

(async () => {
  const b = await chromium.launch(LAUNCH);
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(URL);
  await p.waitForFunction(() => window.AP_READY === true, null, { timeout: 60000 });
  await p.evaluate(() => AP_DEBUG.setPaused(true));
  const begin = (id) => p.evaluate((id) => { AP_DEBUG.goIntro(); AP_DEBUG.selectFruit(id); document.getElementById('btn-start').click(); document.getElementById('btn-select-next').click(); return AP_DEBUG.snapshot().state; }, id);

  console.log('=== 1. 각도 범위 · 속도 · 정지 (설정 상수 MIN_ANGLE_DEG / MAX_ANGLE_DEG) ===');
  await begin('apple');
  const cfg = await p.evaluate(() => ({ min: AP.CONFIG.KNIFE.MIN_ANGLE_DEG, max: AP.CONFIG.KNIFE.MAX_ANGLE_DEG, old: AP.CONFIG.KNIFE.ROT_MAX_DEG, speed: AP.CONFIG.KNIFE.ROT_SPEED_DEG }));
  ok('설정 상수 분리: MIN_ANGLE_DEG ' + cfg.min + ' · MAX_ANGLE_DEG ' + cfg.max + ' (이전 ±40 → ±75) · 회전 속도 ' + cfg.speed + '°/s 유지', cfg.min === -75 && cfg.max === 75 && cfg.old === undefined && cfg.speed === 60, cfg);
  const rot = await p.evaluate(() => {
    AP_DEBUG.setLegacy(true);          // 각도 범위·속도 측정은 게임 규칙과 무관 — 칼 끝이 과일에 닿아 종료되지 않도록 호환 모드로
    const out = {}; AP_DEBUG.setDirs(0, 0, 1); let s = AP_DEBUG.run(0.5, 60); out.cw05 = s.knife.angleDeg; AP_DEBUG.setDirs(0, 0, 0); s = AP_DEBUG.step(1 / 60); out.vrot = s.knife.vrot; const a1 = s.knife.angleDeg; s = AP_DEBUG.run(0.3, 60); out.holdDrift = Math.abs(s.knife.angleDeg - a1);
    AP_DEBUG.setDirs(0, 0, 1); s = AP_DEBUG.run(3, 60); out.max = s.knife.angleDeg; AP_DEBUG.setDirs(0, 0, -1); s = AP_DEBUG.run(0.5, 60); out.back05 = s.knife.angleDeg - out.max; s = AP_DEBUG.run(4, 60); out.min = s.knife.angleDeg; AP_DEBUG.setDirs(null);
    AP_DEBUG.setLegacy(false);
    return out;
  });
  ok('W(시계) 0.5초 ≈ ' + f(rot.cw05, 1) + '°(60°/s − 램프업) · 떼면 즉시 정지(vrot ' + rot.vrot + ', 0.3초 뒤 변화 ' + f(rot.holdDrift, 2) + '°)', Math.abs(rot.cw05 - 27) < 1.5 && rot.vrot === 0 && rot.holdDrift < 1e-6, rot);
  ok('W 를 계속 누르면 +75° 에서 멈춤(' + f(rot.max, 2) + '°) · Q(반시계)는 ' + f(rot.back05, 1) + '°/0.5s 로 되돌아가 −75° 에서 멈춤(' + f(rot.min, 2) + '°)', Math.abs(rot.max - 75) < 1e-6 && Math.abs(rot.min + 75) < 1e-6 && rot.back05 < -20 && rot.back05 > -30, rot);

  console.log('=== 2. 칼 이미지 · 실제 절삭 엣지 · 판정 영역이 항상 같은 각도로 회전 · 피벗 고정 · 날은 위쪽 ===');
  const tr = await p.evaluate(() => {
    const D = AP.knife.data, piv = AP.knife.pivotPNG, res = [];
    for (const deg of [-75, -60, -40, 0, 40, 60, 75]) {
      AP_DEBUG.setKnifeAngleDeg(deg);
      const k = AP_DEBUG.snapshot().knife, s = k.scale, a = k.angleDeg * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
      const T = (q) => { const dx = (q[0] - piv[0]) * s, dy = (q[1] - piv[1]) * s; return [k.px + dx * c - dy * sn, k.py + dx * sn + dy * c]; };
      const R = AP_DEBUG.regions(), poly = (r) => [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]].map(T);
      let worst = 0; const chk = (A, B) => { for (let i = 0; i < A.length; i++) worst = Math.max(worst, Math.hypot(A[i][0] - B[i][0], A[i][1] - B[i][1])); };
      chk(R.edge, D.edge.map(T)); chk(R.bladeRegionPoly, poly(D.bladeRegion)); chk(R.handleRegionPoly, poly(D.handleRegion)); chk([R.tip], [T(D.tip)]);
      const pe = R.edge[Math.floor(R.edge.length * AP.CONFIG.KNIFE.PIVOT_EDGE_FRAC)];
      res.push({ deg, ang: k.angleDeg, worst, pivotErr: Math.hypot(pe[0] - k.px, pe[1] - k.py), sprite: AP_DEBUG.spriteMismatch(), tipAboveHandle: R.tip[1] < (R.handleRegionPoly[0][1] + R.handleRegionPoly[2][1]) / 2, px: k.px, py: k.py });
    }
    return res;
  });
  ok('각도 ' + tr.map((r) => f(r.ang)).join('/') + '°: 날 엣지·칼날 영역·손잡이 영역·칼끝 좌표가 같은 회전 변환과 일치(최대 오차 ' + f(Math.max.apply(null, tr.map((r) => r.worst)), 6) + 'px)', tr.every((r) => r.worst < 1e-6 && Math.abs(r.ang - r.deg) < 1e-9), tr);
  ok('칼 이미지(스프라이트) 모서리 ↔ 판정 변환 불일치 최대 ' + f(Math.max.apply(null, tr.map((r) => r.sprite)), 4) + 'px < 0.01 (±75° 포함)', tr.every((r) => r.sprite < 0.01), tr);
  ok('회전 기준점(날 위 절삭점 = 날 55% 지점)은 어떤 각도에서도 제자리(오차 ' + f(Math.max.apply(null, tr.map((r) => r.pivotErr)), 6) + 'px) · 칼끝은 손잡이보다 위(날이 위쪽을 향함)', tr.every((r) => r.pivotErr < 1e-6 && r.tipAboveHandle), tr);

  console.log('=== 3. 손잡이는 어떤 각도에서도 접촉으로 오인되지 않음 (손잡이가 과일에 겹치는 모든 자세에서 접촉 = 날 엣지 기준) ===');
  const handle = {};
  for (const id of IDS) {
    await begin(id);
    handle[id] = await p.evaluate(() => {
      const cx = AP.scene.appleCx, only = [], both = []; let overlapN = 0, edgeOnly = 0;
      const inside = (x, y) => { const sx = AP_DEBUG.silhouetteX(y); return sx !== null && Math.abs(x - cx) < (sx - cx) - 2; };
      for (let deg = -75; deg <= 75; deg += 15) {
        AP_DEBUG.setKnifeAngleDeg(deg);
        for (let oy = 0; oy <= 560; oy += 16) for (let ox = cx - 340; ox <= cx + 220; ox += 16) {
          AP_DEBUG.setKnifePos(ox, oy);
          const R = AP_DEBUG.regions(), q = R.handleRegionPoly; let n = 0;
          for (let u = 0; u <= 1; u += 0.25) for (let v = 0; v <= 1; v += 0.25) {
            const x = (1 - u) * ((1 - v) * q[0][0] + v * q[3][0]) + u * ((1 - v) * q[1][0] + v * q[2][0]), y = (1 - u) * ((1 - v) * q[0][1] + v * q[3][1]) + u * ((1 - v) * q[1][1] + v * q[2][1]);
            if (inside(x, y)) n++;
          }
          if (n < 3) continue;
          overlapN++;
          const pr = AP_DEBUG.probe(), touching = pr.maxDepth !== null && pr.maxDepth > AP.CONFIG.CUT.CONTACT_EPS;
          if (!touching && (pr.maxDepth === null || pr.maxDepth < -1)) { if (only.length < 3) only.push({ deg, ox, oy, n, gap: pr.gap }); } else both.push(1);
        }
      }
      return { only, overlapN, withEdge: both.length };
    });
  }
  for (const id of IDS) {
    const h = handle[id];
    let res = null;
    if (h.only.length) {
      await begin(id);
      res = await p.evaluate(({ h }) => {
        const out = []; for (const pose of h.only) {
          AP_DEBUG.goIntro(); AP_DEBUG.selectFruit(AP.fruits.current.id); document.getElementById('btn-start').click(); document.getElementById('btn-select-next').click();
          AP_DEBUG.setKnifeAngleDeg(pose.deg); AP_DEBUG.setKnifePos(pose.ox, pose.oy);
          let st = 'ready'; for (let i = 0; i < 60 * 3; i++) { const s = AP_DEBUG.step(1 / 60); st = s.state; if (st !== 'ready') break; }
          out.push({ pose, st, peeled: AP_DEBUG.cellStats().peeled });
        } return out;
      }, { h });
    }
    ok(NAMES[id] + ': 손잡이가 과일에 겹치는 자세 ' + h.overlapN + '곳(−75°~+75°, 15° 간격) 중 ' + (h.only.length ? '손잡이만 겹치고 날은 떨어진 자세 ' + h.only.length + '곳(각도 ' + h.only.map((x) => x.deg).join('/') + '°)에서 3초 READY 유지 · 절삭 0' : '손잡이만 겹치는 자세는 기하학적으로 없음(손잡이가 겹칠 때는 항상 날 엣지도 겹쳐 있음 — 접촉 판정은 날 엣지만 쓰므로 손잡이가 접촉을 만들 수 없다)'),
      h.overlapN > 0 && (h.only.length ? res.every((r) => r.st === 'ready' && r.peeled === 0) : h.withEdge === h.overlapN), { h, res });
  }

  console.log('=== 4. 회전 중 접촉 연속성(피벗이 튀지 않음) · 크게 기울여 접촉이 끊기면 종료 ===');
  const cont = {};
  for (const id of IDS) {
    await begin(id);
    cont[id] = await p.evaluate((id) => {
      AP_DEBUG.setDirs(-1, 0, 0); let s = AP_DEBUG.snapshot(); for (let i = 0; i < 60 * 12 && s.state === 'ready'; i++) s = AP_DEBUG.step(1 / 60);
      AP_DEBUG.setDirs(0, 0, 0); AP_DEBUG.run(0.4, 60); s = AP_DEBUG.snapshot();
      const out = { started: s.state === 'playing', px0: s.knife.px, py0: s.knife.py, maxShift: 0, maxGapStep: 0, frames: 0, endedAt: null, lostAtEnd: null, angleAtEnd: null };
      let prevGap = s.probe.gap;
      AP_DEBUG.setDirs(0, 0, -1);
      for (let i = 0; i < 60 * 3 && s.state === 'playing'; i++) { s = AP_DEBUG.step(1 / 60); out.frames++; out.maxShift = Math.max(out.maxShift, Math.hypot(s.knife.px - out.px0, s.knife.py - out.py0)); out.maxGapStep = Math.max(out.maxGapStep, Math.abs(s.probe.gap - prevGap)); prevGap = s.probe.gap; }
      if (s.state === 'ended') { out.endedAt = s.knife.angleDeg; out.lostAtEnd = s.noContactMs; out.reason = s.endReason; }
      AP_DEBUG.setDirs(null); out.finalState = s.state; out.finalAngle = s.knife.angleDeg; out.atBoundAfter = out.maxShift >= 0.5 && Math.abs(s.knife.px - s.knife.bounds.minX) < 0.01;
      return out;
    }, id);
  }
  for (const id of IDS) {
    const c = cont[id];
    ok(NAMES[id] + ': 접촉 중 반시계로 기울이는 동안 피벗 이동 ' + f(c.maxShift, 2) + 'px' + (c.maxShift >= 0.5 ? '(날 끝이 과일 중심을 넘지 못하게 하는 이동 경계 MAX_DEPTH_RATIO 에 닿아 밀림)' : '') + ' · 프레임당 접촉 거리 변화 최대 ' + f(c.maxGapStep, 2) + 'px(≤ 2.5, 회전 60°/s × 날 길이) · ' + (c.finalState === 'ended' ? '각도 ' + f(c.endedAt) + '°에서 접촉이 끊겨 종료(이탈 ' + f(c.lostAtEnd) + 'ms > 150, 사유 ' + c.reason + ')' : '−75° 까지 접촉 유지'),
      c.started && (c.maxShift < 0.5 || c.atBoundAfter) && c.maxGapStep <= 2.5 && (c.finalState === 'playing' || (c.finalState === 'ended' && c.lostAtEnd > 150 && c.reason === 'detach')), c);
  }

  console.log('=== 5. 윗면(꼭지 주변) 절삭: ±40° 와 ±75° 비교 · 꼭지/윗 캡은 절삭되지 않음 · 플레이어 조작(미리 기울이고 닿는 만큼만) ===');
  const topRes = {};
  for (const id of IDS) {
    topRes[id] = {};
    for (const lim of [40, 75]) {
      topRes[id][lim] = await p.evaluate(({ id, dur, lim }) => {
        AP.CONFIG.KNIFE.MIN_ANGLE_DEG = -lim; AP.CONFIG.KNIFE.MAX_ANGLE_DEG = lim;
        AP_DEBUG.goIntro(); AP_DEBUG.selectFruit(id); document.getElementById('btn-start').click(); document.getElementById('btn-select-next').click();
        const ap = AP_DEBUG.apple, capBefore = Array.from(ap.caps.top.geometry.attributes.position.array.slice(0, 200)).join(','), stemBefore = ap.stem ? Array.from(ap.stem.geometry.attributes.position.array.slice(0, 50)).join(',') : '';
        const o = AP_DEBUG.runAutopilot(200, { single: true, dur, depthFrac: 0.6, pretilt: true }), s = o.snap, S = AP_DEBUG.surface(), NR = S.NR, NS = S.NS;
        const band = (r0, r1) => { let pc = 0, ta = 0; for (let r = r0; r < r1; r++) for (let j = 0; j < NS; j++) { ta++; if (AP_DEBUG.cellState(r, j).peeled) pc++; } return 100 * pc / ta; };
        const out = { state: s.state, why: s.endReason, peel: s.peelPct, flesh: s.fleshPct, top12: band(NR - 12, NR), top4: band(NR - 4, NR), bot12: band(0, 12), score: s.score.total,
          capSame: Array.from(AP_DEBUG.apple.caps.top.geometry.attributes.position.array.slice(0, 200)).join(',') === capBefore, stemSame: !ap.stem || Array.from(AP_DEBUG.apple.stem.geometry.attributes.position.array.slice(0, 50)).join(',') === stemBefore };
        AP.CONFIG.KNIFE.MIN_ANGLE_DEG = -75; AP.CONFIG.KNIFE.MAX_ANGLE_DEG = 75;
        return out;
      }, { id, dur: DUR[id], lim });
    }
  }
  console.log('과일     ±40°(윗끝4행 / 윗12행 / 전체)        ±75°(윗끝4행 / 윗12행 / 전체)');
  for (const id of IDS) { const a = topRes[id][40], c = topRes[id][75]; console.log((NAMES[id]).padEnd(7) + '  ' + (f(a.top4, 1) + '% / ' + f(a.top12, 1) + '% / ' + f(a.peel, 1) + '%').padEnd(36) + f(c.top4, 1) + '% / ' + f(c.top12, 1) + '% / ' + f(c.peel, 1) + '%  (점수 ' + c.score + ')'); }
  ok('사과: ±75° 로 윗 12행 ' + f(topRes.apple[40].top12, 0) + '% → ' + f(topRes.apple[75].top12, 0) + '% · 꼭지 바로 둘레 4행 ' + f(topRes.apple[40].top4, 0) + '% → ' + f(topRes.apple[75].top4, 0) + '% (목표 윗 12행 ≥ 88%, 4행 ≥ 70%)', topRes.apple[75].top12 >= 88 && topRes.apple[75].top4 >= 70 && topRes.apple[75].top4 > topRes.apple[40].top4 + 30, topRes.apple);
  ok('배: ±75° 로 윗 12행 ' + f(topRes.pear[40].top12, 0) + '% → ' + f(topRes.pear[75].top12, 0) + '% · 4행 ' + f(topRes.pear[40].top4, 0) + '% → ' + f(topRes.pear[75].top4, 0) + '% (목표 윗 12행 ≥ 80%, 4행 ≥ 55%)', topRes.pear[75].top12 >= 80 && topRes.pear[75].top4 >= 55 && topRes.pear[75].top4 > topRes.pear[40].top4 + 25, topRes.pear);
  ok('키위·용과(둥근 끝): ±75° 에서도 이전 이상(키위 윗 12행 ' + f(topRes.kiwi[75].top12, 0) + '% · 용과 ' + f(topRes.dragonfruit[75].top12, 0) + '%, 이전 ' + f(topRes.kiwi[40].top12, 0) + '/' + f(topRes.dragonfruit[40].top12, 0) + '%) · 아랫 12행도 유지(키위 ' + f(topRes.kiwi[75].bot12, 0) + '% · 용과 ' + f(topRes.dragonfruit[75].bot12, 0) + '%)', topRes.kiwi[75].top12 >= topRes.kiwi[40].top12 - 1 && topRes.dragonfruit[75].top12 >= topRes.dragonfruit[40].top12 - 1 && topRes.kiwi[75].bot12 >= topRes.kiwi[40].bot12 - 3 && topRes.dragonfruit[75].bot12 >= topRes.dragonfruit[40].bot12 - 3 && topRes.kiwi[75].top12 >= 80 && topRes.dragonfruit[75].top12 >= 90, topRes);
  ok('4종 모두 ±75° 에서 완주(이탈 종료) · 제거율 ≥ 90% · 과육 손실 < 0.5% · 점수 ≥ 93', IDS.every((id) => { const r = topRes[id][75]; return r.state === 'ended' && r.why === 'detach' && r.peel >= 90 && r.flesh < 0.5 && r.score >= 93; }), topRes);
  ok('꼭지·윗 캡은 절삭 대상이 아님: 깎은 뒤에도 윗 캡·줄기 메시 정점 불변(4종 · ±40/±75)', IDS.every((id) => [40, 75].every((lim) => topRes[id][lim].capSame && topRes[id][lim].stemSame)), topRes);
  /* 닿지 않은 채(간격 1.5~8px) 윗면 높이에서 크게 기울인 자세를 찾아, 자동 회전 3초 동안 READY 유지·절삭 0 확인 — 접촉하지 않은 영역은 깎이지 않는다 */
  const noAuto = await p.evaluate(() => {
    AP_DEBUG.goIntro(); AP_DEBUG.selectFruit('apple'); document.getElementById('btn-start').click(); document.getElementById('btn-select-next').click();
    const ys = AP.cutting.rowStageYs(), top = ys[ys.length - 1], cx = AP.scene.appleCx; let pose = null;
    AP_DEBUG.setKnifeAngleDeg(-70);
    for (let oy = 0; oy <= 300 && !pose; oy += 6) for (let ox = cx - 120; ox <= cx + 220; ox += 4) {
      AP_DEBUG.setKnifePos(ox, oy); const k = AP_DEBUG.snapshot().knife, pr = AP_DEBUG.probe();
      if (pr.inRange && pr.gap >= 1.5 && pr.gap <= 8 && Math.abs(k.py - top) < 40 && Math.abs(k.angleDeg + 70) < 1e-6) { pose = { ox, oy, gap: pr.gap, py: k.py }; break; }
    }
    if (!pose) return { pose: null };
    let st = 'ready', minGap = 1e9; for (let i = 0; i < 60 * 3; i++) { const s = AP_DEBUG.step(1 / 60); minGap = Math.min(minGap, s.probe.gap); st = s.state; if (st !== 'ready') break; }
    return { pose, state: st, peeled: AP_DEBUG.cellStats().peeled, minGap, top };
  });
  ok('닿지 않은 자세(간격 ' + f(noAuto.pose && noAuto.pose.gap, 1) + 'px, 칼 y ' + f(noAuto.pose && noAuto.pose.py, 0) + ' ≈ 윗면 ' + f(noAuto.top, 0) + ', −70°)에서 사과가 3초 도는 동안 READY 유지 · 절삭 0 — 접촉하지 않은 영역은 깎이지 않음', !!noAuto.pose && noAuto.state === 'ready' && noAuto.peeled === 0 && noAuto.minGap > 0.75, noAuto);
  await p.close();

  console.log('=== 6. 실제 키보드(실시간) — 능선 높이로 올라가 기울이고 접촉 · 이탈 종료 · 결과 화면 ===');
  for (const id of IDS) {
    const q = await b.newPage({ viewport: { width: 390, height: 844 } });
    const errs = []; q.on('pageerror', (e) => errs.push(e.message));
    await q.goto(URL); await q.waitForFunction(() => window.AP_READY === true, null, { timeout: 60000 });
    const snap = () => q.evaluate(() => { const s = AP_DEBUG.snapshot(); return { st: s.state, ang: s.knife.angleDeg, py: s.knife.py, minY: s.knife.bounds.minY, c: s.isBladeContacting, lost: s.contactLostMs, why: s.endReason, res: document.getElementById('screen-result').classList.contains('active'), qa: s.qaMode }; });
    const waitFor = async (pred, ms) => { const t0 = Date.now(); for (;;) { const x = await snap(); if (pred(x)) return x; if (Date.now() - t0 > ms) return null; await q.waitForTimeout(16); } };
    await q.click('#btn-start'); await q.click('.fruit-cell[data-fruit="' + id + '"]'); await q.click('#btn-select-next');
    await q.keyboard.down('ArrowUp'); const top = await waitFor((x) => x.py <= x.minY + 0.5, 8000); await q.keyboard.up('ArrowUp');       // 능선 높이: 날 끝이 과일 위 허공에 오도록
    await q.keyboard.down('KeyQ'); await q.waitForTimeout(1800); await q.keyboard.up('KeyQ');
    const a1 = await snap(); await q.waitForTimeout(300); const a2 = await snap();
    ok(NAMES[id] + ': 실제 Q 키를 누르고 있으면 −75° 까지 연속 회전(' + f(a1.ang, 1) + '°)하고 떼면 정지(0.3초 뒤 ' + f(a2.ang, 1) + '°) · 능선 높이(칼 y ' + f(a1.py, 0) + ' ≤ 한계 ' + f(a1.minY, 0) + '+0.5)에서 아직 READY', !!top && Math.abs(a1.ang + 75) < 0.5 && Math.abs(a2.ang - a1.ang) < 0.01 && a2.st === 'ready', { top, a1, a2 });
    await q.keyboard.down('KeyW'); await q.waitForTimeout(500); await q.keyboard.up('KeyW');
    const a3 = await snap();
    ok(NAMES[id] + ': 실제 W 키 0.5초 → 시계 방향 ' + f(a3.ang - a1.ang, 1) + '° 회전(≈ +27°)', a3.ang - a1.ang > 24 && a3.ang - a1.ang < 30, { a1, a3 });
    await q.keyboard.down('KeyQ'); await q.waitForTimeout(700); await q.keyboard.up('KeyQ');
    await q.keyboard.down('ArrowDown'); await q.waitForTimeout(250); await q.keyboard.up('ArrowDown');       // 거의 수평인 날은 몸통 쪽 윗면에 닿도록 조금 내린다
    await q.keyboard.down('ArrowLeft'); const hit = await waitFor((x) => x.st === 'playing', 9000); await q.keyboard.up('ArrowLeft');
    ok(NAMES[id] + ': 기울인 채(' + f(hit && hit.ang, 0) + '°) 윗면에서 첫 접촉 → PLAYING', !!hit && hit.ang < -60, hit);
    await q.waitForTimeout(500);
    await q.keyboard.down('ArrowRight'); const end = await waitFor((x) => x.st === 'ended', 6000); await q.keyboard.up('ArrowRight');
    const res = await waitFor((x) => x.res, 4000);
    ok(NAMES[id] + ': 칼을 빼면 종료(이탈 ' + f(end && end.lost) + 'ms > 150) → 결과 화면 표시 · 제품 기본 규칙(qa 꺼짐)', !!end && end.lost > 150 && end.why === 'detach' && !!res && end.qa === false && errs.length === 0, { end, res: !!res, errs });
    await q.close();
  }

  console.log('=== 7. 모바일 회전 버튼(터치 포인터) — 같은 범위·같은 동작 ===');
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const m = await ctx.newPage(); const merr = []; m.on('pageerror', (e) => merr.push(e.message));
  await m.goto(URL); await m.waitForFunction(() => window.AP_READY === true, null, { timeout: 60000 });
  await m.click('#btn-start'); await m.click('.fruit-cell[data-fruit="apple"]'); await m.click('#btn-select-next');
  const press = (dir, id) => m.evaluate(({ dir, id }) => { const el = document.querySelector('[data-dir="' + dir + '"]'); el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: id, pointerType: 'touch', bubbles: true, cancelable: true })); }, { dir, id });
  const lift = (dir, id) => m.evaluate(({ dir, id }) => { const el = document.querySelector('[data-dir="' + dir + '"]'); el.dispatchEvent(new PointerEvent('pointerup', { pointerId: id, pointerType: 'touch', bubbles: true })); }, { dir, id });
  const ms = () => m.evaluate(() => { const s = AP_DEBUG.snapshot(); return { st: s.state, ang: s.knife.angleDeg, py: s.knife.py, minY: s.knife.bounds.minY, lost: s.contactLostMs }; });
  /* 범위 확인은 규칙과 무관 — 호환 모드에서 +75 / −75 */
  await m.evaluate(() => AP_DEBUG.setLegacy(true));
  await press('cw', 1); await m.waitForTimeout(2800); const hi = (await ms()).ang; await lift('cw', 1);
  ok('↷ 버튼을 누르고 있으면 +75° 까지 연속 회전하고 멈춤(' + f(hi, 1) + '°)', Math.abs(hi - 75) < 0.5, { hi });
  await press('ccw', 2); await m.waitForTimeout(600); const mid = (await ms()).ang; const down = await m.evaluate(() => document.querySelector('[data-dir="ccw"]').classList.contains('is-down'));
  await m.waitForTimeout(2600); const lo = (await ms()).ang; await lift('ccw', 2); await m.waitForTimeout(300); const lo2 = (await ms()).ang;
  ok('↶ 버튼: 0.6초 후 ' + f(mid, 1) + '°(연속 회전) · 눌림 표시 ' + down + ' · −75° 에서 멈춤(' + f(lo, 1) + '°) · 떼면 정지(' + f(lo2, 1) + '°)', mid < 75 && down && Math.abs(lo + 75) < 0.5 && Math.abs(lo2 - lo) < 0.01, { mid, lo, lo2 });
  /* 실제 규칙으로 새 판: 능선 높이로 올라가(↑) ↶ 로 기울이고(−75°) ← 로 접촉 → → 로 빼면 종료 */
  await m.evaluate(() => { AP_DEBUG.setLegacy(false); AP_DEBUG.goIntro(); });
  await m.click('#btn-start'); await m.click('#btn-select-next');
  await press('up', 3); const t0 = Date.now(); while (Date.now() - t0 < 8000) { const x = await ms(); if (x.py <= x.minY + 0.5) break; await m.waitForTimeout(16); } await lift('up', 3);
  await press('ccw', 4); await m.waitForTimeout(1800); await lift('ccw', 4); const pre = await ms();
  await press('down', 7); await m.waitForTimeout(250); await lift('down', 7);
  await press('left', 5); const t1 = Date.now(); let st = 'ready'; while (Date.now() - t1 < 9000) { st = (await ms()).st; if (st !== 'ready') break; await m.waitForTimeout(16); } await lift('left', 5);
  const hitAng = (await ms()).ang;
  await m.waitForTimeout(400); await press('right', 6); const t2 = Date.now(); let st2 = 'playing', lost = 0; while (Date.now() - t2 < 6000) { const x = await ms(); st2 = x.st; lost = x.lost; if (st2 === 'ended') break; await m.waitForTimeout(16); } await lift('right', 6);
  const resShown = await m.waitForFunction(() => document.getElementById('screen-result').classList.contains('active'), null, { timeout: 5000 }).then(() => true, () => false);
  ok('모바일 버튼으로 능선 높이 · ' + f(pre.ang, 0) + '° 기울여 접촉(' + st + ', ' + f(hitAng, 0) + '°) → 오른쪽 버튼으로 빼면 종료(이탈 ' + f(lost) + 'ms > 150) → 결과 화면 ' + resShown, st === 'playing' && hitAng < -60 && st2 === 'ended' && lost > 150 && resShown && merr.length === 0, { pre, st, hitAng, st2, lost, resShown, merr });
  await ctx.close();

  ok('페이지 오류 없음', errors.length === 0, errors);
  await b.close(); console.log(failures === 0 ? '\n모든 검사 통과' : '\n실패 ' + failures + '건'); process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
