// Source drift: commit A is the shipped cache-lib; B moves code without
// changing behaviour, duplicates a needle, deletes or renames a file, or
// removes a quoted line. The proposal says what it can move and what needs a
// human; applying needs --confirm, a fresh proposal, and never touches learner
// history.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cli, rmDir, tempDir } from './helpers/cli.mjs';
import { guardGit, stubGit, copyCacheRepo, makeRepo, writeMinimalCourse, CACHE_EXAMPLE } from './helpers/repoquest.mjs';

guardGit();
const made = [];
const keep = (d) => (made.push(d), d);
after(() => made.forEach(rmDir));

async function atCommitA() {
  const root = keep(tempDir());
  const repo = keep(copyCacheRepo());
  const base = ['--root', root, '--json'];
  await cli(['init', 'cache', '--from', CACHE_EXAMPLE, ...base]);
  assert.equal((await cli(['repo', 'verify', 'cache', '--repo', repo, ...base])).code, 0);
  assert.equal((await cli(['record', 'rec-teachback', '--result', 'correct', ...base])).code, 0);
  const dir = path.join(root, '.teachback', 'cache');
  return { root, repo, base, dir, lru: path.join(repo, 'src', 'cache', 'lru.js') };
}

const byWhere = (p, where) => p.changes.find((c) => c.where === where);

