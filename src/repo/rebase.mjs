// repo rebase: after the source changed, propose how each source ref moves,
// then apply only what the user confirms. Nothing is rewritten silently.
//
//   unchanged  the file has the same hash (maybe at a new commit): the ref is kept
//   moved      the file is gone from its path but the same content is elsewhere
//   relocate   the file changed; the ref's symbol (by name) or needle is found
//              exactly once, and the range is moved to it
//   needs_review  the needle appears several times, or the ref has nothing to find
//   broken     the needle or symbol is gone from the file
//   deleted    the file is gone and its content is nowhere else
//
// Applying needs --apply <proposal> --confirm, checks the proposal still
// matches both the current lock and the current source, rewrites the refs it
// can, writes the new lock and repo map, logs the migration, and lists every
// concept, item and quest whose evidence changed for review. learner.json is
// never touched.
import fs from 'node:fs';
import path from 'node:path';
import { TeachbackError, readJson, writeJsonAtomic, resolveNow } from '../util.mjs';
import { loadCourse } from '../course.mjs';
import { scanRepo, repoMapOf, digestOf } from './scan.mjs';
import { loadLock, buildLock, repoRootFor, LOCK_FILE, MAP_FILE } from './source-lock.mjs';
import { collectRefs, verifyCourse } from './verify.mjs';
import { loadQuests, QUESTS_FILE } from '../quest/schema.mjs';

export const REVIEW_FILE = 'source-review.json';
export const LOG_FILE = 'migrations.jsonl';

function rescan(lock, repoRoot, to) {
  const scan = scanRepo(repoRoot, { scope: lock.repo.scope === '.' ? undefined : lock.repo.scope, include: lock.ignore?.include ?? [], exclude: lock.ignore?.exclude ?? [], useGit: to !== 'worktree' });
  if (!scan.complete) throw new TeachbackError('E720', 'The new scan is incomplete, so no proposal can be made.', 'Narrow the scope of the course, then try again.', 2);
  const newLock = buildLock(scan, { name: lock.repo.name, publicUrl: lock.repo.publicUrl, allowDirty: true, include: lock.ignore?.include ?? [], exclude: lock.ignore?.exclude ?? [] });
  return { scan, newLock, newMap: repoMapOf(scan, newLock.manifestDigest) };
}

function occurrences(text, needle) {
  const lines = text.split('\n');
  const hits = [];
  lines.forEach((l, i) => {
    if (l.includes(needle)) hits.push(i + 1);
  });
  // A needle may span lines; count those too.
  if (!hits.length && needle.includes('\n')) {
    let at = text.indexOf(needle);
    while (at >= 0) {
      hits.push(text.slice(0, at).split('\n').length);
      at = text.indexOf(needle, at + 1);
    }
  }
  return hits;
}

