/* 내 과일 전시하기 — 결과 화면의 최종 기록을 전시장 서버(Edge Function submit-gallery-apple)에 한 번만 올린다. 게임 판정·점수에는 관여하지 않는다.
 *
 * 흐름(한 판의 결과 = round 하나): capture(결과가 뜰 때 값·request_id 고정) → submit(이미지 인코딩 → 익명 세션 → POST).
 *  - request_id 는 round 가 만들어질 때 한 번 정해지고, 같은 round 의 재시도(실패 후 다시 누르기)는 항상 같은 값을 쓴다. 새 판 = 새 round = 새 request_id.
 *  - 이미지는 첫 인코딩 결과를 round 에 보관해 재시도에도 같은 바이트를 보낸다(서버는 같은 request_id 에 다른 이미지가 오면 거절한다).
 *  - 성공하면 round 는 done — 같은 결과를 다시 올릴 수 없다(버튼이 "보러 가기"로 바뀐다). 진행 중에 또 누르면 같은 Promise 를 돌려준다.
 *  - 익명 세션(Supabase 익명 로그인)은 localStorage 에 두고 재사용·갱신한다. 토큰은 요청 헤더에만 쓰고, 로그·URL·공유 링크에 넣지 않는다.
 *  - 서버 비밀 키는 이 파일에 없다(공개 가능한 publishable key 만). 서버가 모든 검증·제한을 다시 한다(이 파일의 검사는 불필요한 요청을 줄이는 용도).
 * 설정: window.GALLERY_CONFIG(src/gallery/gallery-config.js)의 SUPABASE_URL · PUBLISHABLE_KEY. 비어 있으면 'config' 오류로 안내하고 아무것도 보내지 않는다. */
'use strict';
window.AP = window.AP || {};

