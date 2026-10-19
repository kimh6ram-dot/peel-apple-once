/* 사과 — 표면 데이터(셀) + Three.js 메시.
 *
 * 표면 = 회전체 높이장 r(θ, y): 바닥 캡 위(링 0)부터 윗면 능선(링 NR)까지. 셀 (i, j) = 링 i~i+1 × 섹터 j~j+1 (로컬 각 기준 → 회전해도 유지).
 *  셀 상태(명세 §6): r0 원래 반경 · rec 누적 절삭 깊이(반경 방향, r = r0 - rec) · skin 껍질 두께(반경 방향 환산) ·
 *                 peeled 껍질 제거 여부 · fleshLoss 누적 과육 손실 깊이(껍질 아래로 들어간 px) · state 0 미절삭/1 껍질 제거/2 과육 파임 ·
 *                 area 면적 가중치. 집계: peeledArea / fleshVolume (cutting.js 가 갱신).
 * 메시 = non-indexed BufferGeometry(셀당 삼각형 2개). 정점 위치는 "보이는 24×16 로우폴리 facet 평면 위" 에 놓이도록 링 반지름을
 *  띠 경계(매듭)에서 선형 보간하고 둘레는 현(chord) 보정 → 외형은 로우폴리, 절삭 해상도는 96×48.
 *  코너 정점의 반경 = 링 반지름 - (그 코너를 공유하는 셀 4개의 최대 rec): 파인 셀이 코너를 끌어당겨 이웃 셀이 경사진 벽이 된다(틈 없음, 실제 파임).
 *  법선: 변형 없는 셀은 facet 법선, 코너가 움직인 셀은 실제 삼각형 법선(홈의 벽이 명암으로 드러난다).
 *  색: 상태 0 = 껍질(빨강), 1·2 = 과육(크림, 손실 깊이에 따라 어둡게). 두 PNG 의 정면 중앙 facet 실측색이 알베도.
 * 윗면(능선 안쪽 캐비티)·바닥·줄기는 별도 로우폴리(절삭 대상 아님. 능선/바닥 반경 < 칼 범위 0.5R 라 돌출하지 않는다). */
'use strict';
window.AP = window.AP || {};

