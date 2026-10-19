/* 에셋 → 런타임 치수/텍스처.
 *  - 칼: PNG 를 그대로 텍스처로(배율만 적용). 판정용 기하(날 폴리라인·영역)는 assets-data 의 실측값을 PNG px 로 보관하고
 *    blade.js 가 현재 칼 위치/배율로 스테이지 px 로 변환한다.
 *  - 사과: PNG 의 실루엣 프로파일(행별 반폭)과 색만 쓴다. 메시는 apple.js 가 만든다. */
'use strict';
window.AP = window.AP || {};

AP.assets = (function () {
  var out = { knifeTex: null, knife: null, apple: null, fruits: {} };

  /* 사과 프로파일: dy(몸통 상단에서 내려온 px) → 반폭(px). 2행 간격 샘플을 선형 보간 */
  function makeProfileSampler(profile) {
    return function (dy) {
      if (dy <= profile[0][0]) return profile[0][1];
      var last = profile[profile.length - 1];
      if (dy >= last[0]) return last[1];
      var lo = 0, hi = profile.length - 1;
      while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (profile[mid][0] <= dy) lo = mid; else hi = mid; }
      var a = profile[lo], b = profile[hi], t = (dy - a[0]) / (b[0] - a[0]);
      return a[1] + (b[1] - a[1]) * t;
    };
  }

  function load(onDone) {
    var data = window.AP_ASSETS;
    if (!data) throw new Error('AP_ASSETS 없음 — node tools/build-assets.js 를 먼저 실행');
    var red = data.red;
    out.apple = {
      png: red,
      radiusPx: red.radiusPx, bodyHeightPx: red.bodyHeight,
      halfWidthAt: makeProfileSampler(red.profile),   // dy → 반폭(px)
      skinBands: red.colorBands, fleshBands: data.peeled.colorBands,
      skinFrontMid: red.colorFrontMid, fleshFrontMid: data.peeled.colorFrontMid,
      stem: red.stem,
    };
    /* 사과 외 과일: 같은 방식으로 실측한 실루엣 프로파일(build-assets.js FRUIT_SHAPE_OPTS) */
    Object.keys(data.fruits || {}).forEach(function (id) {
      var sh = data.fruits[id].shape; if (!sh) return;
      var w = sh.whole;
      out.fruits[id] = { radiusPx: w.radiusPx, bodyHeightPx: w.bodyHeight, halfWidthAt: makeProfileSampler(w.profile), stem: w.stem, axisX: w.axisX, bodyTop: w.bodyTop, leaves: w.leaves || null, leafStops: w.leafStops || null };
    });
    out.knife = data.knife;
    var loader = new THREE.TextureLoader();
    out.knifeTex = loader.load(data.knife.src, function () { onDone(); }, undefined, function () { throw new Error('텍스처 로드 실패: knife'); });
    out.knifeTex.colorSpace = THREE.SRGBColorSpace;
    out.knifeTex.anisotropy = 4;
  }

  out.load = load;
  return out;
})();
