// repo scan: bounded, deterministic, ignore rules, lexical symbols with honest
// certainty, and links only where an import or a name convention supports them.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cli, rmDir } from './helpers/cli.mjs';
import { guardGit, makeRepo, CACHE_REPO } from './helpers/repoquest.mjs';
import { scanRepo, detectSpdx, LIMITS } from '../src/repo/scan.mjs';
import { extractSymbols } from '../src/repo/symbols.mjs';
import { compilePattern, matchRules } from '../src/repo/ignore.mjs';
import { checkRelPath } from '../src/repo/paths.mjs';
import { gitCalls } from '../src/repo/git.mjs';

guardGit();
const made = [];
const repo = (files) => {
  const d = makeRepo(files);
  made.push(d);
  return d;
};
after(() => made.forEach(rmDir));

const strip = (j) => {
  const { durationMs, ...rest } = j;
  return rest;
};

test('scanning the same folder twice gives identical output and digests, and no process starts', async () => {
  const before = gitCalls().length;
  const a = await cli(['repo', 'scan', CACHE_REPO, '--json']);
  const b = await cli(['repo', 'scan', CACHE_REPO, '--json']);
  assert.equal(a.code, 0, a.out);
  assert.deepEqual(strip(a.json), strip(b.json));
  assert.equal(a.json.sourceKind, 'worktree');
  assert.equal(a.json.ref.kind, 'worktree');
  assert.match(a.json.sourceManifestDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(gitCalls().length, before, 'a folder without its own .git starts no git process');
  const lru = a.json.files.find((f) => f.path === 'src/cache/lru.js');
  assert.equal(lru.role, 'source');
  assert.equal(a.json.files.find((f) => f.path === 'test/lru.test.js').role, 'test');
  assert.equal(a.json.files.find((f) => f.path === 'LICENSE').role, 'license');
});

test('CRLF and LF copies of a file hash the same; Unicode paths are kept and sorted', () => {
  const lf = repo({ 'src/a.js': 'export function a() {\n  return 1;\n}\n', 'src/naïve-ü.py': 'def f():\n    return 1\n' });
  const crlf = repo({ 'src/a.js': 'export function a() {\r\n  return 1;\r\n}\r\n', 'src/naïve-ü.py': 'def f():\r\n    return 1\r\n' });
  const x = scanRepo(lf);
  const y = scanRepo(crlf);
  assert.deepEqual(x.files.map((f) => [f.path, f.sha256, f.lineCount]), y.files.map((f) => [f.path, f.sha256, f.lineCount]));
  assert.deepEqual(x.files.map((f) => f.path), ['src/a.js', 'src/naïve-ü.py']);
  assert.equal(x.files[0].lineCount, 3);
  assert.deepEqual(x.symbols.map((s) => [s.name, s.startLine, s.endLine]), y.symbols.map((s) => [s.name, s.startLine, s.endLine]));
});

test('secrets, dependencies, build output, generated files, .git and .teachback are left out by default; .gitignore and --exclude apply', () => {
  const d = repo({
    'src/keep.js': 'export const x = 1;\n',
    '.env': 'API_KEY=sk-not-a-real-key-0000000000000000\n',
    '.env.local': 'X=1\n',
    'config/secrets/token.txt': 'secret\n',
    'id_rsa': 'key\n',
    'certs/server.pem': 'pem\n',
    'node_modules/dep/index.js': 'x\n',
    'vendor/lib.go': 'package lib\n',
    'dist/bundle.js': 'x\n',
    'app.min.js': 'x\n',
    '.teachback/course/learner.json': '{}\n',
    'datasets/big.json': '{}\n',
    'logs/out.log': 'log\n',
    'logs/keep.log': 'keep\n',
    'docs/drafts/a.md': 'x\n',
    '.gitignore': 'logs/*\n!logs/keep.log\n',
    '.git/HEAD': 'ref: refs/heads/main\n'
  });
  fs.rmSync(path.join(d, '.git'), { recursive: true, force: true }); // a plain folder: no git
  const s = scanRepo(d, { exclude: ['docs/drafts/'] });
  const paths = s.files.map((f) => f.path).sort();
  assert.deepEqual(paths, ['.gitignore', 'logs/keep.log', 'src/keep.js']);
  assert.ok(s.ignored.counts['default-excluded-file'] >= 4);
  assert.ok(s.ignored.counts['default-excluded-folder'] >= 5);
  assert.equal(s.ignored.counts.gitignore, 1);
  assert.equal(s.ignored.counts.exclude, 1);
  const inc = scanRepo(d, { include: ['src/**'] });
  assert.deepEqual(inc.files.map((f) => f.path), ['src/keep.js']);
});

test('gitignore patterns: anchoring, folders only, ** and negation', () => {
  const r = (p) => compilePattern(p);
  assert.equal(matchRules([r('/build')], 'build', true), true);
  assert.equal(matchRules([r('/build')], 'src/build', true), undefined);
  assert.equal(matchRules([r('tmp/')], 'a/tmp', true), true);
  assert.equal(matchRules([r('tmp/')], 'a/tmp', false), undefined);
  assert.equal(matchRules([r('**/gen/*.ts')], 'x/y/gen/a.ts', false), true);
  assert.equal(matchRules([r('*.log'), r('!keep.log')], 'a/keep.log', false), false);
});

test('symlinks are not followed by default, and one that escapes the repository is refused even with --follow-symlinks', (t) => {
  const outside = repo({ 'secret.txt': 'outside\n' });
  const d = repo({ 'src/a.js': 'export const a = 1;\n' });
  try {
    fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(d, 'src', 'link.txt'), 'file');
  } catch {
    // Windows without the symlink privilege: a directory junction is a link too,
    // and needs no privilege.
    try {
      fs.symlinkSync(outside, path.join(d, 'src', 'link.txt'), 'junction');
    } catch {
      t.skip('this machine allows neither symlinks nor junctions');
      return;
    }
  }
  const s = scanRepo(d);
  assert.deepEqual(s.files.map((f) => f.path), ['src/a.js']);
  assert.equal(s.ignored.counts.symlink, 1);
  const f = scanRepo(d, { followSymlinks: true });
  assert.deepEqual(f.files.map((x) => x.path), ['src/a.js']);
  assert.equal(f.ignored.counts['symlink-escape'], 1);
});

