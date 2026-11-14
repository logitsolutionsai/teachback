// repo verify: are the course's source references still true of the locked
// source? Reads files and hashes them; runs nothing from the repository.
//
// For each sourceRef: the file id is in the lock, the file is text, its current
// hash equals the locked hash, the line range is inside the file, the needle
// (when given) appears in those lines, and the symbol (when given) is in the
// repo map and overlaps the range. A ref that cannot be proven is reported; it
// is never fixed or added silently.
import path from 'node:path';
import { readJson } from '../util.mjs';
import { loadCourse } from '../course.mjs';
import { checkStatic } from '../check.mjs';
import { validateFile } from '../schema.mjs';
import { loadLock, compareFiles, repoRootFor, MAP_FILE } from './source-lock.mjs';
import { loadQuests, checkQuests } from '../quest/schema.mjs';
import * as git from './git.mjs';

export const MAX_NEEDLE = 200;

// Every sourceRef in the course, with where it came from.
// loc: the file and JSON path of the ref, so a rebase can rewrite exactly it.
export function collectRefs(courseData, questsDoc) {
  const refs = [];
  courseData.concepts.forEach((c, ci) => {
    (c.sourceRefs ?? []).forEach((r, i) => refs.push({ owner: { type: 'concept', id: c.id }, where: `map.json concept ${c.id} sourceRefs[${i}]`, loc: { file: 'map.json', path: ['concepts', ci, 'sourceRefs', i] }, ref: r }));
    (c.misconceptions ?? []).forEach((m, mi) => (m.sourceRefs ?? []).forEach((r, i) => refs.push({ owner: { type: 'misconception', id: `${c.id}/${m.id}`, concept: c.id }, where: `map.json concept ${c.id} misconception ${m.id} sourceRefs[${i}]`, loc: { file: 'map.json', path: ['concepts', ci, 'misconceptions', mi, 'sourceRefs', i] }, ref: r })));
  });
  courseData.itemList.forEach((it, ii) => (it.sourceRefs ?? []).forEach((r, i) => refs.push({ owner: { type: 'item', id: it.id, concept: it.concept }, where: `items.json ${it.id} sourceRefs[${i}]`, loc: { file: 'items.json', path: ['items', ii, 'sourceRefs', i] }, ref: r })));
  (questsDoc?.quests ?? []).forEach((q, qi) => (q.sourceRefs ?? []).forEach((r, i) => refs.push({ owner: { type: 'quest', id: q.id }, where: `quests.json ${q.id} sourceRefs[${i}]`, loc: { file: 'quests.json', path: ['quests', qi, 'sourceRefs', i] }, ref: r })));
  return refs;
}

function linesOf(text, start, end) {
  return text.split('\n').slice(start - 1, end).join('\n');
}

