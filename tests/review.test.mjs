// Review mode (Journey C): learn a change from a unified diff file before
// reviewing it. The diff is data: nothing in it is applied or run. Reading the
// diff from git exists as an option and is tested here only with a stub.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cli, rmDir, tempDir, REPO } from './helpers/cli.mjs';
import { guardGit, stubGit, makeRepo } from './helpers/repoquest.mjs';
import { parseUnifiedDiff } from '../src/repo/diff.mjs';
import { readZip } from '../src/pack/zip.mjs';

guardGit();
const made = [];
const keep = (d) => (made.push(d), d);
after(() => made.forEach(rmDir));

const REVIEW = path.join(REPO, 'examples', 'repoquest-review');
const PATCH = path.join(REVIEW, 'change.patch');

test('the diff parser reads modified, added, deleted and renamed files, short hunk headers and CRLF', () => {
  const text = [
    'diff --git a/src/a.js b/src/a.js', '--- a/src/a.js', '+++ b/src/a.js', '@@ -1,3 +1,4 @@', ' one', '-two', '+TWO', '+three', ' four',
    'diff --git a/new.py b/new.py', 'new file mode 100644', '--- /dev/null', '+++ b/new.py', '@@ -0,0 +1 @@', '+x = 1',
    'diff --git a/old.go b/old.go', 'deleted file mode 100644', '--- a/old.go', '+++ /dev/null', '@@ -1 +0,0 @@', '-package old',
    'diff --git a/x.rs b/y.rs', 'similarity index 100%', 'rename from x.rs', 'rename to y.rs'
  ].join('\r\n');
  const files = parseUnifiedDiff(text);
  assert.deepEqual(files.map((f) => [f.oldPath, f.newPath, f.status]), [['src/a.js', 'src/a.js', 'modified'], [null, 'new.py', 'added'], ['old.go', null, 'deleted'], ['x.rs', 'y.rs', 'renamed']]);
  assert.deepEqual(files[0].hunks[0].added, [2, 3]);
  assert.deepEqual(files[0].hunks[0].removedAt, [2]);
  assert.equal(files[1].hunks[0].newLines, 1);
});

test('a diff that names a path outside the repository is refused (exit 2)', async () => {
  const bad = path.join(keep(tempDir()), 'bad.patch');
  fs.writeFileSync(bad, '--- a/src/a.js\n+++ b/../../etc/passwd\n@@ -1 +1 @@\n-a\n+b\n');
  const r = await cli(['repo', 'scan', path.join(REVIEW, 'repo'), '--diff', bad, '--json']);
  assert.equal(r.code, 2);
  assert.equal(r.json.error.code, 'E740');
});

test('scan --diff names the changed symbol and the test that covers it, with evidence', async () => {
  const r = await cli(['repo', 'scan', path.join(REVIEW, 'repo'), '--diff', PATCH, '--json']);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.json.diff.changedSymbols.map((s) => [s.name, s.changedLines, s.certainty]), [['LruCache.evict', [34], 'lexically_detected']]);
  assert.deepEqual(r.json.diff.relatedTests.map((t) => [t.path, t.basis, t.certainty]), [['test/lru.test.js', 'import-path', 'direct']]);
});

test('repo init --mode review needs the diff, and stores a summary with no code in it', async () => {
  const root = keep(tempDir());
  const base = ['--root', root, '--json'];
  const no = await cli(['repo', 'init', 'rv', '--mode', 'review', '--repo', path.join(REVIEW, 'repo'), ...base]);
  assert.equal(no.code, 2);
  assert.equal(no.json.error.code, 'E634');
  const yes = await cli(['repo', 'init', 'rv', '--mode', 'review', '--diff', PATCH, '--repo', path.join(REVIEW, 'repo'), ...base]);
  assert.equal(yes.code, 0, yes.out);
  const summary = fs.readFileSync(path.join(root, '.teachback', 'rv', 'diff-summary.json'), 'utf8');
  assert.ok(!summary.includes('victim.lastUsed'), 'no code from the diff is stored');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.teachback', 'rv', 'course.json'), 'utf8')).kind, 'review');
});

