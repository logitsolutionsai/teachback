// The RepoQuest loop end to end on the synthetic cache-lib: next offers quests
// by prerequisites after due reviews, a navigate answer is checked against the
// repo map, a predict quest is judged through the existing item loop, the patch
// capstone runs only with an allowlist and --trust-local in a scratch copy, the
// starter fails and the reference fix passes, and the course is "rehearsed"
// only after the teach-back. learner.json keeps its meaning.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cli, rmDir, tempDir } from './helpers/cli.mjs';
import { guardGit, copyCacheRepo, CACHE_EXAMPLE } from './helpers/repoquest.mjs';
import { checkQuests } from '../src/quest/schema.mjs';
import { loadCourse } from '../src/course.mjs';

guardGit();
const made = [];
const keep = (d) => (made.push(d), d);
after(() => made.forEach(rmDir));

const ITEMS = JSON.parse(fs.readFileSync(path.join(CACHE_EXAMPLE, 'items.json'), 'utf8')).items;
const byId = new Map(ITEMS.map((i) => [i.id, i]));
const letter = (n) => String.fromCharCode(65 + n);

async function setup() {
  const root = keep(tempDir());
  const repo = keep(copyCacheRepo());
  assert.equal((await cli(['init', 'cache', '--from', CACHE_EXAMPLE, '--root', root, '--json'])).code, 0);
  assert.equal((await cli(['repo', 'verify', 'cache', '--repo', repo, '--root', root, '--json'])).code, 0);
  const base = ['--root', root, '--json'];
  let minute = 0;
  const now = () => new Date(Date.UTC(2026, 10, 14, 9, minute++)).toISOString();
  const answer = async (id) => {
    const it = byId.get(id);
    if (it.type === 'mcq' || it.type === 'numeric') {
      const r = await cli(['grade', id, '--answer', it.type === 'mcq' ? letter(it.answer) : String(it.answer), '--confidence', '3', '--record', ...base, '--now', now()]);
      assert.equal(r.code, 0, r.out);
    } else {
      const r = await cli(['record', id, '--result', 'correct', '--confidence', '3', ...base, '--now', now()]);
      assert.equal(r.code, 0, r.out);
    }
  };
  const next = async () => (await cli(['next', ...base, '--now', now()])).json;
  return { root, repo, base, now, answer, next, dir: path.join(root, '.teachback', 'cache') };
}

// Follow next, answering every item correctly, until it offers something else.
async function learnUntilNotLearn(s, limit = 20) {
  let plan = await s.next();
  for (let i = 0; i < limit && (plan.kind === 'learn' || plan.kind === 'review'); i++) {
    await s.answer(plan.item.id);
    plan = await s.next();
  }
  return plan;
}

