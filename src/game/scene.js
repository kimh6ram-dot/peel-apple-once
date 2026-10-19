/* Three.js 장면 — 두 장면을 겹쳐 그린다.
 *  1) 사과 장면: 사과 중심 원점. 직교 카메라가 CAMERA_PITCH_DEG 만큼 위에서 내려다본다. 프러스텀을 "사과 중심이 스테이지 (cx, cy) 에
 *     오도록" 비대칭으로 잡아 월드 x = 스테이지 x - cx (1:1) 가 되게 한다.
 *  2) 오버레이 장면: 화면 정렬 직교 카메라(0..W, 0..-H). 칼 스프라이트·디버그 선. 항상 사과 위에 그려진다(깊이 버퍼 초기화).
 * project(v) 는 사과 월드 점 → 스테이지 px. 스냅샷은 두 카메라의 프러스텀을 임시로 잘라 렌더타겟에 그린다. */
'use strict';
window.AP = window.AP || {};

AP.scene = (function () {
  var C = AP.CONFIG, W = C.LOGICAL_WIDTH;
  var renderer, sceneApple, sceneOverlay, camApple, camOverlay;
  var logicalH = 100, appleCx = W / 2, appleCy = 50, pitch = 0;

  function init(canvas) {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.autoClear = false;
    sceneApple = new THREE.Scene();
    sceneOverlay = new THREE.Scene();

    pitch = C.CAMERA_PITCH_DEG * Math.PI / 180;
    camApple = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 3000);
    camApple.position.set(0, 1000 * Math.sin(pitch), 1000 * Math.cos(pitch));
    camApple.up.set(0, 1, 0);
    camApple.lookAt(0, 0, 0);
    camApple.updateMatrixWorld(true);

    camOverlay = new THREE.OrthographicCamera(0, W, 0, -logicalH, 1, 3000);
    camOverlay.position.set(0, 0, 1000);
    camOverlay.lookAt(0, 0, 0);
    camOverlay.updateMatrixWorld(true);

    var L = C.LIGHT;
    sceneApple.add(new THREE.HemisphereLight(L.HEMI_SKY, L.HEMI_GROUND, L.HEMI));
    var key = new THREE.DirectionalLight(0xFFFFFF, L.KEY);
    key.position.set(L.KEY_DIR[0] * 600, L.KEY_DIR[1] * 600, L.KEY_DIR[2] * 600);
    key.target.position.set(0, 0, 0);
    sceneApple.add(key, key.target);
    var fill = new THREE.DirectionalLight(0xFFFFFF, L.FILL);
    fill.position.set(L.FILL_DIR[0] * 600, L.FILL_DIR[1] * 600, L.FILL_DIR[2] * 600);
    fill.target.position.set(0, 0, 0);
    sceneApple.add(fill, fill.target);
  }

  function applyFrustums() {
    camApple.left = -appleCx; camApple.right = W - appleCx; camApple.top = appleCy; camApple.bottom = appleCy - logicalH;
    camApple.updateProjectionMatrix();
    camOverlay.left = 0; camOverlay.right = W; camOverlay.top = 0; camOverlay.bottom = -logicalH;
    camOverlay.updateProjectionMatrix();
  }
  function resize(cssW, cssH) {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(cssW, cssH, false);
    logicalH = cssH * W / cssW;
    applyFrustums();
    return logicalH;
  }
  function setAppleScreen(cx, cy) { appleCx = cx; appleCy = cy; applyFrustums(); }

  var _p = new THREE.Vector3();
  function project(v) {
    _p.copy(v).project(camApple);
    return { x: (_p.x + 1) / 2 * W, y: (1 - _p.y) / 2 * logicalH };
  }

  function render() {
    renderer.setRenderTarget(null);
    renderer.clear();
    renderer.render(sceneApple, camApple);
    renderer.clearDepth();
    renderer.render(sceneOverlay, camOverlay);
  }

  /* 스테이지 사각형 rect{x0,y0,x1,y1} 을 w×h 픽셀로 오프스크린 렌더 → 2D 캔버스(opts.bg: 배경색 문자열, opts.hideOverlay) */
  function renderSnapshot(w, h, rect, opts) {
    opts = opts || {};
    camApple.left = rect.x0 - appleCx; camApple.right = rect.x1 - appleCx; camApple.top = appleCy - rect.y0; camApple.bottom = appleCy - rect.y1;
    camApple.updateProjectionMatrix();
    camOverlay.left = rect.x0; camOverlay.right = rect.x1; camOverlay.top = -rect.y0; camOverlay.bottom = -rect.y1;
    camOverlay.updateProjectionMatrix();
    var rt = new THREE.WebGLRenderTarget(w, h, { samples: 4, colorSpace: THREE.SRGBColorSpace });
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(sceneApple, camApple);
    if (!opts.hideOverlay) { renderer.clearDepth(); renderer.render(sceneOverlay, camOverlay); }
    renderer.setRenderTarget(null);
    var px = new Uint8Array(w * h * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, w, h, px);
    rt.dispose();
    applyFrustums();

    var img = document.createElement('canvas');
    img.width = w; img.height = h;
    var ictx = img.getContext('2d');
    var idata = ictx.createImageData(w, h), row = w * 4;
    for (var y = 0; y < h; y++) idata.data.set(px.subarray((h - 1 - y) * row, (h - y) * row), y * row);
    ictx.putImageData(idata, 0, 0);
    var out = document.createElement('canvas');
    out.width = w; out.height = h;
    var ctx = out.getContext('2d');
    if (opts.bg) { ctx.fillStyle = opts.bg; ctx.fillRect(0, 0, w, h); }
    ctx.drawImage(img, 0, 0);
    return out;
  }

  return {
    init: init, resize: resize, setAppleScreen: setAppleScreen, project: project, render: render, renderSnapshot: renderSnapshot,
    addApple: function (o) { sceneApple.add(o); }, removeApple: function (o) { sceneApple.remove(o); }, addOverlay: function (o) { sceneOverlay.add(o); }, removeOverlay: function (o) { sceneOverlay.remove(o); },
    get renderer() { return renderer; }, get camApple() { return camApple; }, get camOverlay() { return camOverlay; },
    get logicalH() { return logicalH; }, get appleCx() { return appleCx; }, get appleCy() { return appleCy; }, get pitch() { return pitch; },
  };
})();