test('file and byte caps make the scan incomplete with a reason, repo init then refuses, and the hard cap cannot be raised', async () => {
  const files = {};
  for (let i = 0; i < 30; i++) files[`src/f${String(i).padStart(2, '0')}.js`] = `export const v${i} = ${i};\n`;
  const d = repo(files);
  const s = scanRepo(d, { maxFiles: 10 });
  assert.equal(s.complete, false);
  assert.equal(s.files.length, 10);
  assert.ok(s.warnings.some((w) => w.kind === 'partial_scan' && /--scope/.test(w.message)));
  const one = scanRepo(repo({ 'only.py': 'x = 1\n' }));
  assert.equal(one.complete, true);
  assert.equal(one.files.length, 1);
  const root = repo({});
  const init = await cli(['repo', 'init', 'whole', '--repo', d, '--root', root, '--json']);
  assert.equal(init.code, 0, 'the default cap is far above 30 files');
  const refused = await cli(['repo', 'init', 'cut', '--repo', d, '--max-files', '10', '--root', root, '--json']);
  assert.equal(refused.code, 2);
  assert.equal(refused.json.error.code, 'E632');
  assert.match(refused.json.error.hint, /--scope/);
  assert.equal(scanRepo(d, { maxFiles: 10 ** 9 }).complete, true, 'an oversized cap is clamped, not an error');
  assert.equal(LIMITS.hardMaxFiles, 200000);
  // A file over the per-file cap is listed as skipped, not read.
  const lg = repo({ 'big.txt': 'x'.repeat(2000), 'small.txt': 'y\n' });
  const capped = scanRepo(lg, { maxFileBytes: 1000 });
  assert.deepEqual(capped.files.map((f) => f.path), ['small.txt']);
  assert.equal(capped.ignored.counts['too-large'], 1);
  const bytes = scanRepo(d, { maxTotalBytes: 100 });
  assert.equal(bytes.complete, false);
  assert.ok(bytes.warnings.some((w) => w.kind === 'partial_scan' && /byte cap/.test(w.message)));
});