test('B moves code down three lines: symbols and unique needles relocate, a repeated needle needs review, untouched files are unchanged', async () => {
  const c = await atCommitA();
  const learnerBefore = fs.readFileSync(path.join(c.dir, 'learner.json'));
  fs.writeFileSync(c.lru, fs.readFileSync(c.lru, 'utf8').replace("import { Entry } from './entry.js';\n", "import { Entry } from './entry.js';\n\n// Notes for maintainers.\n// The clock is injectable.\n"));
  const v = await cli(['repo', 'verify', 'cache', ...c.base]);
  assert.equal(v.json.status, 'source_stale');
  const out = path.join(c.root, 'proposal.json');
  const p = await cli(['repo', 'rebase', 'cache', '--to', 'worktree', '--dry-run', '--out', out, ...c.base]);
  assert.equal(p.code, 0, p.out);
  const prop = JSON.parse(fs.readFileSync(out, 'utf8'));
  const evict = byWhere(prop, 'map.json concept victim-choice sourceRefs[0]');
  assert.equal(evict.status, 'relocate');
  assert.deepEqual([evict.new.startLine, evict.new.endLine], [34, 41]);
  assert.match(evict.reason, /moved by 3 lines/);
  assert.equal(byWhere(prop, 'quests.json predict-eviction sourceRefs[0]').status, 'relocate', 'a unique needle relocates');
  const twice = byWhere(prop, 'items.json rec-which-ops sourceRefs[0]');
  assert.equal(twice.status, 'needs_review', '"touch(this.clock())" appears twice');
  assert.match(twice.reason, /appears 2 times/);
  assert.equal(byWhere(prop, 'map.json concept recency sourceRefs[0]').status, 'unchanged');
  assert.match(byWhere(prop, 'map.json concept recency sourceRefs[0]').reason, /Identical file hash/);
  assert.deepEqual(fs.readFileSync(path.join(c.dir, 'learner.json')), learnerBefore, 'a dry run changes nothing');
  assert.equal(JSON.parse(fs.readFileSync(path.join(c.dir, 'source-lock.json'), 'utf8')).manifestDigest, prop.from.manifestDigest);

  const noConfirm = await cli(['repo', 'rebase', 'cache', '--apply', out, ...c.base]);
  assert.equal(noConfirm.code, 2);
  const applied = await cli(['repo', 'rebase', 'cache', '--apply', out, '--confirm', ...c.base]);
  assert.equal(applied.code, 0, applied.out);
  assert.equal(applied.json.verify.status, 'verified');
  assert.ok(applied.json.review.some((r) => r.status === 'needs_review'));
  assert.deepEqual(fs.readFileSync(path.join(c.dir, 'learner.json')), learnerBefore, 'learner history is untouched');
  const log = fs.readFileSync(path.join(c.dir, 'migrations.jsonl'), 'utf8').trim().split('\n');
  assert.equal(log.length, 1);
  const review = JSON.parse(fs.readFileSync(path.join(c.dir, 'source-review.json'), 'utf8'));
  assert.ok(review.items.some((i) => i.owner.id === 'victim-choice'));
  // The navigate answer key followed the method.
  const q = JSON.parse(fs.readFileSync(path.join(c.dir, 'quests.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(c.dir, 'source-lock.json'), 'utf8'));
  assert.equal(q.sourceManifestDigest, lock.manifestDigest);
  const map = JSON.parse(fs.readFileSync(path.join(c.dir, 'repo-map.json'), 'utf8'));
  assert.equal(map.symbols.find((s) => s.id === q.quests[0].acceptance.symbolId).startLine, 34);
  const plan = (await cli(['next', ...c.base])).json;
  assert.equal(plan.source.status, 'current');
  assert.equal(plan.sourceReview.count, review.items.length, 'next says evidence needs a re-check');
});

test('a proposal is refused when the source changed again, or when it was made from another lock', async () => {
  const c = await atCommitA();
  fs.appendFileSync(c.lru, '// one\n');
  const out = path.join(c.root, 'p.json');
  await cli(['repo', 'rebase', 'cache', '--to', 'worktree', '--dry-run', '--out', out, ...c.base]);
  fs.appendFileSync(c.lru, '// two\n');
  const r = await cli(['repo', 'rebase', 'cache', '--apply', out, '--confirm', ...c.base]);
  assert.equal(r.code, 2);
  assert.equal(r.json.error.code, 'E724');
  const p = JSON.parse(fs.readFileSync(out, 'utf8'));
  p.from.manifestDigest = `sha256:${'0'.repeat(64)}`;
  fs.writeFileSync(out, JSON.stringify(p));
  const r2 = await cli(['repo', 'rebase', 'cache', '--apply', out, '--confirm', ...c.base]);
  assert.equal(r2.json.error.code, 'E723');
});

test('deleted, renamed, emptied and duplicated: deleted, moved, broken and needs_review, and none is applied silently', async () => {
  const c = await atCommitA();
  fs.renameSync(path.join(c.repo, 'test', 'lru.test.js'), path.join(c.repo, 'test', 'cache.test.js'));
  fs.rmSync(path.join(c.repo, 'src', 'cache', 'entry.js'));
  let text = fs.readFileSync(c.lru, 'utf8').replace('if (this.entries.size >= this.capacity) this.evict();', 'if (this.full()) this.evict();');
  text = text.replace('  get size() {', '  evict() {\n    return undefined;\n  }\n\n  get size() {');
  fs.writeFileSync(c.lru, text);
  const out = path.join(c.root, 'p.json');
  await cli(['repo', 'rebase', 'cache', '--to', 'worktree', '--dry-run', '--out', out, ...c.base]);
  const p = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(byWhere(p, 'map.json concept victim-choice sourceRefs[1]').status, 'moved');
  assert.match(byWhere(p, 'map.json concept victim-choice sourceRefs[1]').new.path, /test\/cache\.test\.js/);
  assert.equal(byWhere(p, 'map.json concept recency sourceRefs[0]').status, 'deleted');
  assert.equal(byWhere(p, 'map.json concept capacity-trigger sourceRefs[0]').status, 'broken', 'the quoted check is gone');
  assert.equal(byWhere(p, 'map.json concept victim-choice sourceRefs[0]').status, 'needs_review', 'two methods named evict');
  const applied = await cli(['repo', 'rebase', 'cache', '--apply', out, '--confirm', ...c.base]);
  assert.notEqual(applied.json.verify.status, 'verified', 'unresolved refs keep the course from verifying');
  assert.ok(applied.json.unresolved.length >= 3);
  assert.notEqual(applied.code, 0);
});

test('a new commit with identical file hashes (stubbed git) reuses every ref, and says why', async () => {
  const repo = keep(makeRepo({ 'src/a.js': 'export function alpha() {\n  return 1;\n}\n', '.git/HEAD': 'ref: refs/heads/main\n' }));
  stubGit({ 'rev-parse': { ok: true, stdout: `${'a'.repeat(40)}\n` }, status: { ok: true, stdout: '' }, 'ls-files': { ok: true, stdout: 'src/a.js\0' } });
  const root = keep(tempDir());
  const base = ['--root', root, '--json'];
  assert.equal((await cli(['repo', 'init', 'g', '--repo', repo, ...base])).code, 0);
  const dir = path.join(root, '.teachback', 'g');
  writeMinimalCourse(dir, JSON.parse(fs.readFileSync(path.join(dir, 'source-lock.json'), 'utf8')));
  stubGit({ 'rev-parse': { ok: true, stdout: `${'b'.repeat(40)}\n` }, status: { ok: true, stdout: '' }, 'ls-files': { ok: true, stdout: 'src/a.js\0' } });
  const p = await cli(['repo', 'rebase', 'g', '--to', 'HEAD', '--dry-run', ...base]);
  assert.equal(p.code, 0, p.out);
  assert.deepEqual(p.json.summary, { unchanged: 1 });
  assert.equal(p.json.to.ref.sha, 'b'.repeat(40));
  assert.match(p.json.changes[0].reason, /even if the commit changed/);
});
