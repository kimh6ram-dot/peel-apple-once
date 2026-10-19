/* ScoreSystem — 단 한 번의 절삭 점수(0~100 정수). 입력은 실제 절삭 기록뿐(무작위 없음). 상수는 config.SCORE. 계산 경로는 이 파일 하나.
 *
 * 이 게임은 "칼을 한 번 대고 떨어지기 전까지 얼마나 잘 깎았는지"를 평가한다 — 사과 전체를 다 벗겨야 고득점이 되는 구조가 아니다.
 *
 *   p          = 껍질 제거율(0~1)  — 그 과일의 절삭 가능 표면적 대비
 *   coverage   = 100 × min(1, p / FULL)^COVERAGE_EXP                     (비선형: 초반에 빨리 오르고 뒤로 갈수록 완만, FULL 이상이면 만점)
 *   fEff       = 과육 손실률(%) × 과일 민감도                              (그 과일의 몸통 부피 대비, 같은 상대 깊이면 같은 값 — fruits.js)
 *   accuracy   = (100 − 구간별 감점(fEff)) × 낭비 계수(ρ)                   ρ = 손실 ÷ 제거한 껍질 층 부피: 얇게 깎은 만큼 손실이 작으면 1
 *   continuity = 100 × (0.6 × min(1, 최장 껍질 / 과일별 기준 길이) + 0.4 × min(1, 최장 / 전체 껍질))
 *   quality    = 1 − (1 − accuracy/100) × DEF_ACC − (1 − continuity/100) × DEF_CONT
 *   score      = coverage × quality × fleshMult(fEff)
 *   cap        = 유효 절삭 미달 → CAP_NO_CUT, 과육 손실 HEAVY_FLESH_PCT 이상 → CAP_HEAVY (그 밖의 구간별 상한 없음)
 * 단위: 제거율은 입력(%)을 0~1 로 바꿔 쓰고, 과육 손실·정확도·연속성은 %·0~100 으로 쓴다(혼용 없음). */
'use strict';
window.AP = window.AP || {};
AP.score = (function () {
  var S = AP.CONFIG.SCORE;
  function grades() { return AP.fruits.grades(); }
  function lenRef() { return AP.fruits ? AP.fruits.lenRefCm() : S.LEN_REF_CM; }
  function minPath() { return AP.fruits ? AP.fruits.minPathCm() : S.MIN_PATH_CM; }
  function sens() { return AP.fruits ? AP.fruits.fleshSensitivity() : 1; }
  function layerPct() { return AP.fruits ? AP.fruits.skinLayerPct() : 8; }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  /* 구간 문구가 배열이면 그 중 하나를 판마다 한 번 랜덤으로 고른다(pick) — 결과 화면과 저장 이미지가 같은 문구를 쓰도록 판 도중에는 바뀌지 않는다. play.reset 이 reroll */
  var pick = Math.random();
  function reroll() { pick = Math.random(); }
  function phrase(v) { return Array.isArray(v) ? v[Math.min(v.length - 1, Math.floor(pick * v.length))] : v; }
  function gradeOf(total) { var G = grades(); for (var i = 0; i < G.length; i++) if (total >= G[i][0]) return phrase(G[i][1]); return phrase(G[G.length - 1][1]); }

  /* 과육 손실 fEff(%) → 정확도 감점(0~100): 구간별 기울기 */
  function fleshPenalty(f) {
    var pen = 0, lo = 0;
    for (var i = 0; i < S.FLESH_PEN.length; i++) {
      var hi = S.FLESH_PEN[i][0], slope = S.FLESH_PEN[i][1];
      if (f > lo) pen += (Math.min(f, hi) - lo) * slope;
      lo = hi;
    }
    return Math.min(100, pen);
  }
  /* 과육 손실 fEff(%) → 승수(선형 보간) */
  function fleshMult(f) {
    var T = S.FLESH_MULT, prevF = 0, prevM = 1;
    for (var i = 0; i < T.length; i++) {
      if (f <= T[i][0]) return prevF === T[i][0] ? T[i][1] : prevM + (T[i][1] - prevM) * (f - prevF) / (T[i][0] - prevF);
      prevF = T[i][0]; prevM = T[i][1];
    }
    return T[T.length - 1][1];
  }

  /* m = { peelPct, fleshPct, longestCm, emittedCm } (peelPct·fleshPct 는 %) */
  function compute(m) {
    var p = clamp(m.peelPct / 100, 0, 1);
    var coverage = 100 * Math.pow(Math.min(1, p / (S.FULL_PEEL_PCT / 100)), S.COVERAGE_EXP);
    var fEff = m.fleshPct * sens();
    var penalty = fleshPenalty(fEff);
    var layer = p * layerPct();                                             // 제거한 껍질 층의 부피(% of 과일 부피)
    var rho = layer > 1e-9 ? m.fleshPct / layer : (m.fleshPct > 0 ? Infinity : 0);
    var waste = rho <= 1 ? 1 : Math.max(S.WASTE_MIN, 1 - S.WASTE_SLOPE * (rho - 1));
    var accuracy = clamp(100 - penalty, 0, 100) * waste;
    var continuity = m.emittedCm > 0 ? 100 * (0.6 * Math.min(1, m.longestCm / lenRef()) + 0.4 * Math.min(1, m.longestCm / m.emittedCm)) : 0;
    var quality = 1 - (1 - accuracy / 100) * S.DEF_ACC - (1 - continuity / 100) * S.DEF_CONT;
    var mult = fleshMult(fEff);
    var raw = coverage * quality * mult;
    var gate = m.peelPct >= S.MIN_PEEL && m.emittedCm >= minPath();
    var cap = 100, capWhy = null;
    if (!gate) { cap = S.CAP_NO_CUT; capWhy = 'no-cut'; }
    if (fEff >= S.HEAVY_FLESH_PCT && S.CAP_HEAVY < cap) { cap = S.CAP_HEAVY; capWhy = 'heavy-flesh'; }
    var total = Math.round(clamp(Math.min(raw, cap), 0, 100));
    return {
      total: total, raw: raw, cap: cap, capWhy: capWhy, gate: gate,
      coverage: coverage, accuracy: accuracy, continuity: continuity, quality: quality, fleshMult: mult, waste: waste, rho: rho, fEff: fEff,
      /* 기여도: 껍질 제거 점수에서 정확도·연속성·과육 승수가 각각 깎은 점수(raw = coverage − 아래 셋) */
      parts: { coverage: coverage, accuracyLoss: coverage * (1 - accuracy / 100) * S.DEF_ACC, continuityLoss: coverage * (1 - continuity / 100) * S.DEF_CONT, fleshLoss: coverage * quality * (1 - mult) },
      grade: gradeOf(total),
    };
  }
  return { compute: compute, gradeOf: gradeOf, reroll: reroll, setPick: function (v) { pick = v; }, fleshPenalty: fleshPenalty, fleshMult: fleshMult };
})();
