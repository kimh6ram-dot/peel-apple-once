/* 전시장 화면 — 읽기 전용. 데이터는 GalleryApi(gallery-api.js)만 통해서 가져오고, 외부 문자열은 전부 textContent 로만 넣는다(innerHTML 사용 안 함).
 * 모드: 기본 = 실데이터(설정이 있을 때) / 설정이 비어 있으면 안내 / ?mode=test = 가짜 데이터(DB 접근 없음, 화면에 표시).
 * 좋아요는 버튼만 있고 서버 호출이 없다 — 다음 단계에서 GalleryUI.onLike 에 서버 함수를 연결한다. */
(function () {
  'use strict';
  var API = window.GalleryApi, CFG = window.GALLERY_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(location.search);
  var isTest = params.get('mode') === 'test';

  var state = { sort: 'new', fruit: '', items: [], page: 0, hasMore: false, loading: false, error: null, token: 0, source: null, setup: null, detail: null };

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function fmtDate(t) { if (t == null) return ''; var d = new Date(t), p = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getFullYear() + '.' + p(d.getMonth() + 1) + '.' + p(d.getDate()); }
  var toastT = null;
  function toast(msg) { var t = $('g-toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, 2200); }

  /* ── 소스 선택 ── */
  function pickSource() {
    if (isTest) return API.createTest('assets/gallery-test', { empty: params.get('empty') === '1', fail: params.get('fail') === '1' });
    var c = API.inspectConfig(CFG);
    if (!c.ok) { state.setup = c.reason; return null; }
    return API.createRemote(CFG);
  }

  /* ── 컨트롤 ── */
  function buildControls() {
    var s = $('g-sorts'), f = $('g-fruits'); clear(s); clear(f);
    Object.keys(API.SORTS).forEach(function (k) { var b = el('button', null, API.SORTS[k].label); b.type = 'button'; b.dataset.sort = k; b.addEventListener('click', function () { setSort(k); }); s.appendChild(b); });
    [['', '전체']].concat(Object.keys(API.FRUITS).map(function (k) { return [k, API.FRUITS[k]]; })).forEach(function (p) { var b = el('button', null, p[1]); b.type = 'button'; b.dataset.fruit = p[0]; b.addEventListener('click', function () { setFruit(p[0]); }); f.appendChild(b); });
    syncControls();
  }
  function syncControls() {
    Array.prototype.forEach.call($('g-sorts').children, function (b) { b.setAttribute('aria-pressed', String(b.dataset.sort === state.sort)); });
    Array.prototype.forEach.call($('g-fruits').children, function (b) { b.setAttribute('aria-pressed', String(b.dataset.fruit === state.fruit)); });
  }
  function setSort(k) { if (k === state.sort) return; state.sort = k; syncControls(); reload(); }
  function setFruit(k) { if (k === state.fruit) return; state.fruit = k; syncControls(); reload(); }

  /* ── 격자 ── */
  function cell(item) {
    var li = el('li'), b = el('button', 'g-cell'); b.type = 'button'; b.dataset.id = item.id;
    var box = el('span', 'g-cell-img'), img = document.createElement('img');
    img.alt = item.nickname + '의 ' + API.FRUITS[item.fruit]; img.width = 512; img.height = 512; img.loading = 'lazy'; img.decoding = 'async'; img.src = item.imageUrl;
    img.addEventListener('error', function () { img.style.visibility = 'hidden'; });
    box.appendChild(img);
    var row = el('span', 'g-cell-row'), sc = el('span', 'g-cell-score', String(item.score)); sc.appendChild(el('small', null, '점'));
    row.appendChild(sc); row.appendChild(el('span', 'g-cell-likes', '♥ ' + item.likes));
    b.appendChild(box); b.appendChild(row); b.appendChild(el('span', 'g-cell-name', item.nickname));
    b.addEventListener('click', function () { openDetail(item, b); });
    li.appendChild(b); return li;
  }
  function appendItems(items) { var g = $('g-grid'), frag = document.createDocumentFragment(); items.forEach(function (it) { frag.appendChild(cell(it)); }); g.appendChild(frag); }

  /* ── 상태 표시(불러오는 중 · 빈 목록 · 오류 · 안내) ── */
  function showStatus(kind, opts) {
    var s = $('g-status'); clear(s); s.hidden = !kind; s.className = 'g-state' + (opts && opts.inline ? ' g-inline' : '');
    if (!kind) return;
    if (kind === 'loading') { s.appendChild(el('p', 'g-state-text', '불러오는 중…')); return; }
    if (kind === 'empty') {
      s.appendChild(el('p', 'g-state-title', state.fruit ? '아직 이 과일은 없어요' : '아직 전시된 과일이 없어요'));
      s.appendChild(el('p', 'g-state-text', state.fruit ? '다른 과일을 골라보세요.' : '첫 번째 작품의 주인공이 되어보세요.'));
      var a = el('a', 'cta', '게임 하러 가기'); a.href = 'index.html'; s.appendChild(a); return;
    }
    if (kind === 'error') {
      s.appendChild(el('p', 'g-state-title', '불러오지 못했어요'));
      s.appendChild(el('p', 'g-state-text', '네트워크를 확인하고 다시 시도해 주세요.'));
      var r = el('button', 'btn-secondary', '다시 시도'); r.type = 'button'; r.id = 'g-retry'; r.addEventListener('click', function () { state.page === 0 || !state.items.length ? reload() : loadMore(); }); s.appendChild(r);
    }
  }
  function showSetup(reason) {
    $('g-controls').hidden = true; $('g-more-wrap').hidden = true;
    var n = $('g-notice'); clear(n); n.hidden = false;
    n.appendChild(el('p', 'g-state-title', '전시장을 준비하고 있어요'));
    n.appendChild(el('p', 'g-state-text', reason === 'empty' ? '아직 데이터베이스 연결 전이에요.' : '연결 설정을 확인해 주세요. (' + reason + ')'));
    var a = el('a', 'btn-secondary', '테스트 데이터로 미리보기'); a.href = '?mode=test'; n.appendChild(a);
  }

  /* ── 불러오기 ── */
  function reload() {
    state.token++; state.items = []; state.page = 0; state.hasMore = false; state.error = null; state.loading = false;
    clear($('g-grid')); $('g-more-wrap').hidden = true; showStatus(null);
    fetchPage(true);
  }
  function loadMore() { if (state.loading || !state.hasMore || state.error) return; fetchPage(false); }
  function fetchPage(first) {
    if (!state.source) return;
    var tk = state.token, page = state.page; state.loading = true; state.error = null; $('g-more-wrap').hidden = true; showStatus('loading', { inline: !first });
    state.source.list({ sort: state.sort, fruit: state.fruit, page: page, pageSize: CFG.PAGE_SIZE || 24 }).then(function (r) {
      if (tk !== state.token) return;                                           // 정렬·필터가 바뀐 뒤 늦게 온 응답은 버린다
      state.loading = false; state.items = state.items.concat(r.items); state.page = page + 1; state.hasMore = r.hasMore;
      appendItems(r.items);
      if (!state.items.length) showStatus('empty'); else showStatus(null);
      $('g-more-wrap').hidden = !state.hasMore;
    }, function (e) {
      if (tk !== state.token) return;
      state.loading = false; state.error = e || { kind: 'unknown' };
      try { console.warn('[전시장] 조회 실패', e && e.kind, e && e.status, e && e.code, e && e.detail); } catch (x) { /* 무시 */ }
      showStatus('error', { inline: !first && state.items.length > 0 });
    });
  }

  /* ── 상세 ── */
  var lastFocus = null;
  function openDetail(item, opener) {
    state.detail = item; lastFocus = opener || null;
    var img = $('g-d-img'); img.src = item.imageUrl; img.alt = item.nickname + '의 ' + API.FRUITS[item.fruit];
    var sc = $('g-d-score'); sc.textContent = String(item.score); sc.appendChild(el('small', null, '점'));
    $('g-d-name').textContent = item.nickname;
    $('g-d-meta').textContent = API.FRUITS[item.fruit] + (item.createdAt != null ? ' · ' + fmtDate(item.createdAt) : '');
    $('g-d-test').hidden = !(state.source && state.source.mode === 'test');
    $('g-like-n').textContent = String(item.likes);
    $('g-detail').hidden = false; document.documentElement.style.overflow = 'hidden'; $('g-close').focus();
    setUrlId(item.id); showMissing(null);
  }
  function closeDetail() { $('g-detail').hidden = true; document.documentElement.style.overflow = ''; state.detail = null; setUrlId(null); if (lastFocus && document.contains(lastFocus)) try { lastFocus.focus(); } catch (e) { /* 무시 */ } }

  /* ── 공유 링크(?id=<과일 id>) ── 상세를 열면 주소에 id 가 붙고(새로고침·복사해도 같은 화면) 닫으면 빠진다. 기록 저장(history)은 쌓지 않는다 */
  function pageBase() { return location.href.split('#')[0].split('?')[0]; }
  function linkFor(id) { return pageBase() + '?' + (isTest ? 'mode=test&' : '') + 'id=' + encodeURIComponent(id); }
  function setUrlId(id) {
    try {
      var q = new URLSearchParams(location.search); if (id) q.set('id', id); else q.delete('id');
      var s = q.toString(); history.replaceState(null, '', pageBase() + (s ? '?' + s : '') + location.hash);
    } catch (e) { /* 일부 환경(file:// 등)은 주소 변경을 막는다 — 화면 동작에는 영향 없음 */ }
  }
  function shareClicked() {
    var item = state.detail; if (!item) return;
    var url = linkFor(item.id), data = { title: '사과 깎기 전시장', text: item.nickname + '의 ' + API.FRUITS[item.fruit] + ' ' + item.score + '점', url: url };
    function copy() {
      var p = (navigator.clipboard && navigator.clipboard.writeText) ? navigator.clipboard.writeText(url) : Promise.reject(new Error('no clipboard'));
      return p.then(function () { toast('링크를 복사했어요'); }, function () { try { window.prompt('링크를 복사하세요', url); } catch (x) { /* 무시 */ } });
    }
    var touch = false; try { touch = window.matchMedia('(pointer: coarse)').matches; } catch (e) { /* 무시 */ }
    if (touch && navigator.share) navigator.share(data).catch(function (e) { if (!e || e.name !== 'AbortError') return copy(); });
    else copy();
  }
  /* 공유 링크로 들어왔는데 보여 줄 과일이 없을 때 안내(잘못된 id · 삭제/숨김 처리 · 불러오기 실패). msg=null 이면 숨긴다 */
  function showMissing(kind) {
    var m = $('g-missing'); clear(m); m.hidden = !kind; if (!kind) return;
    if (kind === 'error') {
      m.appendChild(el('p', null, '과일을 불러오지 못했어요. 네트워크를 확인하고 다시 시도해 주세요.'));
      var r = el('button', 'btn-secondary', '다시 시도'); r.type = 'button'; r.id = 'g-missing-retry'; r.addEventListener('click', function () { openById(state.wantId); }); m.appendChild(r);
    } else m.appendChild(el('p', null, '찾을 수 없는 과일이에요. 주소가 잘못됐거나 삭제·숨김 처리됐을 수 있어요. 아래 전시장에서 다른 과일을 구경해 보세요.'));
  }
  function openById(id) {
    state.wantId = id;
    if (!API.isValidId(id) || !state.source) { showMissing('missing'); return; }
    showMissing(null);
    state.source.get(id).then(function (item) {
      if (state.wantId !== id) return;                                            // 그 사이 다른 요청으로 바뀜
      if (item) openDetail(item, null); else showMissing('missing');
    }, function (e) {
      if (state.wantId !== id) return;
      try { console.warn('[전시장] 상세 조회 실패', e && e.kind, e && e.status, e && e.code); } catch (x) { /* 무시 */ }
      showMissing('error');
    });
  }

  /* 좋아요: 지금은 서버 호출 없음. 다음 단계에서 onLike 를 서버 함수 호출로 교체한다(반환: Promise<{ok, likes?, reason?}>). */
  var UI = {
    onLike: function (item) { return Promise.resolve({ ok: false, reason: 'not-ready' }); },
  };
  function likeClicked() {
    var item = state.detail; if (!item) return;
    UI.onLike(item).then(function (r) {
      if (r && r.ok) { $('g-like-n').textContent = String(r.likes); $('g-like').setAttribute('aria-pressed', 'true'); }
      else toast('좋아요는 곧 열려요');
    });
  }

  /* ── 시작 ── */
  function init() {
    $('g-close').addEventListener('click', closeDetail);
    $('g-detail').addEventListener('click', function (e) { if (e.target === $('g-detail')) closeDetail(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('g-detail').hidden) closeDetail(); });
    $('g-like').addEventListener('click', likeClicked);
    $('g-share').addEventListener('click', shareClicked);
    $('g-more').addEventListener('click', loadMore);
    buildControls();
    state.source = pickSource();
    if (isTest) { var bn = $('g-banner'); bn.hidden = false; bn.textContent = '테스트 데이터입니다 · 실제 이용자의 기록이 아니에요'; }
    if (!state.source) { showSetup(state.setup); return; }
    if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { if (es[0].isIntersecting) loadMore(); }, { rootMargin: '400px 0px' }).observe($('g-sentinel'));
    reload();
    if (params.has('id')) openById(params.get('id'));                              // 공유 링크: 목록은 그대로 불러오고, 그 위에 해당 과일 상세를 연다
  }

  window.GalleryUI = UI; UI.state = state; UI.reload = reload; UI.loadMore = loadMore;
  init();
})();
