// Learner model: BKT updates, partial credit, threshold crossing, the cap,
// pretest placement, SM-2-lite scheduling and calibration. Expected values are
// worked out by hand in the comments (and in references/learner-model.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_BKT, itemParams, bktUpdate, isMastered } from '../src/model/bkt.mjs';
import { nextSchedule, isDue, DEFAULT_SCHEDULE } from '../src/model/schedule.mjs';
import { summarise, calibration } from '../src/model/calibration.mjs';
import { replay } from '../src/model/learner.mjs';

const close = (got, want, eps = 1e-6, msg) => assert.ok(Math.abs(got - want) <= eps, `${msg ?? ''} expected ${want}, got ${got}`);

// ---------------------------------------------------------------- BKT

test('item difficulty adjusts slip and guess', () => {
  const mcq = (difficulty, n = 4) => ({ type: 'mcq', difficulty, options: Array(n).fill({}) });
  // difficulty 3 is neutral: slip = 0.1, guess = 1 / options
  assert.deepEqual(itemParams(mcq(3)), { slip: 0.1, guess: 0.25 });
  // f = (d - 3) / 2; slip = 0.1 * (1 + f/2); guess = base * (1 - f/2)
  const hard = itemParams(mcq(5));
  close(hard.slip, 0.15);
  close(hard.guess, 0.125);
  const easy = itemParams(mcq(1));
  close(easy.slip, 0.05);
  close(easy.guess, 0.375);
  close(itemParams(mcq(3, 3)).guess, 1 / 3);
  assert.deepEqual(itemParams({ type: 'numeric', difficulty: 3 }), { slip: 0.1, guess: 0.05 });
  assert.deepEqual(itemParams({ type: 'teachback' }), { slip: 0.1, guess: 0.05 });
  assert.deepEqual(itemParams({ type: 'code' }), { slip: 0.1, guess: 0.02 });
  // explicit per-item overrides win
  assert.deepEqual(itemParams({ type: 'mcq', options: [{}, {}], pSlip: 0.2, pGuess: 0.4 }), { slip: 0.2, guess: 0.4 });
});

test('BKT update, hand-computed: correct, wrong and partial from P(L) = 0.2', () => {
  const p = { slip: 0.1, guess: 0.25, pLearn: 0.15 };
  // correct: 0.2*0.9 / (0.18 + 0.8*0.25) = 0.18/0.38 = 0.473684; + (1-0.473684)*0.15 = 0.552632
  close(bktUpdate(0.2, 1, p), 0.552632);
  // wrong: 0.2*0.1 / (0.02 + 0.8*0.75) = 0.02/0.62 = 0.032258; + 0.967742*0.15 = 0.177419
  close(bktUpdate(0.2, 0, p), 0.177419);
  // partial: 0.5*0.473684 + 0.5*0.032258 = 0.252971; + 0.747029*0.15 = 0.365025
  close(bktUpdate(0.2, 0.5, p), 0.365025);
  // with no learning transition, the posterior alone
  close(bktUpdate(0.2, 1, { ...p, pLearn: 0 }), 0.473684);
});

test('mastery threshold is 0.95 and inclusive', () => {
  assert.equal(DEFAULT_BKT.masteryThreshold, 0.95);
  assert.equal(isMastered(0.95), true);
  assert.equal(isMastered(0.9499), false);
});

