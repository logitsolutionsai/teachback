// Confidence calibration: does the learner's confidence (1-4) match how often
// they are right? See references/learner-model.md.
import { round } from '../util.mjs';

// What each confidence level claims, as a probability of being right.
export const CONFIDENCE_PROB = Object.freeze({ 1: 0.25, 2: 0.5, 3: 0.75, 4: 0.95 });
export const CONFIDENCE_LABEL = Object.freeze({ 1: 'Guessing', 2: 'Unsure', 3: 'Fairly sure', 4: 'Certain' });

export const CALIBRATION_DEFAULTS = Object.freeze({ minAnswers: 3, band: 0.1 });

// answers: [{ concept, score (0, 0.5, 1), confidence (1-4) }]; others are ignored.
export function summarise(answers, opts = CALIBRATION_DEFAULTS) {
  const rated = answers.filter((a) => a.confidence >= 1 && a.confidence <= 4);
  const n = rated.length;
  if (n === 0) return { n: 0, meanConfidence: null, accuracy: null, bias: null, brier: null, label: 'not enough data' };
  let sumP = 0;
  let sumS = 0;
  let sumSq = 0;
  for (const a of rated) {
    const p = CONFIDENCE_PROB[a.confidence];
    sumP += p;
    sumS += a.score;
    sumSq += (p - a.score) ** 2;
  }
  const meanConfidence = sumP / n;
  const accuracy = sumS / n;
  const bias = meanConfidence - accuracy; // > 0 means overconfident
  let label = 'calibrated';
  if (n < opts.minAnswers) label = 'not enough data';
  else if (bias > opts.band) label = 'overconfident';
  else if (bias < -opts.band) label = 'underconfident';
  return {
    n,
    meanConfidence: round(meanConfidence),
    accuracy: round(accuracy),
    bias: round(bias),
    brier: round(sumSq / n),
    label
  };
}

export function calibration(answers, opts = CALIBRATION_DEFAULTS) {
  const byLevel = [1, 2, 3, 4].map((level) => {
    const at = answers.filter((a) => a.confidence === level);
    const acc = at.length ? at.reduce((s, a) => s + a.score, 0) / at.length : null;
    return { level, label: CONFIDENCE_LABEL[level], expected: CONFIDENCE_PROB[level], n: at.length, accuracy: acc == null ? null : round(acc) };
  });
  const byConcept = {};
  const concepts = [...new Set(answers.map((a) => a.concept))];
  for (const c of concepts) byConcept[c] = summarise(answers.filter((a) => a.concept === c), opts);
  return { overall: summarise(answers, opts), byLevel, byConcept };
}
