/* 전시장 좋아요 통신 계층 — 화면(DOM)을 전혀 모른다. gallery-api.js 는 읽기 전용으로 두고, 쓰기/인증이 필요한 좋아요는 이 파일이 맡는다.
 *  - status(ids) : 내가 누른 과일 ID 목록(읽기 전용 DB 함수 gallery_my_likes — voter 는 JWT 에서만 정해진다). 저장된 익명 세션이 있을 때만 부르고, 없으면 요청 없이 [] (새 계정을 만들지 않는다).
 *  - toggle(id, liked) : Edge Function toggle-gallery-like 에 "원하는 상태"를 보낸다(멱등). 익명 세션이 없으면 이때 처음 만든다.
 *  - 익명 세션은 게임의 "사과 전시하기"와 같은 저장소 키(ccojik_apple_anon_session)를 쓴다 → 같은 사용자로 이어진다. 토큰은 요청 헤더에만 쓰고 로그·URL 에 넣지 않는다.
 *  - 비밀 키는 없다(공개 가능한 publishable key 만). 서버가 모든 검증을 다시 한다 — 여기의 검사는 불필요한 요청을 줄이는 용도다.
 *  - createTest(items): ?mode=test 용 메모리 구현(DB·네트워크 접근 없음). */
window.GalleryLikes = (function () {
  'use strict';
  var STORE_KEY = 'ccojik_apple_anon_session', FN_PATH = '/functions/v1/toggle-gallery-like', RPC_PATH = '/rest/v1/rpc/gallery_my_likes';
  var TIMEOUT_AUTH_MS = 12000, TIMEOUT_CALL_MS = 15000, REFRESH_MARGIN_S = 60, STATUS_CHUNK = 60;
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function LikeError(kind, message, extra) { var e = new Error(message || kind); e.kind = kind; e.userMessage = message; if (extra) for (var k in extra) e[k] = extra[k]; return e; }

  function create(cfg, env) {
    env = env || {};
    var url = String(cfg.SUPABASE_URL || '').trim().replace(/\/+$/, ''), key = String(cfg.PUBLISHABLE_KEY || '').trim();
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url) || !key || /^sb_secret_/i.test(key)) throw LikeError('config', '설정 오류');
    var memSession = null, signing = null;
    function nowSec() { return Math.floor((env.now ? env.now() : Date.now()) / 1000); }
    function doFetch(u, init) { return (env.fetch || window.fetch.bind(window))(u, init); }
    function timer(ms) { var ctl = typeof AbortController === 'function' ? new AbortController() : null, t = setTimeout(function () { if (ctl) ctl.abort(); }, ms); return { signal: ctl ? ctl.signal : undefined, done: function () { clearTimeout(t); } }; }

    /* ── 세션 저장 ── */
    function readStore() {
      try { var s = (env.storage || window.localStorage).getItem(STORE_KEY); if (s) { var o = JSON.parse(s); if (o && o.access_token) return o; } } catch (e) { /* 저장소 없음/손상 */ }
      return memSession;
    }
    function writeStore(o) {
      memSession = o;
      try { var st = env.storage || window.localStorage; o ? st.setItem(STORE_KEY, JSON.stringify(o)) : st.removeItem(STORE_KEY); } catch (e) { /* 사생활 보호 모드 등: 메모리에만 */ }
    }
    function toSession(j) {
      if (!j || !j.access_token) return null;
      var exp = Number(j.expires_at) || (nowSec() + (Number(j.expires_in) || 3600));
      return { access_token: String(j.access_token), refresh_token: j.refresh_token ? String(j.refresh_token) : '', expires_at: exp, user_id: j.user && j.user.id ? String(j.user.id) : '' };
    }
    function authCall(path, body) {
      var to = timer(TIMEOUT_AUTH_MS);
      return doFetch(url + path, { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: to.signal }).then(function (res) {
        to.done();
        return res.json().catch(function () { return {}; }).then(function (j) { return { status: res.status, body: j || {} }; });
      }, function (e) { to.done(); throw LikeError(e && e.name === 'AbortError' ? 'timeout' : 'network', '네트워크에 연결되지 않았어요.'); });
    }
    function refresh(s) {
      if (!s || !s.refresh_token) return Promise.resolve(null);
      return authCall('/auth/v1/token?grant_type=refresh_token', { refresh_token: s.refresh_token }).then(function (r) {
        var n = r.status >= 200 && r.status < 300 ? toSession(r.body) : null;
        if (n) { writeStore(n); return n; }
        return null;
      });
    }
    function signUp() {
      if (signing) return signing;                                                            // 동시에 여러 번 눌러도 계정은 하나만 만든다
      signing = authCall('/auth/v1/signup', { data: {} }).then(function (r) {
        signing = null;
        var s = r.status >= 200 && r.status < 300 ? toSession(r.body) : null;
        if (s) { writeStore(s); return s; }
        if (r.status === 429) throw LikeError('rate_limited', '요청이 많아요. 잠시 후 다시 눌러 주세요.');
        throw LikeError('auth', '지금은 좋아요를 누를 수 없어요. 잠시 후 다시 시도해 주세요.');
      }, function (e) { signing = null; throw e; });
      return signing;
    }
    /* 쓸 수 있는 세션: 저장된 것(만료 임박이면 갱신) → 없거나 갱신 불가 → create 가 true 일 때만 새 익명 로그인 */
    function getSession(create) {
      var s = readStore();
      if (s && s.expires_at - nowSec() > REFRESH_MARGIN_S) return Promise.resolve(s);
      var p = s ? refresh(s) : Promise.resolve(null);
      return p.then(function (n) { if (n) return n; if (s) writeStore(null); return create ? signUp() : null; });
    }

    /* ── 호출 ── */
    function call(path, session, body) {
      var to = timer(TIMEOUT_CALL_MS);
      return doFetch(url + path, { method: 'POST', headers: { apikey: key, Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: to.signal }).then(function (res) {
        to.done();
        return res.json().catch(function () { return null; }).then(function (j) { return { status: res.status, body: j }; });
      }, function (e) { to.done(); throw LikeError(e && e.name === 'AbortError' ? 'timeout' : 'network', '네트워크에 연결되지 않았어요.'); });
    }
    function withAuthRetry(path, create, bodyFn) {                                            // 401 이면 세션을 버리고 한 번만 다시 만들어 재시도
      return getSession(create).then(function (s) {
        if (!s) return null;
        return call(path, s, bodyFn()).then(function (r) {
          if (r.status !== 401) return r;
          writeStore(null);
          return getSession(create).then(function (s2) { return s2 ? call(path, s2, bodyFn()) : null; });
        });
      });
    }

    return {
      mode: 'remote',
      hasSession: function () { return !!readStore(); },
      /* 내가 누른 과일 ID 목록. 세션이 없거나 인증이 안 되면 [] (다른 사람의 기록은 서버가 JWT 로만 구분하므로 절대 오지 않는다). 네트워크/서버 오류는 throw */
      status: function (ids) {
        var list = (ids || []).filter(function (v) { return typeof v === 'string' && UUID_RE.test(v); });
        if (!list.length || !readStore()) return Promise.resolve([]);
        var chunks = []; for (var i = 0; i < list.length; i += STATUS_CHUNK) chunks.push(list.slice(i, i + STATUS_CHUNK));
        return chunks.reduce(function (acc, ch) {
          return acc.then(function (out) {
            return withAuthRetry(RPC_PATH, false, function () { return { p_ids: ch }; }).then(function (r) {
              if (!r || r.status === 401) return out;                                           // 인증 실패 → 아무 것도 표시하지 않는다
              if (r.status < 200 || r.status >= 300 || !Array.isArray(r.body)) throw LikeError('server', '좋아요 상태를 불러오지 못했어요.');
              return out.concat(r.body.filter(function (v) { return typeof v === 'string' && UUID_RE.test(v); }));
            });
          });
        }, Promise.resolve([]));
      },
      /* 좋아요를 liked(true/false) 상태로 맞춘다. 성공: {liked, likes}. 실패: LikeError(kind = network|timeout|not_found|rate_limited|auth|server|invalid) */
      toggle: function (id, liked) {
        if (typeof id !== 'string' || !UUID_RE.test(id)) return Promise.reject(LikeError('invalid', '잘못된 과일이에요.'));
        liked = !!liked;
        return withAuthRetry(FN_PATH, true, function () { return { apple_id: id, liked: liked }; }).then(function (r) {
          if (!r) throw LikeError('auth', '지금은 좋아요를 누를 수 없어요. 잠시 후 다시 시도해 주세요.');
          var b = r.body;
          if (r.status === 200 && b && b.ok === true && typeof b.likes_count === 'number' && typeof b.liked === 'boolean') return { liked: b.liked, likes: Math.max(0, Math.round(b.likes_count)) };
          if (r.status === 404) throw LikeError('not_found', '이미 사라진 과일이에요.');
          if (r.status === 429) throw LikeError('rate_limited', '요청이 많아요. 잠시 후 다시 눌러 주세요.');
          if (r.status === 401) throw LikeError('auth', '지금은 좋아요를 누를 수 없어요. 잠시 후 다시 시도해 주세요.');
          if (r.status === 400) throw LikeError('invalid', '잘못된 요청이에요.');
          throw LikeError('server', '좋아요를 처리하지 못했어요. 잠시 후 다시 시도해 주세요.');
        });
      },
      clearSession: function () { writeStore(null); },
    };
  }

  /* ?mode=test : 메모리 구현. items = GalleryApi.createTest().all (이 객체의 likes 를 직접 갱신 → 인기순에도 반영). opts.fail=true 면 항상 네트워크 오류 */
  function createTest(items, opts) {
    opts = opts || {}; var mine = {};
    function find(id) { for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i]; return null; }
    return {
      mode: 'test',
      hasSession: function () { return true; },
      status: function (ids) { return Promise.resolve((ids || []).filter(function (id) { return mine[id]; })); },
      toggle: function (id, liked) {
        return new Promise(function (res, rej) {
          setTimeout(function () {
            if (opts.fail) return rej(LikeError('network', '네트워크에 연결되지 않았어요.'));
            var it = find(id); if (!it) return rej(LikeError('not_found', '이미 사라진 과일이에요.'));
            liked = !!liked; if (liked && !mine[id]) { mine[id] = true; it.likes += 1; } else if (!liked && mine[id]) { delete mine[id]; it.likes = Math.max(0, it.likes - 1); }
            res({ liked: liked, likes: it.likes });
          }, 90);
        });
      },
      clearSession: function () { mine = {}; },
    };
  }

  return { create: create, createTest: createTest, LikeError: LikeError, STORE_KEY: STORE_KEY };
})();
