// Simulated learner across three study days (2, 3 and 6 March 2026), driven
// by `teachback next` with an injected clock. Asserts that mastery rises and
// falls as expected, reviews come due on the right days, and the capstone pass
// sets Rebuilt.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { simulate, DAYS } from './helpers/simulate.mjs';
import { cli, tempDir, rmDir } from './helpers/cli.mjs';
import { addDays } from '../src/util.mjs';

let root;
let trace;
before(async () => {
  root = tempDir('teachback-sim-');
  trace = await simulate(root);
});
after(() => rmDir(root));

const day = (d) => trace.days[d];

test('the clock is injected: every event falls on one of the three scripted days', () => {
  const days = new Set(trace.learner.events.map((e) => e.t.slice(0, 10)));
  assert.deepEqual([...days].sort(), DAYS);
  assert.deepEqual(trace.learner.history.map((h) => h.day), DAYS);
});

test('day 1: nothing is due at the start, mastery rises, and the first exercises pass', () => {
  const d1 = day('2026-03-02');
  assert.equal(d1.start.kind, 'learn');
  assert.equal(d1.start.concept, 'softmax', 'the only root concept with no prerequisites comes first');
  assert.equal(d1.start.activity, 'socratic');
  assert.equal(d1.start.dueReviews.length, 0);
  assert.equal(d1.end.concepts.mastered, 5);
  const firstCorrect = trace.records.find((r) => r.item === 'softmax-weights');
  assert.ok(firstCorrect.after > firstCorrect.before, 'a correct answer raises mastery');
  const wrong = trace.records.find((r) => r.item === 'sdpa-variance' && r.result === 'wrong');
  assert.ok(wrong.after < wrong.before, 'a wrong answer lowers mastery');
  const partial = trace.records.find((r) => r.item === 'qkv-roles' && r.result === 'partial');
  assert.ok(partial.after > partial.before && partial.after < 0.7, 'a partial answer raises it a little');
  const passed = trace.runs.filter((r) => r.day === '2026-03-02' && r.status === 'passed').map((r) => r.exercise);
  assert.deepEqual(passed, ['01-softmax', '02-scaled-dot-product', '03-masking']);
  const failedFirst = trace.runs.find((r) => r.exercise === '02-scaled-dot-product');
  assert.deepEqual([failedFirst.status, failedFirst.passed, failedFirst.code], ['failed', 0, 1], 'the untouched starter fails first');
});

test('reviews are scheduled one day after a first correct answer and three days after a second', () => {
  const day1 = trace.records.filter((r) => r.day === '2026-03-02' && r.type !== 'code');
  for (const r of day1) {
    if (r.result !== 'wrong') assert.equal(r.dueDay, '2026-03-03', `${r.item} answered on day 1 is due on day 2`);
  }
  // Items answered correctly at the first try on day 1 and correctly again when reviewed on day 2.
  const cleanDay1 = new Set(day1.filter((r) => r.result === 'correct').map((r) => r.item));
  for (const r of day1) if (r.result !== 'correct') cleanDay1.delete(r.item);
  const reviewedDay2 = trace.records.filter((r) => r.day === '2026-03-03' && r.mode === 'review' && r.result === 'correct' && cleanDay1.has(r.item));
  assert.ok(reviewedDay2.length > 5);
  for (const r of reviewedDay2) assert.equal(r.dueDay, addDays('2026-03-03', 3), `${r.item} reviewed correctly on day 2 is due 3 days later`);
});

test('day 2: every item answered on day 1 comes due, reviews come before new material, and all are cleared', () => {
  const d2 = day('2026-03-03');
  const day1Items = new Set(trace.records.filter((r) => r.day === '2026-03-02' && r.type !== 'code').map((r) => r.item));
  assert.equal(d2.start.kind, 'review');
  assert.deepEqual(new Set(d2.start.dueReviews.map((r) => r.item)), day1Items);
  const firstLearn = d2.plans.findIndex((p) => p.kind !== 'review');
  assert.ok(d2.plans.slice(firstLearn).every((p) => p.kind !== 'review'), 'no review is left once new material starts');
  assert.equal(firstLearn, day1Items.size, 'each due item is reviewed once; a failed one is rescheduled for tomorrow');
  assert.equal(d2.end.reviews.dueToday, 0);
  assert.equal(d2.end.concepts.mastered, 9);
});