test('next offers each quest when its prerequisites are met, and the whole loop ends in "rehearsed"', async () => {
  const s = await setup();
  const first = await s.next();
  assert.equal(first.kind, 'learn');
  assert.equal(first.concept, 'recency');
  assert.equal(first.source.status, 'current');
  assert.ok(first.quests.every((q) => q.status === 'not_run'));

  // Recency mastered: the navigate quest comes before the next concept.
  let plan = await learnUntilNotLearn(s);
  assert.equal(plan.kind, 'quest');
  assert.equal(plan.quest.id, 'locate-eviction');

  const show = await cli(['quest', 'show', 'locate-eviction', ...s.base]);
  assert.equal(show.code, 0);
  assert.ok(!JSON.stringify(show.json).includes('sym-src-cache-lru-js-lrucache-evict'), 'the answer key is not shown');
  assert.deepEqual(show.json.sourceRefs, []);
  const fileOnly = await cli(['quest', 'answer', 'locate-eviction', '--path', 'src/cache/lru.js', ...s.base]);
  assert.equal(fileOnly.code, 2, 'a file name alone is never accepted');
  const wrong = await cli(['quest', 'answer', 'locate-eviction', '--path', 'src/cache/lru.js', '--symbol', 'set', ...s.base]);
  assert.equal(wrong.code, 1);
  assert.equal(wrong.json.passed, false);
  assert.ok(!/LruCache.evict|31/.test(wrong.json.feedback), 'the feedback does not give the answer away');
  const right = await cli(['quest', 'answer', 'locate-eviction', '--path', 'src/cache/lru.js', '--symbol', 'evict', ...s.base]);
  assert.equal(right.code, 0, right.out);
  assert.equal(right.json.cite.startLine, 31);

  // capacity-trigger mastered: the predict quest, judged by its item.
  plan = await learnUntilNotLearn(s);
  assert.equal(plan.kind, 'quest');
  assert.equal(plan.quest.id, 'predict-eviction');
  assert.equal(plan.quest.item, 'vic-predict');
  await s.answer('vic-predict');

  // victim-choice mastered: the patch capstone.
  plan = await learnUntilNotLearn(s);
  assert.equal(plan.kind, 'quest', JSON.stringify(plan));
  assert.equal(plan.quest.id, 'fix-eviction');
  assert.deepEqual(plan.quest.command, ['node', '--test', 'test/lru.test.js']);

  const start = await cli(['quest', 'start', 'fix-eviction', ...s.base]);
  assert.equal(start.code, 0, start.out);
  assert.equal(start.json.strategy, 'scratch-copy');
  const ws = start.json.workspace;
  assert.ok(ws.startsWith(path.join(s.root, '.teachback', 'workspaces')));
  assert.ok(fs.existsSync(path.join(ws, 'src', 'cache', 'lru.js')));

  const notAllowed = await cli(['quest', 'run', 'fix-eviction', '--trust-local', ...s.base]);
  assert.equal(notAllowed.code, 3);
  assert.equal(notAllowed.json.status, 'blocked');
  assert.match(notAllowed.json.reason, /not in .*trusted-commands\.json/);
  fs.copyFileSync(path.join(CACHE_EXAMPLE, 'trusted-commands.example.json'), path.join(s.root, '.teachback', 'trusted-commands.json'));
  const noFlag = await cli(['quest', 'run', 'fix-eviction', ...s.base]);
  assert.equal(noFlag.code, 3);
  assert.match(noFlag.json.reason, /--trust-local/);

  const starter = await cli(['quest', 'run', 'fix-eviction', '--trust-local', ...s.base]);
  assert.equal(starter.code, 1, 'the starter (the repository as locked) fails its test');
  assert.equal(starter.json.status, 'failed');
  assert.equal(starter.json.record.environment.sandbox, 'none');

  fs.copyFileSync(path.join(CACHE_EXAMPLE, 'quests', 'fix-eviction', '.reference', 'src', 'cache', 'lru.js'), path.join(ws, 'src', 'cache', 'lru.js'));
  const pass = await cli(['quest', 'run', 'fix-eviction', '--trust-local', ...s.base, '--now', s.now()]);
  assert.equal(pass.code, 0, pass.out);
  assert.equal(pass.json.status, 'passed');
  assert.equal(pass.json.teachbackRecorded, false);
  assert.deepEqual(pass.json.record.changedFiles, [{ path: 'src/cache/lru.js', change: 'modified' }]);
  assert.match(pass.json.record.checks[0].stdoutDigest, /^sha256:[0-9a-f]{64}$/);
  const draft = fs.readFileSync(pass.json.draftPr, 'utf8');
  assert.match(draft, /Local draft for human review/);
  assert.doesNotMatch(draft, /was merged|has been merged|accepted by the maintainer/i);

  plan = await s.next();
  assert.equal(plan.kind, 'quest');
  assert.equal(plan.quest.status, 'needs_teachback');
  assert.equal(plan.item.id, 'vic-teachback');
  await s.answer('vic-teachback');
  plan = await s.next();
  assert.equal(plan.kind, 'rehearsed', JSON.stringify(plan.quests));
  assert.match(plan.reason, /not a merged contribution/);

  // learner.json holds only the original event types.
  const learner = JSON.parse(fs.readFileSync(path.join(s.dir, 'learner.json'), 'utf8'));
  assert.deepEqual([...new Set(learner.events.map((e) => e.type))], ['answer']);
  const qs = JSON.parse(fs.readFileSync(path.join(s.dir, 'quest-state.json'), 'utf8'));
  assert.equal(qs.quests['fix-eviction'].status, 'passed');
  // Your own checkout was never written to.
  assert.match(fs.readFileSync(path.join(s.repo, 'src', 'cache', 'lru.js'), 'utf8'), /entry\.lastUsed > victim\.lastUsed/);
});

test('changes outside allowedPaths block the run, so a learner cannot pass by editing the test', async () => {
  const s = await setup();
  fs.copyFileSync(path.join(CACHE_EXAMPLE, 'trusted-commands.example.json'), path.join(s.root, '.teachback', 'trusted-commands.json'));
  const start = await cli(['quest', 'start', 'fix-eviction', ...s.base]);
  fs.writeFileSync(path.join(start.json.workspace, 'test', 'lru.test.js'), "import { test } from 'node:test';\ntest('nothing', () => {});\n");
  const r = await cli(['quest', 'run', 'fix-eviction', '--trust-local', ...s.base]);
  assert.equal(r.code, 3);
  assert.match(r.json.reason, /outside the quest scope changed: test\/lru\.test\.js \(modified\)/);
  const again = await cli(['quest', 'start', 'fix-eviction', '--reset', ...s.base]);
  assert.equal(again.json.created, true);
  const fresh = await cli(['quest', 'run', 'fix-eviction', '--trust-local', ...s.base]);
  assert.equal(fresh.json.status, 'failed');
});