export function proposeRebase(courseDir, { repo, to = 'HEAD', now }) {
  const lock = loadLock(courseDir);
  const repoRoot = repoRootFor(courseDir, repo);
  const courseData = loadCourse(courseDir);
  const questsDoc = loadQuests(courseDir);
  const oldMap = readJson(path.join(courseDir, MAP_FILE)) ?? { symbols: [] };
  const { scan, newLock, newMap } = rescan(lock, repoRoot, to);
  const oldById = new Map(lock.files.map((f) => [f.id, f]));
  const newByPath = new Map(newLock.files.map((f) => [f.path, f]));
  const newByHash = new Map();
  for (const f of newLock.files) (newByHash.get(f.sha256) ?? newByHash.set(f.sha256, []).get(f.sha256)).push(f);
  const oldSym = new Map((oldMap.symbols ?? []).map((s) => [s.id, s]));
  const changes = [];
  for (const r of collectRefs(courseData, questsDoc)) {
    const ref = r.ref;
    const old = oldById.get(ref.fileId);
    const base = { where: r.where, owner: r.owner, loc: r.loc, old: { fileId: ref.fileId, path: old?.path ?? null, startLine: ref.startLine, endLine: ref.endLine } };
    if (!old) {
      changes.push({ ...base, status: 'broken', new: null, reason: 'The ref names a file id that was not in the old lock.' });
      continue;
    }
    const same = newByPath.get(old.path);
    if (same && same.sha256 === old.sha256) {
      changes.push({ ...base, status: 'unchanged', new: { fileId: same.id, path: same.path, startLine: ref.startLine, endLine: ref.endLine }, reason: 'Identical file hash: the evidence is the same text, even if the commit changed.' });
      continue;
    }
    if (!same) {
      const twins = newByHash.get(old.sha256) ?? [];
      if (twins.length === 1) changes.push({ ...base, status: 'moved', new: { fileId: twins[0].id, path: twins[0].path, startLine: ref.startLine, endLine: ref.endLine }, reason: `The same content is now at ${twins[0].path}.` });
      else if (twins.length > 1) changes.push({ ...base, status: 'needs_review', new: null, reason: `The same content is at ${twins.length} paths: ${twins.map((t) => t.path).join(', ')}.` });
      else changes.push({ ...base, status: 'deleted', new: null, reason: `${old.path} is gone and its content is not elsewhere in scope.` });
      continue;
    }
    // Changed in place.
    const text = scan.texts.get(same.id) ?? '';
    const len = ref.endLine - ref.startLine;
    if (ref.symbolId && oldSym.has(ref.symbolId)) {
      const name = oldSym.get(ref.symbolId).name;
      const cands = newMap.symbols.filter((s) => s.fileId === same.id && s.name === name);
      if (cands.length === 1) {
        const d = cands[0].startLine - oldSym.get(ref.symbolId).startLine;
        const nr = { fileId: same.id, path: same.path, startLine: ref.startLine + d, endLine: Math.min(ref.endLine + d, same.lineCount), symbolId: cands[0].id };
        const needleOk = !ref.needle || text.split('\n').slice(nr.startLine - 1, nr.endLine).join('\n').includes(ref.needle);
        const gone = !needleOk && occurrences(text, ref.needle).length === 0;
        changes.push({ ...base, status: needleOk ? 'relocate' : gone ? 'broken' : 'needs_review', new: needleOk ? nr : null, reason: needleOk ? `Symbol ${name} moved by ${d} line${Math.abs(d) === 1 ? '' : 's'}.` : gone ? `The needle is no longer in ${same.path}.` : `Symbol ${name} was found, but the needle is no longer in its lines.` });
        continue;
      }
      if (cands.length > 1) {
        changes.push({ ...base, status: 'needs_review', new: null, reason: `Symbol ${name} appears ${cands.length} times in ${same.path}.` });
        continue;
      }
      if (!ref.needle) {
        changes.push({ ...base, status: 'broken', new: null, reason: `Symbol ${name} is no longer in ${same.path}.` });
        continue;
      }
    }
    if (!ref.needle) {
      changes.push({ ...base, status: 'needs_review', new: null, reason: `${same.path} changed and this ref has no needle to find again.` });
      continue;
    }
    const hits = occurrences(text, ref.needle);
    if (hits.length === 1) {
      const L = hits[0];
      const d = L >= ref.startLine && L <= ref.endLine ? 0 : L < ref.startLine ? L - ref.startLine : L - ref.endLine;
      changes.push({ ...base, status: 'relocate', new: { fileId: same.id, path: same.path, startLine: Math.max(1, ref.startLine + d), endLine: Math.min(same.lineCount, ref.startLine + d + len) }, reason: d ? `The needle is now on line ${L}; the range moved by ${d}.` : 'The file changed but the needle is still inside the range.' });
    } else if (hits.length > 1) changes.push({ ...base, status: 'needs_review', new: null, reason: `The needle appears ${hits.length} times (lines ${hits.slice(0, 6).join(', ')}): which one is meant cannot be decided automatically.` });
    else changes.push({ ...base, status: 'broken', new: null, reason: `The needle is no longer in ${same.path}.` });
  }
  const summary = {};
  for (const c of changes) summary[c.status] = (summary[c.status] ?? 0) + 1;
  const proposal = {
    schemaVersion: 1,
    kind: 'teachback-rebase-proposal',
    course: courseData.slug,
    createdAt: now.toISOString(),
    from: { manifestDigest: lock.manifestDigest, ref: lock.repo.ref },
    to: { manifestDigest: newLock.manifestDigest, ref: newLock.repo.ref, dirty: newLock.repo.dirty },
    summary,
    changes,
    newLock,
    newRepoMap: newMap,
    note: 'A proposal only. Nothing changed. Apply with: teachback repo rebase <course> --apply <this file> --confirm'
  };
  proposal.proposalDigest = digestOf({ ...proposal, createdAt: undefined });
  return proposal;
}