AP.gallery = (function () {
  var FN_PATH = '/functions/v1/submit-gallery-apple', STORE_KEY = 'ccojik_apple_anon_session';
  var MAX_BYTES = 300 * 1024, MIN_BYTES = 200, SIZE = 512, QUALITIES = [0.9, 0.8, 0.7, 0.6, 0.5];
  var TIMEOUT_AUTH_MS = 12000, TIMEOUT_POST_MS = 45000, MAX_WAIT_MS = 8000, MAX_IN_PROGRESS_RETRIES = 2;

  var round = null, sessionPromise = null, memSession = null;
  var env = { fetch: null, storage: null, now: null, sleep: null };       // QA 가 바꿔 끼울 수 있는 의존성(기본값은 브라우저 것)

  function GalleryErr(kind, message, extra) { var e = new Error(message || kind); e.kind = kind; e.userMessage = message; if (extra) for (var k in extra) e[k] = extra[k]; return e; }
  function nowSec() { return Math.floor((env.now ? env.now() : Date.now()) / 1000); }
  function sleep(ms) { return env.sleep ? env.sleep(ms) : new Promise(function (r) { setTimeout(r, ms); }); }
  function doFetch(url, init) { return (env.fetch || window.fetch.bind(window))(url, init); }

  /* ── 설정 ── */
  function config() {
    var c = window.GALLERY_CONFIG || {}, url = String(c.SUPABASE_URL || '').trim().replace(/\/+$/, ''), key = String(c.PUBLISHABLE_KEY || '').trim();
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url) || !key) return null;
    if (/^sb_secret_/i.test(key)) return null;                                   // 서버 전용 키는 브라우저에서 쓰지 않는다
    if (!/^sb_publishable_/i.test(key)) {                                        // 구형 anon JWT 만 허용
      var m = key.split('.'); if (m.length !== 3) return null;
      try { if (JSON.parse(atob(m[1].replace(/-/g, '+').replace(/_/g, '/'))).role !== 'anon') return null; } catch (e) { return null; }
    }
    return { url: url, key: key };
  }

  /* ── UUID ── */
  function uuid() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* 아래 대체 */ }
    var b = new Uint8Array(16);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(b); else for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    var h = ''; for (var j = 0; j < 16; j++) h += (b[j] + 256).toString(16).slice(1);
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  /* ── WebP 인코딩 지원 확인(iOS Safari 등 일부 환경은 canvas 가 webp 로 인코딩하지 못하고 PNG 로 돌려준다) ── */
  function webpSupported() {
    try { var c = document.createElement('canvas'); c.width = c.height = 1; return c.toDataURL('image/webp').indexOf('data:image/webp') === 0; } catch (e) { return false; }
  }
  function encodeWebp(cv) {
    return new Promise(function (resolve, reject) {
      var i = 0;
      function next() {
        if (i >= QUALITIES.length) return reject(GalleryErr('too_large', '이미지 용량이 너무 커서 전시할 수 없어요.'));
        var q = QUALITIES[i++];
        try {
          cv.toBlob(function (b) {
            if (!b || b.type !== 'image/webp') return reject(GalleryErr('webp_unsupported', '이 브라우저는 전시용 이미지(WebP)를 만들 수 없어요. 다른 브라우저로 시도해 주세요.'));
            if (b.size < MIN_BYTES) return reject(GalleryErr('encode_failed', '이미지를 만들지 못했어요. 다시 시도해 주세요.'));
            if (b.size > MAX_BYTES) return next();                                    // 용량 초과 → 화질을 낮춰 다시 인코딩
            resolve(b);
          }, 'image/webp', q);
        } catch (e) { reject(GalleryErr('encode_failed', '이미지를 만들지 못했어요. 다시 시도해 주세요.')); }
      }
      next();
    });
  }
  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { var s = String(fr.result), i = s.indexOf(','); i >= 0 ? resolve(s.slice(i + 1)) : reject(GalleryErr('encode_failed', '이미지를 만들지 못했어요. 다시 시도해 주세요.')); };
      fr.onerror = function () { reject(GalleryErr('encode_failed', '이미지를 만들지 못했어요. 다시 시도해 주세요.')); };
      fr.readAsDataURL(blob);
    });
  }

  /* ── 익명 세션: 저장된 것 재사용 → 만료되면 refresh → 안 되면 새 익명 로그인 ── */
  function readStore() {
    try { var s = (env.storage || window.localStorage).getItem(STORE_KEY); if (s) { var o = JSON.parse(s); if (o && o.access_token) return o; } } catch (e) { /* 저장소 없음/손상 */ }
    return memSession;
  }
  function writeStore(o) {
    memSession = o;
    try { var st = env.storage || window.localStorage; o ? st.setItem(STORE_KEY, JSON.stringify(o)) : st.removeItem(STORE_KEY); } catch (e) { /* 사생활 보호 모드 등: 메모리에만 */ }
  }
  function withTimeout(ms) {
    var ctl = typeof AbortController === 'function' ? new AbortController() : null, t = setTimeout(function () { if (ctl) ctl.abort(); }, ms);
    return { signal: ctl ? ctl.signal : undefined, done: function () { clearTimeout(t); } };
  }
  function authCall(c, path, body) {
    var to = withTimeout(TIMEOUT_AUTH_MS);
    return doFetch(c.url + path, { method: 'POST', headers: { apikey: c.key, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: to.signal }).then(function (res) {
      to.done();
      return res.json().catch(function () { return {}; }).then(function (j) { return { status: res.status, body: j || {} }; });
    }, function (e) { to.done(); throw GalleryErr(e && e.name === 'AbortError' ? 'timeout' : 'network', e && e.name === 'AbortError' ? '인증 서버 응답이 늦어요. 잠시 후 다시 시도해 주세요.' : '네트워크에 연결되어 있지 않아요. 연결을 확인하고 다시 시도해 주세요.', { retryable: true }); });
  }
  function toSession(j) {
    if (!j || !j.access_token) return null;
    var exp = Number(j.expires_at) || (nowSec() + (Number(j.expires_in) || 3600));
    return { access_token: String(j.access_token), refresh_token: j.refresh_token ? String(j.refresh_token) : '', expires_at: exp, user_id: j.user && j.user.id ? String(j.user.id) : '' };
  }
  function signInAnon(c) {
    return authCall(c, '/auth/v1/signup', { data: {} }).then(function (r) {
      var s = r.status >= 200 && r.status < 300 ? toSession(r.body) : null;
      if (s) { writeStore(s); return s; }
      var code = String(r.body.error_code || r.body.code || '');
      if (r.status === 429 || /rate_limit/.test(code)) throw GalleryErr('auth_rate_limited', '잠시 요청이 많아요. 조금 뒤에 다시 시도해 주세요.', { retryable: true });
      if (/anonymous_provider_disabled/.test(code) || r.status === 422 || r.status === 400) throw GalleryErr('auth_disabled', '지금은 전시를 이용할 수 없어요. 잠시 뒤에 다시 시도해 주세요.', { retryable: false });
      throw GalleryErr('auth_failed', '인증에 실패했어요. 잠시 후 다시 시도해 주세요.', { retryable: true });
    });
  }
  function refresh(c, s) {
    if (!s.refresh_token) return Promise.resolve(null);
    return authCall(c, '/auth/v1/token?grant_type=refresh_token', { refresh_token: s.refresh_token }).then(function (r) {
      var n = r.status >= 200 && r.status < 300 ? toSession(r.body) : null;
      if (n) { writeStore(n); return n; }
      return null;                                                                // refresh 불가(만료·폐기) → 새 익명 로그인
    });
  }
  /* 유효한 세션을 돌려준다. 동시에 여러 번 불러도 로그인은 한 번만 일어난다 */
  function getSession(c, force) {
    if (sessionPromise) return sessionPromise;
    var s = force ? null : readStore();
    if (s && s.expires_at - 60 > nowSec()) return Promise.resolve(s);
    sessionPromise = (s ? refresh(c, s) : Promise.resolve(null)).then(function (n) { return n || signInAnon(c); }).then(function (r) { sessionPromise = null; return r; }, function (e) { sessionPromise = null; throw e; });
    return sessionPromise;
  }

  /* ── 서버 호출 ── */
  function post(c, session, body) {
    var to = withTimeout(TIMEOUT_POST_MS);
    return doFetch(c.url + FN_PATH, { method: 'POST', headers: { Authorization: 'Bearer ' + session.access_token, apikey: c.key, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: to.signal }).then(function (res) {
      to.done();
      return res.json().catch(function () { return {}; }).then(function (j) { return { status: res.status, body: j || {}, retryAfter: Number(res.headers.get('retry-after')) || 0 }; });
    }, function (e) { to.done(); throw GalleryErr(e && e.name === 'AbortError' ? 'timeout' : 'network', e && e.name === 'AbortError' ? '서버 응답이 늦어요. 같은 기록으로 다시 시도할 수 있어요.' : '네트워크에 연결되어 있지 않아요. 연결을 확인하고 다시 시도해 주세요.', { retryable: true }); });
  }
  /* 서버 응답 → 사용자에게 보일 오류(이 함수는 성공이 아닌 응답만 받는다) */
  function httpError(r) {
    var code = r.body && r.body.error && r.body.error.code, ra = Math.max(r.retryAfter || 0, (r.body && r.body.error && r.body.error.retry_after) || 0);
    if (r.status === 401) return GalleryErr('unauthorized', '로그인 정보가 만료됐어요. 다시 시도해 주세요.', { retryable: true });
    if (r.status === 413) return GalleryErr('too_large', '이미지 용량이 너무 커서 전시할 수 없어요.');
    if (r.status === 429) return GalleryErr(code === 'too_many_attempts' ? 'too_many_attempts' : 'rate_limited',
      code === 'too_many_attempts' ? '시도 횟수를 넘었어요. 나중에 다시 시도해 주세요.' : (ra >= 60 ? '전시 요청이 너무 많아요. ' + Math.ceil(ra / 60) + '분 뒤에 다시 시도해 주세요.' : '조금 천천히 해주세요. ' + (ra || 15) + '초 뒤에 다시 시도해 주세요.'), { retryable: true, retryAfter: ra });
    if (r.status === 403) return GalleryErr('forbidden', '이 주소에서는 전시할 수 없어요.');
    if (r.status === 400 || r.status === 415 || r.status === 422) return GalleryErr('rejected', code === 'implausible_result' ? '이 기록은 전시할 수 없어요.' : '전시할 수 없는 기록이에요.', { serverCode: code });
    if (r.status === 409 || r.status === 503) return GalleryErr('busy', '처리가 길어지고 있어요. 잠시 후 다시 시도해 주세요.', { retryable: true, retryAfter: ra });
    return GalleryErr('server', '서버에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.', { retryable: true });
  }

  /* ── 한 판의 결과 ── */
  /* 결과가 화면에 뜰 때 호출 — 그 순간의 값과 새 request_id 를 고정한다(이후 다른 판을 해도 섞이지 않는다) */
  function capture(rec) {
    round = {
      requestId: uuid(), status: 'idle', promise: null, result: null, nickname: null, image: null,
      fruit: rec.fruit, score: rec.score, peel_pct: rec.peelPct, flesh_pct: rec.fleshPct, grid: rec.grid,
    };
    return round;
  }
  function clearRound() { round = null; }
  function current() { return round; }

  /* opts: { round, nickname, render: () => canvas(512×512, 투명) } — render 는 지금 화면의 과일이 이 round 의 것일 때만 캔버스를 돌려주고, 아니면 throw 한다 */
  function submit(opts) {
    var r = opts.round;
    if (!r || r !== round) return Promise.reject(GalleryErr('stale', '이미 다른 판이 시작됐어요. 결과 화면에서 다시 시도해 주세요.'));
    if (r.status === 'done') return Promise.resolve(r.result);
    if (r.status === 'sending' && r.promise) return r.promise;                  // 연속 클릭: 같은 요청을 기다릴 뿐 새로 보내지 않는다
    var c = config();
    if (!c) return Promise.reject(GalleryErr('config', '전시장 연결이 아직 준비되지 않았어요.'));
    if (!r.image && !webpSupported()) return Promise.reject(GalleryErr('webp_unsupported', '이 브라우저는 전시용 이미지(WebP)를 만들 수 없어요. 다른 브라우저로 시도해 주세요.'));
    if (opts.nickname != null) r.nickname = opts.nickname;
    r.status = 'sending';
    r.promise = Promise.resolve().then(function () {
      if (r.image) return r.image;                                              // 재시도: 처음 만든 이미지를 그대로(같은 request_id + 같은 바이트)
      var cv = opts.render();
      if (!cv || cv.width !== SIZE || cv.height !== SIZE) throw GalleryErr('encode_failed', '이미지를 만들지 못했어요. 다시 시도해 주세요.');
      return encodeWebp(cv).then(blobToBase64).then(function (b64) { r.image = b64; return b64; });
    }).then(function (b64) {
      if (round !== r) throw GalleryErr('stale', '이미 다른 판이 시작됐어요. 결과 화면에서 다시 시도해 주세요.');
      var body = { request_id: r.requestId, fruit: r.fruit, nickname: r.nickname, score: r.score, peel_pct: r.peel_pct, flesh_pct: r.flesh_pct, grid: r.grid, image_base64: b64 };
      var inProgress = 0, reauthed = false;
      function attempt(session) {
        return post(c, session, body).then(function (res) {
          if (res.status === 200 || res.status === 201) {
            var b = res.body;
            if (!b || b.ok !== true || typeof b.id !== 'string') throw GalleryErr('server', '서버 응답을 이해하지 못했어요. 잠시 후 다시 시도해 주세요.', { retryable: true });
            return { id: b.id, imagePath: b.image_path, duplicate: !!b.duplicate };
          }
          if (res.status === 401 && !reauthed) {                                // 토큰이 거절됨 → 새 익명 세션으로 한 번만 같은 요청 재전송
            reauthed = true; writeStore(null);
            return getSession(c, true).then(attempt);
          }
          if (res.status === 409 && inProgress < MAX_IN_PROGRESS_RETRIES) {     // 같은 request_id 를 서버가 처리 중 → 잠시 기다렸다 같은 요청으로 확인
            inProgress++;
            return sleep(Math.min(MAX_WAIT_MS, Math.max(1000, (res.retryAfter || 3) * 1000))).then(function () { return round === r ? attempt(session) : Promise.reject(GalleryErr('stale', '이미 다른 판이 시작됐어요.')); });
          }
          throw httpError(res);
        });
      }
      return getSession(c).then(attempt);
    }).then(function (result) {
      r.status = 'done'; r.result = result; r.promise = null; return result;
    }, function (e) {
      r.status = 'idle'; r.promise = null;                                       // 실패: 같은 round(같은 request_id)로 다시 시도할 수 있다
      throw (e && e.kind ? e : GalleryErr('unknown', '전시하지 못했어요. 잠시 후 다시 시도해 주세요.', { retryable: true }));
    });
    return r.promise;
  }

  return {
    capture: capture, clearRound: clearRound, current: current, submit: submit, config: config, clearSession: function () { writeStore(null); }, webpSupported: webpSupported, uuid: uuid,
    /* [내 사과 보러 가기]: 전시장 전체 화면으로 가서 방금 올린 내 사과를 표시(?mine=). 공유 링크(?id=, 상세가 바로 열림)는 galleryUrl */
    listUrl: function (id) { var q = id ? '?mine=' + encodeURIComponent(id) : ''; try { return new URL('gallery.html' + q, location.href).href; } catch (e) { return 'gallery.html' + q; } },
    galleryUrl: function (id) { try { return new URL('gallery.html' + (id ? '?id=' + encodeURIComponent(id) : ''), location.href).href; } catch (e) { return 'gallery.html' + (id ? '?id=' + encodeURIComponent(id) : ''); } },
    _env: env, STORE_KEY: STORE_KEY,
  };
})();