test('when the source changes, next warns, suspends what cites the changed file, and keeps other progress', async () => {
  const s = await setup();
  await s.answer('rec-which-ops');
  const lru = path.join(s.repo, 'src', 'cache', 'lru.js');
  fs.writeFileSync(lru, fs.readFileSync(lru, 'utf8').replace('// Chooses which entry', '// Picks which entry'));
  const plan = await s.next();
  assert.equal(plan.kind, 'learn', 'the original selection is unchanged');
  assert.equal(plan.source.status, 'source_stale');
  assert.deepEqual(plan.source.changed, ['src/cache/lru.js']);
  assert.match(plan.sourceWarning, /suspended/);
  assert.ok(plan.source.suspendedConcepts.includes('victim-choice'));
  assert.ok(plan.source.suspendedQuests.includes('locate-eviction'));
  assert.equal(plan.quests.find((q) => q.id === 'locate-eviction').status, 'suspended');
  const learner = JSON.parse(fs.readFileSync(path.join(s.dir, 'learner.json'), 'utf8'));
  assert.equal(learner.events.length, 1, 'progress is kept');
  const start = await cli(['quest', 'start', 'fix-eviction', ...s.base]);
  assert.equal(start.code, 2, 'no workspace is built from a source that no longer matches the lock');
});

test('quests and concepts share one DAG: cycles, unknown prerequisites, duplicate ids and bad acceptance are errors', () => {
  const courseData = loadCourse(CACHE_EXAMPLE);
  const doc = JSON.parse(fs.readFileSync(path.join(CACHE_EXAMPLE, 'quests.json'), 'utf8'));
  assert.deepEqual(checkQuests(courseData, doc).filter((p) => p.level === 'error'), []);
  const bad = structuredClone(doc);
  bad.quests[0].prerequisites = ['fix-eviction'];
  bad.quests.push({ ...structuredClone(doc.quests[1]) });
  bad.quests.push({ id: 'recency', kind: 'navigate', title: 'x', prerequisites: ['nope'] });
  bad.quests[1].acceptance = { kind: 'tests' };
  const codes = new Set(checkQuests(courseData, bad).filter((p) => p.level === 'error').map((p) => p.code));
  for (const c of ['Q010', 'Q011', 'Q012', 'Q013', 'Q020', 'Q021']) assert.ok(codes.has(c), c);
});

test('quest start --worktree asks git for a detached worktree of the locked commit (stubbed), and refuses when the checkout no longer matches the lock', async () => {
  const { stubGit, makeRepo, writeMinimalCourse } = await import('./helpers/repoquest.mjs');
  const repo = keep(makeRepo({ 'src/a.js': 'export function alpha() {\n  return 1;\n}\n', 'test/a.test.js': "import { test } from 'node:test';\ntest('x', () => {});\n", '.git/HEAD': 'ref: refs/heads/main\n' }));
  const SHA = 'd'.repeat(40);
  const answers = { 'rev-parse': { ok: true, stdout: `${SHA}\n` }, status: { ok: true, stdout: '' }, 'ls-files': { ok: true, stdout: 'src/a.js\0test/a.test.js\0' }, worktree: () => ({ ok: true, stdout: '' }) };
  const calls = stubGit(answers);
  const root = keep(tempDir());
  const base = ['--root', root, '--json'];
  assert.equal((await cli(['repo', 'init', 'w', '--repo', repo, ...base])).code, 0);
  const dir = path.join(root, '.teachback', 'w');
  const lock = JSON.parse(fs.readFileSync(path.join(dir, 'source-lock.json'), 'utf8'));
  writeMinimalCourse(dir, lock);
  const q = JSON.parse(fs.readFileSync(path.join(dir, 'quests.json'), 'utf8'));
  q.quests.push({ id: 'p', kind: 'patch', title: 'p', prerequisites: ['alpha'], acceptance: { kind: 'tests' }, workspace: { strategy: 'scratch-worktree', allowedPaths: ['src/**'] }, verification: { runner: 'node', command: ['node', '--test', 'test/a.test.js'], expectedExitCode: 0 } });
  fs.writeFileSync(path.join(dir, 'quests.json'), JSON.stringify(q));
  const r = await cli(['quest', 'start', 'p', '--worktree', ...base]);
  assert.equal(r.code, 0, r.out);
  assert.equal(r.json.strategy, 'scratch-worktree');
  const wt = calls().filter((c) => c.args[0] === 'worktree').at(-1);
  assert.deepEqual(wt.args, ['worktree', 'add', '--detach', r.json.workspace, SHA]);
  // A changed checkout: no worktree, and no copy either, because the files no longer match the lock.
  stubGit({ ...answers, status: { ok: true, stdout: ' M src/a.js\0' } });
  fs.writeFileSync(path.join(repo, 'src', 'a.js'), 'export function alpha() {\n  return 2;\n}\n');
  const d = await cli(['quest', 'start', 'p', '--worktree', '--reset', ...base]);
  assert.equal(d.code, 2, 'the changed file no longer matches the lock, so not even a copy is made');
});
