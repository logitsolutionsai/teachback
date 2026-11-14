// The source lock and repo verify. The git paths are tested only with a stubbed
// runner (a fake .git folder and canned answers); no test runs real git.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cli, rmDir, tempDir } from './helpers/cli.mjs';
import { guardGit, stubGit, makeRepo, copyCacheRepo, writeMinimalCourse, CACHE_EXAMPLE } from './helpers/repoquest.mjs';
import { run as gitRun, gitCalls, READ_ONLY_SUBCOMMANDS } from '../src/repo/git.mjs';
import { ABSOLUTE_PATH_PATTERN } from '../src/repo/paths.mjs';

const made = [];
const keep = (d) => (made.push(d), d);
after(() => made.forEach(rmDir));
beforeEach(() => guardGit());

const SHA = 'a'.repeat(40);
const SHA2 = 'b'.repeat(40);

function gitRepo(files) {
  const d = keep(makeRepo({ ...files, '.git/HEAD': 'ref: refs/heads/main\n' }));
  return d;
}
const tracked = (...paths) => ({ ok: true, code: 0, stdout: paths.map((p) => `${p}\0`).join(''), stderr: '' });

test('a plain folder gets a content-digest lock (ref.kind worktree) and starts no process', async () => {
  const root = keep(tempDir());
  const before = gitCalls().length;
  const r = await cli(['repo', 'init', 'plain', '--repo', copyCacheRepo(), '--root', root, '--json']);
  assert.equal(r.code, 0, r.out);
  assert.equal(r.json.sourceKind, 'worktree');
  assert.equal(r.json.ref.kind, 'worktree');
  assert.match(r.json.ref.digest, /^sha256:/);
  assert.equal(gitCalls().length, before);
  const lock = JSON.parse(fs.readFileSync(path.join(root, '.teachback', 'plain', 'source-lock.json'), 'utf8'));
  assert.match(lock.provenance, /lower provenance confidence/);
  assert.ok(lock.files.every((f) => f.state === 'worktree'));
});

test('a git checkout (stubbed): --ref HEAD resolves to the real SHA, clean files are committed, only read-only git runs', async () => {
  const d = gitRepo({ 'src/a.js': 'export const a = 1;\n', LICENSE: 'Permission is hereby granted, free of charge, to any person obtaining a copy\n' });
  const calls = stubGit({ 'rev-parse': { ok: true, code: 0, stdout: `${SHA}\n`, stderr: '' }, status: { ok: true, code: 0, stdout: '', stderr: '' }, 'ls-files': tracked('LICENSE', 'src/a.js') });
  const before = calls().length;
  const root = keep(tempDir());
  const r = await cli(['repo', 'init', 'g', '--repo', d, '--ref', 'HEAD', '--root', root, '--json']);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.json.ref, { kind: 'git', sha: SHA });
  assert.equal(r.json.sourceKind, 'git-repository');
  assert.equal(r.json.dirty, false);
  const lock = JSON.parse(fs.readFileSync(path.join(root, '.teachback', 'g', 'source-lock.json'), 'utf8'));
  assert.ok(lock.files.every((f) => f.state === 'committed'));
  const used = calls().slice(before).map((c) => c.args[0]);
  assert.deepEqual(used, ['rev-parse', 'status', 'ls-files']);
  assert.ok(used.every((s) => READ_ONLY_SUBCOMMANDS.includes(s)));
  assert.deepEqual(calls().at(-3).args, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
});

test('a dirty git checkout (stubbed) is refused without --allow-dirty, and marked dirtySource with it', async () => {
  const d = gitRepo({ 'src/a.js': 'export const a = 2;\n', 'src/new.js': 'export const n = 1;\n', 'src/same.js': 'x\n' });
  stubGit({ 'rev-parse': { ok: true, code: 0, stdout: `${SHA}\n` }, status: { ok: true, code: 0, stdout: ' M src/a.js\0?? src/new.js\0' }, 'ls-files': tracked('src/a.js', 'src/same.js') });
  const root = keep(tempDir());
  const no = await cli(['repo', 'init', 'd', '--repo', d, '--root', root, '--json']);
  assert.equal(no.code, 2);
  assert.equal(no.json.error.code, 'E611');
  assert.match(no.json.error.message, /src\/a\.js/);
  const yes = await cli(['repo', 'init', 'd', '--repo', d, '--allow-dirty', '--root', root, '--json']);
  assert.equal(yes.code, 0, yes.out);
  const lock = JSON.parse(fs.readFileSync(path.join(root, '.teachback', 'd', 'source-lock.json'), 'utf8'));
  assert.equal(lock.repo.dirty, true);
  assert.equal(lock.repo.dirtySource, true);
  assert.match(lock.repo.contentDigest, /^sha256:/);
  const state = Object.fromEntries(lock.files.map((f) => [f.path, f.state]));
  assert.deepEqual(state, { 'src/a.js': 'dirty', 'src/new.js': 'untracked', 'src/same.js': 'committed' });
});