test('a scope that climbs out of the repository is refused with exit code 2', async () => {
  const d = repo({ 'f.js': 'export const x = 1;\n' });
  const root = repo({});
  const r = await cli(['repo', 'init', 'x', '--repo', d, '--scope', '../outside', '--root', root, '--json']);
  assert.equal(r.code, 2);
  assert.match(r.json.error.message, /not allowed/);
  const s = await cli(['repo', 'scan', d, '--scope', 'C:/Windows', '--json']);
  assert.equal(s.code, 2);
});

test('binary files are hashed but get no line count and no symbols', () => {
  const d = repo({ 'img.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 1, 2]), 'a.js': 'export function f() {}\n' });
  const s = scanRepo(d);
  const png = s.files.find((f) => f.path === 'img.png');
  assert.equal(png.binary, true);
  assert.equal(png.lineCount, undefined);
  assert.ok(!s.symbols.some((x) => x.fileId === png.id));
});

test('JavaScript and TypeScript symbols: classes, methods, functions, arrows, interfaces, types', () => {
  const js = [
    'export class Cache {',
    '  constructor(n) {',
    '    this.n = n;',
    '  }',
    '  get(key) {',
    '    if (key) {',
    "      return '{';",
    '    }',
    '  }',
    '}',
    'export async function load(x) {',
    '  return x;',
    '}',
    'export const add = (a, b) => {',
    '  return a + b;',
    '};',
    'function helper() { return 1; }'
  ].join('\n');
  const s = extractSymbols('javascript', js);
  const by = Object.fromEntries(s.map((x) => [x.name, x]));
  assert.deepEqual([by.Cache.startLine, by.Cache.endLine, by.Cache.kind, by.Cache.exported], [1, 10, 'class', true]);
  assert.deepEqual([by['Cache.get'].startLine, by['Cache.get'].endLine, by['Cache.get'].kind], [5, 9, 'method'], 'a brace inside a string does not end the method early');
  assert.deepEqual([by.load.startLine, by.load.endLine], [11, 13]);
  assert.deepEqual([by.add.kind, by.add.endLine], ['function', 16]);
  assert.equal(by.helper.exported, false);
  assert.ok(s.every((x) => x.certainty === 'lexically_detected'));
  const ts = extractSymbols('typescript', 'export interface Opts {\n  size: number;\n}\nexport type Key = string;\n');
  assert.deepEqual(ts.map((x) => [x.name, x.kind]), [['Opts', 'interface'], ['Key', 'type']]);
});

test('Python, Go and Rust symbols, and an unclosed body is marked unknown instead of guessed', () => {
  const py = extractSymbols('python', 'class Cache:\n    def get(self, k):\n        return k\n\n    def _evict(self):\n        pass\n\ndef build():\n    return Cache()\n');
  assert.deepEqual(py.map((x) => [x.name, x.kind, x.startLine, x.endLine, x.exported]), [
    ['Cache', 'class', 1, 6, true],
    ['Cache.get', 'method', 2, 3, true],
    ['Cache._evict', 'method', 5, 6, false],
    ['build', 'function', 8, 9, true]
  ]);
  const go = extractSymbols('go', 'package c\n\ntype Cache struct {\n\tn int\n}\n\nfunc (c *Cache) Evict() string {\n\treturn ""\n}\n\nfunc newCache() *Cache {\n\treturn nil\n}\n');
  assert.deepEqual(go.map((x) => [x.name, x.kind, x.startLine, x.endLine, x.exported]), [
    ['Cache', 'struct', 3, 5, true],
    ['Cache.Evict', 'method', 7, 9, true],
    ['newCache', 'function', 11, 13, false]
  ]);
  const rs = extractSymbols('rust', 'pub struct Cache {\n    n: usize,\n}\n\nimpl Cache {\n    pub fn evict(&mut self) -> Option<u32> {\n        None\n    }\n}\n\nfn helper() {}\n');
  assert.deepEqual(rs.map((x) => [x.name, x.kind, x.startLine, x.endLine]), [
    ['Cache', 'struct', 1, 3],
    ['Cache.evict', 'method', 6, 8],
    ['helper', 'function', 11, 11]
  ]);
  const broken = extractSymbols('javascript', 'export function open() {\n  if (x) {\n');
  assert.equal(broken[0].certainty, 'unknown');
  assert.equal(broken[0].endLine, null);
});

test('links come only from imports that resolve to scanned files (direct) or test name conventions (candidate); no call graph', () => {
  const d = repo({
    'src/cache.js': "import { util } from './util.js';\nexport function get() { return util(); }\n",
    'src/util.js': 'export function util() { return 1; }\n',
    'test/cache.test.js': "import { get } from '../src/cache.js';\n",
    'test/util.test.js': '// no import\n',
    'pkg/store.py': 'from .helpers import x\n',
    'pkg/helpers.py': 'x = 1\n',
    'tests/test_store.py': 'import os\n'
  });
  const s = scanRepo(d);
  const id = (p) => s.files.find((f) => f.path === p).id;
  const has = (from, to, kind, certainty) => s.links.some((l) => l.from === id(from) && l.to === id(to) && l.kind === kind && l.certainty === certainty);
  assert.ok(has('src/cache.js', 'src/util.js', 'imports', 'direct'));
  assert.ok(has('test/cache.test.js', 'src/cache.js', 'tests', 'direct'));
  assert.ok(has('test/util.test.js', 'src/util.js', 'tests_candidate', 'candidate'));
  assert.ok(has('pkg/store.py', 'pkg/helpers.py', 'imports', 'direct'));
  assert.ok(has('tests/test_store.py', 'pkg/store.py', 'tests_candidate', 'candidate'));
  assert.ok(s.links.every((l) => ['imports', 'tests', 'tests_candidate'].includes(l.kind)), 'no "calls" edges are ever produced');
});

test('licence detection is a guess: MIT is recognised, a proprietary notice is not, and verifiedByHuman is always false', () => {
  assert.equal(detectSpdx(fs.readFileSync(path.join(CACHE_REPO, 'LICENSE'), 'utf8')), 'MIT');
  assert.equal(detectSpdx('This is not the MIT License. Proprietary. All rights reserved.'), null);
  assert.equal(detectSpdx('Licensed under the Apache License, Version 2.0'), 'Apache-2.0');
  const none = scanRepo(repo({ 'a.js': 'x\n' }));
  assert.equal(none.license.detectedSpdx, null);
  assert.equal(none.license.verifiedByHuman, false);
  assert.ok(none.warnings.some((w) => w.kind === 'no_license_detected'));
  const fake = scanRepo(repo({ LICENSE: 'MIT License (just kidding). Proprietary, all rights reserved.\n', 'a.js': 'x\n' }));
  assert.equal(fake.license.detectedSpdx, null, 'the words "MIT License" alone are not enough');
  const unsupported = scanRepo(repo({ 'Main.java': 'class Main {}\n' }));
  assert.ok(unsupported.warnings.some((w) => w.kind === 'unsupported_language' && w.path === 'Main.java'));
});

test('path rules refuse traversal, absolute paths, backslashes, drive letters and URIs', () => {
  for (const bad of ['../x', 'a/../../x', '/etc/passwd', 'C:/x', 'a\\..\\b', 'file:///etc/passwd', 'a//b', './a', 'a/./b', '']) assert.equal(checkRelPath(bad).ok, false, bad);
  for (const good of ['src/cache/lru.js', 'naïve/ü.py', '.gitignore']) assert.equal(checkRelPath(good).ok, true, good);
});

test('repo scan --json reports errors as JSON with exit code 4 for a missing folder', async () => {
  const r = await cli(['repo', 'scan', path.join(CACHE_REPO, 'does-not-exist'), '--json']);
  assert.equal(r.code, 4);
  assert.equal(r.json.error.code, 'E601');
  const u = await cli(['repo', 'nonsense', '--json']);
  assert.equal(u.code, 2);
});
