// One status object, shared by `status --json` and the dashboard, so the
// numbers on the page are the numbers the CLI reports.
import { dayKey, addDays, round, masteryPercent } from './util.mjs';
import { replay } from './model/learner.mjs';
import { calibration } from './model/calibration.mjs';
import { planNext, dueReviews, nextReviewDay } from './model/next.mjs';
import { layers, topoOrder } from './graph.mjs';

export function conceptState(m) {
  if (!m || m.attempts === 0) return m?.mastered ? 'mastered' : 'not-started';
  if (m.mastered) return 'mastered';
  if (m.pL >= 0.6) return 'almost';
  return 'learning';
}

export const STATE_LABEL = { 'not-started': 'Not started', learning: 'Learning', almost: 'Almost there', mastered: 'Mastered' };

export function computeStatus(courseData, learner, now) {
  const derived = replay(courseData, learner);
  const offset = learner.settings?.utcOffsetMinutes ?? 0;
  const today = dayKey(now, offset);
  const depth = layers(courseData.concepts);
  const order = topoOrder(courseData.concepts);
  const cal = calibration(derived.answers);

  const conceptList = order.map((id) => {
    const k = courseData.conceptById.get(id);
    const m = derived.mastery[id];
    return {
      id,
      name: k.name,
      layer: depth[id],
      prerequisites: k.prerequisites ?? [],
      sources: (k.sources ?? []).map((s) => s.section),
      pL: round(m.pL, 4),
      mastered: m.mastered,
      state: conceptState(m),
      attempts: m.attempts,
      correct: m.correct,
      partial: m.partial,
      wrong: m.wrong,
      teachbackPassed: m.teachbackPassed,
      firstMasteredAt: m.firstMasteredAt ?? null,
      calibration: cal.byConcept[id] ?? null
    };
  });
  const total = conceptList.length;
  const mastered = conceptList.filter((c) => c.mastered).length;
  const notStarted = conceptList.filter((c) => c.state === 'not-started').length;
  const meanMastery = total ? round(conceptList.reduce((s, c) => s + c.pL, 0) / total, 4) : 0;
  // For the end-of-session summary: concepts that became mastered today and still are.
  const masteredToday = conceptList.filter((c) => c.mastered && c.firstMasteredAt && dayKey(c.firstMasteredAt, offset) === today).map((c) => c.id);

  const due = dueReviews(courseData, derived, today);
  const upcoming = [];
  for (let i = 1; i <= 14; i++) {
    const day = addDays(today, i);
    const count = Object.values(derived.reviews).filter((r) => r.dueDay === day).length;
    upcoming.push({ day, count });
  }
  const scheduled = Object.values(derived.reviews).filter((r) => r.dueDay).length;

  const exList = courseData.track
    .filter((id) => courseData.exercises.has(id))
    .map((id) => {
      const x = courseData.exercises.get(id);
      const e = derived.exercises[id];
      let status = 'not-started';
      if (e.passed) status = 'passed';
      else if (e.runs > 0) status = e.lastStatus === 'timeout' ? 'timeout' : 'failing';
      return {
        id,
        title: x.title,
        language: x.language,
        capstone: Boolean(x.capstone),
        concepts: x.concepts ?? [],
        status,
        runs: e.runs,
        lastPassed: e.lastPassed,
        lastTotal: e.lastTotal,
        firstPassedAt: e.firstPassedAt
      };
    });
  const capstone = courseData.capstone;
  const capstonePassed = Boolean(capstone && derived.exercises[capstone]?.passed);
  const allMastered = total > 0 && mastered === total;
  const rebuilt = Boolean(derived.rebuiltAt);
  // Only events replay could use (a hand-edited record may hold broken ones; replay warns).
  const events = (learner.events ?? []).filter((e) => e && typeof e.t === 'string' && !Number.isNaN(Date.parse(e.t)));
  const answerEvents = events.filter((e) => e.type === 'answer');
  const days = new Set(events.map((e) => dayKey(e.t, offset)));
  const plan = planNext(courseData, derived, today);

  return {
    course: {
      slug: courseData.slug,
      title: courseData.course.title,
      source: courseData.course.source ?? {},
      licence: courseData.course.licence ?? ''
    },
    generatedAt: now.toISOString(),
    today,
    masteryThreshold: derived.params.bkt.masteryThreshold,
    concepts: { total, mastered, notStarted, inProgress: total - mastered - notStarted, meanMastery, masteredToday },
    conceptList,
    reviews: { dueToday: due.length, due: due.slice(0, 20), nextReviewDay: nextReviewDay(derived, today), upcoming, scheduled },
    exercises: { total: exList.length, passed: exList.filter((e) => e.status === 'passed').length, list: exList },
    calibration: cal,
    history: derived.history,
    activity: { answers: answerEvents.length, runs: events.filter((e) => e.type === 'run').length, daysActive: days.size },
    capstone,
    capstonePassed,
    allMastered,
    rebuilt,
    rebuiltAt: derived.rebuiltAt,
    complete: rebuilt || (!capstone && allMastered),
    next: { kind: plan.kind, activity: plan.activity, concept: plan.concept, conceptName: plan.conceptName ?? null, item: plan.item?.id ?? null, exercise: plan.exercise?.id ?? null, reason: plan.reason },
    warnings: derived.warnings
  };
}

export function formatStatus(s) {
  const lines = [];
  lines.push(`${s.course.title}`);
  if (s.course.source?.url || s.course.source?.citation) lines.push(`Source: ${s.course.source.citation ?? s.course.source.url}`);
  lines.push('');
  lines.push(`Concepts mastered   ${s.concepts.mastered}/${s.concepts.total}   (mean mastery estimate ${Math.round(s.concepts.meanMastery * 100)}%)`);
  if (s.concepts.masteredToday.length) lines.push(`Mastered today      ${s.concepts.masteredToday.map((id) => s.conceptList.find((c) => c.id === id).name).join('; ')}`);
  lines.push(`Reviews due today   ${s.reviews.dueToday}${s.reviews.nextReviewDay ? `   (next after today: ${s.reviews.nextReviewDay})` : ''}`);
  lines.push(`Exercises passed    ${s.exercises.passed}/${s.exercises.total}${s.capstone ? `   (capstone: ${s.capstonePassed ? 'passed' : 'not yet'})` : ''}`);
  const o = s.calibration.overall;
  lines.push(`Calibration         ${o.label}${o.n ? ` (${o.n} rated answers, confidence ${Math.round(o.meanConfidence * 100)}% vs accuracy ${Math.round(o.accuracy * 100)}%)` : ''}`);
  lines.push(`Activity            ${s.activity.answers} answer${s.activity.answers === 1 ? '' : 's'}, ${s.activity.runs} exercise run${s.activity.runs === 1 ? '' : 's'}, ${s.activity.daysActive} day${s.activity.daysActive === 1 ? '' : 's'} active`);
  if (s.rebuilt) lines.push(`\nRebuilt on ${s.rebuiltAt.slice(0, 10)}: every concept mastered and the capstone passes.`);
  lines.push('');
  lines.push('Concepts');
  for (const c of s.conceptList) {
    const bar = '#'.repeat(Math.round(c.pL * 10)).padEnd(10, '.');
    lines.push(`  [${bar}] ${String(masteryPercent(c.pL, c.mastered, s.masteryThreshold)).padStart(3)}%  ${c.name}${c.mastered ? '  (mastered)' : ''}`);
  }
  lines.push('');
  lines.push(`Next: ${s.next.reason}`);
  for (const w of s.warnings) lines.push(`warning: ${w}`);
  return lines.join('\n');
}