test('git missing (stubbed as unavailable) falls back to a content digest with a warning; a ref other than HEAD is refused', async () => {
  const d = gitRepo({ 'a.py': 'x = 1\n' });
  stubGit({ 'rev-parse': { ok: false, unavailable: true, code: null, stdout: '', stderr: 'spawn git ENOENT' } });
  const s = await cli(['repo', 'scan', d, '--json']);
  assert.equal(s.json.ref.kind, 'worktree');
  assert.ok(s.json.warnings.some((w) => /falls back to a content digest/.test(w.message)));
  stubGit({ 'rev-parse': { ok: true, code: 0, stdout: `${SHA}\n` }, status: { ok: true, stdout: '' }, 'ls-files': tracked('a.py') });
  const root = keep(tempDir());
  const r = await cli(['repo', 'init', 'x', '--repo', d, '--ref', 'main~3', '--root', root, '--json']);
  assert.equal(r.code, 2);
  assert.equal(r.json.error.code, 'E633');
  const bad = await cli(['repo', 'init', 'x', '--repo', d, '--ref', SHA2, '--root', root, '--json']);
  assert.equal(bad.code, 2);
});

test('the git module refuses anything but its read-only subcommands and worktree add', () => {
  stubGit({});
  for (const args of [['push'], ['fetch'], ['reset', '--hard'], ['clean', '-fd'], ['checkout', 'main'], ['worktree', 'remove', 'x'], ['config', 'x']]) {
    assert.throws(() => gitRun(args, { cwd: '.' }), /not allowed/, args.join(' '));
  }
});

test('source-lock.json holds relative paths only; the absolute checkout path stays in .local-source.json', async () => {
  const root = keep(tempDir());
  const repo = copyCacheRepo();
  keep(repo);
  await cli(['repo', 'init', 'p', '--repo', repo, '--root', root, '--json']);
  const dir = path.join(root, '.teachback', 'p');
  const lockText = fs.readFileSync(path.join(dir, 'source-lock.json'), 'utf8');
  const mapText = fs.readFileSync(path.join(dir, 'repo-map.json'), 'utf8');
  assert.ok(!ABSOLUTE_PATH_PATTERN.test(lockText), 'no absolute path in the lock');
  assert.ok(!ABSOLUTE_PATH_PATTERN.test(mapText), 'no absolute path in the repo map');
  assert.ok(!lockText.includes(repo));
  const local = JSON.parse(fs.readFileSync(path.join(dir, '.local-source.json'), 'utf8'));
  assert.equal(local.repoPath, path.resolve(repo));
  assert.equal(local.trust, 'untrusted');
});

test('a public URL is accepted only as https://github.com/<owner>/<repo>', async () => {
  const root = keep(tempDir());
  const repo = keep(copyCacheRepo());
  const ok = await cli(['repo', 'init', 'u', '--repo', repo, '--public-url', 'https://github.com/example/cache-lib', '--root', root, '--json']);
  assert.equal(ok.code, 0, ok.out);
  for (const bad of ['http://github.com/a/b', 'https://gitlab.com/a/b', 'https://github.com/a/b/../../evil', 'javascript:alert(1)', 'https://github.com/a/b?x=<script>', 'file:///etc/passwd']) {
    const r = await cli(['repo', 'init', 'u2', '--repo', repo, '--public-url', bad, '--root', root, '--json']);
    assert.equal(r.code, 2, bad);
    assert.equal(r.json.error.code, 'E610', bad);
  }
});

// ---------------------------------------------------------------- verify
async function exampleCourse() {
  const root = keep(tempDir());
  const repo = keep(copyCacheRepo());
  assert.equal((await cli(['init', 'cache', '--from', CACHE_EXAMPLE, '--root', root, '--json'])).code, 0);
  const v = await cli(['repo', 'verify', 'cache', '--repo', repo, '--root', root, '--json']);
  return { root, repo, dir: path.join(root, '.teachback', 'cache'), v };
}

test('the shipped example verifies: every line range and needle is in the locked file', async () => {
  const { v, dir, repo } = await exampleCourse();
  assert.equal(v.code, 0, JSON.stringify(v.json?.errors ?? v.out));
  assert.equal(v.json.status, 'verified');
  assert.equal(v.json.refs.unverified_ref, 0);
  assert.ok(v.json.refs.verified >= 10);
  assert.equal(v.json.refs.inferred, 1, 'the inference is counted as inferred, not as verified');
  assert.equal(v.json.rememberedRepo, path.resolve(repo));
  assert.ok(fs.existsSync(path.join(dir, '.local-source.json')));
});

