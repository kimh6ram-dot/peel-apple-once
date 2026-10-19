/* 제공 에셋(PNG 3장)을 **바이트 그대로** base64 로 내장한 src/game/assets-data.js 를 만들고,
 * 배치·판정에 필요한 실측값을 함께 기록한다. (형제 게임 261013_icecream 의 build-assets.js 와 같은 원칙)
 *
 * - 크롭/리사이즈/색보정 없음. 원본 파일을 그대로 data URL 로 감싼다(에셋 수정 금지).
 * - 왜 내장하나: file:// 로 index.html 을 더블클릭해 열면 <img> → WebGL 텍스처 업로드가 cross-origin 으로 막힌다.
 * - 실측값은 여기(데이터)에 두고, config.js 는 "원본 px → 스테이지 px" 배율과 비율만 가진다.
 *
 * 사과(red_apple.png / peeled_apple.png):
 *   - 알파 실루엣 → 행별 반폭(회전체 프로파일의 원천), 몸통 상단/하단, 회전축 x, 줄기(상단 가는 부분) 기울기·폭·길이
 *   - 색: 몸통을 높이 10 밴드로 나눈 평균색 + 정면 중앙 facet 평균색(알베도 기준) + 줄기 평균색
 * 칼(knife.png):
 *   - 행별로 회색(금속) / 갈색(손잡이) 픽셀을 분류 → bladeRegion(회색 bbox), handleRegion(갈색 bbox), bolster(혼재 띠)
 *   - bladeEdge = 회색 영역의 **왼쪽 실루엣**(곡선 쪽 = 날. 오른쪽 직선 = 등/spine) 을 팁부터 힐(최소 x 구간 끝)까지 폴리라인으로
 *
 * 사용: node tools/build-assets.js   (PNG 가 바뀌면 다시 실행)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const png = require('./png.js');

const ROOT = path.join(__dirname, '..');
const ASSET_DIR = path.join(ROOT, 'assets');
const OUT = path.join(ROOT, 'src', 'game', 'assets-data.js');

const A_TH = 128;   // 실루엣 알파 임계값

function load(name) {
  const file = path.join(ASSET_DIR, name);
  if (!fs.existsSync(file)) throw new Error('에셋 없음: ' + file + ' — 임의 생성/대체하지 않는다. 파일을 확인할 것');
  const buf = fs.readFileSync(file);
  const img = png.decode(buf);
  return { name, img, src: 'data:image/png;base64,' + buf.toString('base64'), bytes: buf.length };
}

/* 조건을 만족하는 불투명 화소의 평균색 */
function maskedColor(img, pred) {
  const { width: W, height: H, data } = img; let r = 0, g = 0, b = 0, n = 0;
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) { const o = (y * W + x) * 4; if (data[o + 3] < 200) continue; if (pred(data[o], data[o + 1], data[o + 2])) { r += data[o]; g += data[o + 1]; b += data[o + 2]; n++; } }
  return n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : null;
}
function alphaBBox(img, th) {
  const { width: W, height: H, data } = img;
  let minX = W, maxX = -1, minY = H, maxY = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (data[(y * W + x) * 4 + 3] > th) {
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}
function rowExtent(img, y, th) {
  const { width: W, data } = img;
  let l = -1, r = -1;
  for (let x = 0; x < W; x++) if (data[(y * W + x) * 4 + 3] > th) { if (l < 0) l = x; r = x; }
  return l < 0 ? null : { l, r, w: r - l + 1, cx: (l + r) / 2 };
}
function avgColor(img, x0, y0, x1, y1, step) {
  const { width: W, data } = img; let r = 0, g = 0, b = 0, n = 0;
  for (let y = y0; y <= y1; y += step) for (let x = x0; x <= x1; x += step) {
    const o = (y * W + x) * 4; if (data[o + 3] < 200) continue;
    r += data[o]; g += data[o + 1]; b += data[o + 2]; n++;
  }
  return n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : null;
}

/* ── 사과 ─────────────────────────────────────────────────────────────── */
function measureApple(a, opts) {
  opts = opts || {};
  const img = a.img;
  const bb = alphaBBox(img, 8);
  const rows = [];
  let maxW = 0;
  for (let y = bb.y; y < bb.y + bb.h; y++) { const e = rowExtent(img, y, A_TH); rows.push({ y, e }); if (e && e.w > maxW) maxW = e.w; }
  // 몸통 상단 = 위에서 내려오며 폭이 처음 최대폭의 30% 를 넘는 행(그 위는 줄기)
  let bodyTop = -1, bodyBottom = -1;
  for (const r of rows) { if (r.e && (opts.noStem || r.e.w > maxW * 0.30)) { bodyTop = r.y; break; } }   // noStem(키위·용과): 실루엣 맨 위 행이 몸통 상단
  for (const r of rows) { if (r.e) bodyBottom = r.y; }
  // 회전축 x = 몸통 20~80% 높이 행들의 중심 평균
  let axisX = 0, n = 0;
  for (const r of rows) if (r.e && r.y > bodyTop + (bodyBottom - bodyTop) * 0.2 && r.y < bodyTop + (bodyBottom - bodyTop) * 0.8) { axisX += r.e.cx; n++; }
  axisX /= n;
  // 프로파일: 몸통 상단→하단, 2행마다 (y, 반폭 = max(cx - l, r - cx)) — 좌우 비대칭은 큰 쪽을 쓴다
  const profile = [];
  for (const r of rows) if (r.e && r.y >= bodyTop && (r.y - bodyTop) % 2 === 0) profile.push([r.y - bodyTop, +Math.max(axisX - r.e.l, r.e.r - axisX).toFixed(1)]);
  // 줄기: 몸통 상단 위의 행들
  const stemRows = rows.filter((r) => r.e && r.y < bodyTop);
  let stem = null;
  if (stemRows.length > 8) {
    const top = stemRows[0], base = stemRows[stemRows.length - 1];
    const widths = stemRows.map((r) => r.e.w).sort((p, q) => p - q);
    const tipW = stemRows.slice(0, 6).reduce((s, r) => s + r.e.w, 0) / 6;
    stem = {
      tip: [top.e.cx, top.y], base: [base.e.cx, base.y],
      visibleLen: base.y - top.y + 1,
      width: widths[Math.floor(widths.length / 2)], tipWidth: tipW,
      leanDeg: +(Math.atan2(top.e.cx - base.e.cx, base.y - top.y) * 180 / Math.PI).toFixed(1),   // + = 위쪽이 오른쪽으로 기움
      color: avgColor(img, bb.x, top.y + Math.round((base.y - top.y) * 0.3), bb.x + bb.w, base.y, 2),
      topColor: avgColor(img, bb.x, top.y, bb.x + bb.w, top.y + Math.round((base.y - top.y) * 0.12), 1),
    };
  }
  // 색: 높이 10 밴드 평균 + 정면 중앙(폭 중앙 20%) 평균
  const H = bodyBottom - bodyTop;
  const bands = [], center = [];
  for (let k = 0; k < 10; k++) {
    const y0 = bodyTop + Math.round(H * k / 10), y1 = bodyTop + Math.round(H * (k + 1) / 10) - 1;
    bands.push(avgColor(img, bb.x, y0, bb.x + bb.w, y1, 3));
    center.push(avgColor(img, Math.round(axisX - maxW * 0.1), y0, Math.round(axisX + maxW * 0.1), y1, 2));
  }
  return {
    w: img.width, h: img.height, src: a.src, bbox: bb,
    bodyTop, bodyBottom, bodyHeight: H, maxWidth: maxW, radiusPx: maxW / 2, axisX: +axisX.toFixed(1),
    profile, stem, colorBands: bands, colorCenter: center,
    colorFrontMid: avgColor(img, Math.round(axisX - maxW * 0.12), bodyTop + Math.round(H * 0.40), Math.round(axisX + maxW * 0.12), bodyTop + Math.round(H * 0.55), 2),
  };
}

/* ── 칼 ───────────────────────────────────────────────────────────────── */
function measureKnife(k) {
  const img = k.img, { width: W, data } = img;
  const bb = alphaBBox(img, 8);
  const rows = [];
  for (let y = bb.y; y < bb.y + bb.h; y++) {
    let gl = -1, gr = -1, bl = -1, br = -1, gn = 0, bn = 0, al = -1, ar = -1;
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4; if (data[o + 3] <= A_TH) continue;
      if (al < 0) al = x; ar = x;
      const r = data[o], g = data[o + 1], b = data[o + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx === 0 ? 0 : (mx - mn) / mx;
      const brown = sat > 0.25 && r > g && g > b;   // 손잡이: 채도 있는 갈색. 금속: 무채색
      if (brown) { if (bl < 0) bl = x; br = x; bn++; } else { if (gl < 0) gl = x; gr = x; gn++; }
    }
    rows.push({ y, al, ar, gl, gr, gn, bl, br, bn });
  }
  const grayRows = rows.filter((r) => r.gn >= 3);
  const tipRow = grayRows[0];
  let lastGrayDom = -1, firstBrownDom = -1;
  for (const r of rows) if (r.gn > r.bn && r.gn > 5) lastGrayDom = r.y;
  for (const r of rows) if (r.bn > r.gn && r.bn > 5) { firstBrownDom = r.y; break; }
  const bolsterRows = rows.filter((r) => r.gn > 5 && r.bn > 5);
  const bladeRows = rows.filter((r) => r.gn >= 3 && r.y <= lastGrayDom);
  let bladeMinX = Infinity, bladeMaxX = -1;
  for (const r of bladeRows) { bladeMinX = Math.min(bladeMinX, r.gl); bladeMaxX = Math.max(bladeMaxX, r.gr); }
  // 날(edge): 왼쪽 실루엣. 팁부터 "최소 x 구간의 끝"(힐이 손잡이 쪽으로 되감기기 직전)까지
  let minGl = Infinity; for (const r of bladeRows) minGl = Math.min(minGl, r.gl);
  let edgeEndY = tipRow.y; for (const r of bladeRows) if (r.gl <= minGl + 4) edgeEndY = r.y;
  const edge = [], spine = [], heel = [];
  for (const r of bladeRows) {
    if (r.y === tipRow.y || (r.y - tipRow.y) % 6 === 0 || r.y === edgeEndY) {
      if (r.y <= edgeEndY) edge.push([r.gl, r.y]); else heel.push([r.gl, r.y]);
      spine.push([r.gr, r.y]);
    }
  }
  if (edge[edge.length - 1][1] !== edgeEndY) edge.push([bladeRows.find((r) => r.y === edgeEndY).gl, edgeEndY]);
  const handleRows = rows.filter((r) => r.bn >= 3 && r.y >= firstBrownDom);
  let hMinX = Infinity, hMaxX = -1;
  for (const r of handleRows) { hMinX = Math.min(hMinX, r.bl); hMaxX = Math.max(hMaxX, r.br); }
  return {
    w: img.width, h: img.height, src: k.src, bbox: bb,
    tip: [tipRow.gl + (tipRow.gr - tipRow.gl) / 2, tipRow.y],
    bladeRegion: { x: bladeMinX, y: tipRow.y, w: bladeMaxX - bladeMinX + 1, h: lastGrayDom - tipRow.y + 1 },
    bladeLen: lastGrayDom - tipRow.y + 1,
    bolster: { y0: bolsterRows.length ? bolsterRows[0].y : lastGrayDom, y1: bolsterRows.length ? bolsterRows[bolsterRows.length - 1].y : firstBrownDom },
    handleRegion: { x: hMinX, y: firstBrownDom, w: hMaxX - hMinX + 1, h: bb.y + bb.h - firstBrownDom },
    edge, edgeEndY, heel, spine,
    bladeColor: avgColor(img, bladeMinX, tipRow.y, bladeMaxX, lastGrayDom, 3),
    handleColor: avgColor(img, hMinX, firstBrownDom, hMaxX, bb.y + bb.h - 1, 3),
  };
}

/* ── 용과: 분홍 본체 윤곽 + 잎 돌기 실측 ── */
function measureDragon(a) {
  const img = a.img, W = img.width, H = img.height, d = img.data;
  const skin = new Uint8Array(W * H), leafM = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4; if (d[o + 3] <= A_TH) continue;
    const r = d[o], g = d[o + 1], b = d[o + 2];
    if (r > 90 && r > g * 1.7 && r > b * 1.1) skin[y * W + x] = 1;                 // 분홍·자홍·진홍(아래쪽 어두운 부분 포함) = 본체 껍질
    else if (g >= r * 0.7 && g > b * 1.1) leafM[y * W + x] = 1;                   // 노랑~초록 = 잎
  }
  const ext = [];
  for (let y = 0; y < H; y++) { let l = -1, r = -1, n = 0; for (let x = 0; x < W; x++) if (skin[y * W + x]) { if (l < 0) l = x; r = x; n++; } ext.push(n >= 4 ? { l, r, n } : null); }
  let bodyTop = -1, bodyBottom = -1; for (let y = 0; y < H; y++) if (ext[y]) { if (bodyTop < 0) bodyTop = y; bodyBottom = y; }
  const centers = []; for (let y = bodyTop; y <= bodyBottom; y++) if (ext[y] && ext[y].r - ext[y].l > 200) centers.push((ext[y].l + ext[y].r) / 2);
  centers.sort((p, q) => p - q); const axisX = centers[Math.floor(centers.length / 2)];
  // 반폭: 좌우 중 큰 쪽(잎이 한쪽 가장자리를 가려도 보정) → 위아래 ±3행 최대 → ±6행 평균
  const hw = []; for (let y = bodyTop; y <= bodyBottom; y++) hw.push(ext[y] ? Math.max(axisX - ext[y].l, ext[y].r - axisX) : 0);
  /* 윤곽 피팅: 잎이 가장자리를 가린 행은 반폭이 작게 나온다. 가려진 점(피팅보다 3px 이상 작은 점)의 가중치를 낮추며 8차 다항식을 반복 피팅 → 원본처럼 매끈한 달걀형 */
  function polyfit(xs, ys, ws, deg) {
    const n = deg + 1, M = []; for (let r = 0; r < n; r++) M.push(new Array(n + 1).fill(0));
    for (let i = 0; i < xs.length; i++) { const xp = [1]; for (let j = 1; j <= 2 * deg; j++) xp[j] = xp[j - 1] * xs[i]; for (let r = 0; r < n; r++) { for (let c = 0; c < n; c++) M[r][c] += ws[i] * xp[r + c]; M[r][n] += ws[i] * ys[i] * xp[r]; } }
    for (let c = 0; c < n; c++) { let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r; [M[c], M[piv]] = [M[piv], M[c]]; for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; } }
    return M.map((row, r) => row[n] / row[r]);
  }
  /* 반폭의 제곱을 피팅한다(꼭대기가 뾰족한 달걀형은 hw ≈ √t 처럼 시작하므로 hw² 가 다항식으로 잘 맞는다). 꼭대기 행(잎에 가려 폭이 작은 행)도 포함. */
  const ts = hw.map((_, i) => i / (hw.length - 1)), valid = hw.map((v) => v > 2), sq = hw.map((v) => v * v);
  let wts = hw.map((v, i) => (valid[i] ? 1 : 0)), coef = null;
  const ev = (c, t) => { let v = 0, tp = 1; for (let j = 0; j < c.length; j++) { v += c[j] * tp; tp *= t; } return v; };
  const evh = (c, t) => Math.sqrt(Math.max(0, ev(c, t)));
  for (let it = 0; it < 6; it++) { coef = polyfit(ts, sq, wts, 7); wts = hw.map((v, i) => (!valid[i] ? 0 : (v - evh(coef, ts[i]) < -3 ? 0.08 : 1))); }
  const sm = ts.map((t) => Math.max(4, evh(coef, t)));
  const bodyHeight = bodyBottom - bodyTop, maxHw = Math.max.apply(null, sm);
  const profile = []; for (let i = 0; i < sm.length; i += 2) profile.push([i, +sm[i].toFixed(1)]);
  // 본체 색(정면 중앙의 껍질 화소 평균)
  let cr = 0, cg = 0, cb = 0, cn = 0;
  for (let y = bodyTop + Math.round(bodyHeight * 0.4); y <= bodyTop + Math.round(bodyHeight * 0.6); y++) for (let x = Math.round(axisX - maxHw * 0.4); x <= Math.round(axisX + maxHw * 0.4); x++) if (skin[y * W + x]) { const o = (y * W + x) * 4; cr += d[o]; cg += d[o + 1]; cb += d[o + 2]; cn++; }
  const colorFrontMid = [Math.round(cr / cn), Math.round(cg / cn), Math.round(cb / cn)];
  // 잎: 잎 화소의 연결 성분(3px 격자) → 주축(PCA)·팁·밑동·폭
  const S = 3, gw = Math.ceil(W / S), gh = Math.ceil(H / S), lab = new Int32Array(gw * gh).fill(-1), comps = [];
  const isLeaf = (gx, gy) => { const x = gx * S + 1, y = gy * S + 1; return x < W && y < H && leafM[y * W + x]; };
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    if (lab[gy * gw + gx] >= 0 || !isLeaf(gx, gy)) continue;
    const id = comps.length, st = [[gx, gy]], px = []; lab[gy * gw + gx] = id;
    while (st.length) { const [cx, cy] = st.pop(); px.push([cx * S + 1, cy * S + 1]); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= gw || ny >= gh || lab[ny * gw + nx] >= 0 || !isLeaf(nx, ny)) continue; lab[ny * gw + nx] = id; st.push([nx, ny]); } }
    comps.push(px);
  }
  /* 잎 11개의 배치는 원본 PNG 를 잎 마스크 오버레이 위에서 직접 읽은 값이다(밑동 중심 · 밑동 폭 · 팁, PNG px).
   * 자동 추정(주축·접촉 가장자리)은 밑동이 넓은 삼각형 잎·본체 옆면에 걸친 잎에서 방향을 틀리게 잡아 쓰지 않는다.
   * 팁은 읽은 위치 근처의 실제 잎 화소 중 방향상 가장 먼 점으로 스냅하고, 색 단계(노랑·초록)는 각 잎의 삼각형 영역 안 잎 화소에서 실측한다. */
  const READ = [
    { id: 'apex',       base: [615, 242], wid: 160, tip: [577, 108] },     // 맨 위 큰 잎
    { id: 'upL-thin',   base: [503, 268], wid: 46,  tip: [477, 207] },     // 왼쪽 위 가는 잎
    { id: 'upL-big',    base: [480, 452], wid: 165, tip: [445, 282] },     // 왼쪽 위 큰 잎
    { id: 'upR',        base: [752, 325], wid: 104, tip: [712, 200] },     // 오른쪽 위 잎
    { id: 'edgeR',      base: [880, 502], wid: 46,  tip: [866, 358] },     // 오른쪽 가장자리 작은 잎
    { id: 'midR-big',   base: [695, 600], wid: 225, tip: [760, 438] },     // 중앙 오른쪽 큰 잎
    { id: 'midL',       base: [365, 612], wid: 92,  tip: [318, 460] },     // 왼쪽 잎
    { id: 'lowL-big',   base: [555, 826], wid: 190, tip: [470, 695] },     // 아래 중앙 큰 잎
    { id: 'lowR',       base: [828, 786], wid: 112, tip: [930, 628] },     // 오른쪽 아래 잎
    { id: 'lowL-edge',  base: [432, 866], wid: 62,  tip: [350, 760] },     // 왼쪽 아래 가장자리 잎
    { id: 'bottom',     base: [700, 928], wid: 88,  tip: [790, 880] },     // 맨 아래 잎
  ];
  const leaves = [], ycol = [0, 0, 0, 0], gcol = [0, 0, 0, 0];
  for (const L of READ) {
    const bx = L.base[0], by = L.base[1];
    let ux = L.tip[0] - bx, uy = L.tip[1] - by; const l0 = Math.hypot(ux, uy); ux /= l0; uy /= l0;
    // 팁 스냅: 읽은 팁 주변 14px 안의 잎 화소 중 방향(밑동→팁)으로 가장 먼 점
    let tip = L.tip.slice(), best = -1e9;
    for (let y = Math.max(0, L.tip[1] - 14); y < Math.min(H, L.tip[1] + 14); y++) for (let x = Math.max(0, L.tip[0] - 14); x < Math.min(W, L.tip[0] + 14); x++) if (leafM[y * W + x]) { const t = (x - bx) * ux + (y - by) * uy; if (t > best) { best = t; tip = [x, y]; } }
    const len = Math.hypot(tip[0] - bx, tip[1] - by), vx = -uy, vy = ux, hwid = L.wid / 2;
    // 삼각형(밑동 좌·우 모서리, 팁) 안의 잎 화소로 색 단계 실측
    const A = [bx + vx * hwid, by + vy * hwid], B = [bx - vx * hwid, by - vy * hwid];
    const x0 = Math.floor(Math.min(A[0], B[0], tip[0])), x1 = Math.ceil(Math.max(A[0], B[0], tip[0])), y0 = Math.floor(Math.min(A[1], B[1], tip[1])), y1 = Math.ceil(Math.max(A[1], B[1], tip[1]));
    let inN = 0;
    for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) {
      if (!leafM[y * W + x]) continue;
      const t = ((x - bx) * (tip[0] - bx) + (y - by) * (tip[1] - by)) / (len * len), pp = Math.abs((x - bx) * vx + (y - by) * vy), lim = hwid * (1 - t) * 1.1 + 4;
      if (t < -0.05 || pp > lim) continue; inN++;
      const o = (y * W + x) * 4; if (t >= 0.1 && t <= 0.4) { ycol[0] += d[o]; ycol[1] += d[o + 1]; ycol[2] += d[o + 2]; ycol[3]++; } if (t >= 0.65) { gcol[0] += d[o]; gcol[1] += d[o + 1]; gcol[2] += d[o + 2]; gcol[3]++; }
    }
    leaves.push({ id: L.id, bx, by, tx: tip[0], ty: tip[1], len: +len.toFixed(1), wid: L.wid, pixels: inN });
  }
  const avg = (c) => c[3] ? [Math.round(c[0] / c[3]), Math.round(c[1] / c[3]), Math.round(c[2] / c[3])] : null;
  return { w: W, h: H, src: null, bbox: { x: Math.round(axisX - maxHw), y: bodyTop, w: Math.round(maxHw * 2), h: bodyHeight + 1 }, bodyTop, bodyBottom, bodyHeight, maxWidth: +(maxHw * 2).toFixed(1), radiusPx: +maxHw.toFixed(1), axisX: +axisX.toFixed(1),
    profile, stem: null, colorBands: [], colorCenter: [], colorFrontMid, leaves, leafStops: { yellow: avg(ycol), green: avg(gcol) } };
}

