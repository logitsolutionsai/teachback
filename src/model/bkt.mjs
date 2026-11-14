// Bayesian Knowledge Tracing, one hidden "knows it / does not know it" state per concept.
// See references/learner-model.md for the maths and a worked example.
import { clamp } from '../util.mjs';

export const DEFAULT_BKT = Object.freeze({
  pInit: 0.2, // P(L0): chance the learner already knows a concept before any evidence
  pLearn: 0.15, // P(T): chance of learning the concept at each practice opportunity
  pSlip: 0.1, // base P(S): knows it but answers wrongly
  masteryThreshold: 0.95, // P(L) at or above this counts as mastered
  pMax: 0.99, // P(L) is capped here, so one clear failure on a review is always noticed
  placementMastery: 0.95, // P(L) set by a confident correct pretest answer
  placementMinConfidence: 3 // confidence needed (1-4) for a pretest answer to place out
});

// Base guess rates by item type: how likely a learner who does not know the
// concept still produces a correct answer.
export const TYPE_GUESS = Object.freeze({
  numeric: 0.05,
  short: 0.1,
  teachback: 0.05,
  code: 0.02
});

export const RESULT_SCORE = Object.freeze({ correct: 1, partial: 0.5, wrong: 0 });

// Slip and guess for one item. Difficulty runs 1 (easy) to 5 (hard), 3 is neutral.
// Harder items: more slips, fewer lucky guesses. Easier items: the reverse.
export function itemParams(item, params = DEFAULT_BKT) {
  const d = clamp(Number(item?.difficulty ?? 3), 1, 5);
  const f = (d - 3) / 2; // -1 .. +1
  let baseGuess;
  if (item?.type === 'mcq') baseGuess = 1 / Math.max(2, item.options?.length ?? 4);
  else baseGuess = TYPE_GUESS[item?.type] ?? 0.1;
  const slip = item?.pSlip ?? clamp(params.pSlip * (1 + f / 2), 0.01, 0.3);
  const guess = item?.pGuess ?? clamp(baseGuess * (1 - f / 2), 0.01, 0.5);
  return { slip, guess };
}

// One BKT step. score is 1 (correct), 0.5 (partial) or 0 (wrong); any value in
// [0, 1] works: the posterior is the score-weighted mix of the two classic
// posteriors. pLearn is applied afterwards (the learning transition).
export function bktUpdate(pL, score, { slip, guess, pLearn }) {
  const s = clamp(score, 0, 1);
  const knowsAndRight = pL * (1 - slip);
  const postCorrect = knowsAndRight / (knowsAndRight + (1 - pL) * guess);
  const knowsAndWrong = pL * slip;
  const postWrong = knowsAndWrong / (knowsAndWrong + (1 - pL) * (1 - guess));
  const posterior = s * postCorrect + (1 - s) * postWrong;
  return posterior + (1 - posterior) * pLearn;
}

export function isMastered(pL, params = DEFAULT_BKT) {
  // Small epsilon so 0.95 computed in floating point still counts.
  return pL >= params.masteryThreshold - 1e-9;
}