// A tiny course object for replay tests.
function course() {
  const concepts = [
    { id: 'x', name: 'X', prerequisites: [] },
    { id: 'y', name: 'Y', prerequisites: ['x'] }
  ];
  const items = [
    { id: 'x-tb', concept: 'x', type: 'teachback', difficulty: 3, rubric: { required: [{ id: 'i', idea: 'i', synonyms: ['i'] }] } },
    { id: 'x-mcq', concept: 'x', type: 'mcq', difficulty: 3, options: [{}, {}, {}, {}], answer: 0 },
    { id: 'x-num', concept: 'x', type: 'numeric', difficulty: 3, answer: 1 },
    { id: 'y-code', concept: 'y', type: 'code', difficulty: 3, exercise: 'ex' }
  ];
  return {
    dir: '.',
    slug: 't',
    course: {},
    concepts,
    itemList: items,
    conceptById: new Map(concepts.map((c) => [c.id, c])),
    itemById: new Map(items.map((i) => [i.id, i])),
    exercises: new Map([['ex', { id: 'ex', concepts: ['y'], capstone: true }]]),
    track: ['ex'],
    capstone: 'ex'
  };
}
const learner = (events) => ({ settings: { utcOffsetMinutes: 0 }, events });
const ans = (t, item, result, extra = {}) => ({ t, type: 'answer', item, result, ...extra });

test('replay: mastery crosses the threshold on the second correct teach-back, then is capped at 0.99', () => {
  // teachback d3: slip 0.1, guess 0.05.
  // 1st: 0.18/(0.18+0.04) = 0.818182 -> + 0.181818*0.15 = 0.845455 (not mastered)
  // 2nd: 0.760909/(0.760909+0.007727) = 0.989947 -> + 0.001508 = 0.991455 -> capped to 0.99 (mastered)
  const c = course();
  const one = replay(c, learner([ans('2026-01-05T09:00:00Z', 'x-tb', 'correct')]));
  close(one.mastery.x.pL, 0.845455);
  assert.equal(one.mastery.x.mastered, false);
  const two = replay(c, learner([ans('2026-01-05T09:00:00Z', 'x-tb', 'correct'), ans('2026-01-05T09:05:00Z', 'x-tb', 'correct')]));
  close(two.mastery.x.pL, 0.99);
  assert.equal(two.mastery.x.mastered, true);
  assert.equal(two.mastery.x.firstMasteredAt, '2026-01-05T09:05:00Z');
  assert.equal(two.mastery.x.teachbackPassed, true);
});

test('replay: one clear failure after mastery drops below the threshold (the cap keeps 1% doubt)', () => {
  // From 0.99, wrong on an mcq (slip 0.1, guess 0.25): 0.099/(0.099+0.0075) = 0.929577 -> + 0.070423*0.15 = 0.940141
  const c = course();
  const d = replay(c, learner([ans('2026-01-05T09:00:00Z', 'x-tb', 'correct'), ans('2026-01-05T09:05:00Z', 'x-tb', 'correct'), ans('2026-01-06T09:00:00Z', 'x-mcq', 'wrong')]));
  close(d.mastery.x.pL, 0.940141);
  assert.equal(d.mastery.x.mastered, false);
  assert.equal(d.mastery.x.firstMasteredAt, '2026-01-05T09:05:00Z', 'first mastery time is kept');
});

test('replay: partial credit is the score-weighted mix of the two posteriors', () => {
  const c = course();
  const d = replay(c, learner([ans('2026-01-05T09:00:00Z', 'x-mcq', 'partial')]));
  close(d.mastery.x.pL, 0.365025);
  assert.equal(d.mastery.x.partial, 1);
});

test('replay: pretest placement and pretest evidence without learning', () => {
  const c = course();
  // confident correct pretest answer places out at 0.95
  const placed = replay(c, learner([ans('2026-01-05T09:00:00Z', 'x-num', 'correct', { mode: 'pretest', confidence: 3 })]));
  close(placed.mastery.x.pL, 0.95);
  assert.equal(placed.mastery.x.mastered, true);
  // unsure correct pretest answer: ordinary evidence, no learning transition
  // numeric d3: slip 0.1, guess 0.05: 0.18/(0.18+0.04) = 0.818182
  const unsure = replay(c, learner([ans('2026-01-05T09:00:00Z', 'x-num', 'correct', { mode: 'pretest', confidence: 2 })]));
  close(unsure.mastery.x.pL, 0.818182);
  // wrong pretest answer: 0.02/(0.02+0.76) = 0.025641, no learning added
  const wrong = replay(c, learner([ans('2026-01-05T09:00:00Z', 'x-num', 'wrong', { mode: 'pretest', confidence: 4 })]));
  close(wrong.mastery.x.pL, 0.025641);
});

