/* 부트스트랩: 에셋 → 장면(사과 메시·칼 스프라이트·껍질 조각) → 레이아웃(HUD/패드 실측) → 입력 → rAF 루프 → 화면 전환 → QA 훅(AP_DEBUG)
 * 화면: INTRO(흰 화면, 미리보기) → PLAY(HUD: 남은 시간·껍질·과육 / 사과+칼 / 하단 패드·완료) → RESULT(골격)
 *
 * 레이아웃: 사과 지름·중심 x 는 1단계 값(210px·45%) 그대로. 세로 위치와 화면 배율은 "기울기 0 의 칼이 이동 범위 안에서 능선~바닥 전체에
 * 닿을 수 있는 방"(칼 bbox 위~힐 + 몸통 + 팁~칼 bbox 아래)을 플레이 영역에 맞춰 정한다. 방이 모자라면(짧은 화면) 사과·칼을 같이 줄인다. */
'use strict';
(function () {
  var C = AP.CONFIG, W = C.LOGICAL_WIDTH;
  var $ = function (id) { return document.getElementById(id); };
  var container = $('app'), canvas = $('stage');
  var hud = $('hud'), hudRibbon = $('hud-ribbon'), hudPeel = $('hud-peel'), hudFlesh = $('hud-flesh');
  var pad = $('pad'), hint = $('hint'), watermark = $('watermark'), debugReadout = $('debug-readout');
  var screenIntro = $('screen-intro'), introCanvas = $('intro-canvas'), btnStart = $('btn-start');
  var screenSelect = $('screen-select'), fruitGrid = $('fruit-grid'), btnSelectNext = $('btn-select-next');
  var screenChallenge = $('screen-challenge'), screenBattle = $('screen-battle'), btnBattleResult = $('btn-battle-result');
  var challenge = null;          // 도전장 링크로 들어왔을 때 친구의 기록(AP.battle.parseToken)
  function track(name) { try { if (window.SiteAnalytics) window.SiteAnalytics.track(name); } catch (e) { /* 무시 */ } }
  var btnSave = $('btn-save');
  var selectedFruit = 'apple';
  var resultScore = $('result-score'), resultGrade = $('result-grade'), resultDetail = $('result-detail'), screenResult = $('screen-result'), resultCanvas = $('result-canvas'), resultTitle = $('result-title'), btnRestart = $('btn-restart');

  var apple = null, knifeMesh = null, debugOn = location.hash === C.DEBUG_HASH;
  var dbg = null, layoutInfo = null, shownResult = false, paused = false, interacted = false;

  AP.scene.init(canvas);

  function show(el, on) { el.classList.toggle('active', !!on); container.classList.toggle('screen-on', !!document.querySelector('.screen.active')); }   // 화면이 켜져 있으면 3D 스테이지 숨김(css .app.screen-on #stage)
  function uiVisible(el, on) { el.classList.toggle('ui-hidden', !on); }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* ── 사과 세로 배치·배율: 기울기 0 의 칼의 절삭점(피벗)이 능선~바닥 전체에 닿을 수 있도록 ──
   * 필요한 방 = (칼 bbox 위 → 피벗) + 몸통 + (피벗 → 칼 bbox 아래), 여기에 양끝 REACH_MARGIN. 모자라면(짧은 화면) 사과·칼을 같이 줄인다 */
  function layoutApple(playTop, playBottom, targetCy) {
    var S = apple.surface, d = AP.assets.knife, K = C.KNIFE, m = K.STAGE_MARGIN, rm = K.REACH_MARGIN;
    var cosP = Math.cos(AP.scene.pitch);
    var B0 = (S.crestY - S.ring0Y) * cosP;                           // 배율 1 의 몸통(능선~링0) 투영 높이
    var refB = AP.apple.stats('apple').bodyH * cosP;                 // 칼 크기 기준 = 사과 몸통 높이(과일이 바뀌어도 같은 칼)
    var s0 = K.BLADE_LEN_RATIO * refB / d.bladeLen;                  // 배율 1 의 칼 배율
    var piv = d.edge[Math.floor(d.edge.length * K.PIVOT_EDGE_FRAC)];
    var above0 = (piv[1] - d.bbox.y) * s0;                           // 칼 bbox 위 → 피벗(절삭점)
    var below0 = (d.bbox.y + d.bbox.h - piv[1]) * s0;                // 피벗 → 칼 bbox 아래
    var need = B0 + above0 + below0, avail = (playBottom - m) - (playTop + m) - 2 * rm;
    var vs = Math.min(1, avail / need);
    var reachX0 = 0; for (var e = 0; e < d.edge.length; e++) reachX0 = Math.max(reachX0, (d.edge[e][0] - piv[0]) * s0);
    vs = Math.min(vs, (W - m - W * C.APPLE_CENTER_X_RATIO - K.START_GAP) / (S.R + reachX0));   // 가로: 넓은 과일(배)도 시작 위치의 칼날이 화면 안에
    var slack = Math.max(0, avail - need * vs);
    var minCrest = playTop + m + rm + above0 * vs;                    // 칼이 HUD 아래에 닿는 가장 위 위치(여유 0)
    /* 남는 공간(slack)을 어디에 둘지: 과일 중심을 INTRO 비주얼 중심(앵커)에 맞춘다. 칼 이동 범위가 허용하는 만큼(0~slack)만 이동 — 조작 영역을 해치는 강제 정렬은 하지 않는다 */
    var crestStageY = (typeof targetCy === 'number' && isFinite(targetCy)) ? clamp(targetCy - C.APPLE_CENTER_Y_BIAS - S.crestY * cosP * vs, minCrest, minCrest + slack) : minCrest + slack / 2;
    var cy = crestStageY + S.crestY * cosP * vs + C.APPLE_CENTER_Y_BIAS;
    var wantCrest = (typeof targetCy === 'number' && isFinite(targetCy)) ? targetCy - C.APPLE_CENTER_Y_BIAS - S.crestY * cosP * vs : null;
    return { vs: vs, cy: cy, need: need, avail: avail, refB: refB, slack: slack, limited: wantCrest === null ? null : (wantCrest < minCrest ? 'top' : (wantCrest > minCrest + slack ? 'bottom' : null)) };
  }

  /* ── 레이아웃: HUD 아래 ~ 패드 위가 플레이 영역 ── */
  function handleResize() {
    var rect = container.getBoundingClientRect();
    if (rect.width === 0) return;
    var H = AP.scene.resize(rect.width, rect.height);
    var scale = rect.width / W;
    var hudRect = hud.getBoundingClientRect(), padRect = pad.getBoundingClientRect();
    var playTop = (hudRect.bottom - rect.top) / scale + 4;
    var playBottom = (padRect.top - rect.top) / scale - 4;
    var cx = W * C.APPLE_CENTER_X_RATIO;
    if (!apple) { AP.scene.setAppleScreen(cx, (playTop + playBottom) / 2); return; }
    var probe = $('layout-probe'), anchorCy = probe ? probe.getBoundingClientRect().height / scale : null;   // INTRO 비주얼 프레임 중심 Y(스테이지 px)
    var lay = layoutApple(playTop, playBottom, anchorCy);
    apple.setViewScale(lay.vs);
    AP.scene.setAppleScreen(cx, lay.cy);
    var S = apple.surface, vs = lay.vs;
    var topY = AP.scene.project(new THREE.Vector3(0, S.crestY * vs, 0)).y;
    var bottomY = AP.scene.project(new THREE.Vector3(0, S.ring0Y * vs, 0)).y;
    layoutInfo = { W: W, H: H, scale: scale, playTop: playTop, playBottom: playBottom, appleCx: cx, appleCy: lay.cy, appleR: S.R * vs, viewScale: vs, bodyTopY: topY, bodyBottomY: bottomY, bodyH: bottomY - topY, need: lay.need, avail: lay.avail, knifeBodyH: lay.refB * lay.vs, slack: lay.slack, limited: lay.limited };
    AP.knife.layout(layoutInfo);
    if (!AP.knife.placed || AP.play.state === 'intro') AP.knife.place(AP.apple.silhouetteX);
    syncKnifeMesh();
    if (screenChallenge.classList.contains('active')) paintChallenge();
    if (AP.play.state === 'intro') { paintIntroPreview(); if (screenSelect.classList.contains('active')) { layoutFruitImages(); paintSelectPreview(); } }
  }

  /* ── 칼 스프라이트(knifeVisual): PNG 전체를 오버레이 평면에. 위치·회전은 knife.toStage(판정과 같은 변환) ── */
  function buildKnifeMesh() {
    var d = AP.assets.knife;
    var mat = new THREE.MeshBasicMaterial({ map: AP.assets.knifeTex, transparent: true, depthTest: false, depthWrite: false });
    knifeMesh = new THREE.Mesh(new THREE.PlaneGeometry(d.w, d.h), mat);
    knifeMesh.renderOrder = 10;
    knifeMesh.frustumCulled = false;
    AP.scene.addOverlay(knifeMesh);
  }
  function syncKnifeMesh() {
    if (!knifeMesh || !AP.knife.placed) return;
    var s = AP.knife.scale, d = AP.knife.data, c = AP.knife.toStage([d.w / 2, d.h / 2]);
    knifeMesh.scale.set(s, s, 1);
    knifeMesh.rotation.z = -AP.knife.angle;          // 스테이지(y 아래) 시계 방향 = 오버레이(y 위) 음의 z 회전
    knifeMesh.position.set(c[0], -c[1], 0);
  }

  /* ── 디버그 오버레이(#debug) ── */
  function makeLine(color, loop) {
    var l = new (loop ? THREE.LineLoop : THREE.Line)(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: color, depthTest: false }));
    l.renderOrder = 20; l.frustumCulled = false;
    return l;
  }
  function setLine(line, pts) { line.geometry.setFromPoints(pts.map(function (p) { return new THREE.Vector3(p[0], -p[1], 1); })); }
  function ensureDebug() {
    if (dbg) return;
    dbg = { edge: makeLine(0xE02020), spine: makeLine(0x777777), heel: makeLine(0x777777), blade: makeLine(0x999999, true), bolster: makeLine(0xBBBBBB, true), handle: makeLine(0x8B4A2B, true), meridian: makeLine(0x2D5BFF) };
    dbg.contact = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x22C55E, depthTest: false }));
    dbg.contact.renderOrder = 21; dbg.contact.frustumCulled = false;
    for (var k in dbg) AP.scene.addOverlay(dbg[k]);
  }
  function setDebug(on) {
    debugOn = !!on;
    if (debugOn) ensureDebug();
    if (dbg) for (var k in dbg) dbg[k].visible = debugOn;
    if (apple) apple.marker.visible = debugOn;
    uiVisible(debugReadout, debugOn);
    if (!debugOn) debugReadout.textContent = '';
  }
  function updateDebug() {
    if (!debugOn || !AP.knife.placed) return;
    ensureDebug();
    var R = AP.blade.regions();
    setLine(dbg.edge, R.edge); setLine(dbg.spine, R.spine); setLine(dbg.heel, R.heel);
    setLine(dbg.blade, R.bladeRegionPoly); setLine(dbg.bolster, R.bolsterPoly); setLine(dbg.handle, R.handleRegionPoly);
    setLine(dbg.meridian, AP.apple.meridianStage());
    var cut = AP.cutting.contact, segs = [];
    if (cut && cut.rows > 0) {
      var ys = AP.cutting.rowStageYs();
      for (var i = cut.iMin; i <= cut.iMax; i++) { var xe = AP.cutting.edgeXAt(ys[i]); if (xe === null) continue; segs.push(new THREE.Vector3(xe - 14, -ys[i], 2), new THREE.Vector3(xe, -ys[i], 2)); }
    }
    var gs = AP.play.getSnapshot();
    if (gs.contactCandidate) { var cc = gs.contactCandidate; segs.push(new THREE.Vector3(cc.x - 7, -cc.y, 3), new THREE.Vector3(cc.x + 7, -cc.y, 3), new THREE.Vector3(cc.x, -cc.y - 7, 3), new THREE.Vector3(cc.x, -cc.y + 7, 3)); }   // 접촉 후보점(날에서 표면 쪽으로 가장 깊은 점) — 십자
    if (cut && cut.x !== null) { segs.push(new THREE.Vector3(cut.x - 4, -cut.y - 4, 2), new THREE.Vector3(cut.x + 4, -cut.y + 4, 2), new THREE.Vector3(cut.x - 4, -cut.y + 4, 2), new THREE.Vector3(cut.x + 4, -cut.y - 4, 2)); }
    dbg.contact.geometry.setFromPoints(segs);
    var st = AP.cutting.cellStats();
    debugReadout.textContent = 'state ' + gs.state + '  fruit ' + gs.selectedFruit + '  contacting ' + gs.isBladeContacting + '  peeling ' + gs.isPeeling + '  dist ' + (gs.contactDistance === null ? '-' : gs.contactDistance.toFixed(1)) + '  lost ' + gs.contactLostMs.toFixed(0) + '/' + gs.graceMs + 'ms  blade (' + gs.knife.px.toFixed(0) + ',' + gs.knife.py.toFixed(0) + ') rot ' + gs.knife.angleDeg.toFixed(0) + '°  qa ' + gs.qaMode + '\n' + (cut ? ('sector ' + cut.sector + (cut.sectors > 1 ? ' (+' + (cut.sectors - 1) + ')' : '') + '  tilt ' + AP.knife.angleDeg.toFixed(0) + '°  center row ' + cut.iDeep + '  cut rows ' + (cut.rows ? cut.iMin + '~' + cut.iMax : '-') + '  depth ' + cut.depthCur.toFixed(1) + ' / orig ' + cut.depth0.toFixed(1) + '  cut ' + cut.cutCells + '\n') : '') +
      'cells  skin ' + st.unpeeled + '  peeled ' + st.peeled + '  flesh ' + st.flesh + '  maxRec ' + st.maxRec.toFixed(1) + '  ribbon ' + AP.ribbon.info().curCm.toFixed(1) + 'cm(최장 ' + AP.ribbon.info().longestCm.toFixed(1) + ') falling ' + AP.ribbon.info().falling + '\n' +
      'peel ' + st.peelPct.toFixed(1) + '%  flesh ' + st.fleshPct.toFixed(2) + '%  scale ' + (layoutInfo ? layoutInfo.viewScale.toFixed(3) : '-');
  }

  /* ── 스냅샷(미리보기/결과) ── */
  function sceneRect() {
    var S = apple.surface, vs = apple.viewScale, cx = AP.scene.appleCx, k = AP.knife.rectStage();
    var rch = S.decorReach || 0;   // 장식(돌기)이 본체 밖으로 나온 길이
    var top = AP.scene.project(new THREE.Vector3(0, (S.topExtent + rch) * vs, 0)).y;
    var bottom = AP.scene.project(new THREE.Vector3(0, (S.bottomY - rch - (S.capExtraBottom || 0)) * vs, 0)).y;
    return { x0: cx - (S.R + rch) * vs - 14, x1: Math.max(k.x1, cx + (S.R + rch) * vs) + 10, y0: Math.min(top, k.y0) - 8, y1: Math.max(bottom, k.y1) + 8 };
  }
  function fitAspect(r, aspect) {
    var w = r.x1 - r.x0, h = r.y1 - r.y0, cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
    if (w / h < aspect) w = h * aspect; else h = w / aspect;
    return { x0: cx - w / 2, x1: cx + w / 2, y0: cy - h / 2, y1: cy + h / 2 };
  }
  function paintCanvas(cv, rect) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2), cssW = cv.clientWidth || 320, cssH = cv.clientHeight || 200;
    var w = Math.round(cssW * dpr), h = Math.round(cssH * dpr);
    var snap = AP.scene.renderSnapshot(w, h, fitAspect(rect, cssW / cssH), { bg: '#FFFFFF' });
    cv.width = w; cv.height = h;
    cv.getContext('2d').drawImage(snap, 0, 0);
  }
  /* 초기화(에셋·과일 선택·모델·레이아웃)가 모두 끝나기 전에는 그리지 않는다 → 비주얼 프레임은 빈 상태로 있다가 최종 과일이 정상 크기로 한 번만 나타난다 */
  var bootReady = false;
  function paintIntroPreview() { if (bootReady && apple && AP.knife.placed) paintCanvas(introCanvas, sceneRect()); }
  /* ── 과일 선택 화면: 실루엣 기준 scale 정규화(fruits.js) — 이미지 캔버스 px 가 아니라 불투명 실루엣 bbox, 사과 표시 길이 × previewScale ── */
  var previewFruit = 'apple';          // 선택 화면에서 고른 과일(플레이 가능 여부와 별개). selectedFruit = 실제로 플레이할 과일
  var selectPreview = $('select-preview'), selectNote = $('select-note');
  function makeImg(id, kind) { var im = document.createElement('img'); im.src = AP.fruits.CONFIGS[id].assets[kind === 'peeled' ? 'peeled' : 'whole']; im.alt = AP.fruits.CONFIGS[id].name; im.draggable = false; return im; }
  /* 상단 미리보기: 선택한 과일을 프레임 중앙에 — 사과 표시 길이는 프레임 높이의 62%, 나머지는 previewScale 배 */
  function paintSelectPreview() {
    var w = selectPreview.clientWidth, h = selectPreview.clientHeight; if (!w || !h) return;
    selectPreview.textContent = '';
    if (!AP.fruits.assetsReady(previewFruit)) return;
    var im = makeImg(previewFruit, 'whole'); AP.fruits.place(im, previewFruit, 'whole', w, h, AP.fruits.previewK(previewFruit, 0.62 * h)); selectPreview.appendChild(im);
  }
  /* 카드 이미지: 같은 규칙(사과 길이 = 이미지 박스 높이의 78%) */
  function layoutFruitImages() {
    Array.prototype.forEach.call(fruitGrid.querySelectorAll('.fruit-img'), function (box) {
      var id = box.getAttribute('data-fruit'), im = box.querySelector('img'), w = box.clientWidth, h = box.clientHeight;
      if (im && w && h) AP.fruits.place(im, id, 'whole', w, h, AP.fruits.previewK(id, 0.78 * h));
    });
  }
  /* 2×2 그리드: 이미지가 로드된 과일은 미리보기 선택 가능, 플레이는 shape 가 연결된 과일만(지금은 사과). 이미지가 없으면 비활성(임의 그림 없음). 카드 안에는 이미지+이름만 */
  function buildFruitGrid() {
    fruitGrid.textContent = '';
    AP.fruits.ORDER.forEach(function (id) {
      var f = AP.fruits.CONFIGS[id], hasImg = AP.fruits.assetsReady(id), playable = AP.fruits.available(id);
      var b = document.createElement('button'); b.type = 'button'; b.className = 'fruit-cell' + (id === previewFruit ? ' is-selected' : ''); b.setAttribute('data-fruit', id);
      b.setAttribute('aria-pressed', id === previewFruit ? 'true' : 'false');
      var box = document.createElement('span'); box.className = 'fruit-img'; box.setAttribute('data-fruit', id);
      if (hasImg) box.appendChild(makeImg(id, 'whole'));
      else b.disabled = true;                       // 이미지 없음: 카드 문구 없이 비활성(흐리게)만
      var nm = document.createElement('span'); nm.className = 'fruit-name'; nm.textContent = f.name;
      b.appendChild(box); b.appendChild(nm);
      b.addEventListener('click', function () { if (!b.disabled) selectFruit(id); });
      fruitGrid.appendChild(b);
    });
  }
  function updateSelectNext() {
    var playable = AP.fruits.available(previewFruit);
    btnSelectNext.disabled = !playable;
    selectNote.hidden = playable; selectNote.textContent = playable ? '' : '이 과일은 절삭 데이터가 아직 연결되지 않아 플레이할 수 없어요(크기 비교용 미리보기)';
  }
  function selectFruit(id) {
    if (!AP.fruits.assetsReady(id)) return false;
    previewFruit = id;
    Array.prototype.forEach.call(fruitGrid.children, function (c) { var on = c.getAttribute('data-fruit') === id; c.classList.toggle('is-selected', on); c.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    if (AP.fruits.select(id)) { selectedFruit = id; useFruit(id); btnSave.textContent = '내 ' + AP.fruits.current.name + ' 저장'; }
    updateSelectNext(); paintSelectPreview();
    return true;
  }
  function hideFlow() { show(screenIntro, false); show(screenSelect, false); show(screenResult, false); show(screenChallenge, false); show(screenBattle, false); }
  function showSelect() { hideFlow(); show(screenSelect, true); layoutFruitImages(); updateSelectNext(); paintSelectPreview(); }

  /* ── 도전장 · 대결 결과(주차하기와 같은 흐름) ── */
  function drawContain(cv, src) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2), w = cv.clientWidth || 300, h = cv.clientHeight || 150;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    var x = cv.getContext('2d'); x.fillStyle = '#FFFFFF'; x.fillRect(0, 0, cv.width, cv.height);
    var k = Math.min(cv.width / src.width, cv.height / src.height), dw = src.width * k, dh = src.height * k;
    x.drawImage(src, (cv.width - dw) / 2, (cv.height - dh) / 2, dw, dh);
  }
  function snapFor(rec, cv) { var dpr = Math.min(window.devicePixelRatio || 1, 2); return AP.battle.snapshotOf(rec, (cv.clientWidth || 300) * dpr, (cv.clientHeight || 150) * dpr); }
  function paintChallenge() { if (challenge) drawContain($('challenge-canvas'), snapFor(challenge, $('challenge-canvas'))); }
  function showChallenge() {
    hideFlow(); show(screenChallenge, true); document.documentElement.classList.remove('boot-challenge');
    $('challenge-name').textContent = challenge.nickname + '의 ' + AP.fruits.CONFIGS[challenge.fruit].name + ' 깎기 기록';
    var sc = $('challenge-score'); sc.textContent = ''; sc.appendChild(document.createTextNode(String(challenge.total))); var un = document.createElement('span'); un.className = 'unit'; un.textContent = '점'; sc.appendChild(un);
    paintChallenge();
  }
  function showBattle() {
    if (!challenge) return;
    var mine = AP.play.getSnapshot(); hideFlow(); show(screenBattle, true);
    var ca = $('vs-a-canvas'), cb = $('vs-b-canvas'), dpr = Math.min(window.devicePixelRatio || 1, 2);
    drawContain(ca, snapFor(challenge, ca));                                                   // 친구
    drawContain(cb, AP.share.renderApple((cb.clientWidth || 140) * dpr, (cb.clientHeight || 150) * dpr));   // 나(지금 모델 = 내 최종 모습)
    $('vs-a-name').textContent = challenge.nickname; $('vs-b-name').textContent = '나';
    $('vs-a-score').textContent = String(challenge.total); $('vs-b-score').textContent = String(mine.score.total);
    var diff = mine.score.total - challenge.total;
    $('vs-winner').textContent = diff > 0 ? '이겼습니다. ' + diff + '점 차이.' : (diff < 0 ? '졌습니다. ' + (-diff) + '점 부족.' : '무승부. 한 번 더.');
  }

  /* ── 흐름 ── */
  /* 3D 과일 모델 교체: 선택한 과일의 형태·색·크기로 표면/메시를 다시 만든다(절삭 엔진은 그대로 — 표면 데이터만 교체) */
  function useFruit(id) {
    if (apple && apple.fruitId === id) return;
    if (apple) { AP.scene.removeApple(apple.group); apple.dispose(); }
    apple = AP.apple.create(id);
    AP.scene.addApple(apple.group);
    setDebug(debugOn);
    handleResize();
    AP.play.reset();
    syncKnifeMesh();
  }
  /* ── 사과 전시하기(결과 화면) — 업로드 로직은 AP.gallery(gallery-submit.js). 여기서는 화면 상태·닉네임·이미지 렌더만 맡는다 ── */
  var btnGallery = $('btn-gallery-submit'), btnGalleryView = $('btn-gallery-view'), galleryNote = $('gallery-note'), galleryAsking = false;
  /* 캐시로 index.html 과 JS 버전이 어긋난 경우(옛 HTML + 새 main.js 등)에도 게임은 정상 부팅해야 한다 — 전시 기능에 필요한 DOM·모듈이 모두 있을 때만 켠다 */
  function galleryOn() { return !!(btnGallery && btnGalleryView && galleryNote && AP.gallery && AP.share && AP.share.renderGalleryImage); }
  function galleryUi(mode, msg) {      // mode: idle | sending | done | retry
    if (!galleryOn()) return;
    var label = { idle: '사과 전시하기', sending: '전시하는 중…', done: '내 사과 보러 가기', retry: '다시 전시하기' }[mode];
    btnGallery.textContent = label; btnGallery.disabled = mode === 'sending';
    galleryNote.hidden = !msg; galleryNote.textContent = msg || '';
  }
  function galleryReset() { if (!galleryOn()) return; AP.gallery.clearRound(); galleryAsking = false; galleryUi('idle'); }
  function galleryCapture(snap) {      // 결과 화면이 뜨는 순간의 실제 결과(점수·제거율·손실률·표면 격자)와 request_id 를 고정 — 이후 다른 판과 섞이지 않는다
    if (!galleryOn()) return;
    AP.gallery.capture({ fruit: AP.fruits.current.id, score: snap.score.total, peelPct: snap.peelPct, fleshPct: snap.fleshPct, grid: AP.battle.encodeSurface(AP.apple.current.surface) });
    galleryAsking = false; galleryUi('idle');
  }
  function galleryClick() {
    if (!galleryOn()) return;
    var r =AP.gallery.current(); if (!r) return;
    if (r.status === 'done') { track('gallery_open'); location.href = (AP.gallery.listUrl || AP.gallery.galleryUrl)(r.result.id); return; }
    if (r.status === 'sending' || galleryAsking) return;           // 연속 클릭·모달이 떠 있는 동안: 아무것도 새로 시작하지 않는다
    function stale() { var e = new Error('stale'); e.kind = 'stale'; e.userMessage = '이미 다른 판이 시작됐어요.'; return e; }
    function render() {                                             // 지금 화면의 과일이 이 결과의 것일 때만(다른 판·다른 과일이면 올리지 않는다)
      var s = AP.play.getSnapshot();
      if (r !== AP.gallery.current() || s.state !== 'ended' || AP.fruits.current.id !== r.fruit || AP.battle.encodeSurface(AP.apple.current.surface) !== r.grid) throw stale();
      return AP.share.renderGalleryImage(512);
    }
    galleryAsking = true;
    (r.nickname ? Promise.resolve(r.nickname) : AP.share.askNickname('전시장에 올릴 닉네임')).then(function (nick) {
      galleryAsking = false;
      if (nick == null) return;                                      // 취소: 아무것도 보내지 않는다
      track('gallery_submit'); galleryUi('sending', '내 과일을 전시장에 올리고 있어요…');
      return AP.gallery.submit({ round: r, nickname: nick, render: render }).then(function () {
        if (r !== AP.gallery.current()) return;
        galleryUi('done', '전시 완료! 내 과일이 전시장에 올라갔어요.'); AP.share.toast('전시 완료!');
      }, function (e) {
        if (r !== AP.gallery.current()) return;
        if (e && e.kind === 'rejected') r.nickname = null;           // 서버가 거절(닉네임 문자 등): 다음엔 닉네임을 다시 묻는다
        galleryUi(e && e.retryable ? 'retry' : 'idle', (e && e.userMessage) || '전시하지 못했어요. 잠시 후 다시 시도해 주세요.');
      });
    });
  }
  function requestStart() {
    useFruit(selectedFruit);
    if (!AP.play.start()) return;
    shownResult = false; interacted = false; galleryReset();
    hideFlow();
    syncKnifeMesh();
    updateUi(AP.play.getSnapshot());
  }
  function goIntro() {
    AP.play.reset();
    hideFlow(); shownResult = false; galleryReset();
    syncKnifeMesh();
    paintIntroPreview();
    show(screenIntro, true);
    updateUi(AP.play.getSnapshot());
  }
  function updateUi(snap) {
    var ready = snap.state === 'ready';
    uiVisible(hud, snap.state !== 'intro');
    uiVisible(pad, snap.state !== 'intro');
    uiVisible(watermark, snap.state !== 'intro');
    uiVisible(hint, ready);                       // 칼이 닿기 전에만 조작 안내(시작 후에는 화면을 가리지 않는다)
    hudRibbon.textContent = Math.round(snap.ribbon.curCm) + 'cm';
    hudPeel.textContent = Math.round(snap.peelPct) + '%';
    hudFlesh.textContent = Math.round(snap.fleshPct) + '%';
    if (snap.dirs.dx !== 0 || snap.dirs.dy !== 0 || snap.dirs.rot !== 0) interacted = true;
    if (snap.state === 'ended' && !shownResult && snap.endT * 1000 >= C.RULES.SETTLE_MS) {   // SETTLING: 껍질 분리·낙하 연출 뒤 결과 화면
      shownResult = true;
      resultTitle.textContent = AP.fruits.current.resultTitle; btnSave.textContent = '내 ' + AP.fruits.current.name + ' 저장';
      resultScore.textContent = ''; resultScore.appendChild(document.createTextNode(String(snap.score.total))); var un = document.createElement('span'); un.className = 'unit'; un.textContent = '점'; resultScore.appendChild(un);
      resultGrade.textContent = snap.score.grade;
      resultDetail.textContent = '껍질 제거 ' + Math.round(snap.peelPct) + '% · 과육 손실 ' + snap.fleshPct.toFixed(1) + '% · 최장 껍질 ' + Math.round(snap.ribbon.longestCm) + 'cm';
      screenResult.classList.toggle('has-battle', !!challenge); btnBattleResult.hidden = !challenge;     // 도전으로 들어온 판이면 [대결 결과 보기]
      track('game_complete');
      galleryCapture(snap);
      show(screenResult, true);
      paintCanvas(resultCanvas, sceneRect());
    }
  }

  function frame(dt) {
    if (!paused) AP.play.update(dt);
    syncKnifeMesh();
    if (debugOn) updateDebug();
    AP.scene.render();
    var snap = AP.play.getSnapshot();
    updateUi(snap);
    return snap;
  }
  var lastTs = null;
  function loop(ts) {
    if (lastTs === null) lastTs = ts;
    var dt = (ts - lastTs) / 1000;
    lastTs = ts;
    frame(dt);
    requestAnimationFrame(loop);
  }

  window.addEventListener('resize', handleResize);
  window.addEventListener('orientationchange', handleResize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', handleResize);
  window.addEventListener('hashchange', function () { setDebug(location.hash === C.DEBUG_HASH); });

  AP.assets.load(function () {
    apple = AP.apple.create();
    AP.scene.addApple(apple.group);
    buildKnifeMesh();
    AP.ribbon.init();
    handleResize();
    AP.play.reset();
    syncKnifeMesh();
    setDebug(debugOn);
    hint.textContent = AP.input.isTouchPrimary() ? '방향 버튼으로 이동 · 회전 버튼으로 각도 조절 · 칼을 떼면 끝!' : '방향키로 이동 · Q/W로 각도 조절 · 칼을 떼면 끝!';
    AP.input.attach(pad);
    btnStart.addEventListener('click', function () { track('flow_start'); showSelect(); });
    btnSelectNext.addEventListener('click', function () { track('game_start'); requestStart(); });
    btnRestart.addEventListener('click', function () { track('replay'); requestStart(); });
    $('btn-challenge-start').addEventListener('click', function () { track('challenge_start'); if (challenge && AP.fruits.available(challenge.fruit)) selectFruit(challenge.fruit); showSelect(); });   // 친구와 같은 과일이 미리 선택된다(바꿀 수 있음)
    btnBattleResult.addEventListener('click', showBattle);
    if (btnGallery) btnGallery.addEventListener('click', galleryClick);
    if (btnGalleryView) btnGalleryView.addEventListener('click', function () { track('gallery_view'); });
    $('btn-rematch').addEventListener('click', function () { track('replay'); requestStart(); });
    $('btn-vs-detail').addEventListener('click', function () { hideFlow(); show(screenResult, true); });
    AP.share.bind({ save: $('btn-save'), challenge: $('btn-challenge'), note: $('challenge-note'), toast: $('toast') });
    paintIntroPreview();
    AP.fruits.probe(function () {                  // 과일 이미지 존재 확인 후 선택 UI 구성(없는 이미지는 오류 없이 "준비 중")
      var q = /[?&]fruit=([a-z]+)/.exec(location.search);      // 공유 링크의 ?fruit= 로 같은 과일 미리 선택
      if (q && AP.fruits.available(q[1])) selectedFruit = q[1];
      AP.fruits.select(selectedFruit); useFruit(selectedFruit); previewFruit = selectedFruit; buildFruitGrid(); btnSave.textContent = '내 ' + AP.fruits.current.name + ' 저장';
      bootReady = true;
      var tok = AP.battle.parseHash(), rec = tok && AP.battle.parseToken(tok);      // 도전장 링크(#battle/…)면 도전장 화면, 아니면 메인 — 최종 과일·크기·위치가 정해진 뒤 첫 그림
      if (rec) { challenge = rec; showChallenge(); } else { document.documentElement.classList.remove('boot-challenge'); paintIntroPreview(); }
      window.AP_READY = true;
      requestAnimationFrame(loop);
    });
  });

  /* ── QA/디버그 훅 ── */
  /* 자동조종(QA 전용, 게임에는 없음) — 사람의 "나선형으로 내려가며 껍질만" 플레이를 흉내 낸다. 입력은 실제 키 입력과 같은 경로(setOverride).
   *   절삭점(피벗)을 능선 행에서 바닥 행까지 dur 초에 걸쳐 내린다(↑↓).
   *   기울기(Q/W)는 그 행의 표면 경사에 날이 평행하도록(위쪽 어깨는 반시계, 아래쪽은 시계) 맞춘다.
   *   깊이(←→)는 cutting 이 보고하는 "원래 껍질 기준 최대 깊이(depth0)" 가 목표(껍질 두께×DEPTH_FRAC, 껍질 안)에 머물도록. */
  var qaLegacy = false;     // 제품 기본 = 실제 규칙(접촉 이탈 종료). 호환 모드(종료 없음·시작 즉시 PLAYING)는 QA 가 AP_DEBUG.setLegacy(true) 로 명시할 때만 켠다
  AP.play.setQaMode(false);
  var auto = { t0: null, opts: null };
  function autopilot(s, opts) {
    var Sf = apple.surface, ys = AP.cutting.rowStageYs(), K = C.KNIFE;
    if (auto.t0 === null && (!opts.single || s.state === 'playing')) { auto.t0 = opts.single ? s.playT : s.t; }
    var tt = opts.single ? s.playT : s.t;
    var dur = opts.dur || 40, p = auto.t0 === null ? 0 : clamp((tt - auto.t0) / dur, 0, 1);
    var it = Math.round((Sf.NR - 1) * (1 - p));
    var ey = ys[it] - AP.knife.py, dead = opts.dead || 0.6, dy = ey > dead ? 1 : (ey < -dead ? -1 : 0);
    if (opts.oscHz && auto.t0 !== null) dy = Math.sin(2 * Math.PI * opts.oscHz * (tt - auto.t0)) > 0 ? 1 : -1;       // 빠르게 위아래로 흔들기(QA)
    var band = Math.min(C.VISUAL_RINGS - 1, Math.floor(it / C.SUB_RINGS));
    var slope = (Sf.knotR[band + 1] - Sf.knotR[band]) / (Sf.knotY[band + 1] - Sf.knotY[band]);      // dr/dy(월드, y 위)
    var minA = K.MIN_ANGLE_DEG * Math.PI / 180, maxA = K.MAX_ANGLE_DEG * Math.PI / 180;
    var targetA = clamp(Math.atan(apple.viewScale * slope / Math.cos(AP.scene.pitch)), minA, maxA) * (opts.tiltGain === undefined ? 1 : opts.tiltGain);
    var ea = targetA - AP.knife.angle, rot = ea > 0.02 ? 1 : (ea < -0.02 ? -1 : 0);
    var dx;
    if (opts.single) {                              // 실제 규칙용: 닿기 전엔 높이를 맞춘 뒤 접근, 닿은 뒤엔 절대 물러나지 않고 깊이만 조절, 끝낼 때만 뺀다
      var Sf2 = Sf, sec2 = AP.rotation.sectorAtWorld(0, Sf2.NS), idx2 = it * Sf2.NS + sec2;
      var tg = Sf2.skin[idx2] * (opts.depthFrac || 0.6), tl = opts.tol || 0.7;
      if (s.state === 'ready') { var kb = AP.knife.bounds, blocked = (ey < 0 && AP.knife.py <= kb.minY + 0.05) || (ey > 0 && AP.knife.py >= kb.maxY - 0.05);   // 이동 한계에 닿았으면 더 못 맞추므로 정렬된 것으로 본다
        dx = ((Math.abs(ey) > 2 && !blocked) || (opts.pretilt && Math.abs(ea) > 0.05)) ? 0 : -1; }       // pretilt: READY 에서 시작 행의 경사에 미리 기울인 뒤 접근(사람이 READY 에서 하는 조작)
      else if (opts.stopAt !== undefined && p >= opts.stopAt || opts.tapMs !== undefined && s.playT * 1000 >= opts.tapMs) { dx = 1; dy = 0; rot = 0; }
      else if (!s.cut || s.cut.inRange === 0) dx = -1;
      else dx = s.cut.depth0 < tg - tl ? -1 : (s.cut.depth0 > tg + tl ? 1 : 0);
      if (s.state === 'ready' && !opts.pretilt) rot = 0;
      if (s.state === 'playing' && p >= 1 && opts.retreatEnd !== false) { dx = 1; dy = 0; }
    } else if (Math.abs(ey) > (opts.jump || 20) || !s.cut || s.cut.inRange === 0) dx = 1;   // 큰 이동 중이거나 창 안에 행이 없으면 물러난다(맹목적으로 밀어 넣지 않음)
    else {
      var sector = AP.rotation.sectorAtWorld(0, Sf.NS), idx = it * Sf.NS + sector;
      var target = Sf.skin[idx] * (opts.depthFrac || 0.6), tol = opts.tol || 0.7;
      var d0 = s.cut.depth0;
      dx = d0 < target - tol ? -1 : (d0 > target + tol ? 1 : 0);
    }
    AP.input.setOverride({ dx: dx, dy: dy, rot: rot });
  }
  window.AP_DEBUG = {
    snapshot: function () { return AP.play.getSnapshot(); },
    step: function (dt) { AP.play.update(dt); return frame(0); },
    run: function (seconds, fps) { var n = Math.round(seconds * (fps || 60)), dt = 1 / (fps || 60); for (var i = 0; i < n; i++) { AP.play.update(dt); } return frame(0); },
    runAutopilot: function (seconds, opts, fps) {
      opts = opts || {}; auto.t0 = null; auto.opts = opts;
      var n = Math.round(seconds * (fps || 60)), dt = 1 / (fps || 60), s = AP.play.getSnapshot(), maxFleshDelta = 0;
      var rib = { badEmit: 0, maxSegGap: 0, maxPtStep: 0, frames: 0, maxMs: 0, sumMs: 0 }, prevEm = AP.ribbon.info().emittedPx, prevPts = null;
      for (var i = 0; i < n; i++) {
        autopilot(s, opts);
        var t0 = performance.now(); AP.play.update(dt); var ms = performance.now() - t0;
        s = AP.play.getSnapshot(); if (s.cut && s.cut.fleshDelta > maxFleshDelta) maxFleshDelta = s.cut.fleshDelta;
        if (opts.onFrame) opts.onFrame(s);                                // QA: 프레임마다 스냅샷 콜백
        if (s.state === 'ended') break;
        /* 리본 불변식: 길이는 새 껍질이 제거된 프레임에만 증가 · 사슬 인접 마디 간격 ≤ SEG_LEN · 프레임당 마디 이동량 */
        var em = s.ribbon.emittedPx, newly = s.cut ? s.cut.newlyPeeled : 0;
        if ((em > prevEm + 1e-9) !== (newly > 0 && s.cut.peelLen > 0)) rib.badEmit++;
        prevEm = em;
        var pts = AP.ribbon.points();
        for (var q = 1; q < pts.length; q++) rib.maxSegGap = Math.max(rib.maxSegGap, Math.hypot(pts[q][0] - pts[q - 1][0], pts[q][1] - pts[q - 1][1]));
        if (prevPts && prevPts.length) for (var w = 0; w < Math.min(prevPts.length, pts.length); w++) if (w > 0) rib.maxPtStep = Math.max(rib.maxPtStep, Math.hypot(pts[w][0] - prevPts[w][0], pts[w][1] - prevPts[w][1]));
        prevPts = pts; rib.frames++; rib.sumMs += ms; if (ms > rib.maxMs) rib.maxMs = ms;
      }
      AP.input.setOverride(null);
      frame(0);
      return { snap: AP.play.getSnapshot(), stats: AP.cutting.cellStats(), maxFleshDelta: maxFleshDelta, rib: rib };
    },
    cellStats: function () { return AP.cutting.cellStats(); },
    cellsAt: function (sector) { return AP.cutting.cellsAt(sector); },
    dumpSurface: function () { return AP.cutting.dumpSurface(); },
    logCuts: function (on) { AP.cutting.log = !!on; },
    cellMeshRadius: function (idx) { return apple.body.cellMeshRadius(idx); },
    cellState: function (row, sector) { var Sf = apple.surface, idx = row * Sf.NS + sector; return { idx: idx, state: Sf.state[idx], rec: Sf.rec[idx], r0: Sf.r0[idx], skin: Sf.skin[idx], fleshLoss: Sf.fleshLoss[idx], peeled: Sf.peeled[idx], meshR: apple.body.cellMeshRadius(idx) }; },
    /* QA: 기본은 호환 모드(시작 즉시 PLAYING · 접촉 상실로 종료 안 함 — 기계 동작 테스트용). setLegacy(false) 가 실제 규칙(READY→첫 접촉→PLAYING→이탈 종료) */
    start: function () { var ok = requestStart(); if (qaLegacy) AP.play.forcePlaying(); return ok; }, finish: function (r) { return AP.play.finish(r || 'button'); }, goIntro: goIntro,
    goSelect: showSelect, challenge: function () { return challenge; }, goBattle: showBattle, selectFruit: selectFruit, selectedFruit: function () { return selectedFruit; }, previewFruit: function () { return previewFruit; },
    setLegacy: function (b) { qaLegacy = !!b; AP.play.setQaMode(!!b); },
    setPaused: function (b) { paused = !!b; },
    setDirs: function (dx, dy, rot) { AP.input.setOverride(dx === null || dx === undefined ? null : { dx: dx, dy: dy, rot: rot || 0 }); },
    setKnifePos: function (x, y) { AP.knife.setOrigin(x, y); syncKnifeMesh(); },
    setKnifeAngleDeg: function (deg) { AP.knife.setAngle(deg * Math.PI / 180); syncKnifeMesh(); },
    setDebug: setDebug,
    setSmoothPeel: function (b) { apple.body.setSmooth(b); },
    layout: function () { return layoutInfo; },
    probe: function () { return AP.blade.probe(AP.apple.silhouetteX); },
    regions: function () { return AP.blade.regions(); },
    meridian: function () { return AP.apple.meridianStage(); },
    silhouetteX: function (y) { return AP.apple.silhouetteX(y); },
    contact: function () { return AP.cutting.contact; },
    ribbon: function () { return AP.ribbon.info(); },
    ribbonPoints: function () { return AP.ribbon.points(); },
    ribbonColors: function () { return AP.ribbon.colorsNow(); },
    meshBox: function () { var b = new THREE.Box3(); b.expandByObject(apple.body.mesh); b.expandByObject(apple.caps.top); b.expandByObject(apple.caps.bottom); return { x0: b.min.x, x1: b.max.x, y0: b.min.y, y1: b.max.y, vs: apple.viewScale }; },
    /* 스프라이트 ↔ 판정 변환 일치 검사: PNG bbox 모서리를 knife.toStage 로 보낸 점과 메시의 같은 모서리 월드 좌표의 최대 거리(px) */
    spriteMismatch: function () {
      var d = AP.knife.data, bb = d.bbox, worst = 0;
      var cs = [[bb.x, bb.y], [bb.x + bb.w, bb.y], [bb.x + bb.w, bb.y + bb.h], [bb.x, bb.y + bb.h]];
      knifeMesh.updateMatrixWorld(true);
      for (var i = 0; i < cs.length; i++) {
        var local = new THREE.Vector3(cs[i][0] - d.w / 2, -(cs[i][1] - d.h / 2), 0);   // 평면 로컬(중심 원점, y 위)
        var w = knifeMesh.localToWorld(local), st = AP.knife.toStage(cs[i]);
        worst = Math.max(worst, Math.hypot(w.x - st[0], -w.y - st[1]));
      }
      return worst;
    },
    /* 표면 추적 마커의 월드 위치(z>0 = 정면) + 스테이지 투영 */
    marker: function () { var w = apple.markerWorld(); var p = AP.scene.project(w); return { wx: w.x, wy: w.y, wz: w.z, sx: p.x, sy: p.y }; },
    appleCenterStage: function () { return AP.scene.project(new THREE.Vector3(0, 0, 0)); },
    surface: function () { var S = apple.surface; return { R: S.R, bodyH: S.bodyH, NR: S.NR, NS: S.NS, crestY: S.crestY, ring0Y: S.ring0Y, crestR: S.crestR, ring0R: S.ring0R, topY: S.topY, bottomY: S.bottomY, totalArea: S.totalArea, viewScale: apple.viewScale }; },
    introPreviewDataUrl: function () { return introCanvas.toDataURL('image/png'); },
    appleSnapshotDataUrl: function (w, h) {
      var S = apple.surface, vs = apple.viewScale, cx = AP.scene.appleCx;
      var top = AP.scene.project(new THREE.Vector3(0, S.topY * vs, 0)).y, bottom = AP.scene.project(new THREE.Vector3(0, S.bottomY * vs, 0)).y;
      var rect = { x0: cx - S.R * vs - 4, x1: cx + S.R * vs + 4, y0: top - 4, y1: bottom + 4 };
      var ww = w || 300;
      return AP.scene.renderSnapshot(ww, h || Math.round(ww * (rect.y1 - rect.y0) / (rect.x1 - rect.x0)), rect, { bg: '#FFFFFF', hideOverlay: true }).toDataURL('image/png');
    },
    get apple() { return apple; }, get knifeMesh() { return knifeMesh; },
  };
})();
