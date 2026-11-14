// What to do now: due reviews first, then the frontier concept (all
// prerequisites mastered, itself not mastered), then the rebuild track.
import { topoOrder } from '../graph.mjs';
import { daysBetween } from '../util.mjs';

export const ACTIVITY_THRESHOLDS = Object.freeze({ practiceBelow: 0.7 });

function itemOrderKey(item) {
  return [item.difficulty ?? 3, item.id];
}

function byKey(a, b) {
  const ka = itemOrderKey(a);
  const kb = itemOrderKey(b);
  return ka[0] - kb[0] || (ka[1] < kb[1] ? -1 : ka[1] > kb[1] ? 1 : 0);
}

// Pick the next practice item for a concept: unseen first (easiest first), then
// ones last answered wrongly or partly, then the least recently seen.
export function pickItem(courseData, derived, conceptId, { types } = {}) {
  const pool = courseData.itemList.filter(
    (i) => i.concept === conceptId && i.type !== 'code' && (!types || types.includes(i.type))
  );
  if (!pool.length) return null;
  const unseen = pool.filter((i) => !derived.reviews[i.id]).sort(byKey);
  if (unseen.length) return unseen[0];
  const missed = pool.filter((i) => derived.reviews[i.id]?.lastResult !== 'correct').sort(byKey);
  if (missed.length) return missed[0];
  return [...pool].sort((a, b) => {
    const la = derived.reviews[a.id]?.lastSeen ?? '';
    const lb = derived.reviews[b.id]?.lastSeen ?? '';
    return la < lb ? -1 : la > lb ? 1 : byKey(a, b);
  })[0];
}

export function dueReviews(courseData, derived, today) {
  const order = new Map(topoOrder(courseData.concepts).map((id, i) => [id, i]));
  const out = [];
  for (const [itemId, r] of Object.entries(derived.reviews)) {
    const item = courseData.itemById.get(itemId);
    if (!item || !r.dueDay || r.dueDay > today) continue;
    out.push({ item: itemId, concept: item.concept, type: item.type, dueDay: r.dueDay, overdueDays: daysBetween(r.dueDay, today) });
  }
  out.sort(
    (a, b) =>
      (a.dueDay < b.dueDay ? -1 : a.dueDay > b.dueDay ? 1 : 0) ||
      (order.get(a.concept) ?? 1e9) - (order.get(b.concept) ?? 1e9) ||
      (a.item < b.item ? -1 : a.item > b.item ? 1 : 0)
  );
  return out;
}

export function nextReviewDay(derived, today) {
  let best = null;
  for (const r of Object.values(derived.reviews)) {
    if (r.dueDay && r.dueDay > today && (!best || r.dueDay < best)) best = r.dueDay;
  }
  return best;
}

export function frontier(courseData, derived) {
  const order = topoOrder(courseData.concepts);
  return order.filter((id) => {
    const c = courseData.conceptById.get(id);
    if (!c || derived.mastery[id]?.mastered) return false;
    return (c.prerequisites ?? []).every((p) => derived.mastery[p]?.mastered);
  });
}

// An exercise is unlocked when every prerequisite of every concept it practises
// is mastered, and every earlier exercise on the track has passed.
export function exerciseUnlocked(courseData, derived, exId) {
  const ex = courseData.exercises.get(exId);
  if (!ex) return false;
  for (const cid of ex.concepts ?? []) {
    const c = courseData.conceptById.get(cid);
    if (!c) return false;
    if (!(c.prerequisites ?? []).every((p) => derived.mastery[p]?.mastered)) return false;
  }
  const idx = courseData.track.indexOf(exId);
  for (const earlier of courseData.track.slice(0, Math.max(0, idx))) {
    if (!derived.exercises[earlier]?.passed) return false;
  }
  // The capstone is the last step: every concept it does not practise must be mastered first.
  if (ex.capstone) {
    const own = new Set(ex.concepts ?? []);
    for (const c of courseData.concepts) {
      if (!own.has(c.id) && !derived.mastery[c.id]?.mastered) return false;
    }
  }
  return true;
}

function exercisesFor(courseData, conceptId) {
  return courseData.track.filter((id) => (courseData.exercises.get(id)?.concepts ?? []).includes(conceptId));
}

