/* 결과 공유 — "내 사과 저장"(1080×1920 PNG) · "친구에게 도전장 보내기"(Web Share / 클립보드 복사). 게임 판정·점수에는 관여하지 않는다.
 * 저장 이미지: 흰 배경 · 제목 · 점수 · 평가 문구 · **플레이어가 실제로 깎은 최종 사과**(같은 3D 장면을 오버레이(칼·리본) 없이 렌더) · 제거율/손실률/최장 껍질 · @ccojik.dh.
 *   플레이가 끝나면 회전이 멈추므로 결과 화면과 이미지가 같은 각도의 같은 표면 상태다. 점수에 따라 미리 만든 이미지로 바꾸지 않는다.
 * 저장 방법: 터치 기기에서 파일 공유가 되면 공유 시트(iOS 는 다운로드 속성을 무시), 아니면 Blob 다운로드. 실패하면 토스트로 안내.
 * 도전장: 터치 기기는 navigator.share, 데스크톱(공유창이 무반응처럼 느껴짐)과 미지원 환경은 클립보드 복사 + 토스트. 취소는 조용히 복귀.
 *   공개 URL(CONFIG.SHARE.URL)이 비어 있으면 버튼을 비활성화하고 테스트 상태임을 표시한다(임의 주소 금지). */
'use strict';
window.AP = window.AP || {};

