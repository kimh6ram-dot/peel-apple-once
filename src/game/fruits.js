/* 과일 설정 — 하나의 공통 절삭 엔진, 과일마다 설정값과 에셋만 바뀐다(주차하기의 parkingModes 처럼 확장 가능한 config).
 * 새 과일 추가 = 이 표에 항목 + PNG 2장 + tools/build-assets.js 의 FRUIT_FILES/FRUIT_SHAPE_OPTS. 절삭 엔진(cutting.js 등)은 수정하지 않는다.
 *
 * 상태(status):
 *   'no-assets' 이미지가 없거나 provided:false 또는 로드 실패 — 오류 없이 선택 불가(카드 비활성)
 *   'no-shape'  이미지는 있으나 실루엣 형태(shape) 실측/model 이 없음 — 플레이 불가
 *   'ready'     플레이 가능(4종 모두)
 *
 * ── 크기: 실루엣 기준 상대 배율 ──
 * 이미지 캔버스 px 가 아니라 **불투명 실루엣 bbox**(AP_ASSETS.fruits[id].whole)의 긴 변이 과일 "길이". 사과 길이를 1 로 두고
 *   previewScale: 선택 화면 표시 / playScale: 플레이 화면 — **3D 메시 자체**가 이 배율로 만들어진다(AP.fruits.playK → apple.js createSurface).
 * 그래서 보이는 크기 = 절삭 판정 표면 크기(CSS scale 로 이미지만 키우지 않는다). 화면에 안 들어가면 layout 의 viewScale(전체)만 줄어들고 과일 간 비율은 유지된다.
 *
 * ── 과일별로 독립 조절하는 값 ──
 *   model     형태: style 'cavity'(윗면 움푹+줄기: 사과·배) | 'dome'(둥글게 닫힘: 키위·용과), cutTopRatio / cutBottomRatio = 절삭 가능 높이 범위
 *             (최대 반지름 대비 이 비율 이상인 구간만 몸통 링 = 절삭 대상, 그 바깥은 절삭 불가 캡). 외곽 곡선 자체는 PNG 실루엣 프로파일.
 *   rotation  period(초/바퀴)
 *   cutting   skinThickness(껍질 두께 px), widthScale·windowHalf(절삭 폭), fleshConvexRef(깊을수록 과육 손실이 빨리 늘어나는 정도 = 과육 손실 민감도)
 *   ribbon    width(껍질 리본 폭 px)
 *   scoring   lenRefCm · fleshSensitivity — null 이면 기하에서 자동 유도(아래)
 *   색        PNG 정면 중앙 실측색 × 1.05(조명 보정, 사과 값과 같은 비율). 사과는 기존 config 색 그대로.
 *
 * ── 점수 정규화(과일이 크다고 점수가 높아지지 않게) ──
 *   제거율 = 제거 면적 / 그 과일의 절삭 가능 표면적, 과육 손실률 = 손실 부피 / 그 과일의 몸통 부피(둘 다 비율이라 크기와 무관).
 *   기준 껍질 길이 lenRefCm = 100cm × (면적 ÷ 절삭 폭) / (사과 면적 ÷ 사과 절삭 폭) — "한 줄로 쭉 깎았을 때의 전체 길이"에 비례(사과 = 100).
 *   과육 손실 민감도 = (사과의 "껍질×1.5 깊이로 깎았을 때 과육 손실률") ÷ (그 과일의 같은 값) — 작거나 껍질이 상대적으로 두꺼운 과일은 같은 상대 깊이에서 손실률이 더 크게 잡히므로 보정(사과 = 1).
 *   최소 껍질 경로(기본 점수 조건)도 lenRef 비율로 스케일. */
'use strict';
window.AP = window.AP || {};

