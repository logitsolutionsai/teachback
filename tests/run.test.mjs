// run: Python and JavaScript exercises, compact failure summaries, timeouts,
// a confined working folder, and recording through the CLI.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runExercise, detectPython, formatRun } from '../src/runner.mjs';
import { cli, tempDir, rmDir, FIXTURES } from './helpers/cli.mjs';

const MINI = path.join(FIXTURES, 'mini');
const py = { id: 'py-double', language: 'python', starter: 'double.py', tests: 'test_double.py', dir: path.join(MINI, 'exercises', 'py-double') };
const js = { id: 'js-double', language: 'javascript', starter: 'double.mjs', tests: 'double.test.mjs', dir: path.join(MINI, 'exercises', 'js-double') };
const scratch = tempDir('teachback-run-test-');
after(() => rmDir(scratch));

function solution(name, text) {
  const f = path.join(scratch, name);
  fs.writeFileSync(f, text);
  return f;
}

test('a Python 3 interpreter is detected', () => {
  const p = detectPython();
  assert.ok(p, 'python3, python or py -3 must be available for these tests');
  assert.match(p.version, /Python 3\./);
});

test('Python: the reference passes and the starter fails with a compact summary', async () => {
  const ok = await runExercise(py, path.join(py.dir, '.reference', 'double.py'));
  assert.equal(ok.status, 'passed');
  assert.deepEqual([ok.passed, ok.total], [3, 3]);
  const bad = await runExercise(py, path.join(py.dir, 'double.py'));
  assert.equal(bad.status, 'failed');
  assert.equal(bad.passed, 0);
  assert.equal(bad.errors, 3);
  assert.match(bad.tests[0].message, /NotImplementedError: double: your code here/);
  assert.equal(bad.tests[0].where, 'double.py:2', 'points at the line in the learner file');
  const text = formatRun(bad, { title: 'Double' });
  assert.match(text, /^Double: FAILED 0\/3 tests passed/);
  assert.match(text, /x test_negative \(double\.py:2\): NotImplementedError/);
});

test('Python: a partly right solution reports which tests fail', async () => {
  const f = solution('double.py', 'def double(x):\n    return abs(2 * x)\n');
  const r = await runExercise(py, f);
  assert.equal(r.status, 'failed');
  assert.deepEqual([r.passed, r.failed, r.total], [2, 1, 3]);
  const failing = r.tests.find((t) => t.status === 'fail');
  assert.equal(failing.name, 'test_negative');
  assert.match(failing.message, /AssertionError: 6 != -6/);
});

test('Python: a syntax error is reported as an error, not a crash', async () => {
  const f = solution('double.py', 'def double(x)\n    return 2 * x\n');
  const r = await runExercise(py, f);
  assert.equal(r.status, 'failed');
  assert.equal(r.passed, 0);
  assert.ok(r.tests.some((t) => /SyntaxError/.test(t.message ?? '')), JSON.stringify(r.tests));
});

test('Python: an infinite loop is stopped by the timeout', async () => {
  const f = solution('double.py', 'def double(x):\n    while True:\n        pass\n');
  const t0 = Date.now();
  const r = await runExercise(py, f, { timeoutMs: 1500 });
  assert.equal(r.status, 'timeout');
  assert.ok(Date.now() - t0 < 10000, 'returns soon after the timeout');
  assert.match(formatRun(r), /TIMEOUT/);
});

test('JavaScript: the reference passes and the starter fails', async () => {
  const ok = await runExercise(js, path.join(js.dir, '.reference', 'double.mjs'));
  assert.equal(ok.status, 'passed', JSON.stringify(ok));
  assert.deepEqual([ok.passed, ok.total], [3, 3]);
  const bad = await runExercise(js, path.join(js.dir, 'double.mjs'));
  assert.equal(bad.status, 'failed');
  assert.equal(bad.passed, 0);
  assert.match(bad.tests[0].message, /double: your code here/);
});

test('JavaScript: a partly right solution and an infinite loop', async () => {
  const partly = await runExercise(js, solution('double.mjs', 'export function double(x) { return Math.abs(2 * x); }\n'));
  assert.deepEqual([partly.status, partly.passed, partly.total], ['failed', 2, 3]);
  assert.match(partly.tests.find((t) => t.status === 'fail').message, /-6/);
  const loop = await runExercise(js, solution('double.mjs', 'export function double(x) { while (true) {} }\n'), { timeoutMs: 1500 });
  assert.equal(loop.status, 'timeout');
});

test('the working folder is a throwaway copy: the exercise folder is never written to', async () => {
  const f = solution('double.py', 'import os\nopen("touched.txt", "w").write(os.getcwd())\n\ndef double(x):\n    return 2 * x\n');
  const before = fs.readdirSync(py.dir).sort();
  const r = await runExercise(py, f);
  assert.equal(r.status, 'passed');
  assert.deepEqual(fs.readdirSync(py.dir).sort(), before, 'no files appear in the exercise folder');
  assert.ok(!fs.existsSync(path.join(path.dirname(f), 'touched.txt')), 'nor next to the solution file');
});

test('CLI run: creates a work copy, records each run, and counts the first pass as evidence', async () => {
  const root = tempDir('teachback-cli-run-');
  try {
    await cli(['init', 'mini', '--from', MINI, '--root', root]);
    const base = ['--root', root, '--json', '--now', '2026-01-05T09:00:00Z'];
    const created = await cli(['run', 'py-double', ...base]);
    assert.equal(created.json.status, 'created');
    assert.ok(fs.existsSync(created.json.workFile));
    assert.ok(!fs.existsSync(path.join(path.dirname(created.json.workFile), '.reference')), 'the work copy has no reference solution');
    const fail = await cli(['run', 'py-double', ...base]);
    assert.equal(fail.code, 1);
    assert.equal(fail.json.status, 'failed');
    assert.equal(fail.json.recorded, true);
    fs.writeFileSync(created.json.workFile, 'def double(x):\n    return 2 * x\n');
    const pass = await cli(['run', 'py-double', ...base]);
    assert.equal(pass.code, 0);
    assert.equal(pass.json.firstPass, true);
    const status = (await cli(['status', ...base])).json;
    assert.equal(status.exercises.passed, 1);
    const ex = status.exercises.list.find((e) => e.id === 'py-double');
    assert.deepEqual([ex.status, ex.runs], ['passed', 2]);
    assert.equal(status.conceptList.find((c) => c.id === 'b').attempts, 1, 'the pass counted once for concept b');
    const js = await cli(['run', 'js-double', path.join(MINI, 'exercises', 'js-double', '.reference', 'double.mjs'), ...base]);
    assert.equal(js.json.status, 'passed');
    const noRecord = await cli(['run', 'py-double', '--no-record', ...base]);
    assert.equal(noRecord.json.recorded, false);
    assert.equal((await cli(['status', ...base])).json.activity.runs, 3);
  } finally {
    rmDir(root);
  }
});