AP.share = (function () {
  var C = AP.CONFIG, SH = C.SHARE;
  var ui = null, toastTimer = null, lastError = null;
  var FONT = '"Pretendard Variable", Pretendard, "Apple SD Gothic Neo", "Noto Sans KR", system-ui, sans-serif';

  function toast(msg) {
    if (!ui || !ui.toast) return;
    ui.toast.textContent = msg; ui.toast.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { ui.toast.hidden = true; }, 2200);
  }

  /* 최종 사과(오버레이 제외)를 box(w×h) 안에 비율 유지로 렌더한 캔버스 */
  function renderApple(boxW, boxH) {
    var S = AP.apple.current.surface, vs = AP.apple.current.viewScale, cx = AP.scene.appleCx, P = AP.scene;
    var rch = S.decorReach || 0;   // 장식(돌기) 길이만큼 여백
    var top = P.project(new THREE.Vector3(0, (S.topExtent + rch) * vs, 0)).y, bottom = P.project(new THREE.Vector3(0, (S.bottomY - rch - (S.capExtraBottom || 0)) * vs, 0)).y;
    var pad = 10, rect = { x0: cx - (S.R + rch) * vs - pad, x1: cx + (S.R + rch) * vs + pad, y0: top - pad, y1: bottom + pad };
    var rw = rect.x1 - rect.x0, rh = rect.y1 - rect.y0, k = Math.min(boxW / rw, boxH / rh);
    var w = Math.round(rw * k), h = Math.round(rh * k);
    return P.renderSnapshot(w, h, rect, { bg: '#FFFFFF', hideOverlay: true });
  }

  /* 전시장용(검증 단계): 현재 사과를 투명 배경 정사각 캔버스(size×size)로 렌더 — renderApple 과 같은 외곽 계산·같은 렌더 경로, 배경색만 칠하지 않는다. 화면·점수에는 영향 없음 */
  function renderGalleryImage(size, bg) {
    var S = AP.apple.current.surface, vs = AP.apple.current.viewScale, cx = AP.scene.appleCx, P = AP.scene;
    var rch = S.decorReach || 0;
    var top = P.project(new THREE.Vector3(0, (S.topExtent + rch) * vs, 0)).y, bottom = P.project(new THREE.Vector3(0, (S.bottomY - rch - (S.capExtraBottom || 0)) * vs, 0)).y;
    var pad = 10, x0 = cx - (S.R + rch) * vs - pad, x1 = cx + (S.R + rch) * vs + pad, y0 = top - pad, y1 = bottom + pad;
    var side = Math.max(x1 - x0, y1 - y0), mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    return P.renderSnapshot(size, size, { x0: mx - side / 2, x1: mx + side / 2, y0: my - side / 2, y1: my + side / 2 }, { hideOverlay: true, bg: bg });
  }
  function toWebpBlob(cv, quality) { return new Promise(function (res, rej) { cv.toBlob(function (b) { (b && b.type === 'image/webp') ? res(b) : rej(new Error('webp 인코딩 실패')); }, 'image/webp', quality == null ? 0.9 : quality); }); }

  function fitText(ctx, text, maxW, size, weight) {
    var s = size; ctx.font = weight + ' ' + s + 'px ' + FONT;
    while (ctx.measureText(text).width > maxW && s > 20) { s -= 2; ctx.font = weight + ' ' + s + 'px ' + FONT; }
    return s;
  }

  function buildImage(snap) {
    var W = 1080, H = 1920, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#000000';
    var ttl = AP.fruits.current.resultTitle; fitText(ctx, ttl, 920, 64, 800); ctx.fillText(ttl, W / 2, 170);
    ctx.font = '900 220px ' + FONT; ctx.fillText(snap.score.total + '점', W / 2, 410);
    fitText(ctx, snap.score.grade, 920, 56, 800); ctx.fillText(snap.score.grade, W / 2, 510);
    var apple = renderApple(900, 800);
    ctx.drawImage(apple, Math.round((W - apple.width) / 2), 560 + Math.round((800 - apple.height) / 2));
    var rows = [['껍질 제거율', Math.round(snap.peelPct) + '%'], ['과육 손실률', snap.fleshPct.toFixed(1) + '%'], ['최장 껍질 길이', Math.round(snap.ribbon.longestCm) + 'cm']];
    for (var i = 0; i < rows.length; i++) {
      var y = 1480 + i * 92;
      ctx.textAlign = 'left'; ctx.fillStyle = '#777777'; ctx.font = '500 44px ' + FONT; ctx.fillText(rows[i][0], 200, y);
      ctx.textAlign = 'right'; ctx.fillStyle = '#000000'; ctx.font = '800 52px ' + FONT; ctx.fillText(rows[i][1], W - 200, y);
    }
    ctx.textAlign = 'center'; ctx.fillStyle = '#777777'; ctx.font = '500 36px ' + FONT; ctx.fillText('@ccojik.dh', W / 2, 1840);
    return cv;
  }

  function toBlob(cv) { return new Promise(function (res, rej) { cv.toBlob(function (b) { b ? res(b) : rej(new Error('toBlob failed')); }, 'image/png'); }); }
  function download(blob) {
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = SH.FILENAME; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }
  function isTouch() { try { return window.matchMedia('(pointer: coarse)').matches; } catch (e) { return false; } }

  /* 반환: Promise<'shared' | 'saved' | 'cancelled'> — 실패는 reject(토스트도 띄움) */
  function save() {
    var snap = AP.play.getSnapshot();
    return Promise.resolve().then(function () {
      if (snap.state !== 'ended') throw new Error('not ended');
      return toBlob(buildImage(snap));
    }).then(function (blob) {
      var file = null;
      try { file = new File([blob], SH.FILENAME, { type: 'image/png' }); } catch (e) { /* 구형 */ }
      if (file && isTouch() && navigator.canShare && navigator.canShare({ files: [file] })) {
        return navigator.share({ files: [file], title: '사과 깎기' }).then(function () { return 'shared'; }, function (e) {
          if (e && e.name === 'AbortError') return 'cancelled';
          download(blob); return 'saved';
        });
      }
      download(blob); toast('이미지를 저장했어요'); return 'saved';
    }).catch(function (e) { lastError = e; toast('이미지를 만들지 못했어요. 다시 시도해 주세요'); throw e; });
  }

  function shareText(score) { return SH.TEXT.replace('{fruit}', AP.fruits.current.name).replace('{score}', String(score)); }
  function shareUrl() { return SH.URL ? SH.URL + (SH.URL.indexOf('?') >= 0 ? '&' : '?') + 'fruit=' + AP.fruits.current.id : ''; }
  /* 닉네임 입력(도전장에 적힌다) — 마지막으로 쓴 닉네임을 기억한다 */
  function askNickname(title) {       // title: 모달 제목(생략하면 도전장용 기본 문구). 전시하기도 같은 모달을 쓴다
    return new Promise(function (resolve) {
      var modal = document.getElementById('modal'), input = document.getElementById('modal-input'), okB = document.getElementById('modal-ok'), noB = document.getElementById('modal-cancel');
      var titleEl = modal.querySelector('.modal-title'), defTitle = titleEl.getAttribute('data-default') || titleEl.textContent;
      titleEl.setAttribute('data-default', defTitle); titleEl.textContent = title || defTitle;
      var last = ''; try { last = localStorage.getItem('peel_nick') || ''; } catch (e) { /* 무시 */ }
      modal.classList.remove('hidden'); input.value = last; setTimeout(function () { try { input.focus(); input.select(); } catch (e) { /* 무시 */ } }, 50);
      function done(v) { modal.classList.add('hidden'); titleEl.textContent = defTitle; okB.removeEventListener('click', ok); noB.removeEventListener('click', cancel); input.removeEventListener('keydown', key); resolve(v); }
      function ok() { var v = (input.value || '').trim() || '친구'; try { localStorage.setItem('peel_nick', v); } catch (e) { /* 무시 */ } done(v); }
      function cancel() { done(null); }
      function key(e) { if (e.key === 'Enter') ok(); if (e.key === 'Escape') cancel(); }
      okB.addEventListener('click', ok); noB.addEventListener('click', cancel); input.addEventListener('keydown', key);
    });
  }
  function track(name) { try { if (window.SiteAnalytics) window.SiteAnalytics.track(name); } catch (e) { /* 무시 */ } }

  /* 도전장 보내기: 닉네임 → 내 기록(점수·과일·깎인 모습)을 담은 링크 → 공유 시트(없으면 클립보드 복사) */
  function challenge() {
    var snap = AP.play.getSnapshot();
    if (!SH.URL) { toast('공유 주소가 아직 설정되지 않았어요(테스트 상태)'); return Promise.resolve('disabled'); }
    if (snap.state !== 'ended') return Promise.resolve('disabled');
    track('challenge_share');
    return askNickname().then(function (nick) {
      if (nick == null) return 'cancelled';
      var url = AP.battle.buildUrl(AP.battle.makeToken({ nickname: nick, total: snap.score.total, fruit: AP.fruits.current.id, peelPct: snap.peelPct, fleshPct: snap.fleshPct, surface: AP.apple.current.surface }));
      var text = shareText(snap.score.total), data = { title: SH.TITLE, text: text, url: url };
      function copy() {
        var p = (navigator.clipboard && navigator.clipboard.writeText) ? navigator.clipboard.writeText(SH.TITLE + '\n' + text + '\n' + url) : Promise.reject(new Error('no clipboard'));
        return p.then(function () { toast(SH.COPIED); return 'copied'; }, function (e) { lastError = e; try { window.prompt('도전장 링크를 복사하세요', url); } catch (x) { /* 무시 */ } toast('복사하지 못했어요'); return 'failed'; });
      }
      if (isTouch() && navigator.share) {
        return navigator.share(data).then(function () { return 'shared'; }, function (e) { if (e && e.name === 'AbortError') return 'cancelled'; return copy(); });
      }
      return copy();
    });
  }

  function bind(els) {
    ui = els;
    var busy = false;
    function guard(fn) { return function () { if (busy) return; busy = true; Promise.resolve().then(fn).catch(function () { /* 토스트로 안내됨 */ }).then(function () { busy = false; }); }; }
    els.save.addEventListener('click', guard(save));
    els.challenge.addEventListener('click', guard(challenge));
    refresh();
  }
  /* 공개 URL 이 없으면 비활성 + 안내 */
  function refresh() {
    if (!ui) return;
    var none = !SH.URL;
    ui.challenge.disabled = none;
    ui.note.hidden = !none;
    ui.note.textContent = none ? '공개 주소가 설정되면 켜져요(테스트 상태)' : '';
  }

  return { askNickname: askNickname, renderApple: renderApple, renderGalleryImage: renderGalleryImage, toWebpBlob: toWebpBlob, shareUrl: shareUrl, bind: bind, refresh: refresh, save: save, challenge: challenge, buildImage: buildImage, shareText: shareText, toast: toast, get lastError() { return lastError; } };
})();