// One ref against one file's current content. Returns { status, code?, message?, hint? }.
export function checkRef(ref, lockFile, cmp, symbolById) {
  if (!lockFile) return { status: 'unverified_ref', code: 'R010', message: `File id "${ref.fileId}" is not in the source lock.`, hint: 'Use a file id from source-lock.json; "teachback repo scan" lists them.' };
  if (lockFile.binary) return { status: 'unverified_ref', code: 'R011', message: `${lockFile.path} is a binary or unreadable file; line references into it cannot be checked.`, hint: 'Point at a text file.' };
  if (!cmp || cmp.status === 'missing') return { status: 'source_stale', code: 'R020', message: `${lockFile.path} is missing from the checkout.`, hint: 'Run "teachback repo rebase <course> --dry-run" to see what moved.' };
  if (cmp.status === 'changed') return { status: 'source_stale', code: 'R021', message: `${lockFile.path} changed since the lock was made.`, hint: 'Its claims are suspended. Run "teachback repo rebase <course> --dry-run", review the proposal, then apply it.' };
  if (ref.endLine < ref.startLine) return { status: 'unverified_ref', code: 'R012', message: `Lines ${ref.startLine}-${ref.endLine} run backwards.`, hint: 'startLine must not be after endLine.' };
  if (ref.endLine > lockFile.lineCount) return { status: 'unverified_ref', code: 'R012', message: `Lines ${ref.startLine}-${ref.endLine} are outside ${lockFile.path}, which has ${lockFile.lineCount} lines.`, hint: 'Fix the line range.' };
  if (ref.needle !== undefined) {
    if (ref.needle.length > MAX_NEEDLE) return { status: 'unverified_ref', code: 'R015', message: `The needle is ${ref.needle.length} characters long.`, hint: `Quote at most ${MAX_NEEDLE} characters: an identifier or a few words, not a passage.` };
    if (!linesOf(cmp.current.text, ref.startLine, ref.endLine).includes(ref.needle)) return { status: 'unverified_ref', code: 'R013', message: `"${ref.needle}" does not appear in ${lockFile.path} lines ${ref.startLine}-${ref.endLine}.`, hint: 'Fix the needle or the line range so the quoted text is really there.' };
  }
  if (ref.symbolId !== undefined) {
    const s = symbolById.get(ref.symbolId);
    if (!s) return { status: 'unverified_ref', code: 'R014', message: `Symbol "${ref.symbolId}" is not in repo-map.json.`, hint: 'Use a symbol id from repo-map.json.' };
    if (s.fileId !== ref.fileId) return { status: 'unverified_ref', code: 'R014', message: `Symbol "${s.id}" is in "${s.fileId}", not "${ref.fileId}".`, hint: 'Point the ref at the file that holds the symbol.' };
    const end = s.endLine ?? s.startLine;
    if (ref.endLine < s.startLine || ref.startLine > end) return { status: 'unverified_ref', code: 'R014', message: `Symbol "${s.id}" (lines ${s.startLine}-${end}) is outside lines ${ref.startLine}-${ref.endLine}.`, hint: 'Make the range cover the symbol.' };
  }
  if (ref.needle === undefined && ref.symbolId === undefined && ref.evidenceKind !== 'inferred') {
    return { status: 'unverified_ref', code: 'R016', message: 'This ref names lines but nothing that can be checked in them.', hint: 'Add a needle or a symbolId, or mark it "evidenceKind": "inferred" if it is a teaching inference.' };
  }
  return { status: ref.evidenceKind === 'inferred' ? 'inferred' : 'verified' };
}

