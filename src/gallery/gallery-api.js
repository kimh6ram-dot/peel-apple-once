/* 전시장 데이터 계층 — 화면(DOM)을 전혀 모른다. 같은 인터페이스 list({sort, fruit, page, pageSize}) → Promise<{items, hasMore}> 를
 *  - 실데이터: Supabase REST(PostgREST)를 fetch 로 호출(읽기 전용, 공개 컬럼만, 숨김 행은 DB 정책이 제외)
 *  - 테스트: 브라우저 안의 가짜 데이터(DB 에 아무것도 쓰지 않음)
 * 두 가지로 제공한다. 좋아요·업로드 같은 쓰기 호출은 이 파일에 없다(다음 단계에서 서버 함수로 연결). */
window.GalleryApi = (function () {
  'use strict';

  var FRUITS = { apple: '사과', pear: '배', kiwi: '키위', dragonfruit: '용과' };
  var SORTS = {
    new: { label: '최신순', order: 'created_at.desc,id.desc' },
    popular: { label: '인기순', order: 'likes_count.desc,created_at.desc,id.desc' },
    score: { label: '점수순', order: 'score.desc,created_at.desc,id.desc' },
  };
  var COLUMNS = 'id,created_at,nickname,fruit,score,likes_count,image_path';   // 공개 SELECT 컬럼만(grid·peel_pct·flesh_pct·hidden 은 요청하지 않는다 — 권한이 없다)

  function GalleryError(kind, message, extra) { var e = new Error(message || kind); e.kind = kind; if (extra) for (var k in extra) e[k] = extra[k]; return e; }

  /* 설정 검사: 공개 가능한 키만 허용(secret / service_role 거부) */
  function inspectConfig(cfg) {
    cfg = cfg || {};
    var url = String(cfg.SUPABASE_URL || '').trim().replace(/\/+$/, ''), key = String(cfg.PUBLISHABLE_KEY || '').trim();
    if (!url && !key) return { ok: false, reason: 'empty' };
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) return { ok: false, reason: 'bad-url' };
    if (!key) return { ok: false, reason: 'no-key' };
    if (/^sb_secret_/i.test(key)) return { ok: false, reason: 'secret-key' };
    if (/^sb_publishable_/i.test(key)) return { ok: true, url: url, key: key };
    var m = key.split('.');
    if (m.length === 3) {                                  // 구형 JWT 키: role 이 anon 일 때만
      try {
        var pay = JSON.parse(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')));
        if (pay.role === 'anon') return { ok: true, url: url, key: key };
        return { ok: false, reason: 'secret-key' };
      } catch (e) { return { ok: false, reason: 'bad-key' }; }
    }
    return { ok: false, reason: 'bad-key' };
  }

  /* 쿼리 문자열(PostgREST). limit+1 개를 요청해 다음 페이지 유무를 알아낸다. */
  function buildQuery(o) {
    var s = SORTS[o.sort] || SORTS.new, ps = Math.max(1, Math.min(60, o.pageSize | 0 || 24)), page = Math.max(0, o.page | 0);
    var q = ['select=' + COLUMNS];                      // 숨김(hidden) 처리는 DB 의 RLS 정책(hidden = false)이 맡는다 — 요청에 조건을 넣지 않는다
    if (o.fruit && FRUITS[o.fruit]) q.push('fruit=eq.' + o.fruit);
    q.push('order=' + s.order, 'limit=' + (ps + 1), 'offset=' + (page * ps));
    return q.join('&');
  }

  /* 공유 링크의 id: 서버가 만드는 UUID 또는 테스트 데이터의 test-숫자 만 허용(그 밖의 문자열은 질의에 넣지 않는다) */
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, ID_RE = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|test-\d{1,6})$/i;
  function isValidId(v) { return typeof v === 'string' && ID_RE.test(v); }          // 화면에서 받아들이는 id 형식(UUID 또는 테스트 데이터)

  /* 외부 문자열 정리: 제어문자 제거·길이 제한(화면에는 textContent 로만 넣는다) */
  function cleanText(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, max); }
  function intIn(v, lo, hi) { var n = Number(v); if (!isFinite(n)) return null; n = Math.round(n); return n < lo || n > hi ? null : n; }

  function normalizeRow(row, imageBase) {
    if (!row || typeof row !== 'object') return null;
    var fruit = String(row.fruit || ''), score = intIn(row.score, 0, 100), likes = intIn(row.likes_count == null ? 0 : row.likes_count, 0, 1e9);
    if (!FRUITS[fruit] || score === null || likes === null) return null;
    var id = cleanText(row.id, 64); if (!id) return null;
    var url = null;
    if (row.imageUrl) url = String(row.imageUrl);                                              // 테스트 데이터(로컬 상대경로)
    else if (typeof row.image_path === 'string' && /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,160}$/.test(row.image_path) && row.image_path.indexOf('..') < 0) url = imageBase + '/' + row.image_path;
    if (!url) return null;
    var t = Date.parse(row.created_at);
    return { id: id, nickname: cleanText(row.nickname, 20) || '익명', fruit: fruit, score: score, likes: likes, createdAt: isFinite(t) ? t : null, imageUrl: url };
  }

  /* ── 실데이터 ── */
  function createRemote(cfg, fetchImpl) {
    var c = inspectConfig(cfg);
    if (!c.ok) throw GalleryError('config', '설정 오류: ' + c.reason, { reason: c.reason });
    var f = fetchImpl || (typeof fetch === 'function' ? fetch.bind(window) : null);
    var base = c.url + '/rest/v1/' + (cfg.TABLE || 'gallery_apples'), imageBase = c.url + '/storage/v1/object/public/' + (cfg.BUCKET || 'gallery-apples');
    function getRows(query) {
      if (!f) return Promise.reject(GalleryError('network', 'fetch 없음'));
      var ctl = typeof AbortController === 'function' ? new AbortController() : null, to = setTimeout(function () { if (ctl) ctl.abort(); }, cfg.TIMEOUT_MS || 10000);
      /* 공개 키는 apikey 헤더로만 보낸다(Publishable key 는 JWT 가 아니므로 Authorization 에 넣지 않는다) */
      return f(base + '?' + query, { method: 'GET', headers: { apikey: c.key, Accept: 'application/json' }, signal: ctl ? ctl.signal : undefined }).then(function (res) {
        clearTimeout(to);
        if (!res.ok) return res.json().catch(function () { return {}; }).then(function (b) { throw GalleryError('http', 'HTTP ' + res.status, { status: res.status, code: b && b.code, detail: b && b.message }); });   // 권한(401/403, 42501)·컬럼(42703) 오류의 원인을 개발자 콘솔에서 알 수 있게 보존
        return res.json();
      }, function (e) { clearTimeout(to); throw GalleryError('network', e && e.name === 'AbortError' ? '시간 초과' : '네트워크 오류'); }).then(function (rows) {
        if (!Array.isArray(rows)) throw GalleryError('http', '응답 형식 오류');
        return rows;
      });
    }
    return {
      mode: 'remote',
      list: function (o) {
        var ps = Math.max(1, Math.min(60, o.pageSize | 0 || cfg.PAGE_SIZE || 24));
        return getRows(buildQuery({ sort: o.sort, fruit: o.fruit, page: o.page, pageSize: ps })).then(function (rows) {
          var more = rows.length > ps, items = rows.slice(0, ps).map(function (r) { return normalizeRow(r, imageBase); }).filter(Boolean);
          return { items: items, hasMore: more };
        });
      },
      /* id 한 건(공유 링크용). 없거나 숨김 처리됐거나 삭제됐으면 null — 숨김은 DB 정책이 걸러서 "없음"과 같게 보인다. 형식이 틀린 id 는 요청 없이 null */
      get: function (id) {
        if (typeof id !== 'string' || !UUID_RE.test(id)) return Promise.resolve(null);     // 실데이터는 UUID 만(그 밖의 문자열은 질의에 넣지 않는다)
        return getRows('select=' + COLUMNS + '&id=eq.' + id + '&limit=1').then(function (rows) { return rows.length ? normalizeRow(rows[0], imageBase) : null; });
      },
    };
  }

  /* ── 테스트 데이터(실제 기록이 아님 · DB 접근 없음) ── */
  var TEST_NICKS = ['껍질장인', '사과킬러', '한번에', 'A&B', '<img src=x onerror=alert(1)>', '"><script>alert(1)</script>', '아주아주아주긴닉네임이름입니다', '😀과일왕', '칼질연습생', 'minsu', '  ', '배달인', '키위새', '용과러버', '손이 느린 사람', '‮evil', '0점의 기적', 'Pear\nLine', '느긋한 오후', '초보자'];
  function makeTestRows(imgBase) {
    var ids = ['apple', 'pear', 'kiwi', 'dragonfruit'], rows = [], seed = 7, rnd = function () { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (var i = 0; i < 44; i++) {
      var f = ids[(i * 3 + (i >> 2)) % 4];
      rows.push({ id: 'test-' + (100 + i), created_at: new Date(Date.UTC(2026, 9, 1) + i * 5400000).toISOString(), nickname: TEST_NICKS[i % TEST_NICKS.length], fruit: f, score: Math.round(18 + rnd() * 81), likes_count: Math.floor(rnd() * rnd() * 320), imageUrl: imgBase + '/' + f + '.webp' });
    }
    return rows;
  }
  function createTest(imgBase, opts) {
    opts = opts || {};
    var all = opts.empty ? [] : makeTestRows(imgBase || 'assets/gallery-test').map(function (r) { return normalizeRow(r, ''); }).filter(Boolean);
    return {
      mode: 'test',
      all: all,
      list: function (o) {
        if (opts.fail) return new Promise(function (_, rej) { setTimeout(function () { rej(GalleryError('network', '테스트 오류')); }, 120); });
        var ps = Math.max(1, Math.min(60, o.pageSize | 0 || 24)), page = Math.max(0, o.page | 0), s = o.sort;
        var rows = all.filter(function (r) { return !o.fruit || r.fruit === o.fruit; });
        var key = { new: function (r) { return [r.createdAt]; }, popular: function (r) { return [r.likes, r.createdAt]; }, score: function (r) { return [r.score, r.createdAt]; } }[s] || function (r) { return [r.createdAt]; };
        rows.sort(function (a, b) { var x = key(a), y = key(b); for (var i = 0; i < x.length; i++) if (x[i] !== y[i]) return y[i] - x[i]; return a.id < b.id ? 1 : -1; });
        var slice = rows.slice(page * ps, page * ps + ps + 1);
        return new Promise(function (res) { setTimeout(function () { res({ items: slice.slice(0, ps), hasMore: slice.length > ps }); }, 80); });
      },
      get: function (id) {
        if (opts.fail) return new Promise(function (_, rej) { setTimeout(function () { rej(GalleryError('network', '테스트 오류')); }, 120); });
        var hit = isValidId(id) ? all.filter(function (r) { return r.id === id; })[0] : null;
        return new Promise(function (res) { setTimeout(function () { res(hit || null); }, 60); });
      },
    };
  }

  return { FRUITS: FRUITS, SORTS: SORTS, COLUMNS: COLUMNS, GalleryError: GalleryError, inspectConfig: inspectConfig, isValidId: isValidId, buildQuery: buildQuery, normalizeRow: normalizeRow, createRemote: createRemote, createTest: createTest, cleanText: cleanText };
})();