AP.apple = (function () {
  var C = AP.CONFIG;
  var TAU = Math.PI * 2;
  var current = null;

  function srgb(rgb) { return new THREE.Color().setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace); }

  /* ── 표면 데이터 ─────────────────────────────────────────────────────── */
  /* P = AP.fruits.params(id): { id, asset(실루엣 프로파일), R(최대 반지름 px), style 'cavity'|'dome', cutTopRatio, cutBottomRatio|null, skinThickness, colors, stem }
   * 사과의 P 는 기존 config 값 그대로라 사과 표면은 이전과 완전히 같다. */
  function createSurface(P) {
    var A = P.asset;
    var R = P.R;
    var k = R / A.radiusPx;                       // PNG px → 월드(스테이지 px)
    var bodyH = A.bodyHeightPx * k;
    var crestDy = 0;
    for (var d = 0; d < A.bodyHeightPx; d++) { if (A.halfWidthAt(d) >= P.cutTopRatio * A.radiusPx) { crestDy = d; break; } }
    var ring0Dy = A.bodyHeightPx * (1 - C.BOTTOM_CAP_RATIO);
    if (P.cutBottomRatio) { ring0Dy = A.bodyHeightPx; for (var d2 = A.bodyHeightPx; d2 >= 0; d2--) { if (A.halfWidthAt(d2) >= P.cutBottomRatio * A.radiusPx) { ring0Dy = d2; break; } } }   // 절삭 가능 하단 = 반경이 이 비율 이상인 마지막 행
    var NR = C.VISUAL_RINGS * C.SUB_RINGS, NS = C.VISUAL_SECTORS * C.SUB_SECTORS;
    var centerDy = (crestDy + ring0Dy) / 2;       // 몸통(능선~링0) 세로 중앙 = 원점
    function yOfDy(dy) { return (centerDy - dy) * k; }

    var knotR = [], knotY = [];
    for (var m = 0; m <= C.VISUAL_RINGS; m++) {
      var dy = ring0Dy + (crestDy - ring0Dy) * m / C.VISUAL_RINGS;
      knotR.push(A.halfWidthAt(dy) * k); knotY.push(yOfDy(dy));
    }
    var ringR0 = new Float32Array(NR + 1), ringY = new Float32Array(NR + 1);
    for (var i = 0; i <= NR; i++) {
      var mm = Math.min(C.VISUAL_RINGS - 1, Math.floor(i / C.SUB_RINGS)), f = i / C.SUB_RINGS - mm;
      ringR0[i] = knotR[mm] + (knotR[mm + 1] - knotR[mm]) * f;
      ringY[i] = knotY[mm] + (knotY[mm + 1] - knotY[mm]) * f;
    }
    var n = NR * NS;
    var S = {
      R: R, k: k, bodyH: bodyH, NR: NR, NS: NS, fruitId: P.id, decorReach: (P.decor && P.decor.leaves && A.leaves) ? Math.max.apply(null, A.leaves.map(function (l) { return l.len; })) * k * 0.8 : 0, asset: A, yOfDy: yOfDy, seeds: (P.decor && P.decor.seeds) || null, style: P.style, colors: P.colors, skinThickness: P.skinThickness,
      crestY: yOfDy(crestDy), ring0Y: yOfDy(ring0Dy), crestR: knotR[C.VISUAL_RINGS], ring0R: knotR[0],
      topY: yOfDy(0), bottomY: yOfDy(A.bodyHeightPx),
      knotR: knotR, knotY: knotY, ringR0: ringR0, ringY: ringY,
      r0: new Float32Array(n), rec: new Float32Array(n), skin: new Float32Array(n), skinNx: new Float32Array(n),
      peeled: new Uint8Array(n), fleshLoss: new Float32Array(n), state: new Uint8Array(n),
      area: new Float32Array(n), totalArea: 0, volume: 0, peeledArea: 0, fleshVolume: 0, fleshIndex: 0, maxRec: 0,
    };
    /* 돔 캡(키위·용과): 실루엣 프로파일을 그대로 따라 능선→꼭대기, 링0→바닥으로 닫는다(절삭 대상 아님) */
    S.domeTop = []; S.domeBottom = [];
    for (var q = 0; q <= 8; q++) {
      var dT = crestDy * (1 - q / 8), dB = ring0Dy + (A.bodyHeightPx - ring0Dy) * q / 8;
      S.domeTop.push([A.halfWidthAt(dT) * k, yOfDy(dT)]); S.domeBottom.push([A.halfWidthAt(dB) * k, yOfDy(dB)]);
    }
    /* 맨 위·아래는 평평한 원판이 아니라 윤곽을 따라 둥글게 닫는다(타원 호). 원판 반지름이 큰 과일(용과 0.3R)에서 "뚜껑" 처럼 보이던 것을 없앤다 — 반지름이 작은 키위는 사실상 변화 없음 */
    var rTop = A.halfWidthAt(0) * k, rBot = A.halfWidthAt(A.bodyHeightPx) * k, hTop = rTop * 0.45, hBot = rBot * 0.18;
    for (var cq = 1; cq <= 4; cq++) { var ph = cq / 4 * Math.PI / 2; S.domeTop.push([rTop * Math.cos(ph), yOfDy(0) + hTop * Math.sin(ph)]); S.domeBottom.push([rBot * Math.cos(ph), yOfDy(A.bodyHeightPx) - hBot * Math.sin(ph)]); }
    S.capExtraTop = P.style === 'dome' ? hTop : 0; S.capExtraBottom = P.style === 'dome' ? hBot : 0;
    if (P.style === 'cavity') {
      var stp = P.stem;
      if (!stp) { S.stemSpec = null; S.topExtent = S.topY; }
      else if (stp.img) {        // 실측 줄기(배): 이미지 px 치수 × k. 캐비티 안쪽으로 박힌 길이만큼 더 길게
        S.stemSpec = { len: stp.img.visibleLen * k + C.CAVITY_DEPTH_RATIO * bodyH, rTop: stp.img.tipWidth / 2 * k, rBase: stp.img.width / 2 * k, lean: stp.img.leanDeg };
        S.topExtent = S.topY + stp.img.visibleLen * k;
      } else { S.stemSpec = { len: stp.len * bodyH, rTop: stp.rTopRatio * R, rBase: stp.rBaseRatio * R, lean: stp.leanDeg }; S.topExtent = S.topY + stp.topExtentRatio * bodyH; }
    } else { S.stemSpec = null; S.topExtent = S.topY + S.capExtraTop; }
    for (var ii = 0; ii < NR; ii++) {
      var band = Math.floor(ii / C.SUB_RINGS);
      var slope = (knotR[band + 1] - knotR[band]) / (knotY[band + 1] - knotY[band]);   // dr/dy
      var nx = 1 / Math.sqrt(1 + slope * slope);                                        // facet 법선의 x 성분(θ=0)
      for (var j = 0; j < NS; j++) {
        var idx = ii * NS + j, rc = (ringR0[ii] + ringR0[ii + 1]) / 2;
        S.r0[idx] = rc;
        S.skinNx[idx] = nx;
        S.skin[idx] = P.skinThickness / Math.max(nx, C.CUT.N_X_MIN);   // 법선 방향 두께 → 반경 방향 두께
        var a = rc * (TAU / NS) * Math.abs(ringY[ii + 1] - ringY[ii]);
        S.area[idx] = a; S.totalArea += a;
        S.volume += a * rc / 2;                       // 축까지의 쐐기 부피(= 몸통 부피 근사) — 과육 손실률의 분모
      }
    }
    S.index = function (i, j) { return i * NS + ((j % NS) + NS) % NS; };
    S.r = function (idx) { return S.r0[idx] - S.rec[idx]; };
    S.resetCells = function () {
      for (var q = 0; q < n; q++) { S.rec[q] = 0; S.peeled[q] = 0; S.fleshLoss[q] = 0; S.state[q] = 0; }
      S.peeledArea = 0; S.fleshVolume = 0; S.fleshIndex = 0; S.maxRec = 0;
    };
    /* 링 i · 섹터 j 코너를 공유하는 셀(최대 4개)의 최대 rec — 메시 코너 반경과 실루엣이 같은 규칙을 쓴다 */
    S.cornerRec = function (i, j) {
      var jj = ((j % NS) + NS) % NS, jp = (jj + NS - 1) % NS, m = 0;
      if (i > 0) { var b = (i - 1) * NS; m = Math.max(m, S.rec[b + jj], S.rec[b + jp]); }
      if (i < NR) { var c = i * NS; m = Math.max(m, S.rec[c + jj], S.rec[c + jp]); }
      return m;
    };
    return S;
  }

  /* ── 메시 ────────────────────────────────────────────────────────────── */
  function facetNormals(S) {
    var out = [], dTh = TAU / C.VISUAL_SECTORS;
    for (var m = 0; m < C.VISUAL_RINGS; m++) {
      var row = [], slope = (S.knotR[m + 1] - S.knotR[m]) / (S.knotY[m + 1] - S.knotY[m]);
      for (var kf = 0; kf < C.VISUAL_SECTORS; kf++) {
        var th = (kf + 0.5) * dTh;
        var v = new THREE.Vector3(Math.cos(th), -slope, Math.sin(th)).normalize();
        row.push([v.x, v.y, v.z]);
      }
      out.push(row);
    }
    return out;
  }
  function chordFactor(j) {
    var dTh = TAU / C.VISUAL_SECTORS, half = dTh / 2;
    var th = (j % (C.VISUAL_SECTORS * C.SUB_SECTORS)) * (TAU / (C.VISUAL_SECTORS * C.SUB_SECTORS));
    var kf = Math.floor(th / dTh + 1e-9), mid = (kf + 0.5) * dTh;
    return Math.cos(half) / Math.cos(th - mid);
  }

  function buildBodyMesh(S) {
    var NR = S.NR, NS = S.NS, cells = NR * NS;
    var pos = new Float32Array(cells * 18), nor = new Float32Array(cells * 18), col = new Float32Array(cells * 18);
    var geo = new THREE.BufferGeometry();
    var aPos = new THREE.BufferAttribute(pos, 3), aNor = new THREE.BufferAttribute(nor, 3), aCol = new THREE.BufferAttribute(col, 3);
    aPos.setUsage(THREE.DynamicDrawUsage); aNor.setUsage(THREE.DynamicDrawUsage); aCol.setUsage(THREE.DynamicDrawUsage);
    var peelS = new Float32Array(cells * 6), peelF = new Float32Array(cells * 6);       // 정점별 "벗겨짐" 값: 매끈(코너 평균) / 셀 단위(비교용)
    var aPeel = new THREE.BufferAttribute(peelS, 1), aPeelF = new THREE.BufferAttribute(peelF, 1);
    aPeel.setUsage(THREE.DynamicDrawUsage); aPeelF.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', aPos); geo.setAttribute('normal', aNor); geo.setAttribute('color', aCol); geo.setAttribute('aPeel', aPeel); geo.setAttribute('aPeelF', aPeelF);
    var mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: C.APPLE_ROUGHNESS, metalness: 0, side: THREE.FrontSide });
    /* 경계 렌더링: 판정 셀(96×48)은 그대로 두고, 색만 "코너 평균 벗겨짐 값"을 삼각형 안에서 보간해 0.5 등치선으로 자른다(화면 미분 폭의 안티앨리어싱, 블러 아님).
     * 셀 하나가 통째로 색이 바뀌던 계단이 사라지고 경계가 셀 안을 대각선으로 지나는 곡선이 된다. 정점·판정·반경은 전혀 바뀌지 않는다. */
    var peelU = { uSkin: { value: srgb(S.colors.skin) }, uSmooth: { value: 1 } };
    /* 씨앗(용과): 과육 색 위에만, 3D 공간(과일 로컬 좌표)에 흩어진 점들이 표면과 만나는 자리에 검은 점으로 보인다 — 깨처럼 박혀 있고, 과일과 함께 회전하며,
     * 깊이 파면 파인 표면(정점 위치 = 절삭 반영)을 따라 점의 자리가 자연스럽게 바뀐다. 껍질(분홍)·돌기·리본에는 적용되지 않는다(pt = 과육 가중치). */
    var seedU = S.seeds ? { uSeed: { value: new THREE.Vector4(S.seeds.cell, S.seeds.prob, S.seeds.radius[0], S.seeds.radius[1]) }, uSeedColor: { value: srgb(S.seeds.color || [34, 28, 30]) } } : null;
    mat.onBeforeCompile = function (shader) {
      shader.uniforms.uSkin = peelU.uSkin; shader.uniforms.uSmooth = peelU.uSmooth;
      if (seedU) { shader.uniforms.uSeed = seedU.uSeed; shader.uniforms.uSeedColor = seedU.uSeedColor; }
      shader.vertexShader = shader.vertexShader.replace('#include <common>', ['#include <common>', 'attribute float aPeel; attribute float aPeelF; uniform float uSmooth; varying float vPeel;', seedU ? 'varying vec3 vLocal;' : ''].join('\n'))
        .replace('#include <begin_vertex>', ['#include <begin_vertex>', 'vPeel = mix(aPeelF, aPeel, uSmooth);', seedU ? 'vLocal = position;' : ''].join('\n'));
      var seedFn = seedU ? [
        'varying vec3 vLocal; uniform vec4 uSeed; uniform vec3 uSeedColor;',
        'vec3 hash33(vec3 p) { p = fract(p * vec3(.1031, .1030, .0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }',
        'float seedMask(vec3 P) { vec3 ip = floor(P / uSeed.x); float m = 0.0;',
        '  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {',
        '    vec3 c = ip + vec3(float(x), float(y), float(z)); vec3 h = hash33(c); if (h.x > uSeed.y) continue;',
        '    vec3 ctr = (c + hash33(c + 7.7)) * uSeed.x; float rr = mix(uSeed.z, uSeed.w, h.y);',
        '    m = max(m, 1.0 - smoothstep(rr - 0.45, rr + 0.45, length(P - ctr))); }',
        '  return m; }'].join('\n') : '';
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', ['#include <common>', 'varying float vPeel; uniform vec3 uSkin;', seedFn].join('\n'))
        .replace('#include <color_fragment>', 'float pw = max(fwidth(vPeel), 1e-3) * 0.75; float pt = smoothstep(0.5 - pw, 0.5 + pw, vPeel); diffuseColor.rgb = mix(uSkin, vColor.rgb, pt);' + (seedU ? ' diffuseColor.rgb = mix(diffuseColor.rgb, uSeedColor, seedMask(vLocal) * pt * 0.96);' : ''));
    };
    mat.customProgramCacheKey = function () { return 'ap-peel-iso' + (seedU ? '-seeds' : ''); };
    var mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;

    var fn = facetNormals(S);
    var skin = srgb(S.colors.skin), flesh = srgb(S.colors.flesh);
    var cosT = new Float32Array(NS + 1), sinT = new Float32Array(NS + 1), chord = new Float32Array(NS + 1);
    for (var j = 0; j <= NS; j++) { var th = (j % NS) * TAU / NS; cosT[j] = Math.cos(th); sinT[j] = Math.sin(th); chord[j] = chordFactor(j); }

    var tmp = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    function corner(i, j) { var rho = (S.ringR0[i] - S.cornerRec(i, j)) * chord[j]; return [rho * cosT[j], S.ringY[i], rho * sinT[j]]; }
    /* 셀 하나의 정점 6개(삼각형 2개, 바깥쪽에서 CCW) 를 다시 쓴다 */
    function writeCell(i, j) {
      var idx = i * NS + j, base = idx * 18;
      var p00 = corner(i, j), p10 = corner(i, j + 1), p01 = corner(i + 1, j), p11 = corner(i + 1, j + 1);
      var tri = [p00, p11, p10, p00, p01, p11];
      var deformed = S.cornerRec(i, j) > 0 || S.cornerRec(i, j + 1) > 0 || S.cornerRec(i + 1, j) > 0 || S.cornerRec(i + 1, j + 1) > 0;
      var nrm;
      if (deformed) {   // 코너가 움직인 셀: 실제 삼각형 법선(두 삼각형 평균)
        e1.set(p11[0] - p00[0], p11[1] - p00[1], p11[2] - p00[2]); e2.set(p10[0] - p00[0], p10[1] - p00[1], p10[2] - p00[2]);
        tmp.crossVectors(e1, e2);
        e1.set(p01[0] - p00[0], p01[1] - p00[1], p01[2] - p00[2]); e2.set(p11[0] - p00[0], p11[1] - p00[1], p11[2] - p00[2]);
        tmp.add(e1.cross(e2)).normalize();
        nrm = [tmp.x, tmp.y, tmp.z];
      } else {
        nrm = fn[Math.floor(i / C.SUB_RINGS)][Math.floor(j / C.SUB_SECTORS)];
      }
      /* 정점(코너)별 값: 코너를 공유하는 셀(최대 4)의 벗겨진 비율 · 벗겨진 셀들의 평균 어두움 → 과육색 */
      var own = S.state[idx] >= 1 ? 1 : 0;
      var cks = [[i, j], [i + 1, j + 1], [i, j + 1], [i, j], [i + 1, j], [i + 1, j + 1]];
      for (var v = 0; v < 6; v++) {
        var o = base + v * 3, cv = cornerVals(cks[v][0], cks[v][1]);
        pos[o] = tri[v][0]; pos[o + 1] = tri[v][1]; pos[o + 2] = tri[v][2];
        nor[o] = nrm[0]; nor[o + 1] = nrm[1]; nor[o + 2] = nrm[2];
        var dk = 1 - cv.dark;
        col[o] = flesh.r * dk; col[o + 1] = flesh.g * dk; col[o + 2] = flesh.b * dk;
        peelS[idx * 6 + v] = cv.peel; peelF[idx * 6 + v] = own;
      }
    }
    var cvTmp = { peel: 0, dark: 0 };
    function cornerVals(i, j) {
      var jj = ((j % NS) + NS) % NS, jp = (jj + NS - 1) % NS, n = 0, pc = 0, dsum = 0;
      for (var q = 0; q < 4; q++) {
        var ci = q < 2 ? i - 1 : i, cj = (q & 1) ? jp : jj;
        if (ci < 0 || ci >= NR) continue;
        var id2 = ci * NS + cj; n++;
        if (S.state[id2] >= 1) { pc++; dsum += C.CUT.FLESH_DARKEN * Math.min(1, S.fleshLoss[id2] / C.CUT.FLESH_DARKEN_DEPTH); }
      }
      cvTmp.peel = n ? pc / n : 0; cvTmp.dark = pc ? dsum / pc : 0;
      return cvTmp;
    }
    function rebuildAll() {
      for (var i = 0; i < NR; i++) for (var j = 0; j < NS; j++) writeCell(i, j);
      aPos.clearUpdateRanges(); aNor.clearUpdateRanges(); aCol.clearUpdateRanges(); aPeel.clearUpdateRanges(); aPeelF.clearUpdateRanges();
      aPos.needsUpdate = true; aNor.needsUpdate = true; aCol.needsUpdate = true; aPeel.needsUpdate = true; aPeelF.needsUpdate = true;
    }
    /* 변형된 셀 + 코너를 공유하는 이웃 8셀을 다시 쓰고, 그 범위만 GPU 에 올린다 */
    var dirty = new Uint8Array(cells), dirtyList = [];
    function markDirty(idx) { if (!dirty[idx]) { dirty[idx] = 1; dirtyList.push(idx); } }
    var touched = new Uint8Array(cells);
    function flushDirty() {
      if (!dirtyList.length) return 0;
      var count = 0;
      for (var q = 0; q < dirtyList.length; q++) {
        var idx = dirtyList[q], i = Math.floor(idx / NS), j = idx % NS;
        dirty[idx] = 0;
        for (var di = -1; di <= 1; di++) {
          var ii = i + di; if (ii < 0 || ii >= NR) continue;
          for (var dj = -1; dj <= 1; dj++) {
            var jj = (j + dj + NS) % NS, t = ii * NS + jj;
            if (touched[t]) continue;
            touched[t] = 1;
            writeCell(ii, jj);
            aPos.addUpdateRange(t * 18, 18); aNor.addUpdateRange(t * 18, 18); aCol.addUpdateRange(t * 18, 18); aPeel.addUpdateRange(t * 6, 6); aPeelF.addUpdateRange(t * 6, 6);
            count++;
          }
        }
      }
      for (var w = 0; w < dirtyList.length; w++) { var ci = dirtyList[w], ii2 = Math.floor(ci / NS), jj2 = ci % NS; for (var a = -1; a <= 1; a++) for (var b = -1; b <= 1; b++) { var ir = ii2 + a; if (ir < 0 || ir >= NR) continue; touched[ir * NS + (jj2 + b + NS) % NS] = 0; } }
      dirtyList.length = 0;
      aPos.needsUpdate = true; aNor.needsUpdate = true; aCol.needsUpdate = true; aPeel.needsUpdate = true; aPeelF.needsUpdate = true;
      return count;
    }
    /* QA: 셀의 6정점 평균 반경(xz) — 실제 메시가 파였는지 확인용 */
    function cellMeshRadius(idx) { var b = idx * 18, s = 0; for (var v = 0; v < 6; v++) s += Math.hypot(pos[b + v * 3], pos[b + v * 3 + 2]); return s / 6; }
    rebuildAll();
    return { mesh: mesh, setSmooth: function (b) { peelU.uSmooth.value = b ? 1 : 0; }, get smooth() { return peelU.uSmooth.value === 1; }, rebuildAll: rebuildAll, markDirty: markDirty, flushDirty: flushDirty, cellMeshRadius: cellMeshRadius };
  }

  function lathe(points, color, segments) {
    var pts = points.map(function (p) { return new THREE.Vector2(Math.max(0, p[0]), p[1]); });
    var geo = new THREE.LatheGeometry(pts, segments);
    var mat = new THREE.MeshStandardMaterial({ color: color, roughness: C.APPLE_ROUGHNESS, metalness: 0, flatShading: true, side: THREE.DoubleSide });
    var m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    return m;
  }
  function buildCaps(S) {
    var skin = srgb(S.colors.skin);
    if (S.style === 'dome') {
      return { top: lathe(S.domeTop, skin, C.VISUAL_SECTORS), bottom: lathe(S.domeBottom, skin, C.VISUAL_SECTORS), cavityBottomY: S.crestY };
    }
    var rc = S.crestR, yc = S.crestY, rise = C.CAVITY_RIM_RISE * S.bodyH, D = C.CAVITY_DEPTH_RATIO * S.bodyH;
    var top = lathe([
      [rc, yc], [rc * 0.92, yc + rise * 0.8], [rc * 0.78, yc + rise], [rc * 0.62, yc + rise * 0.3],
      [rc * 0.45, yc - D * 0.45], [rc * 0.25, yc - D * 0.85], [rc * 0.10, yc - D], [0, yc - D],
    ], skin, C.VISUAL_SECTORS);
    var r0 = S.ring0R, y0 = S.ring0Y, hb = C.BOTTOM_CAP_RATIO * S.bodyH;
    var bottom = lathe([
      [r0, y0], [r0 * 0.75, y0 - hb * 0.5], [r0 * 0.45, y0 - hb * 0.85], [r0 * 0.18, y0 - hb], [r0 * 0.07, y0 - hb * 0.88], [0, y0 - hb * 0.85],
    ], skin, C.VISUAL_SECTORS);
    return { top: top, bottom: bottom, cavityBottomY: yc - D };
  }
  function buildStem(S, baseY) {
    var st = C.STEM, sp = S.stemSpec, len = sp.len;
    var geo = new THREE.CylinderGeometry(sp.rTop, sp.rBase, len, st.SEGMENTS, 1, false);
    geo.translate(0, len / 2, 0);
    var mat = new THREE.MeshStandardMaterial({ color: srgb(S.colors.stem), roughness: 0.9, metalness: 0, flatShading: true });
    var m = new THREE.Mesh(geo, mat);
    m.position.set(0, baseY, 0);
    m.rotation.z = -sp.lean * Math.PI / 180;    // 위쪽이 +x 로 기움
    m.frustumCulled = false;
    return m;
  }

  /* ── 장식(용과의 잎 돌기) ──
   * 원본 PNG 에서 실측한 잎 11장(밑동 중심·폭·팁, assets-data 의 leaves)을 3D 로 옮긴다. 잎은 밑동이 넓고 끝이 뾰족한 로우폴리 "불꽃"이고(가운데가 접힌 능선, 위·바깥으로 휨),
   * 밑동은 분홍~주황빛, 중간은 노란빛 연두, 끝은 초록(색 단계도 PNG 실측). 앞면 11장은 PNG 와 같은 자리, 뒷면은 일부만 배치한다.
   * 잎은 장식 — 절삭·접촉 판정·셀 데이터에 관여하지 않는다. 대신 밑동이 붙은 표면 셀(밑동 폭 × 위 방향) 중 하나라도 벗겨지면 그 잎은 사라진다(과육 위에 잎이 남지 않는다). */
  function buildDecor(S, P) {
    var A = P.asset, d = P.decor; if (!d || !d.leaves || !A.leaves || !P.colors.leaf) return null;
    var NR = S.NR, NS = S.NS, k = S.k, g = new THREE.Group(), items = [];
    var skin = srgb(P.colors.skin), yel = srgb(P.colors.leaf.yellow), grn = srgb(P.colors.leaf.green);
    var cBase = skin.clone().lerp(yel, 0.12), cB0 = skin.clone().lerp(yel, 0.42), cMid = yel.clone().lerp(grn, 0.6);   // 밑동은 분홍~주황빛(원본), 위로 갈수록 노랑 → 초록
    var mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, flatShading: true, side: THREE.DoubleSide });
    var rowH = (S.ringY[NR] - S.ringY[0]) / NR;
    function leafGeometry(L, W) {
      /* 로컬: x 폭 · y 잎 방향 · z 바깥. 링(s): 밑동 아래 묻힌 부분 → 밑동 → 1/3 → 2/3 → 끝 근처 → 팁 */
      var rings = [[-0.12, 1.0, cBase, -0.05], [0, 1.0, cB0, 0], [0.30, 0.72, yel, 0.02], [0.62, 0.42, cMid, 0.07], [0.86, 0.17, grn, 0.13]];   // [s, 폭 비율, 색, 바깥 휨]: 본체에 납작하게 붙어 끝만 살짝 들린다
      var pos = [], col = [], tipC = grn.clone().multiplyScalar(0.95);
      function V(x, y, z, c) { pos.push(x, y, z); col.push(Math.min(1, c.r * 1.3), Math.min(1, c.g * 1.3), Math.min(1, c.b * 1.3)); }   // 원본처럼 밝은 연두~초록(조명에 어두워지지 않게 보정)
      function ring(r) { var s0 = r[0], hw = W * 0.5 * r[1], y = L * s0, z = L * (r[3] + 0.18 * s0 * s0) * (s0 < 0 ? 1 : 1), ridge = 0.10 * W * Math.max(0, 1 - Math.max(0, s0)); return { l: [-hw, y, z], c: [0, y, z + ridge], r: [hw, y, z], col: r[2] }; }
      var R = rings.map(ring);
      function tri(a, b, c) { V(a[0][0], a[0][1], a[0][2], a[1]); V(b[0][0], b[0][1], b[0][2], b[1]); V(c[0][0], c[0][1], c[0][2], c[1]); }
      for (var i = 0; i < R.length - 1; i++) {
        var A0 = R[i], B0 = R[i + 1];
        tri([A0.l, A0.col], [B0.l, B0.col], [B0.c, B0.col]); tri([A0.l, A0.col], [B0.c, B0.col], [A0.c, A0.col]);
        tri([A0.c, A0.col], [B0.c, B0.col], [B0.r, B0.col]); tri([A0.c, A0.col], [B0.r, B0.col], [A0.r, A0.col]);
      }
      var T = R[R.length - 1], tip = [0, L, L * 0.24];
      tri([T.l, T.col], [tip, tipC], [T.c, T.col]); tri([T.c, T.col], [tip, tipC], [T.r, T.col]);
      var geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.computeVertexNormals();
      return geo;
    }
    function place(L0, theta, dyp, scale, tag) {
      var hwp = A.halfWidthAt(dyp), rho = hwp * k, y = S.yOfDy(dyp);
      var slope = (A.halfWidthAt(Math.max(0, dyp - 6)) - A.halfWidthAt(dyp + 6)) / 12;           // dρ/dy
      var cs = Math.cos(theta), sn = Math.sin(theta);
      var nOut = new THREE.Vector3(cs, -slope, sn).normalize(), eT = new THREE.Vector3(-sn, 0, cs), tUp = new THREE.Vector3().crossVectors(eT, nOut).normalize();
      var ux = (L0.tx - L0.bx) / L0.len, uy = -(L0.ty - L0.by) / L0.len;                       // PNG 에서 밑동→팁 방향(오른쪽 +, 위 +)
      var dir = new THREE.Vector3().addScaledVector(nOut, ux * cs).addScaledVector(eT, -ux * sn).addScaledVector(tUp, uy);
      var dn = dir.dot(nOut); if (dn < 0.12) dir.addScaledVector(nOut, 0.12 - dn); dir.normalize();
      /* 잎의 넓은 면이 처음(회전 0°) 카메라를 향하도록: 폭 축 = 잎 방향 × 시선(0,0,1). 원본 PNG 도 한 시점에서 잎의 넓은 면을 보여준다(가장자리 잎이 옆면으로 가늘게 보이지 않게). 바깥 쪽(zAx)은 본체 바깥을 향하게 맞춘다 */
      var view = new THREE.Vector3(0, 0, 1), xAx = new THREE.Vector3().crossVectors(dir, view);
      if (xAx.lengthSq() < 0.05) xAx.crossVectors(dir, nOut); xAx.normalize();
      var zAx = new THREE.Vector3().crossVectors(xAx, dir).normalize(); if (zAx.dot(nOut) < 0) { zAx.negate(); xAx.negate(); }
      var Lw = L0.len * k * scale * 1.15, Ww = L0.wid * k * scale;   // 길이 ×1.15: 휘어 눕힌 잎은 화면에서 PNG 보다 짧게 보이므로 보정
      var mesh = new THREE.Mesh(leafGeometry(Lw, Ww), mat);
      var P0 = new THREE.Vector3(rho * cs, y, rho * sn).addScaledVector(nOut, -0.08 * Lw);
      mesh.matrixAutoUpdate = false; mesh.matrix.makeBasis(xAx, dir, zAx).setPosition(P0); mesh.frustumCulled = false;
      /* 붙은 표면 셀(밑동 폭 × 위쪽): 하나라도 벗겨지면 사라진다. 캡 구간(셀 없음)에 붙은 잎은 항상 보인다 */
      var row = Math.floor((y - S.ringY[0]) / rowH), sec = Math.floor(((theta % TAU + TAU) % TAU) / TAU * NS), nsx = Math.max(1, Math.ceil((Ww * 0.5) / (Math.max(rho, 1) * TAU / NS)));
      var cells = []; for (var rr = row - 1; rr <= row + 2; rr++) { if (rr < 0 || rr >= NR) continue; for (var ss = -nsx; ss <= nsx; ss += Math.max(1, Math.floor(nsx / 2))) cells.push(rr * NS + (((sec + ss) % NS) + NS) % NS); }
      g.add(mesh); items.push({ mesh: mesh, cells: cells, tag: tag });
    }
    var front = A.leaves;
    front.forEach(function (L0) {
      var dxp = L0.bx - A.axisX, dyp = Math.max(0, Math.min(A.bodyHeightPx - 1, L0.by - A.bodyTop)), hwp = Math.max(1, A.halfWidthAt(dyp));
      var theta = Math.acos(Math.max(-0.98, Math.min(0.98, dxp / hwp)));                         // 앞면(sin > 0): PNG 의 x 위치 → 각도
      place(L0, theta, dyp, 1, 'front');
    });
    front.forEach(function (L0, i) {                                                            // 뒷면: 가장자리에 걸치지 않은 잎 중 일부(과밀 방지)
      var dxp = L0.bx - A.axisX, dyp0 = L0.by - A.bodyTop, hwp = Math.max(1, A.halfWidthAt(Math.max(0, dyp0)));
      var th = Math.acos(Math.max(-0.98, Math.min(0.98, dxp / hwp)));
      if (i % 2 !== 0 || th < 0.5 || th > Math.PI - 0.5) return;
      var dyp = Math.max(0, Math.min(A.bodyHeightPx - 1, dyp0 + (i % 4 === 0 ? 28 : -28)));
      place(L0, -th + 0.35, dyp, 0.92, 'back');
    });
    return { group: g, items: items, material: mat };
  }

  /* ── 생성 ────────────────────────────────────────────────────────────── */
  function create(fid) {
    var S = createSurface(AP.fruits.params(fid || 'apple'));
    var body = buildBodyMesh(S);
    var caps = buildCaps(S);
    var stem = S.stemSpec ? buildStem(S, caps.cavityBottomY) : null;
    var group = new THREE.Group();
    group.add(body.mesh, caps.top, caps.bottom);
    var decor = buildDecor(S, AP.fruits.params(fid || 'apple'));
    if (decor) group.add(decor.group);
    function decorSync() { if (!decor) return; for (var q = 0; q < decor.items.length; q++) { var it = decor.items[q], vis = true; for (var c = 0; c < it.cells.length; c++) if (S.state[it.cells[c]] !== 0) { vis = false; break; } it.mesh.visible = vis; } }
    if (stem) group.add(stem);

    /* 표면 추적 디버그 마커: 로컬 각 90°(φ=0 일 때 정면) 적도 위 점 → 정면(z>0)에 있을 때 화면 x 가 커져야 한다 */
    var widest = 0; for (var i = 1; i <= S.NR; i++) if (S.ringR0[i] > S.ringR0[widest]) widest = i;
    var marker = new THREE.Mesh(new THREE.SphereGeometry(3.5, 8, 6), new THREE.MeshBasicMaterial({ color: 0x1A1A2E }));
    marker.position.set(0, S.ringY[widest], S.ringR0[widest]);
    marker.visible = false;
    group.add(marker);

    var viewScale = 1;   // 화면 배율(짧은 화면에서 기울기 0 의 칼이 능선~바닥 전체에 닿도록 사과를 줄일 때 < 1). 표면 데이터는 배율과 무관(사과 단위)
    var apple = {
      group: group, surface: S, body: body, stem: stem, caps: caps, marker: marker, fruitId: S.fruitId,
      dispose: function () { group.traverse(function (o) { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); },
      setAngle: function (phi) { group.rotation.y = phi; },
      setViewScale: function (vs) { viewScale = vs; group.scale.set(vs, vs, vs); },
      get viewScale() { return viewScale; },
      resetSurface: function () { S.resetCells(); body.rebuildAll(); decorSync(); },
      markDirty: body.markDirty, flushDirty: function () { var n = body.flushDirty(); decorSync(); return n; }, decor: decor,
      /* 월드 각 0(칼 쪽, +x) 에 지금 와 있는 표면의 링 i 점(월드 좌표 = 사과 단위 × 화면 배율). 코너 반경 규칙(인접 셀 최대 rec)과 동일 */
      meridianPoint: function (i) {
        var sector = AP.rotation.sectorAtWorld(0, S.NS);
        return new THREE.Vector3((S.ringR0[i] - S.cornerRec(i, sector)) * viewScale, S.ringY[i] * viewScale, 0);
      },
      markerWorld: function () { var v = new THREE.Vector3(); marker.updateWorldMatrix(true, false); return v.setFromMatrixPosition(marker.matrixWorld); },
    };
    current = apple;
    return apple;
  }

  /* 칼 쪽(월드 각 0) 자오선을 스테이지 좌표 폴리라인으로 — 바닥 캡·윗면 캡은 절삭 대상이 아니므로 제외. */
  function meridianStage() {
    var S = current.surface, pts = [];
    for (var i = 0; i <= S.NR; i++) { var p = AP.scene.project(current.meridianPoint(i)); pts.push([p.x, p.y, i]); }
    return pts;   // 위로 갈수록 stage y 가 작아진다(i 증가 = 위)
  }
  /* 스테이지 y 에서 칼 쪽 실루엣(자오선)의 x. 범위 밖이면 null */
  function silhouetteX(stageY) {
    var pts = meridianStage();
    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i], b = pts[i + 1];       // a 아래(y 큼), b 위(y 작음)
      if (stageY <= a[1] && stageY >= b[1]) { var t = a[1] === b[1] ? 0 : (a[1] - stageY) / (a[1] - b[1]); return a[0] + (b[0] - a[0]) * t; }
    }
    return null;
  }

  /* 과일별 표면 통계(캐시) — 점수 정규화(기준 껍질 길이·과육 손실 민감도)가 쓴다. 메시는 만들지 않는다 */
  var statCache = {};
  function stats(fid) {
    if (!statCache[fid]) { var S = createSurface(AP.fruits.params(fid)); /* 기준 과육 손실률: 모든 셀을 "껍질 두께의 절반만큼 더" 판 경우(= 껍질 두께 × 1.5 깊이)의 손실 지수 / 부피 — 같은 상대 깊이로 깎으면 같은 감점이 되게 하는 과육 민감도의 기준 */
      var K = AP.fruits.CONFIGS[fid].cutting.fleshConvexRef, sum = 0, n = S.NR * S.NS;
      for (var q = 0; q < n; q++) { var e = 0.5 * S.skin[q]; sum += S.area[q] * (e + e * e / K); }
      statCache[fid] = { totalArea: S.totalArea, volume: S.volume, R: S.R, skin: S.skinThickness, bodyH: S.crestY - S.ring0Y, refLossPct: 100 * sum / S.volume, skinLayerPct: 100 * S.totalArea * S.skinThickness / S.volume }; }   /* skinLayerPct = 껍질 층 전체의 부피(% of 과일 부피) — 점수의 낭비 계수가 쓴다 */
    return statCache[fid];
  }
  return { create: create, stats: stats, silhouetteX: silhouetteX, meridianStage: meridianStage, get current() { return current; } };
})();
