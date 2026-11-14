// grade: deterministic mcq and numeric grading, and rubric coverage for short
// and teach-back answers (synonyms, symbols, stemming, misconceptions, negation).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMcqAnswer, gradeMcq, parseNumber, gradeNumeric, rubricCoverage, normalise, gradeItem } from '../src/grade.mjs';

const mcq = {
  id: 'q',
  type: 'mcq',
  options: [
    { text: 'Divide by d_k', rationale: 'Too much: the variance needs the square root.' },
    { text: 'Divide by √d_k', rationale: 'Right: this restores unit variance.' },
    { text: 'Multiply by d_k', rationale: 'Makes it worse.' }
  ],
  answer: 1
};

test('mcq answers can be a letter, a 1-based number or the option text', () => {
  for (const a of ['B', 'b', '(B)', 'B)', 'option B', '2', 'Divide by √d_k', '  divide by √D_K ']) assert.equal(parseMcqAnswer(mcq, a), 1, a);
  assert.equal(parseMcqAnswer(mcq, 'a'), 0);
  assert.throws(() => parseMcqAnswer(mcq, 'D'), (e) => e.code === 'E101');
  assert.throws(() => parseMcqAnswer(mcq, '4'), (e) => e.code === 'E101');
});

test('mcq grading returns the rationale for the chosen and the correct option', () => {
  const right = gradeMcq(mcq, 'B');
  assert.equal(right.result, 'correct');
  assert.match(right.rationale, /unit variance/);
  const wrong = gradeMcq(mcq, 'A');
  assert.equal(wrong.result, 'wrong');
  assert.equal(wrong.chosen, 'A');
  assert.equal(wrong.correctOption, 'B');
  assert.match(wrong.rationale, /square root/);
  assert.match(wrong.correctRationale, /unit variance/);
});

test('numbers: decimals, fractions, powers, percentages, thousands separators, scientific notation', () => {
  assert.equal(parseNumber('0.125'), 0.125);
  assert.equal(parseNumber('1/8'), 0.125);
  assert.equal(parseNumber('2^-3'), 0.125);
  assert.equal(parseNumber('12.5%'), 0.125);
  assert.equal(parseNumber('4,000'), 4000);
  assert.equal(parseNumber('1e-9'), 1e-9);
  assert.equal(parseNumber(' -64 '), -64);
  assert.throws(() => parseNumber('sixty four'), (e) => e.code === 'E102');
});

test('numeric grading honours the tolerance at its edges', () => {
  const item = { type: 'numeric', answer: 0.75, tolerance: 0.005 };
  assert.equal(gradeNumeric(item, '0.754').result, 'correct');
  assert.equal(gradeNumeric(item, '3/4').result, 'correct');
  assert.equal(gradeNumeric(item, '0.756').result, 'wrong');
  assert.equal(gradeNumeric({ type: 'numeric', answer: 64 }, '64').result, 'correct');
  assert.equal(gradeNumeric({ type: 'numeric', answer: 64 }, '64.01').result, 'wrong');
});

test('normalise maps symbols, joins d_k, drops apostrophes, stems words and reads every negator as "not"', () => {
  assert.deepEqual(normalise('Divide by √d_k!'), ['divid', 'by', 'sqrt', 'dk']);
  assert.deepEqual(normalise("Gradients don't vanish"), ['gradient', 'not', 'vanish']);
  assert.deepEqual(normalise('Set it to −∞'), ['set', 'it', 'to', 'infin']);
  assert.deepEqual(normalise('P_drop = 0.1.'), ['pdrop', '0.1']);
});

const rubric = {
  required: [
    { id: 'grow', idea: 'Dot products grow with d_k', synonyms: ['grow large', 'variance dk', 'get bigger'] },
    { id: 'grad', idea: 'Softmax saturates and gradients become tiny', synonyms: ['small gradient', 'saturate', 'vanishing gradient'] },
    { id: 'unit', idea: 'Scaling restores unit variance', synonyms: ['unit variance', 'variance of 1', 'variance back to 1'] }
  ],
  misconceptions: [{ id: 'speed', description: 'Thinks the scaling is for speed', synonyms: ['faster', 'for speed'] }],
  minRequired: 2
};

test('rubric coverage finds required ideas through synonyms, symbols and plurals', () => {
  const cv = rubricCoverage(rubric, 'The scores have variance d_k, so they get bigger; softmax saturates and the gradients are small. Dividing by √d_k brings them back to a variance of 1.');
  assert.equal(cv.covered, 3);
  assert.equal(cv.total, 3);
  assert.deepEqual(cv.required.map((r) => r.covered), [true, true, true]);
  assert.equal(cv.required[0].matched, 'variance dk', 'd_k matches the synonym written as dk');
  assert.equal(cv.required[1].matched, 'small gradient', '"the gradients are small" has the key words of "small gradient", in another order');
  assert.equal(rubricCoverage(rubric, 'softmax saturates').required[1].matched, 'saturate', 'saturates is stemmed like saturate');
  assert.equal(cv.suggestion, 'correct');
  assert.equal(cv.misconceptions[0].present, false);
});

test('rubric coverage reports misconceptions and partial coverage, as a suggestion only', () => {
  const cv = rubricCoverage(rubric, 'We divide so attention runs faster, and the numbers grow large otherwise.');
  assert.equal(cv.covered, 1);
  assert.equal(cv.misconceptions[0].present, true);
  assert.equal(cv.misconceptions[0].matched, 'faster');
  assert.equal(cv.suggestion, 'wrong', 'below minRequired with a misconception');
  assert.match(cv.caution[0], /evidence, not a verdict/);
  const partial = rubricCoverage(rubric, 'Without it the gradients get small, a vanishing gradient problem.');
  assert.equal(partial.covered, 1);
  assert.equal(partial.suggestion, 'partial');
  assert.equal(rubricCoverage(rubric, 'No idea.').suggestion, 'wrong');
});

test('a match next to a negation is flagged and not counted', () => {
  const cv = rubricCoverage(rubric, 'It is not for speed, it does not make things faster. The products grow large and softmax would saturate.');
  assert.equal(cv.misconceptions[0].present, true);
  assert.equal(cv.misconceptions[0].negated, true);
  assert.equal(cv.covered, 2);
  assert.equal(cv.suggestion, 'correct', 'a negated misconception does not count against the answer');
  assert.equal(cv.caution.length, 2);
  const neg = rubricCoverage(rubric, 'The gradients will never saturate here.');
  assert.equal(neg.required[1].negated, true);
  assert.equal(neg.covered, 0);
});

test('gradeItem routes by type and refuses code items', () => {
  assert.equal(gradeItem(mcq, 'B').deterministic, true);
  const short = gradeItem({ id: 's', type: 'short', rubric }, 'grow large and saturate');
  assert.equal(short.deterministic, false);
  assert.equal(short.coverage.covered, 2);
  assert.throws(() => gradeItem({ id: 'k', type: 'code', exercise: 'ex' }, 'x'), (e) => e.code === 'E103' && /teachback run ex/.test(e.hint));
});
