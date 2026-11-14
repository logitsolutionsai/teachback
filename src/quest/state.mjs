// Quest progress lives in quest-state.json, next to learner.json and as private
// as it. learner.json is not touched by RepoQuest: concepts and items keep
// their meaning, and quests are a separate record.
import path from 'node:path';
import { readJson, writeJsonAtomic, exists } from '../util.mjs';
import { loadQuests } from './schema.mjs';
import { loadLock, loadLocal, compareFiles, LOCK_FILE } from '../repo/source-lock.mjs';
import { collectRefs } from '../repo/verify.mjs';

export const STATE_FILE = 'quest-state.json';

export function loadQuestState(courseDir) {
  const s = readJson(path.join(courseDir, STATE_FILE));
  return s && typeof s === 'object' ? { schemaVersion: 1, quests: {}, ...s } : { schemaVersion: 1, quests: {} };
}

export function saveQuestState(courseDir, state) {
  writeJsonAtomic(path.join(courseDir, STATE_FILE), state);
}

export function isRepoCourse(courseData) {
  return exists(path.join(courseData.dir, LOCK_FILE)) || ['repo-quest', 'review'].includes(courseData.course.kind);
}

// Compare the locked files with the checkout, without throwing: next and the
// dashboard must work when the checkout is not reachable.
export function sourceState(courseData) {
  let lock;
  try {
    lock = loadLock(courseData.dir);
  } catch (err) {
    return { status: 'invalid', message: err.message, changed: [], lock: null };
  }
  const local = loadLocal(courseData.dir);
  if (!local?.repoPath || !exists(local.repoPath)) return { status: 'unknown', message: 'The repository checkout is not available on this machine.', changed: [], lock };
  const cmp = compareFiles(lock, local.repoPath);
  const changed = lock.files.filter((f) => cmp.get(f.id).status !== 'match').map((f) => ({ id: f.id, path: f.path, status: cmp.get(f.id).status }));
  return { status: changed.length ? 'source_stale' : 'current', changed, lock, repoPath: local.repoPath, trust: local.trust ?? 'untrusted' };
}

// Which concepts, items and quests cite a changed file.
export function suspendedOwners(courseData, questsDoc, changed) {
  const ids = new Set(changed.map((c) => c.id));
  const out = { concepts: new Set(), items: new Set(), quests: new Set() };
  for (const r of collectRefs(courseData, questsDoc)) {
    if (!ids.has(r.ref.fileId)) continue;
    if (r.owner.type === 'concept' || r.owner.type === 'misconception') out.concepts.add(r.owner.concept ?? r.owner.id);
    if (r.owner.type === 'item') out.items.add(r.owner.id);
    if (r.owner.type === 'quest') out.quests.add(r.owner.id);
  }
  return out;
}

export function questContext(courseData) {
  if (!isRepoCourse(courseData)) return null;
  const questsDoc = loadQuests(courseData.dir);
  if (!questsDoc || questsDoc._error || !Array.isArray(questsDoc.quests)) return null;
  const source = sourceState(courseData);
  const review = readJson(path.join(courseData.dir, 'source-review.json'))?.items ?? [];
  return { questsDoc, quests: questsDoc.quests, state: loadQuestState(courseData.dir), source, suspended: suspendedOwners(courseData, questsDoc, source.changed), review };
}

// The patch teach-back counts only when it was recorded after the passing run:
// explaining the item before the patch existed is not an explanation of the patch.
export function teachbackDone(q, derived, passedAt) {
  if (!q.requiresTeachback) return true;
  const r = derived.reviews[q.teachbackItem];
  if (!(r?.lastResult === 'correct' || r?.lastResult === 'partial')) return false;
  return !passedAt || Date.parse(r.lastSeen) >= Date.parse(passedAt);
}

// One quest's status: passed, failed, blocked, not_run, attempted, needs_teachback or suspended.
export function questStatus(q, ctx, derived) {
  if (ctx.suspended.quests.has(q.id)) return 'suspended';
  const rec = ctx.state.quests[q.id];
  if (q.acceptance?.kind === 'item') {
    const r = derived.reviews[q.acceptance.item];
    if (!r) return 'not_run';
    return r.lastResult === 'correct' ? 'passed' : 'attempted';
  }
  if (!rec) return 'not_run';
  if (q.acceptance?.kind === 'tests') {
    const lockDigest = ctx.source.lock?.manifestDigest;
    if (rec.status === 'passed' && rec.record?.sourceManifestDigest !== lockDigest) return 'not_run';
    if (rec.status === 'passed' && !teachbackDone(q, derived, rec.record?.at)) return 'needs_teachback';
  }
  return rec.status;
}

export function prerequisitesMet(q, ctx, derived, statuses) {
  return q.prerequisites.every((p) => (derived.mastery[p] ? derived.mastery[p].mastered : statuses[p] === 'passed'));
}

export function questSummary(ctx, derived) {
  const statuses = {};
  // Quests may depend on quests; resolve in file order, then once more for forward references.
  for (let pass = 0; pass < 2; pass++) for (const q of ctx.quests) statuses[q.id] = questStatus(q, ctx, derived);
  return ctx.quests.map((q) => ({ id: q.id, kind: q.kind, title: q.title, capstone: Boolean(q.capstone), status: statuses[q.id], ready: statuses[q.id] !== 'passed' && statuses[q.id] !== 'suspended' && prerequisitesMet(q, ctx, derived, statuses) }));
}