export function itemView(item, { withAnswer = false } = {}) {
  if (!item) return null;
  const v = { id: item.id, concept: item.concept, type: item.type, difficulty: item.difficulty ?? 3, prompt: item.prompt };
  if (item.type === 'mcq') v.options = item.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o.text}`);
  if (item.type === 'numeric' && item.unit) v.unit = item.unit;
  if (item.type === 'code') v.exercise = item.exercise;
  if (item.source) v.source = item.source;
  if (withAnswer) {
    if (item.type === 'mcq') v.answer = String.fromCharCode(65 + item.answer);
    if (item.type === 'numeric') {
      v.answer = item.answer;
      v.tolerance = item.tolerance ?? 0;
    }
    if (item.rubric) v.rubric = item.rubric;
    if (item.modelAnswer) v.modelAnswer = item.modelAnswer;
  }
  return v;
}

export function planNext(courseData, derived, today) {
  const due = dueReviews(courseData, derived, today);
  const front = frontier(courseData, derived);
  const base = { today, dueReviews: due, frontier: front, nextReviewDay: nextReviewDay(derived, today) };
  const conceptName = (id) => courseData.conceptById.get(id)?.name ?? id;
  const sourcesOf = (id) => courseData.conceptById.get(id)?.sources ?? [];

  if (due.length) {
    const first = due[0];
    return {
      ...base,
      kind: 'review',
      activity: 'review',
      concept: first.concept,
      conceptName: conceptName(first.concept),
      sources: sourcesOf(first.concept),
      item: itemView(courseData.itemById.get(first.item)),
      reason: `${due.length} review${due.length === 1 ? '' : 's'} due today; reviews come before new material.`
    };
  }

  // Rebuild what was just learned: the first unpassed track exercise whose
  // concepts are all mastered (and which is unlocked) comes before new material.
  const ready = courseData.track.find(
    (id) =>
      !derived.exercises[id]?.passed &&
      exerciseUnlocked(courseData, derived, id) &&
      (courseData.exercises.get(id)?.concepts ?? []).every((c) => derived.mastery[c]?.mastered)
  );
  if (ready && front.length) {
    return {
      ...base,
      kind: 'exercise',
      activity: 'exercise',
      concept: null,
      exercise: exerciseView(courseData, ready),
      reason: 'The concepts behind this exercise are mastered: rebuild them in code before moving on.'
    };
  }

  if (front.length) {
    const cid = front[0];
    const m = derived.mastery[cid];
    const tbItems = courseData.itemList.filter((i) => i.concept === cid && i.type === 'teachback');
    const exs = exercisesFor(courseData, cid).filter((id) => !derived.exercises[id]?.passed);
    let activity;
    let item = null;
    let exercise = null;
    let reason;
    if (m.attempts === 0) {
      activity = 'socratic';
      item = pickItem(courseData, derived, cid, { types: ['mcq', 'numeric', 'short'] }) ?? pickItem(courseData, derived, cid);
      reason = 'New concept: open with a Socratic question before any explanation, then use the suggested item.';
    } else if (m.pL < ACTIVITY_THRESHOLDS.practiceBelow) {
      activity = 'item';
      item = pickItem(courseData, derived, cid, { types: ['mcq', 'numeric', 'short'] }) ?? pickItem(courseData, derived, cid);
      reason = `Mastery estimate ${Math.round(m.pL * 100)}% is below ${Math.round(ACTIVITY_THRESHOLDS.practiceBelow * 100)}%: keep practising with questions.`;
    } else if (tbItems.length && !m.teachbackPassed) {
      activity = 'teachback';
      item = pickItem(courseData, derived, cid, { types: ['teachback'] });
      reason = 'Close to mastery: ask the learner to teach the idea back in their own words.';
    } else if (exs.length && exerciseUnlocked(courseData, derived, exs[0])) {
      activity = 'exercise';
      exercise = exs[0];
      reason = 'Understanding looks solid: rebuild it in code.';
    } else {
      activity = 'item';
      item = pickItem(courseData, derived, cid);
      reason = 'One more piece of evidence is needed before this concept counts as mastered.';
    }
    return {
      ...base,
      kind: 'learn',
      activity,
      concept: cid,
      conceptName: conceptName(cid),
      sources: sourcesOf(cid),
      mastery: m.pL,
      item: itemView(item),
      exercise: exercise ? exerciseView(courseData, exercise) : null,
      reason
    };
  }

  const pending = courseData.track.filter((id) => !derived.exercises[id]?.passed);
  if (pending.length) {
    const ex = pending[0];
    return {
      ...base,
      kind: 'exercise',
      activity: 'exercise',
      concept: null,
      exercise: exerciseView(courseData, ex),
      reason: courseData.exercises.get(ex)?.capstone
        ? 'Every concept is mastered. Finish the capstone to rebuild the paper.'
        : 'Every concept is mastered. Continue the rebuild track.'
    };
  }

  const hasCapstone = Boolean(courseData.capstone);
  return {
    ...base,
    kind: hasCapstone ? 'rebuilt' : 'complete',
    activity: 'none',
    concept: null,
    reason: hasCapstone
      ? 'Every concept is mastered and the capstone passes. Reviews continue on their schedule.'
      : 'Every concept is mastered. Reviews continue on their schedule.'
  };
}

export function exerciseView(courseData, exId) {
  const ex = courseData.exercises.get(exId);
  if (!ex) return null;
  return {
    id: ex.id,
    title: ex.title,
    language: ex.language,
    capstone: Boolean(ex.capstone),
    concepts: ex.concepts ?? [],
    task: `exercises/${ex.folder}/TASK.md`,
    starter: `exercises/${ex.folder}/${ex.starter}`,
    workFile: `work/${ex.id}/${ex.starter}`
  };
}
