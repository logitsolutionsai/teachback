// `next` ordering on a crafted map: due reviews first, the frontier respects
// prerequisites, a concept with an unmastered prerequisite is never suggested,
// ready exercises come before new material, and the capstone comes last.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replay } from '../src/model/learner.mjs';
import { planNext, frontier, dueReviews } from '../src/model/next.mjs';

//   a   b
//   |  /|
//   c d |      c <- a ; d <- a, b ; e <- c, d ; f <- b
//    \|  f
//     e
function crafted() {
  const concepts = [
    { id: 'a', name: 'A', prerequisites: [] },
    { id: 'b', name: 'B', prerequisites: [] },
    { id: 'c', name: 'C', prerequisites: ['a'] },
    { id: 'd', name: 'D', prerequisites: ['a', 'b'] },
    { id: 'e', name: 'E', prerequisites: ['c', 'd'] },
    { id: 'f', name: 'F', prerequisites: ['b'] }
  ];
  const items = [];
  for (const c of concepts) {
    items.push({ id: `${c.id}-num`, concept: c.id, type: 'numeric', difficulty: 2, prompt: '?', answer: 1 });
    items.push({ id: `${c.id}-mcq`, concept: c.id, type: 'mcq', difficulty: 3, prompt: '?', options: [{}, {}, {}], answer: 0 });
    items.push({ id: `${c.id}-tb`, concept: c.id, type: 'teachback', difficulty: 3, prompt: '?', rubric: { required: [{ id: 'x', idea: 'x', synonyms: ['x'] }] } });
  }
  items.push({ id: 'c-code', concept: 'c', type: 'code', exercise: 'ex-c', prompt: '?' });
  items.push({ id: 'e-code', concept: 'e', type: 'code', exercise: 'ex-e', prompt: '?' });
  const exercises = new Map([
    ['ex-c', { id: 'ex-c', folder: 'ex-c', title: 'C in code', language: 'python', starter: 'c.py', concepts: ['c'], capstone: false }],
    ['ex-e', { id: 'ex-e', folder: 'ex-e', title: 'Capstone', language: 'python', starter: 'e.py', concepts: ['e'], capstone: true }]
  ]);
  return {
    dir: '.',
    slug: 'crafted',
    course: {},
    concepts,
    itemList: items,
    conceptById: new Map(concepts.map((c) => [c.id, c])),
    itemById: new Map(items.map((i) => [i.id, i])),
    exercises,
    track: ['ex-c', 'ex-e'],
    capstone: 'ex-e'
  };
}

let minute = 0;
const at = (day) => `${day}T09:${String(minute++ % 60).padStart(2, '0')}:00.000Z`;
// A confident correct pretest answer places a concept at 0.95 (mastered).
const place = (id, day = '2026-01-05') => ({ t: at(day), type: 'answer', item: `${id}-num`, result: 'correct', mode: 'pretest', confidence: 4 });
const pass = (ex, day = '2026-01-05') => ({ t: at(day), type: 'run', exercise: ex, status: 'passed', passed: 1, total: 1 });
const state = (c, events) => replay(c, { settings: { utcOffsetMinutes: 0 }, events });

test('a fresh learner starts at the first root concept with a Socratic opening', () => {
  const c = crafted();
  const plan = planNext(c, state(c, []), '2026-01-05');
  assert.deepEqual(plan.frontier, ['a', 'b']);
  assert.equal(plan.kind, 'learn');
  assert.equal(plan.concept, 'a');
  assert.equal(plan.activity, 'socratic');
  assert.equal(plan.item.id, 'a-num', 'easiest unseen non-teachback item is suggested');
});

test('the frontier only holds concepts whose prerequisites are all mastered', () => {
  const c = crafted();
  const d = state(c, [place('a')]);
  // b is unmastered, so d (needs a and b) and f (needs b) are not on the frontier; c (needs a) is.
  assert.deepEqual(frontier(c, d), ['b', 'c']);
  const d2 = state(c, [place('a'), place('b')]);
  assert.deepEqual(frontier(c, d2), ['c', 'd', 'f']);
  const d3 = state(c, [place('a'), place('b'), place('c')]);
  assert.ok(!frontier(c, d3).includes('e'), 'e still waits for d');
});

test('due reviews come before new material', () => {
  const c = crafted();
  const events = [{ t: '2026-01-05T09:00:00.000Z', type: 'answer', item: 'a-mcq', result: 'correct', confidence: 3 }];
  const sameDay = planNext(c, state(c, events), '2026-01-05');
  assert.equal(sameDay.kind, 'learn', 'nothing is due on the day it was answered');
  assert.equal(sameDay.dueReviews.length, 0);
  const nextDay = planNext(c, state(c, events), '2026-01-06');
  assert.equal(nextDay.kind, 'review');
  assert.equal(nextDay.item.id, 'a-mcq');
  assert.deepEqual(nextDay.dueReviews.map((r) => r.item), ['a-mcq']);
  assert.equal(planNext(c, state(c, events), '2026-01-09').dueReviews[0].overdueDays, 3);
});

