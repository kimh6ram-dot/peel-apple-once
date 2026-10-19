/* BladeCollisionSystem — 칼 이미지와 분리된 판정 기하.
 *   knifeVisual  : PNG 전체(main.js 가 오버레이 스프라이트로 표시, knife.toStage 와 같은 변환으로 회전)
 *   bladeRegion  : 회색 금속 영역 — 절삭 판정의 최대 허용 범위
 *   bladeEdge    : 회색 영역의 왼쪽(사과 쪽) 실루엣 폴리라인, 칼끝 → 힐. **여기서만 절삭이 일어난다**
 *   handleRegion : 갈색 손잡이 + bolster(연결부 띠) — 절대 절삭 불가
 *   spine/heel   : 등·힐 곡선(절삭 불가, 디버그 표시용)
 * 모든 값은 PNG px 실측(assets-data.js)을 현재 칼 피벗·기울기·배율로 스테이지 px 로 바꾼 것(knife.toStage).
 * 기울면 영역은 다각형(…Poly)이 되고, 기존 bbox 필드는 그 다각형의 축 정렬 경계(기울기 0 이면 동일).
 * probe(silhouetteX): 날 각 점의 실루엣 안쪽 깊이(= 실루엣 x - 날 x, >0 이면 접촉). 시작 간격 검증·디버그용. */
'use strict';
window.AP = window.AP || {};

AP.blade = (function () {
  function K() { return AP.knife; }
  function D() { return AP.knife.data; }
  function pt(p) { return K().toStage(p); }
  function poly(r) { return [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]].map(pt); }
  function bbox(pts) {
    var b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (var i = 0; i < pts.length; i++) { b.x0 = Math.min(b.x0, pts[i][0]); b.x1 = Math.max(b.x1, pts[i][0]); b.y0 = Math.min(b.y0, pts[i][1]); b.y1 = Math.max(b.y1, pts[i][1]); }
    return b;
  }

  function regions() {
    var d = D(), s = K().scale, bb = d.bbox;
    var bladePoly = poly(d.bladeRegion), handlePoly = poly(d.handleRegion);
    var bolsterPoly = poly({ x: bb.x, y: d.bolster.y0, w: bb.w, h: d.bolster.y1 - d.bolster.y0 });
    var bolsterBox = bbox(bolsterPoly);
    return {
      bladeRegion: bbox(bladePoly), bladeRegionPoly: bladePoly,
      handleRegion: bbox(handlePoly), handleRegionPoly: handlePoly,
      bolster: { y0: bolsterBox.y0, y1: bolsterBox.y1 }, bolsterPoly: bolsterPoly,
      edge: d.edge.map(pt), heel: d.heel.map(pt), spine: d.spine.map(pt),
      tip: pt(d.tip),
      edgeLen: (d.edgeEndY - d.tip[1]) * s,
      angleDeg: K().angleDeg,
    };
  }

  /* 날 폴리라인 각 점에서 depth = silhouetteX(y) - x. gap = -max(depth): 양수면 그만큼 떨어져 있음(미접촉), 음수면 그만큼 파고듦 */
  function probe(silhouetteX) {
    var d = D();
    var maxDepth = -Infinity, contacts = 0, yFirst = null, yLast = null, atY = null, atX = null;
    for (var k = 0; k < d.edge.length; k++) {
      var q = pt(d.edge[k]), ex = q[0], ey = q[1];
      var sx = silhouetteX(ey);
      if (sx === null) continue;
      var depth = sx - ex;
      if (depth > maxDepth) { maxDepth = depth; atY = ey; atX = ex; }
      if (depth > 0) { contacts++; if (yFirst === null) yFirst = ey; yLast = ey; }
    }
    return { gap: isFinite(maxDepth) ? -maxDepth : Infinity, maxDepth: isFinite(maxDepth) ? maxDepth : null, contacts: contacts, yFirst: yFirst, yLast: yLast, atY: atY, atX: atX, inRange: isFinite(maxDepth) };
  }

  return { regions: regions, probe: probe };
})();