test('replay: a passing run counts once as evidence for its code items; failing runs are practice', () => {
  const c = course();
  const run = (t, status) => ({ t, type: 'run', exercise: 'ex', status, passed: status === 'passed' ? 3 : 0, total: 3 });
  const d = replay(c, learner([run('2026-01-05T09:00:00Z', 'failed'), run('2026-01-05T09:10:00Z', 'passed'), run('2026-01-05T09:20:00Z', 'passed')]));
  // code d3: slip 0.1, guess 0.02: 0.18/(0.18+0.016) = 0.918367; + 0.081633*0.15 = 0.930612
  close(d.mastery.y.pL, 0.930612);
  assert.equal(d.mastery.y.attempts, 1);
  assert.equal(d.exercises.ex.runs, 3);
  assert.equal(d.exercises.ex.passed, true);
  assert.equal(d.exercises.ex.firstPassedAt, '2026-01-05T09:10:00Z');
  assert.equal(d.reviews['y-code'].dueDay, undefined, 'code items are not scheduled for review');
});

test('replay is deterministic and order-independent of how events were appended', () => {
  const c = course();
  const evs = [ans('2026-01-05T09:00:00Z', 'x-mcq', 'correct', { confidence: 3 }), ans('2026-01-05T09:01:00Z', 'x-num', 'wrong', { confidence: 4 }), ans('2026-01-06T09:00:00Z', 'x-tb', 'correct')];
  const a = replay(c, learner(evs));
  const b = replay(c, learner([evs[2], evs[0], evs[1]]));
  assert.deepEqual(a.mastery, b.mastery);
  assert.deepEqual(a.reviews, b.reviews);
  assert.deepEqual(a.history.map((h) => h.day), ['2026-01-05', '2026-01-06']);
});

test('replay skips events for items that no longer exist and says so', () => {
  const d = replay(course(), learner([ans('2026-01-05T09:00:00Z', 'gone', 'correct')]));
  assert.equal(d.warnings.length, 1);
  assert.match(d.warnings[0], /no longer in items.json/);
});

// ---------------------------------------------------------------- scheduling

test('SM-2 lite: intervals 1, 3, then interval x ease; ease +0.1 per confident correct answer', () => {
  let s = nextSchedule(null, 'correct', '2026-01-01');
  assert.deepEqual([s.reps, s.interval, s.dueDay, s.ease], [1, 1, '2026-01-02', 2.6]);
  s = nextSchedule(s, 'correct', '2026-01-02');
  assert.deepEqual([s.reps, s.interval, s.dueDay, s.ease], [2, 3, '2026-01-05', 2.7]);
  s = nextSchedule(s, 'correct', '2026-01-05');
  // round(3 * 2.7) = 8
  assert.deepEqual([s.reps, s.interval, s.dueDay, s.ease], [3, 8, '2026-01-13', 2.8]);
  s = nextSchedule(s, 'correct', '2026-01-13');
  // round(8 * 2.8) = 22; ease capped at 3.0 after this step would be 2.9
  assert.deepEqual([s.reps, s.interval, s.dueDay, s.ease], [4, 22, '2026-02-04', 2.9]);
});

test('SM-2 lite: a lapse resets to 1 day, costs 0.2 ease, and counts only after a success', () => {
  let s = nextSchedule(null, 'wrong', '2026-01-01');
  assert.deepEqual([s.reps, s.interval, s.lapses, s.dueDay, s.ease], [0, 1, 0, '2026-01-02', 2.3]);
  s = nextSchedule(s, 'correct', '2026-01-02');
  s = nextSchedule(s, 'correct', '2026-01-03');
  s = nextSchedule(s, 'wrong', '2026-01-06');
  assert.deepEqual([s.reps, s.interval, s.lapses, s.dueDay], [0, 1, 1, '2026-01-07']);
  close(s.ease, 2.3); // 2.3 + 0.1 + 0.1 - 0.2
  // relearning restarts the ladder
  s = nextSchedule(s, 'correct', '2026-01-07');
  assert.deepEqual([s.reps, s.interval, s.dueDay], [1, 1, '2026-01-08']);
});

