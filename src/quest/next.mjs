// next for repo courses. The original planner runs first and its order is kept:
// due reviews, then a track exercise that is ready, then the frontier concept.
// A quest whose prerequisites are met takes the place of new material (as a
// ready exercise does), never the place of a due review. A course without
// quests.json gets exactly the original plan.
import { planNext } from '../model/next.mjs';
import { questContext as loadContext, questSummary } from './state.mjs';

export function questContext(courseData) {
  return loadContext(courseData);
}

export function questView(q) {
  return {
    id: q.id,
    kind: q.kind,
    title: q.title,
    prompt: q.prompt ?? null,
    capstone: Boolean(q.capstone),
    prerequisites: q.prerequisites,
    ...(q.verification ? { command: q.verification.command, timeoutSec: q.verification.timeoutSec ?? 20 } : {}),
    ...(q.workspace ? { allowedPaths: q.workspace.allowedPaths } : {}),
    ...(q.acceptance?.kind === 'item' ? { item: q.acceptance.item } : {}),
    ...(q.requiresTeachback ? { teachbackItem: q.teachbackItem } : {})
  };
}

export function planWithQuests(courseData, derived, today, ctx) {
  const plan = planNext(courseData, derived, today);
  if (!ctx) return plan;
  const summary = questSummary(ctx, derived);
  const source = { status: ctx.source.status, changed: ctx.source.changed.map((c) => c.path), suspendedConcepts: [...ctx.suspended.concepts].sort(), suspendedQuests: [...ctx.suspended.quests].sort() };
  const extra = { quests: summary, source };
  if (source.status === 'source_stale') extra.sourceWarning = `The source changed in ${source.changed.join(', ')}. Claims citing those files are suspended until "teachback repo rebase" is reviewed and applied; other progress is unaffected.`;
  if (plan.kind === 'learn' && ctx.suspended.concepts.has(plan.concept)) extra.conceptSuspended = true;
  if (ctx.review?.length) extra.sourceReview = { count: ctx.review.length, file: 'source-review.json', note: 'A rebase moved or flagged evidence. Re-check those claims and items before teaching from them.' };
  if (plan.kind === 'review' || plan.kind === 'exercise') return { ...plan, ...extra };
  const ready = summary.find((s) => s.ready);
  if (ready) {
    const q = ctx.quests.find((x) => x.id === ready.id);
    const reason =
      ready.status === 'needs_teachback'
        ? 'The quest tests pass. Ask for the teach-back of the patch before it counts.'
        : plan.kind === 'learn'
          ? 'The concepts this quest needs are mastered: do it before new material.'
          : 'Every concept is mastered. Continue the quests.';
    return { ...plan, ...extra, kind: 'quest', activity: 'quest', concept: null, conceptName: undefined, item: ready.status === 'needs_teachback' ? { id: q.teachbackItem } : null, quest: { ...questView(q), status: ready.status }, reason };
  }
  if ((plan.kind === 'complete' || plan.kind === 'rebuilt') && summary.length) {
    const open = summary.filter((s) => s.status !== 'passed');
    if (!open.length && source.status === 'current') {
      return { ...plan, ...extra, kind: 'rehearsed', activity: 'none', reason: 'Every concept is mastered and every quest passes on the current source, teach-backs included. This is a local rehearsal, not a merged contribution. Reviews continue on their schedule.' };
    }
    if (open.length) return { ...plan, ...extra, kind: 'quests-blocked', activity: 'none', reason: `Every concept is mastered, but ${open.length} quest${open.length === 1 ? ' is' : 's are'} not passed and none is ready: ${open.map((o) => `${o.id} (${o.status})`).join(', ')}.` };
  }
  return { ...plan, ...extra };
}

// For status and the dashboard of a repo course: the quest checklist, the
// source state, and the quest-aware next step. Paper courses get nothing added.
export function addRepoQuestStatus(courseData, derived, today, s) {
  const ctx = questContext(courseData);
  if (!ctx) return s;
  const plan = planWithQuests(courseData, derived, today, ctx);
  const ref = ctx.source.lock?.repo.ref;
  s.repoQuest = {
    source: { status: ctx.source.status, changed: ctx.source.changed.map((c) => c.path) },
    lock: ref ? (ref.kind === 'git' ? `at commit ${ref.sha.slice(0, 12)}` : `by content digest ${ref.digest.slice(7, 19)}`) : 'nowhere (no valid lock)',
    quests: plan.quests,
    rehearsed: plan.kind === 'rehearsed'
  };
  if (['quest', 'rehearsed', 'quests-blocked'].includes(plan.kind)) s.next = { ...s.next, kind: plan.kind, activity: plan.activity, quest: plan.quest?.id ?? null, questTitle: plan.quest?.title ?? null, reason: plan.reason };
  return s;
}