test('a wrong needle, an out-of-range line, an unknown file id and a ref with nothing to check are unverified (exit 1)', async () => {
  const { root, dir } = await exampleCourse();
  const map = JSON.parse(fs.readFileSync(path.join(dir, 'map.json'), 'utf8'));
  map.concepts[0].sourceRefs[0].needle = 'this.lastSeen = now';
  map.concepts[1].sourceRefs[0].endLine = 999;
  map.concepts[2].sourceRefs.push({ fileId: 'src-cache-ghost-js', startLine: 1, endLine: 2, needle: 'x' });
  map.concepts[2].sourceRefs.push({ fileId: 'src-cache-lru-js', startLine: 1, endLine: 2 });
  fs.writeFileSync(path.join(dir, 'map.json'), JSON.stringify(map, null, 2));
  const v = await cli(['repo', 'verify', 'cache', '--root', root, '--json']);
  assert.equal(v.code, 1);
  assert.equal(v.json.status, 'unverified');
  const codes = v.json.errors.map((e) => e.code).sort();
  assert.deepEqual(codes, ['R010', 'R012', 'R013', 'R016']);
  assert.ok(v.json.errors.every((e) => e.hint), 'every problem has a fix hint');
});

test('a changed file makes its refs source_stale (exit 2); a CRLF checkout of the same text does not', async () => {
  const { root, repo } = await exampleCourse();
  const file = path.join(repo, 'src', 'cache', 'lru.js');
  const text = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, text.replace(/\n/g, '\r\n'));
  const crlf = await cli(['repo', 'verify', 'cache', '--root', root, '--json']);
  assert.equal(crlf.json.status, 'verified', 'line endings alone do not make a file stale');
  fs.writeFileSync(file, text.replace('// Chooses which entry', '// Picks which entry'));
  const v = await cli(['repo', 'verify', 'cache', '--root', root, '--json']);
  assert.equal(v.code, 2);
  assert.equal(v.json.status, 'source_stale');
  assert.deepEqual(v.json.changedFiles.map((f) => f.path), ['src/cache/lru.js']);
  assert.ok(v.json.staleOwners.includes('concept:victim-choice'));
  assert.ok(v.json.staleOwners.includes('quest:locate-eviction'));
  assert.ok(!v.json.staleOwners.some((o) => o === 'quest:fix-eviction'), 'the patch quest cites only the test file, which did not change');
  fs.rmSync(path.join(repo, 'src', 'cache', 'entry.js'));
  const gone = await cli(['repo', 'verify', 'cache', '--root', root, '--json']);
  assert.ok(gone.json.changedFiles.some((f) => f.path === 'src/cache/entry.js' && f.status === 'missing'));
});

test('an edited source lock is detected by its own digest (exit 2)', async () => {
  const { root, dir } = await exampleCourse();
  const lock = JSON.parse(fs.readFileSync(path.join(dir, 'source-lock.json'), 'utf8'));
  lock.files[0].sha256 = '0'.repeat(64);
  fs.writeFileSync(path.join(dir, 'source-lock.json'), JSON.stringify(lock, null, 2));
  const v = await cli(['repo', 'verify', 'cache', '--root', root, '--json']);
  assert.equal(v.code, 2);
  assert.equal(v.json.error.code, 'E623');
  lock.files[0].path = '../outside.js';
  fs.writeFileSync(path.join(dir, 'source-lock.json'), JSON.stringify(lock, null, 2));
  const t = await cli(['repo', 'verify', 'cache', '--root', root, '--json']);
  assert.equal(t.json.error.code, 'E622');
});

test('a git lock whose commit moved (stubbed) keeps refs whose file hashes still match, with a warning', async () => {
  const d = gitRepo({ 'src/a.js': 'export function alpha() {\n  return 1;\n}\n' });
  stubGit({ 'rev-parse': { ok: true, code: 0, stdout: `${SHA}\n` }, status: { ok: true, stdout: '' }, 'ls-files': tracked('src/a.js') });
  const root = keep(tempDir());
  assert.equal((await cli(['repo', 'init', 'm', '--repo', d, '--root', root, '--json'])).code, 0);
  const dir = path.join(root, '.teachback', 'm');
  const lock = JSON.parse(fs.readFileSync(path.join(dir, 'source-lock.json'), 'utf8'));
  writeMinimalCourse(dir, lock);
  stubGit({ 'rev-parse': { ok: true, code: 0, stdout: `${SHA2}\n` } });
  const v = await cli(['repo', 'verify', 'm', '--root', root, '--json']);
  assert.equal(v.json.status, 'verified', JSON.stringify(v.json.errors));
  assert.ok(v.json.warnings.some((w) => w.code === 'R040'));
  assert.equal(v.json.checkoutHead, SHA2);
});