test('SM-2 lite: partial halves the interval; early correct answers change nothing; unsure correct earns no ease', () => {
  let s = { reps: 3, ease: 2.5, interval: 8, lapses: 0, dueDay: '2026-01-09', lastDay: '2026-01-01' };
  const partial = nextSchedule(s, 'partial', '2026-01-09');
  assert.deepEqual([partial.interval, partial.dueDay, partial.reps], [4, '2026-01-13', 3]);
  close(partial.ease, 2.35);
  const early = nextSchedule(s, 'correct', '2026-01-04');
  assert.deepEqual([early.interval, early.dueDay, early.reps, early.ease], [8, '2026-01-09', 3, 2.5]);
  const unsure = nextSchedule(null, 'correct', '2026-01-01', { confidence: 2 });
  assert.equal(unsure.ease, 2.5);
  // ease never drops below 1.3
  for (let i = 0; i < 10; i++) s = nextSchedule(s, 'wrong', '2026-02-01');
  assert.equal(s.ease, DEFAULT_SCHEDULE.minEase);
  assert.equal(isDue(s, '2026-02-01'), false);
  assert.equal(isDue(s, '2026-02-02'), true);
});

// ---------------------------------------------------------------- calibration

test('calibration maths: over-, under- and well-calibrated', () => {
  const a = (confidence, score) => ({ concept: 'k', confidence, score });
  // claims 0.95 three times, right once: bias 0.95 - 1/3 = 0.616667; Brier (0.9025 + 0.0025 + 0.9025)/3 = 0.6025
  const over = summarise([a(4, 0), a(4, 1), a(4, 0)]);
  assert.equal(over.label, 'overconfident');
  close(over.meanConfidence, 0.95, 1e-4);
  close(over.accuracy, 0.3333, 1e-4);
  close(over.bias, 0.6167, 1e-4);
  close(over.brier, 0.6025, 1e-4);
  // claims 0.25 three times, always right: bias -0.75, Brier 0.5625
  const under = summarise([a(1, 1), a(1, 1), a(1, 1)]);
  assert.equal(under.label, 'underconfident');
  close(under.bias, -0.75, 1e-4);
  close(under.brier, 0.5625, 1e-4);
  // claims 0.75, right 3 of 4: bias 0
  const good = summarise([a(3, 1), a(3, 1), a(3, 1), a(3, 0)]);
  assert.equal(good.label, 'calibrated');
  close(good.bias, 0, 1e-9);
  // partial counts as 0.5; fewer than 3 rated answers is not enough data
  assert.equal(summarise([a(2, 0.5), a(2, 0.5)]).label, 'not enough data');
  close(summarise([a(2, 0.5), a(2, 0.5)]).accuracy, 0.5);
  assert.equal(summarise([{ concept: 'k', score: 1 }]).n, 0, 'answers without confidence are ignored');
});

test('calibration groups by confidence level and by concept', () => {
  const c = calibration([
    { concept: 'p', confidence: 4, score: 1 },
    { concept: 'p', confidence: 4, score: 0 },
    { concept: 'q', confidence: 1, score: 1 }
  ]);
  assert.deepEqual(c.byLevel.map((l) => l.n), [1, 0, 0, 2]);
  assert.equal(c.byLevel[3].accuracy, 0.5);
  assert.equal(c.byLevel[1].accuracy, null);
  assert.deepEqual(Object.keys(c.byConcept).sort(), ['p', 'q']);
  assert.equal(c.byConcept.p.n, 2);
});
