// A scripted learner working through the attention example over three study
// days, driven entirely by `teachback next` and the injected clock.
import fs from 'node:fs';
import path from 'node:path';
import { cli, clockAt, EXAMPLE } from './cli.mjs';

export const DAYS = ['2026-03-02', '2026-03-03', '2026-03-06'];
// Stop each day once this many concepts are mastered and nothing is due.
const DAY_TARGET = [5, 9, Infinity];

// First attempts at these items are wrong (given with confidence 4: overconfident).
const WRONG_FIRST = new Set(['softmax-scale', 'sdpa-variance', 'mask-count', 'why-ratio', 'pe-value', 'mh-why', 'res-formula', 'res-dropout', 'train-peak']);
// First attempts at these short answers are only partly right.
const PARTIAL_FIRST = new Set(['qkv-roles', 'ed-teachback']);
// Correct, but answered with low confidence (underconfident).
const UNSURE = new Set(['qkv-output', 'emb-dmodel', 'ffn-dff', 'mh-dk']);
// Reviews failed on purpose: day -> item ids.
const REVIEW_WRONG = { '2026-03-03': ['softmax-weights'] };
// Exercises whose first run uses the untouched starter (and fails).
const FAIL_FIRST = new Set(['02-scaled-dot-product', '06-encoder-layer']);

const letter = (i) => String.fromCharCode(65 + i);

// extraSteps: on the last simulated day, keep going this many steps past the day's target.
export async function simulate(root, { days = DAYS.length, extraSteps = 0 } = {}) {
  const init = await cli(['init', 'attention', '--from', EXAMPLE, '--root', root, '--json']);
  if (init.code !== 0) throw new Error(`init failed: ${init.out}${init.err}`);
  const courseDir = path.join(root, '.teachback', 'attention');
  const items = JSON.parse(fs.readFileSync(path.join(courseDir, 'items.json'), 'utf8')).items;
  const byId = new Map(items.map((i) => [i.id, i]));
  const base = ['--root', root, '--json'];
  const attempts = new Map();
  const failedReviews = new Set();
  const trace = { courseDir, records: [], runs: [], days: {} };

  async function answer(itemId, now, { mode, day }) {
    const item = byId.get(itemId);
    const n = (attempts.get(itemId) ?? 0) + 1;
    attempts.set(itemId, n);
    let result = 'correct';
    if (n === 1 && WRONG_FIRST.has(itemId)) result = 'wrong';
    else if (n === 1 && PARTIAL_FIRST.has(itemId)) result = 'partial';
    if (mode === 'review' && (REVIEW_WRONG[day] ?? []).includes(itemId) && !failedReviews.has(`${day}:${itemId}`)) {
      failedReviews.add(`${day}:${itemId}`);
      result = 'wrong';
    }
    let confidence = result === 'wrong' ? 4 : result === 'partial' ? 2 : n === 1 ? 3 : 4;
    if (result === 'correct' && UNSURE.has(itemId)) confidence = 2;
    let rec;
    if (item.type === 'mcq' || item.type === 'numeric') {
      let ans;
      if (item.type === 'mcq') ans = letter(result === 'correct' ? item.answer : (item.answer + 1) % item.options.length);
      else ans = String(result === 'correct' ? item.answer : item.answer + 1000);
      const r = await cli(['grade', itemId, '--answer', ans, '--confidence', String(confidence), '--record', ...base, '--now', now]);
      if (r.code !== 0) throw new Error(`grade failed: ${r.out}${r.err}`);
      rec = r.json.recorded;
    } else {
      const r = await cli(['record', itemId, '--result', result, '--confidence', String(confidence), ...base, '--now', now]);
      if (r.code !== 0) throw new Error(`record failed: ${r.out}${r.err}`);
      rec = r.json;
    }
    trace.records.push({
      day,
      t: now,
      item: itemId,
      type: item.type,
      concept: item.concept,
      result,
      confidence,
      mode: rec.recorded.mode,
      before: rec.concept.before,
      after: rec.concept.after,
      change: rec.concept.change,
      dueDay: rec.review?.dueDay ?? null
    });
  }

  async function exercise(exId, clock, day) {
    const created = await cli(['run', exId, ...base, '--now', clock.next()]);
    if (created.json?.status !== 'created') throw new Error(`expected a work copy for ${exId}: ${created.out}`);
    if (FAIL_FIRST.has(exId)) {
      const r = await cli(['run', exId, ...base, '--now', clock.next()]);
      trace.runs.push({ day, exercise: exId, status: r.json.status, passed: r.json.passed, total: r.json.total, rebuilt: r.json.rebuilt, code: r.code });
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(courseDir, 'exercises', exId, 'exercise.json'), 'utf8'));
    fs.copyFileSync(path.join(courseDir, 'exercises', exId, '.reference', manifest.starter), created.json.workFile);
    const r = await cli(['run', exId, ...base, '--now', clock.next()]);
    trace.runs.push({ day, exercise: exId, status: r.json.status, passed: r.json.passed, total: r.json.total, rebuilt: r.json.rebuilt, firstPass: r.json.firstPass, code: r.code });
  }

  const lastDay = Math.min(days, DAYS.length) - 1;
  let extra = extraSteps;
  for (let d = 0; d <= lastDay; d++) {
    const day = DAYS[d];
    const clock = clockAt(day, 9);
    const info = (trace.days[day] = { plans: [] });
    for (let step = 0; step < 400; step++) {
      const now = clock.next();
      const plan = (await cli(['next', ...base, '--now', now])).json;
      if (step === 0) info.start = plan;
      info.plans.push({ kind: plan.kind, activity: plan.activity, concept: plan.concept, frontier: plan.frontier, item: plan.item?.id, exercise: plan.exercise?.id });
      if (plan.kind === 'rebuilt' || plan.kind === 'complete') break;
      if (plan.kind !== 'review') {
        const st = (await cli(['status', ...base, '--now', now])).json;
        if (st.concepts.mastered >= DAY_TARGET[d]) {
          if (d === lastDay && extra > 0) extra -= 1;
          else break;
        }
      }
      if (plan.exercise) await exercise(plan.exercise.id, clock, day);
      else if (plan.item) await answer(plan.item.id, clock.next(), { mode: plan.kind, day });
      else throw new Error(`No action for plan ${JSON.stringify(plan)}`);
    }
    info.end = (await cli(['status', ...base, '--now', clock.next()])).json;
    info.endNext = (await cli(['next', ...base, '--now', clock.next()])).json;
  }
  trace.learner = JSON.parse(fs.readFileSync(path.join(courseDir, 'learner.json'), 'utf8'));
  return trace;
}