test('due reviews are ordered by due day, then prerequisite order', () => {
  const c = crafted();
  const d = state(c, [
    { t: '2026-01-05T09:00:00.000Z', type: 'answer', item: 'b-mcq', result: 'correct' },
    { t: '2026-01-05T09:01:00.000Z', type: 'answer', item: 'a-mcq', result: 'correct' },
    { t: '2026-01-04T09:00:00.000Z', type: 'answer', item: 'c-mcq', result: 'correct' }
  ]);
  assert.deepEqual(dueReviews(c, d, '2026-01-06').map((r) => r.item), ['c-mcq', 'a-mcq', 'b-mcq']);
});

test('activities progress from Socratic question to practice to teach-back to the exercise', () => {
  const c = crafted();
  const base = [place('a')];
  const answer = (item, result = 'correct') => ({ t: at('2026-01-05'), type: 'answer', item, result, confidence: 3 });
  // c untouched -> socratic
  assert.equal(planNext(c, state(c, [place('a'), place('b')]), '2026-01-05').activity, 'socratic');
  // wrong answer on c -> below 0.7 -> practice item
  const p1 = planNext(c, state(c, [...base, place('b'), answer('c-num', 'wrong')]), '2026-01-05');
  assert.equal(p1.concept, 'c');
  assert.equal(p1.activity, 'item');
  // two correct answers -> above 0.7, no teach-back yet -> teachback
  const p2 = planNext(c, state(c, [...base, place('b'), answer('c-num'), answer('c-mcq')]), '2026-01-05');
  assert.equal(p2.activity, 'teachback');
  assert.equal(p2.item.id, 'c-tb');
});

test('a ready exercise comes before the next new concept', () => {
  const c = crafted();
  const d = state(c, [place('a'), place('b'), place('c')]);
  const plan = planNext(c, d, '2026-01-05');
  assert.equal(plan.kind, 'exercise');
  assert.equal(plan.exercise.id, 'ex-c');
  const after = planNext(c, state(c, [place('a'), place('b'), place('c'), pass('ex-c')]), '2026-01-05');
  assert.equal(after.kind, 'learn');
  assert.equal(after.concept, 'd');
});

test('the capstone stays locked until every other concept is mastered, and its pass makes the course Rebuilt', () => {
  const c = crafted();
  const allButF = [place('a'), place('b'), place('c'), pass('ex-c'), place('d'), place('e')];
  const p1 = planNext(c, state(c, allButF), '2026-01-05');
  assert.equal(p1.kind, 'learn');
  assert.equal(p1.concept, 'f', 'f must be mastered before the capstone');
  const all = [...allButF, place('f')];
  const p2 = planNext(c, state(c, all), '2026-01-05');
  assert.equal(p2.kind, 'exercise');
  assert.equal(p2.exercise.id, 'ex-e');
  assert.equal(p2.exercise.capstone, true);
  const done = state(c, [...all, pass('ex-e')]);
  assert.ok(done.rebuiltAt, 'capstone pass with everything mastered sets Rebuilt');
  assert.equal(planNext(c, done, '2026-01-05').kind, 'rebuilt');
});

test('property: across 300 random learner histories, next never suggests a concept with an unmastered prerequisite', () => {
  const c = crafted();
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const itemIds = c.itemList.filter((i) => i.type !== 'code').map((i) => i.id);
  const results = ['correct', 'correct', 'partial', 'wrong'];
  for (let trial = 0; trial < 300; trial++) {
    const events = [];
    const n = Math.floor(rand() * 14);
    for (let k = 0; k < n; k++) {
      const r = rand();
      if (r < 0.25) events.push(place(['a', 'b', 'c', 'd', 'e', 'f'][Math.floor(rand() * 6)], `2026-01-0${1 + Math.floor(rand() * 5)}`));
      else if (r < 0.3) events.push(pass(rand() < 0.5 ? 'ex-c' : 'ex-e', '2026-01-03'));
      else events.push({ t: at(`2026-01-0${1 + Math.floor(rand() * 5)}`), type: 'answer', item: itemIds[Math.floor(rand() * itemIds.length)], result: results[Math.floor(rand() * 4)], confidence: 1 + Math.floor(rand() * 4) });
    }
    const d = state(c, events);
    const plan = planNext(c, d, '2026-01-06');
    for (const id of plan.frontier) {
      assert.equal(d.mastery[id].mastered, false, `frontier concept ${id} is not mastered`);
      for (const p of c.conceptById.get(id).prerequisites) assert.equal(d.mastery[p].mastered, true, `frontier concept ${id} has mastered prerequisite ${p}`);
    }
    if (plan.kind === 'learn') {
      for (const p of c.conceptById.get(plan.concept).prerequisites) {
        assert.equal(d.mastery[p].mastered, true, `trial ${trial}: suggested ${plan.concept} but prerequisite ${p} is not mastered`);
      }
    }
    if (plan.kind === 'review') assert.ok(plan.dueReviews.length > 0);
    if (plan.kind !== 'review') assert.equal(plan.dueReviews.length, 0, 'reviews always come first');
  }
});