function setAt(obj, p, value) {
  let o = obj;
  for (const k of p.slice(0, -1)) o = o[k];
  o[p.at(-1)] = value;
}
function getAt(obj, p) {
  return p.reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function applyRebase(courseDir, proposalFile, { repo, confirm, now }) {
  if (!confirm) throw new TeachbackError('E721', 'Applying a rebase proposal needs --confirm.', 'Read the proposal first; then run again with --apply <file> --confirm.', 2);
  const proposal = readJson(path.resolve(proposalFile));
  if (!proposal || proposal.kind !== 'teachback-rebase-proposal') throw new TeachbackError('E722', `${proposalFile} is not a rebase proposal.`, 'Make one with "teachback repo rebase <course> --dry-run --out <file>".', 2);
  const lock = loadLock(courseDir);
  if (proposal.from.manifestDigest !== lock.manifestDigest) throw new TeachbackError('E723', 'The proposal was made from a different source lock.', 'Make a new proposal with --dry-run.', 2);
  const repoRoot = repoRootFor(courseDir, repo);
  const { newLock, newMap } = rescan(lock, repoRoot, proposal.to.ref.kind === 'git' ? 'HEAD' : 'worktree');
  if (newLock.manifestDigest !== proposal.to.manifestDigest) throw new TeachbackError('E724', 'The source changed again after the proposal was made.', 'Make a new proposal with --dry-run.', 2);
  const docs = {};
  for (const f of ['map.json', 'items.json', QUESTS_FILE]) docs[f] = readJson(path.join(courseDir, f));
  const applied = [];
  const review = [];
  for (const c of proposal.changes) {
    const cur = getAt(docs[c.loc.file], c.loc.path);
    if (!cur) continue;
    if (['unchanged', 'moved', 'relocate'].includes(c.status)) {
      const next = { ...cur, fileId: c.new.fileId, startLine: c.new.startLine, endLine: c.new.endLine };
      if (cur.symbolId) {
        const oldName = (readJson(path.join(courseDir, MAP_FILE))?.symbols ?? []).find((s) => s.id === cur.symbolId)?.name;
        const cand = newMap.symbols.filter((s) => s.fileId === c.new.fileId && s.name === oldName);
        if (cand.length === 1) next.symbolId = cand[0].id;
        else delete next.symbolId;
      }
      setAt(docs[c.loc.file], c.loc.path, next);
      applied.push(c.where);
    }
    if (c.status !== 'unchanged') review.push({ owner: c.owner, where: c.where, status: c.status, reason: c.reason });
  }
  // Quest acceptance points at file and symbol ids too.
  const oldLockById = new Map(lock.files.map((f) => [f.id, f]));
  const newByPath = new Map(newLock.files.map((f) => [f.path, f]));
  const oldSyms = new Map((readJson(path.join(courseDir, MAP_FILE))?.symbols ?? []).map((s) => [s.id, s]));
  for (const q of docs[QUESTS_FILE]?.quests ?? []) {
    if (q.acceptance?.kind !== 'source-location') continue;
    const of = oldLockById.get(q.acceptance.fileId);
    const nf = of && newByPath.get(of.path);
    const name = oldSyms.get(q.acceptance.symbolId)?.name;
    const ns = nf && newMap.symbols.filter((s) => s.fileId === nf.id && s.name === name);
    if (nf && ns?.length === 1) {
      q.acceptance = { ...q.acceptance, fileId: nf.id, symbolId: ns[0].id };
      if (of.sha256 !== nf.sha256) review.push({ owner: { type: 'quest', id: q.id }, where: `quests.json ${q.id} acceptance`, status: 'relocate', reason: `The answer key follows ${name} to its new lines.` });
    } else review.push({ owner: { type: 'quest', id: q.id }, where: `quests.json ${q.id} acceptance`, status: 'needs_review', reason: 'The answer key could not be moved automatically.' });
  }
  if (docs[QUESTS_FILE]) docs[QUESTS_FILE].sourceManifestDigest = newLock.manifestDigest;
  for (const [f, d] of Object.entries(docs)) if (d) writeJsonAtomic(path.join(courseDir, f), d);
  writeJsonAtomic(path.join(courseDir, LOCK_FILE), newLock);
  writeJsonAtomic(path.join(courseDir, MAP_FILE), newMap);
  const entry = { at: now.toISOString(), from: proposal.from, to: proposal.to, proposalDigest: proposal.proposalDigest, applied: applied.length, review: review.length, unresolved: proposal.changes.filter((c) => !['unchanged', 'moved', 'relocate'].includes(c.status)).map((c) => c.where) };
  fs.appendFileSync(path.join(courseDir, LOG_FILE), `${JSON.stringify(entry)}\n`);
  writeJsonAtomic(path.join(courseDir, REVIEW_FILE), { schemaVersion: 1, createdAt: now.toISOString(), note: 'Evidence for these changed with the source. Re-check each claim and its items before teaching from them; learner history was not changed.', items: review });
  const verify = verifyCourse(courseDir, { repo });
  return { applied: applied.length, review, unresolved: entry.unresolved, verify: { status: verify.status, refs: verify.refs }, log: path.join(courseDir, LOG_FILE), exitCode: verify.status === 'verified' ? 0 : verify.exitCode };
}

export function registerRebaseCommand(SUB) {
  SUB['repo rebase'] = async (argv, { parse, out, setExit }) => {
    const { resolveCourseDir } = await import('../course.mjs');
    const args = parse(argv, { to: { type: 'string' }, 'dry-run': { type: 'boolean' }, out: { type: 'string', short: 'o' }, apply: { type: 'string' }, confirm: { type: 'boolean' }, repo: { type: 'string' } });
    const dir = resolveCourseDir(args.course ?? args._[0], { root: args.root });
    const now = resolveNow(args.now);
    if (args.apply) {
      const res = applyRebase(dir, args.apply, { repo: args.repo, confirm: args.confirm, now });
      out(args, res, () =>
        [
          `Applied ${res.applied} ref change${res.applied === 1 ? '' : 's'}; ${res.review.length} item${res.review.length === 1 ? '' : 's'} marked for review in source-review.json.`,
          ...(res.unresolved.length ? [`  unresolved (fix by hand): ${res.unresolved.join('; ')}`] : []),
          `  repo verify now: ${res.verify.status}. Run "teachback check" too, and re-read every claim listed for review.`,
          '  Learner history was not changed.'
        ].join('\n')
      );
      return setExit(res.exitCode);
    }
    if (!args['dry-run']) throw new TeachbackError('E725', 'repo rebase needs --dry-run (to propose) or --apply <file> --confirm.', 'Start with: teachback repo rebase <course> --to HEAD --dry-run --out rebase-proposal.json', 2);
    const to = args.to ?? 'HEAD';
    if (!['HEAD', 'worktree'].includes(to)) throw new TeachbackError('E726', `--to ${to}: only HEAD or worktree.`, 'Check out the commit you want first; teachback reads the files that are on disk.', 2);
    const p = proposeRebase(dir, { repo: args.repo, to, now });
    const file = path.resolve(args.out ?? path.join(dir, 'rebase-proposal.json'));
    writeJsonAtomic(file, p);
    const { newLock, newRepoMap, ...view } = p;
    out(args, { ...view, written: file }, () =>
      [
        `Proposal written to ${file} (nothing changed yet)`,
        `  ${Object.entries(p.summary).map(([k, v]) => `${v} ${k}`).join(', ') || 'no refs'}`,
        ...p.changes.filter((c) => c.status !== 'unchanged').map((c) => `  ${c.status.padEnd(12)} ${c.where}: ${c.reason}`),
        `  Apply with: teachback repo rebase ${p.course} --apply "${file}" --confirm`
      ].join('\n')
    );
  };
}