export function verifyCourse(courseDir, { repo } = {}) {
  const problems = [];
  const add = (p) => problems.push(p);
  const lock = loadLock(courseDir);
  const repoRoot = repoRootFor(courseDir, repo);
  const courseData = loadCourse(courseDir);
  const questsDoc = loadQuests(courseDir);
  const repoMap = readJson(path.join(courseDir, MAP_FILE));
  if (!repoMap) add({ level: 'error', kind: 'invalid', code: 'R030', file: MAP_FILE, message: 'repo-map.json is missing.', hint: 'Run "teachback repo init --force" to re-create it from the lock.' });
  else {
    for (const e of validateFile(repoMap, 'repo-map.v1')) add({ level: 'error', kind: 'invalid', code: 'R031', file: MAP_FILE, message: `${e.path} ${e.message}.`, hint: 'Re-create it with "teachback repo init --force".' });
    if (repoMap.sourceManifestDigest !== lock.manifestDigest) add({ level: 'error', kind: 'invalid', code: 'R032', file: MAP_FILE, message: 'repo-map.json belongs to a different source lock.', hint: 'Re-create it with "teachback repo init --force".' });
  }

  // Pedagogical structure: the original static check (no exercises are run).
  const stat = checkStatic(courseDir);
  for (const p of stat.problems) add({ ...p, kind: p.level === 'error' ? 'invalid' : 'warning' });
  for (const p of checkQuests(courseData, questsDoc, { lock, repoMap })) add({ ...p, kind: p.level === 'error' ? 'invalid' : 'warning' });

  // Git provenance, when the lock is a commit and git can be asked.
  let head = null;
  if (lock.repo.ref.kind === 'git') {
    if (git.isGitRoot(repoRoot)) {
      const r = git.resolveRef(repoRoot, 'HEAD');
      head = r.ok ? r.sha : null;
      if (r.ok && r.sha !== lock.repo.ref.sha) add({ level: 'warning', kind: 'ref_moved', code: 'R040', file: 'source-lock.json', message: `The checkout is at ${r.sha.slice(0, 12)}, the lock at ${lock.repo.ref.sha.slice(0, 12)}. Files with unchanged hashes keep their refs.`, hint: 'Run "teachback repo rebase <course> --to HEAD --dry-run" to move the lock forward.' });
      if (!r.ok) add({ level: 'warning', kind: 'ref_unknown', code: 'R041', file: 'source-lock.json', message: `Could not read the checkout's commit: ${r.error}`, hint: 'File hashes were still compared.' });
    } else add({ level: 'warning', kind: 'ref_unknown', code: 'R041', file: 'source-lock.json', message: 'The lock names a git commit, but this checkout has no .git, so only file hashes were compared.', hint: 'That is enough for refs; the commit itself was not confirmed.' });
  }

  const cmp = compareFiles(lock, repoRoot);
  const fileById = new Map(lock.files.map((f) => [f.id, f]));
  const symbolById = new Map((repoMap?.symbols ?? []).map((s) => [s.id, s]));
  const refs = collectRefs(courseData, questsDoc);
  const counts = { total: refs.length, verified: 0, inferred: 0, source_stale: 0, unverified_ref: 0 };
  const results = [];
  const staleOwners = new Set();
  for (const r of refs) {
    const res = checkRef(r.ref, fileById.get(r.ref.fileId), cmp.get(r.ref.fileId), symbolById);
    counts[res.status] += 1;
    results.push({ where: r.where, owner: r.owner, fileId: r.ref.fileId, path: fileById.get(r.ref.fileId)?.path ?? null, lines: [r.ref.startLine, r.ref.endLine], status: res.status, ...(res.code ? { code: res.code, message: res.message, hint: res.hint } : {}) });
    if (res.status === 'source_stale') staleOwners.add(`${r.owner.type}:${r.owner.id}`);
    if (res.code) add({ level: 'error', kind: res.status, code: res.code, file: r.where.split(' ')[0], where: r.where, path: fileById.get(r.ref.fileId)?.path, message: res.message, hint: res.hint });
  }
  // Every concept in a repo course carries at least one ref.
  for (const c of courseData.concepts) {
    if (!(c.sourceRefs ?? []).length) add({ level: 'error', kind: 'unverified_ref', code: 'R001', file: 'map.json', where: `concept ${c.id}`, message: `Concept "${c.id}" has no sourceRefs.`, hint: 'Every claim in a repo course points at the lines it comes from; mark a teaching inference with "evidenceKind": "inferred".' });
  }
  // Scan-level facts carried by the lock and the map.
  if (!lock.complete) add({ level: 'warning', kind: 'partial_scan', code: 'R050', file: 'source-lock.json', message: 'The lock was made from an incomplete scan.', hint: 'Re-create it with a narrower --scope.' });
  if (!lock.license.detectedSpdx) add({ level: 'warning', kind: 'no_license_detected', code: 'R051', file: 'source-lock.json', path: lock.license.files[0] ?? null, message: 'No licence was recognised in the repository.', hint: 'Check the licence yourself before sharing anything derived from this repository.' });
  for (const w of repoMap?.warnings ?? []) if (w.kind === 'unsupported_language') add({ level: 'warning', kind: 'unsupported_language', code: 'R052', file: MAP_FILE, path: w.path, message: w.message, hint: 'Refs into this file can still be checked by needle and lines.' });
  const changedFiles = lock.files.filter((f) => cmp.get(f.id)?.status !== 'match').map((f) => ({ id: f.id, path: f.path, status: cmp.get(f.id)?.status }));

  const errors = problems.filter((p) => p.level === 'error');
  const invalid = errors.some((p) => p.kind === 'invalid');
  const stale = errors.some((p) => p.kind === 'source_stale');
  const unverified = errors.some((p) => p.kind === 'unverified_ref');
  const status = invalid ? 'invalid' : stale ? 'source_stale' : unverified ? 'unverified' : 'verified';
  return {
    ok: status === 'verified',
    status,
    exitCode: status === 'verified' ? 0 : invalid || stale ? 2 : 1,
    course: courseData.slug,
    lock: { manifestDigest: lock.manifestDigest, ref: lock.repo.ref, scope: lock.repo.scope, dirty: lock.repo.dirty, files: lock.files.length },
    checkoutHead: head,
    refs: counts,
    changedFiles,
    staleOwners: [...staleOwners].sort(),
    results,
    errors,
    warnings: problems.filter((p) => p.level === 'warning'),
    note: 'A verified ref proves the quoted text is in the locked file at those lines. It does not prove that a summary of it is correct.'
  };
}