AP.fruits = (function () {
  var C0 = AP.CONFIG;
  /* 평가 문구(5구간, 모든 과일 공통 틀 — {과일} 만 이름으로 바뀐다): 90+ "{과일} 깎기 국가대표" · 85~89 "아까 조금만 잘했어도 90점인데" · 75~84 "제법 깎음. (잘깎는다는 말은 ❌)" · 50~74 "너 이거보다 잘할 수 있잖아" · 0~49 "내 {과일}가 죽었어" */
  function gradesFor(name) { var T = AP.CONFIG.SCORE.TIERS; return [[T[0], name + ' 깎기 국가대표'], [T[1], '아까 조금만 잘했어도 ' + T[0] + '점인데'], [T[2], '제법 깎음. (잘깎는다는 말은 ❌)'], [T[3], ['이거보다 잘할 수 있잖아요', '웃기려고 그런거죠?']], [T[4], '내 ' + name + '가 죽었어']]; }
  var APPLE_GRADES = gradesFor('사과');
  var APPLE_COLORS = { skin: C0.SKIN_COLOR.slice(), flesh: C0.FLESH_COLOR.slice(), stem: C0.STEM_COLOR.slice() };   // 사과 = 기존 config 값
  var LIGHT_GAIN = 1.05;
  var CONFIGS = {
    apple: {
      id: 'apple', name: '사과', difficulty: '보통', previewScale: 1.00, playScale: 1.00,
      assets: { whole: 'assets/red_apple.png', peeled: 'assets/peeled_apple.png', provided: true },
      model: { style: 'cavity', cutTopRatio: C0.CREST_RADIUS_RATIO, cutBottomRatio: null },
      rotation: { period: 2.5 },
      cutting: { skinThickness: 4, widthScale: 0.8, windowHalf: 12, fleshConvexRef: 8 },
      ribbon: { width: 5.2 },
      scoring: { lenRefCm: null, fleshSensitivity: null },
      grades: APPLE_GRADES,
      resultTitle: '사과 깎기 완료!',
    },
    pear: {
      id: 'pear', name: '배', difficulty: '쉬움', previewScale: 1.08, playScale: 1.12,
      assets: { whole: 'assets/pear_unpeeled.png', peeled: 'assets/pear_peeled.png', provided: true },
      model: { style: 'cavity', cutTopRatio: 0.42, cutBottomRatio: null },
      rotation: { period: 2.7 },
      cutting: { skinThickness: 4.4, widthScale: 0.8, windowHalf: 13, fleshConvexRef: 8 },
      ribbon: { width: 5.6 },
      scoring: { lenRefCm: null, fleshSensitivity: null },
      grades: gradesFor('배'), resultTitle: '배 깎기 완료!',
    },
    kiwi: {
      id: 'kiwi', name: '키위', difficulty: '어려움', previewScale: 0.72, playScale: 0.68,
      assets: { whole: 'assets/kiwi_unpeeled.png', peeled: 'assets/kiwi_peeled.png', provided: true },
      model: { style: 'dome', cutTopRatio: 0.5, cutBottomRatio: 0.5 },
      rotation: { period: 2.1 },
      cutting: { skinThickness: 3.0, widthScale: 0.8, windowHalf: 10, fleshConvexRef: 7 },
      ribbon: { width: 3.8 },
      scoring: { lenRefCm: null, fleshSensitivity: null },
      grades: gradesFor('키위'), resultTitle: '키위 깎기 완료!',
    },
    dragonfruit: {
      id: 'dragonfruit', name: '용과', difficulty: '보통', previewScale: 1.00, playScale: 1.03,   /* 시작값 0.95/0.98 → 불투명 실루엣 면적을 사과 ≈ 1.0 이 되도록 보정(배 1.16 · 키위 0.46 사이) */
      assets: { whole: 'assets/dragonfruit_unpeeled.png', peeled: 'assets/dragonfruit_peeled.png', provided: true },
      model: { style: 'dome', cutTopRatio: 0.5, cutBottomRatio: 0.5 },     // 본체(둥근 타원) 기준. 초록 돌기는 decor(장식)이라 판정에 쓰지 않는다
      decor: { leaves: true, seeds: { cell: 9, prob: 0.85, radius: [1.4, 2.2] } },   // leaves = 원본 PNG 에서 실측한 잎 돌기(장식) · seeds = 과육이 드러난 곳에만 보이는 검은 씨앗(셰이더)
      rotation: { period: 2.5 },
      cutting: { skinThickness: 3.6, widthScale: 0.8, windowHalf: 11, fleshConvexRef: 8 },
      ribbon: { width: 4.8 },
      scoring: { lenRefCm: null, fleshSensitivity: null },
      grades: gradesFor('용과'), resultTitle: '용과 깎기 완료!',
    },
  };
  var ORDER = ['apple', 'pear', 'kiwi', 'dragonfruit'];
  var loaded = {};          // id → { whole: bool, peeled: bool }
  var current = CONFIGS.apple;     // 플레이 중인(플레이 가능한) 과일

  function probeOne(src, cb) { var im = new Image(); im.onload = function () { cb(true); }; im.onerror = function () { cb(false); }; im.src = src; }
  /* 각 과일의 이미지가 실제로 로드되는지 확인(없거나 실패하면 오류 없이 false). 모두 끝나면 cb */
  function probe(cb) {
    var pending = 0;
    ORDER.forEach(function (id) {
      var f = CONFIGS[id]; loaded[id] = { whole: false, peeled: false };
      if (!f.assets.provided) return;           // provided:false 면 파일을 요청하지 않는다(404 로그 방지)
      ['whole', 'peeled'].forEach(function (k) { pending++; probeOne(f.assets[k], function (ok) { loaded[id][k] = ok; if (--pending === 0 && cb) cb(); }); });
    });
    if (pending === 0 && cb) cb();
  }
  /* ── 실루엣 실측(tools/build-assets.js → AP_ASSETS.fruits) ── */
  function measure(id) { var F = window.AP_ASSETS && window.AP_ASSETS.fruits; return F && F[id] ? F[id] : null; }
  function hasShape(id) { var f = CONFIGS[id]; if (!f || !f.model) return false; if (id === 'apple') return true; var m = measure(id); return !!(m && m.shape && m.shape.whole); }
  function assetsReady(id) { return !!(loaded[id] && loaded[id].whole && loaded[id].peeled && measure(id)); }
  function available(id) { return assetsReady(id) && hasShape(id); }
  function status(id) { return available(id) ? 'ready' : (assetsReady(id) ? 'no-shape' : 'no-assets'); }

  /* 과일의 "길이"(껍질 버전 실루엣 bbox 의 긴 변, 이미지 px) */
  /* dragonfruit 는 돌기(장식)를 뺀 본체 실루엣의 긴 변(sizeLongest)이 기준 — 3D 본체와 선택 화면 이미지가 같은 배율을 쓴다 */
  function longest(id) { var m = measure(id); return m ? (m.sizeLongest || m.whole.longest) : null; }
  /* 이미지 1px 가 화면에서 차지하는 px — 사과 표시 길이(appleLongPx)를 기준으로 과일의 scale 배만큼 */
  function pxPerImagePx(id, appleLongPx, scale) { return scale * appleLongPx / longest(id); }
  function previewK(id, appleLongPx) { return pxPerImagePx(id, appleLongPx, CONFIGS[id].previewScale); }
  /* 플레이 화면: 사과 메시의 실제 화면 길이(지름 APPLE_DIAMETER 에 대응하는 사과 실루엣 길이) 기준. 3D 메시가 이 값으로 만들어진다 */
  function playK(id) { var a = measure('apple'); var kApple = (AP.CONFIG.APPLE_DIAMETER / 2) / (a.whole.bbox.w / 2); return pxPerImagePx(id, a.whole.longest * kApple, CONFIGS[id].playScale); }
  /* DOM <img> 를 박스(boxW×boxH) 중앙에 실루엣 기준으로 배치. kind: 'whole' | 'peeled' — 둘 다 껍질 버전 bbox 중심을 기준점으로 써서 겹친다 */
  function place(img, id, kind, boxW, boxH, k) {
    var m = measure(id), b = m.whole.bbox;
    var cx = b.x + b.w / 2, cy = b.y + b.h / 2, w = m[kind].w, h = m[kind].h;
    img.style.position = 'absolute'; img.style.width = (w * k) + 'px'; img.style.height = (h * k) + 'px'; img.style.maxWidth = 'none'; img.style.maxHeight = 'none';
    img.style.left = (boxW / 2 - cx * k) + 'px'; img.style.top = (boxH / 2 - cy * k) + 'px';
  }

  /* ── 3D 모델 입력 ── */
  function gain(rgb) { return rgb.map(function (v) { return Math.min(255, Math.round(v * LIGHT_GAIN)); }); }
  function colors(id) {
    if (id === 'apple') return APPLE_COLORS;
    var sh = measure(id).shape, st = sh.whole.stem;
    return { skin: gain(sh.whole.colorFrontMid), flesh: gain(sh.peeledColorFrontMid), stem: st && st.color ? gain(st.color) : APPLE_COLORS.stem, leaf: sh.whole.leafStops ? { yellow: gain(sh.whole.leafStops.yellow), green: gain(sh.whole.leafStops.green) } : null };
  }
  function stemOf(id) {
    if (CONFIGS[id].model.style !== 'cavity') return null;
    if (id === 'apple') return { len: C0.STEM.LEN_RATIO, rTopRatio: C0.STEM.R_TOP_RATIO, rBaseRatio: C0.STEM.R_BASE_RATIO, leanDeg: C0.STEM.LEAN_DEG, topExtentRatio: C0.STEM.LEN_RATIO };
    var st = measure(id).shape.whole.stem;
    return st ? { img: { visibleLen: st.visibleLen, width: st.width, tipWidth: st.tipWidth, leanDeg: Math.min(16, Math.max(-16, st.leanDeg)) } } : null;
  }
  /* apple.js createSurface 의 입력. 사과는 기존 config 값 그대로(표면이 이전과 같다) */
  function params(id) {
    var f = CONFIGS[id], m = f.model, isApple = id === 'apple';
    var asset = isApple ? AP.assets.apple : AP.assets.fruits[id];
    return { id: id, asset: asset, R: isApple ? AP.CONFIG.APPLE_DIAMETER / 2 : asset.radiusPx * playK(id), style: m.style, cutTopRatio: m.cutTopRatio, cutBottomRatio: m.cutBottomRatio || null,
      skinThickness: f.cutting.skinThickness, colors: colors(id), stem: stemOf(id), decor: f.decor || null };
  }

  /* 선택한 과일의 설정을 엔진에 적용(3D 모델 재생성 전에 호출 — 색·껍질·절삭 폭·회전·리본 폭). 사과 값은 기존 CONFIG 값과 같다. */
  function apply(f) {
    var C = AP.CONFIG, cu = f.cutting, col = colors(f.id);
    C.ROTATION_PERIOD = f.rotation.period; if (AP.rotation) AP.rotation.period = f.rotation.period;
    C.SKIN_THICKNESS = cu.skinThickness; C.CUT.WIDTH_SCALE = cu.widthScale; C.CUT.WINDOW_HALF = cu.windowHalf; C.CUT.FLESH_CONVEX_REF = cu.fleshConvexRef;
    C.RIBBON.WIDTH = f.ribbon.width;
    C.SKIN_COLOR = col.skin; C.FLESH_COLOR = col.flesh; C.STEM_COLOR = col.stem;       // 리본(ribbon.js)이 읽는 색 = 실제 제거된 껍질 색
  }
  function select(id) {
    if (!available(id)) return false;
    current = CONFIGS[id]; apply(current); return true;
  }

  /* ── 점수 정규화(과일별 기하에서 유도, 설정값이 있으면 그 값) ── */
  function effWidth(id) { var c = CONFIGS[id].cutting; return c.windowHalf * c.widthScale; }
  function lenRefCm() {
    if (current.scoring.lenRefCm) return current.scoring.lenRefCm;
    var ref = AP.apple.stats('apple'), me = AP.apple.stats(current.id);
    return AP.CONFIG.SCORE.LEN_REF_CM * (me.totalArea / effWidth(current.id)) / (ref.totalArea / effWidth('apple'));
  }
  function fleshSensitivity() {
    if (current.scoring.fleshSensitivity) return current.scoring.fleshSensitivity;
    var ref = AP.apple.stats('apple'), me = AP.apple.stats(current.id);
    return ref.refLossPct / me.refLossPct;      // 같은 상대 깊이(껍질×1.5)로 깎으면 같은 감점
  }
  function skinLayerPct() { return AP.apple.stats(current.id).skinLayerPct; }        // 껍질 층 전체 부피(% of 과일 부피) — 점수: 과육 손실이 제거한 껍질 층보다 큰지 판단
  function minPathCm() { return AP.CONFIG.SCORE.MIN_PATH_CM * lenRefCm() / AP.CONFIG.SCORE.LEN_REF_CM; }
  function grades() { return current.grades || APPLE_GRADES; }

  return { CONFIGS: CONFIGS, ORDER: ORDER, probe: probe, available: available, status: status, assetsReady: assetsReady, hasShape: hasShape, select: select,
    lenRefCm: lenRefCm, fleshSensitivity: fleshSensitivity, skinLayerPct: skinLayerPct, minPathCm: minPathCm, grades: grades, params: params,
    measure: measure, longest: longest, previewK: previewK, playK: playK, place: place, get current() { return current; }, loaded: loaded };
})();