test('the review course: the review quest follows its concept, and the local checklist appears only after it passes', async () => {
  const root = keep(tempDir());
  const base = ['--root', root, '--json'];
  await cli(['init', 'pr', '--from', REVIEW, ...base]);
  assert.equal((await cli(['repo', 'verify', 'pr', '--repo', path.join(REVIEW, 'repo'), ...base])).code, 0);
  const before = await cli(['quest', 'show', 'review-changed-invariant', ...base]);
  assert.equal(before.json.checklist.items, null);
  let minute = 0;
  const at = () => new Date(Date.UTC(2026, 10, 14, 9, minute++)).toISOString();
  for (let i = 0; i < 10; i++) {
    const plan = (await cli(['next', ...base, '--now', at()])).json;
    if (plan.kind === 'quest') {
      assert.equal(plan.quest.id, 'review-changed-invariant');
      assert.equal(plan.quest.item, 'review-what-breaks');
      break;
    }
    if (plan.kind === 'rehearsed') break; // the review item was asked while learning the concept
    const it = plan.item;
    const args = it.type === 'mcq' ? ['grade', it.id, '--answer', 'B', '--record'] : ['record', it.id, '--result', 'correct'];
    assert.equal((await cli([...args, ...base, '--now', at()])).code, 0);
  }
  await cli(['record', 'review-what-breaks', '--result', 'correct', ...base, '--now', at()]);
  const shown = await cli(['quest', 'show', 'review-changed-invariant', ...base]);
  assert.equal(shown.json.status, 'passed');
  assert.ok(shown.json.checklist.items.some((i) => /LruCache\.evict/.test(i)));
  assert.ok(shown.json.checklist.items.some((i) => /test\/lru\.test\.js/.test(i)));
  assert.match(shown.json.checklist.note, /does not post comments/);
  // A pack of the review course carries the summary, never the patch.
  const out = path.join(root, 'pr.zip');
  const exp = await cli(['pack', 'export', 'pr', '--out', out, '--allow-private-pack', ...base]);
  assert.equal(exp.code, 0, exp.out);
  const names = readZip(fs.readFileSync(out)).map((e) => e.name);
  assert.ok(names.includes('course/diff-summary.json'));
  assert.ok(!names.some((n) => n.endsWith('.patch')));
});

test('--git-diff reads the change through the git runner (stubbed here; real git is not run by the suite)', async () => {
  const repo = keep(makeRepo({ ...Object.fromEntries(['src/cache/lru.js', 'src/cache/entry.js', 'test/lru.test.js'].map((p) => [p, fs.readFileSync(path.join(REVIEW, 'repo', p))])), '.git/HEAD': 'ref: refs/heads/main\n' }));
  const calls = stubGit({ 'rev-parse': { ok: true, stdout: `${'c'.repeat(40)}\n` }, status: { ok: true, stdout: '' }, 'ls-files': { ok: true, stdout: 'src/cache/lru.js\0src/cache/entry.js\0test/lru.test.js\0' }, diff: { ok: true, stdout: fs.readFileSync(PATCH, 'utf8') } });
  const r = await cli(['repo', 'scan', repo, '--git-diff', 'HEAD~1', '--json']);
  assert.equal(r.code, 0, r.out);
  assert.equal(r.json.diff.changedSymbols[0].name, 'LruCache.evict');
  const diffCall = calls().find((c) => c.args[0] === 'diff');
  assert.deepEqual(diffCall.args, ['diff', '--no-color', '--no-ext-diff', '--no-textconv', 'HEAD~1', '--']);
  const bad = await cli(['repo', 'scan', repo, '--git-diff', '--output=/tmp/x', '--json']);
  assert.notEqual(bad.code, 0, 'an option-looking ref is refused');
});