test('day 2: a failed review costs mastery (lost, then regained) and brings the item back tomorrow', () => {
  const lapse = trace.records.find((r) => r.day === '2026-03-03' && r.item === 'softmax-weights' && r.mode === 'review');
  assert.equal(lapse.result, 'wrong');
  assert.equal(lapse.before, 0.99);
  assert.ok(lapse.after < 0.95);
  assert.equal(lapse.change, 'lost mastery');
  assert.equal(lapse.dueDay, '2026-03-04', 'a lapse resets the interval to one day');
  const regained = trace.records.find((r) => r.day === '2026-03-03' && r.concept === 'softmax' && r.change === 'mastered');
  assert.ok(regained, 'softmax is mastered again later the same day');
  const sched = trace.learner.reviews['softmax-weights'];
  assert.equal(sched.lapses, 1);
});

test('day 3 (three days later): overdue reviews come first, then the last concepts, then the capstone', () => {
  const d3 = day('2026-03-06');
  assert.equal(d3.start.kind, 'review');
  assert.ok(d3.start.dueReviews.some((r) => r.overdueDays === 2), 'items due on 4 March are 2 days overdue');
  assert.ok(d3.start.dueReviews.some((r) => r.overdueDays === 0), 'items due on 6 March are due today');
  const kinds = d3.plans.map((p) => p.kind);
  const lastReview = kinds.lastIndexOf('review');
  const firstLearn = kinds.indexOf('learn');
  assert.ok(lastReview < firstLearn);
  const capstoneAt = d3.plans.findIndex((p) => p.exercise === '06-encoder-layer');
  assert.ok(capstoneAt > kinds.lastIndexOf('learn'), 'the capstone comes after the last concept');
  const ranCapstone = trace.runs.filter((r) => r.exercise === '06-encoder-layer');
  assert.deepEqual(ranCapstone.map((r) => [r.status, r.rebuilt]), [
    ['failed', false],
    ['passed', true]
  ]);
});

test('the capstone pass sets Rebuilt, and status and next agree', () => {
  const end = day('2026-03-06').end;
  assert.equal(end.concepts.mastered, 12);
  assert.equal(end.exercises.passed, 6);
  assert.equal(end.capstonePassed, true);
  assert.equal(end.rebuilt, true);
  assert.equal(end.rebuiltAt.slice(0, 10), '2026-03-06');
  assert.equal(trace.learner.rebuiltAt, end.rebuiltAt, 'learner.json stores it too');
  assert.equal(day('2026-03-06').endNext.kind, 'rebuilt');
  assert.deepEqual(end.history.map((h) => h.mastered), [5, 9, 12], 'progress over time');
});

test('calibration sees the overconfident wrong answers and the underconfident right ones', () => {
  const cal = day('2026-03-06').end.calibration;
  const certain = cal.byLevel.find((l) => l.level === 4);
  const unsure = cal.byLevel.find((l) => l.level === 2);
  assert.ok(certain.accuracy < certain.expected, 'Certain answers were right less than 95% of the time');
  assert.ok(unsure.accuracy > unsure.expected, 'Unsure answers were right more than 50% of the time');
  assert.equal(day('2026-03-06').end.conceptList.find((c) => c.id === 'softmax').calibration.label, 'overconfident');
});

test('reviews keep coming after Rebuilt, and the record replays to the same state', async () => {
  const later = (await cli(['next', '--root', root, '--json', '--now', '2026-03-20T09:00:00Z'])).json;
  assert.equal(later.kind, 'review', 'spaced review continues after the course is finished');
  const again = (await cli(['status', '--root', root, '--json', '--now', '2026-03-06T23:00:00Z'])).json;
  assert.equal(again.concepts.mastered, 12);
  assert.equal(again.rebuilt, true);
});