const red = load('red_apple.png');
const peeled = load('peeled_apple.png');
const knife = load('knife.png');

/* 사과 PNG 2장은 "형태·색의 기준" 으로만 쓴다(3D 메시를 그리므로 텍스처로 올리지 않는다) → 바이트는 내장하지 않고 실측값만.
 * 칼 PNG 는 그대로 스프라이트로 표시하므로 내장한다. 사과 PNG 가 텍스처로 필요해지면 EMBED 를 바꾼다. */
const EMBED = { red: false, peeled: false, knife: true };
const out = {
  red: measureApple(red),
  peeled: measureApple(peeled),
  knife: measureKnife(knife),
};
for (const key of Object.keys(EMBED)) if (!EMBED[key]) out[key].src = null;

/* 과일 4종: 이미지 전체 캔버스가 아니라 **불투명 실루엣 bbox** 를 실측한다(캔버스 크기가 과일마다 다르다 — 사과 1173×1341, 나머지 1080×1080).
 * 껍질/과육(peeled) 쌍은 같은 scale·같은 기준점(껍질 버전 bbox 중심)을 공유하므로 두 bbox 를 모두 기록한다. 파일이 없으면 건너뛴다(준비 중). */
/* 플레이용 형태(shape): 사과 외 3종은 사과와 같은 방식(measureApple)으로 실루엣 프로파일·색을 실측한다. 줄기가 없는 과일은 noStem. */
/* dragonfruit: 껍질 이미지에는 초록 "잎" 돌기가 있다. 절삭 형태(프로파일)는 돌기를 뺀 분홍 본체의 윤곽에서, 잎은 위치·크기·방향·색 단계를 실측해 3D 장식 메시로 만든다(measureDragon). */
const FRUIT_SHAPE_OPTS = { pear: {}, kiwi: { noStem: true }, dragonfruit: { dragon: true } };
const FRUIT_FILES = {
  apple: ['red_apple.png', 'peeled_apple.png'],
  pear: ['pear_unpeeled.png', 'pear_peeled.png'],
  kiwi: ['kiwi_unpeeled.png', 'kiwi_peeled.png'],
  dragonfruit: ['dragonfruit_unpeeled.png', 'dragonfruit_peeled.png'],
};
out.fruits = {};
for (const id of Object.keys(FRUIT_FILES)) {
  const pair = FRUIT_FILES[id];
  if (!pair.every((n) => fs.existsSync(path.join(ASSET_DIR, n)))) continue;
  const m = pair.map((n) => { const im = png.decode(fs.readFileSync(path.join(ASSET_DIR, n))); const b = alphaBBox(im, A_TH); return { file: n, w: im.width, h: im.height, bbox: b, longest: Math.max(b.w, b.h) }; });
  out.fruits[id] = { whole: m[0], peeled: m[1] };
  if (FRUIT_SHAPE_OPTS[id]) {
    const o = FRUIT_SHAPE_OPTS[id], wImg = load(pair[0]), pImg = load(pair[1]);
    let w, pe;
    if (o.dragon) {
      w = measureDragon(wImg); pe = measureApple(pImg, { noStem: true });
      pe.colorFrontMid = maskedColor(pImg.img, (r, g, b) => r > 170 && g > 160 && b > 140);                       // 과육색: 밝은 크림 화소만(검은 씨앗 점 제외)
      out.fruits[id].sizeLongest = Math.max(w.bodyHeight, w.maxWidth);                                            // 크기 기준 길이 = 분홍 본체(잎 제외)
    } else { w = measureApple(wImg, o); pe = measureApple(pImg, o); }
    w.src = null; pe.src = null;
    out.fruits[id].shape = { whole: w, peeledColorFrontMid: pe.colorFrontMid, peeledColorBands: pe.colorBands };
  }
}

const header = '/* 자동 생성 — node tools/build-assets.js. 직접 수정하지 말 것.\n' +
  ' * 제공 PNG 원본 바이트를 그대로 base64 내장(크롭/리사이즈/보정 없음) + 배치·판정용 실측값. */\n' +
  "'use strict';\n";
fs.writeFileSync(OUT, header + 'window.AP_ASSETS = ' + JSON.stringify(out) + ';\n');

const summary = JSON.parse(JSON.stringify(out));
for (const key of ['red', 'peeled', 'knife']) {
  summary[key].src = '(data URL, ' + { red, peeled, knife }[key].bytes + ' bytes png)';
  if (summary[key].profile) summary[key].profile = summary[key].profile.length + ' samples (every 2 rows)';
}
summary.knife.edge = summary.knife.edge.length + ' pts ' + JSON.stringify(out.knife.edge.slice(0, 3)) + ' … ' + JSON.stringify(out.knife.edge.slice(-2));
summary.knife.spine = summary.knife.spine.length + ' pts';
summary.knife.heel = summary.knife.heel.length + ' pts';
console.log(JSON.stringify(summary, null, 2));
console.log('→ ' + path.relative(ROOT, OUT) + ' (' + fs.statSync(OUT).size + ' bytes)');
