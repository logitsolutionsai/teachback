// A fixed learner history for each shipped paper course, replayed by the
// learner model. tests/engine-golden.test.mjs compares the result with
// tests/fixtures/golden/engine-golden.json, which was captured before RepoQuest
// was added, so any change to mastery, review dates, Rebuilt or next fails.
import { loadCourseStrict } from '../../src/course.mjs';
import { replay, newLearner } from '../../src/model/learner.mjs';
import { planNext } from '../../src/model/next.mjs';
import { topoOrder } from '../../src/graph.mjs';
import { dayKey } from '../../src/util.mjs';

const DAYS = ['2026-03-02', '2026-03-03', '2026-03-05', '2026-03-09', '2026-03-20'];
const RESULT_CYCLE = ['correct', 'correct', 'partial', 'correct', 'wrong', 'correct', 'correct'];

// Deterministic events: every item in topological concept order, answered over
// the first three days with a fixed cycle of results and confidences, a pretest
// answer first, then a review pass on the later days, plus exercise runs.
export function goldenEvents(courseData) {
  const order = topoOrder(courseData.concepts);
  const items = order.flatMap((cid) => courseData.itemList.filter((i) => i.concept === cid && i.type !== 'code'));
  const events = [];
  let minute = 0;
  const at = (day) => {
    const t = new Date(Date.parse(`${day}T09:00:00Z`) + minute * 60000).toISOString();
    minute += 1;
    return t;
  };
  if (items[0]) events.push({ t: at(DAYS[0]), type: 'answer', item: items[0].id, concept: items[0].concept, result: 'correct', mode: 'pretest', confidence: 4 });
  items.forEach((it, i) => {
    const day = DAYS[Math.min(2, Math.floor((i * 3) / items.length))];
    const result = RESULT_CYCLE[i % RESULT_CYCLE.length];
    events.push({ t: at(day), type: 'answer', item: it.id, concept: it.concept, result, mode: 'learn', confidence: 1 + (i % 4) });
    if (result !== 'correct') events.push({ t: at(day), type: 'answer', item: it.id, concept: it.concept, result: 'correct', mode: 'learn', confidence: 3 });
  });
  for (const id of courseData.track) {
    events.push({ t: at(DAYS[2]), type: 'run', exercise: id, status: 'failed', passed: 0, failed: 1, total: 1, file: `work/${id}/x` });
    events.push({ t: at(DAYS[2]), type: 'run', exercise: id, status: 'passed', passed: 1, failed: 0, total: 1, file: `work/${id}/x` });
  }
  items.forEach((it, i) => {
    if (i % 2 === 0) events.push({ t: at(DAYS[3]), type: 'answer', item: it.id, concept: it.concept, result: i % 6 === 0 ? 'wrong' : 'correct', mode: 'review', confidence: 3 });
  });
  return events;
}

export function goldenSnapshot(dir) {
  const courseData = loadCourseStrict(dir);
  const learner = newLearner(courseData.slug, new Date('2026-03-01T00:00:00Z'));
  learner.settings.utcOffsetMinutes = 0;
  learner.events = goldenEvents(courseData);
  const derived = replay(courseData, learner);
  const plans = {};
  for (const day of DAYS) {
    const p = planNext(courseData, derived, day);
    plans[day] = { kind: p.kind, activity: p.activity, concept: p.concept, item: p.item?.id ?? null, exercise: p.exercise?.id ?? null, due: p.dueReviews.length, nextReviewDay: p.nextReviewDay };
  }
  // Mastery as it stood partway, too: replay a prefix of the log.
  const half = { ...learner, events: learner.events.slice(0, Math.floor(learner.events.length / 2)) };
  const mid = replay(courseData, half);
  const midPlan = planNext(courseData, mid, dayKey(half.events.at(-1).t));
  return {
    course: courseData.slug,
    events: learner.events.length,
    mastery: derived.mastery,
    reviews: derived.reviews,
    exercises: derived.exercises,
    history: derived.history,
    rebuiltAt: derived.rebuiltAt,
    plans,
    midMastery: mid.mastery,
    midPlan: { kind: midPlan.kind, activity: midPlan.activity, concept: midPlan.concept, item: midPlan.item?.id ?? null, exercise: midPlan.exercise?.id ?? null }
  };
}
