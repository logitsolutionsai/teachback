// Regression tests for bugs found by hands-on QA. Each test names the bug it
// guards against.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { cli, tempDir, rmDir, EXAMPLE, BLOOM, FIXTURES, REPO } from './helpers/cli.mjs';
import { joinDashValues } from '../src/cli.mjs';
import { parseNumber, rubricCoverage } from '../src/grade.mjs';
import { masteryPercent } from '../src/util.mjs';
import { checkCourse } from '../src/check.mjs';
import { runExercise, pythonOverride } from '../src/runner.mjs';
import { loadCourse } from '../src/course.mjs';
import { replay } from '../src/model/learner.mjs';
import { computeStatus } from '../src/status.mjs';
import { renderDashboard } from '../src/dashboard.mjs';

const MINI = path.join(FIXTURES, 'mini');
const ENTRY = path.join(REPO, 'scripts', 'teachback.mjs');
let root;
const scratch = tempDir('teachback-regress-');
const learnerFile = () => path.join(root, '.teachback', 'mini', 'learner.json');
const writeLearner = (value) => fs.writeFileSync(learnerFile(), typeof value === 'string' ? value : JSON.stringify(value));
const at = (time) => ['--root', root, '--now', `2026-01-05T${time}:00Z`];

before(async () => {
  root = tempDir('teachback-regress-root-');
  const r = await cli(['init', 'mini', '--from', MINI, '--root', root, '--json']);
  assert.equal(r.code, 0, r.err);
});
after(() => {
  rmDir(root);
  rmDir(scratch);
});

// Copies the mini course and edits one of its JSON files.
function brokenCourse(name, file, change) {
  const dir = path.join(scratch, name);
  fs.cpSync(MINI, dir, { recursive: true });
  if (file) {
    const f = path.join(dir, file);
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    change(j, dir);
    fs.writeFileSync(f, JSON.stringify(j, null, 2));
  } else change(null, dir);
  return dir;
}

test('answers and notes that start with a dash are read as values, not refused as options', async () => {
  // Bug: parseArgs refused "--answer -0.5" (E200 "argument is ambiguous"), so a negative
  // numeric answer or "-inf before the softmax" could not be graded at all.
  fs.rmSync(learnerFile(), { force: true });
  const neg = await cli(['grade', 'a-num', '--answer', '-2', ...at('09:00'), '--json']);
  assert.equal(neg.code, 0, neg.out);
  assert.equal(neg.json.value, -2);
  assert.equal(neg.json.result, 'wrong');
  const short = await cli(['grade', 'a-num', '-a', '-2', ...at('09:00'), '--json']);
  assert.equal(short.json.value, -2);
  const text = await cli(['grade', 'a-tb', '--answer', '-inf hides the core of a', ...at('09:00'), '--json']);
  assert.equal(text.json.coverage.covered, 1);
  const note = await cli(['record', 'a-num', '--result', 'wrong', '--note', '- off by a sign', ...at('09:01'), '--json']);
  assert.equal(note.json.recorded.note, '- off by a sign');
  // A missing value is still a usage error, not swallowed as the answer "--json".
  const missing = await cli(['grade', 'a-num', '--answer', '--json', ...at('09:02')]);
  assert.equal(missing.code, 2);
  assert.deepEqual(joinDashValues(['x', '--answer', '-1', '--json'], { answer: { type: 'string' }, json: { type: 'boolean' } }), ['x', '--answer=-1', '--json']);
});

test('record refuses a code item: only passing the exercise answers it', async () => {
  // Bug: "record b-code --result correct" was accepted and counted as strong evidence.
  const r = await cli(['record', 'b-code', '--result', 'correct', ...at('09:10')]);
  assert.equal(r.code, 1);
  assert.match(r.err, /E103/);
  assert.match(r.err, /teachback run py-double/);
});

test('show without an item id says so instead of "No item """', async () => {
  const r = await cli(['show', ...at('09:10')]);
  assert.match(r.err, /E203: show needs an item id/);
});

test('numbers: a decimal comma or an infinite value is refused, not misread', () => {
  // Bug: "0,75" was read as 75 and "64,5" as 645 (graded wrong); "1e400" and "1/0" became Infinity.
  for (const bad of ['0,75', '64,5', '1,00', '1e400', '1/0']) assert.throws(() => parseNumber(bad), (e) => e.code === 'E102', bad);
  assert.equal(parseNumber('4,000'), 4000);
  assert.equal(parseNumber('1,234.5'), 1234.5);
  assert.equal(parseNumber('-12,500'), -12500);
});

test('an unmastered estimate never displays as the 95% mastery threshold', async () => {
  // Bug: P(L) = 0.9466 showed as "95%" next to "Almost there" and the threshold mark at 95%;
  // next said "Mastery estimate 70% is below 70%".
  assert.equal(masteryPercent(0.9466, false), 94);
  assert.equal(masteryPercent(0.9499, false), 94);
  assert.equal(masteryPercent(0.95, true), 95);
  assert.equal(masteryPercent(0.99, true), 99);
  assert.equal(masteryPercent(0.2, false), 20);
  assert.equal(masteryPercent(0.8, false, 0.8), 79);
  const dir = path.join(scratch, 'almost');
  fs.cpSync(MINI, dir, { recursive: true });
  const c = loadCourse(dir);
  // Concept a ends just under the threshold (0.9466): a correct mcq, then a correct numeric.
  const t = (m) => `2026-01-05T09:${String(m).padStart(2, '0')}:00.000Z`;
  const learner = {
    schema: 'teachback/learner@1', createdAt: t(0), settings: { utcOffsetMinutes: 0 },
    events: [
      { t: t(1), type: 'answer', item: 'a-mcq', concept: 'a', result: 'correct', mode: 'learn' },
      { t: t(2), type: 'answer', item: 'a-num', concept: 'a', result: 'correct', mode: 'learn' }
    ]
  };
  const pL = replay(c, learner).mastery.a.pL;
  assert.ok(pL >= 0.945 && pL < 0.95, `fixture should sit just under the threshold, got ${pL}`);
  const s = computeStatus(c, learner, new Date(t(30)));
  const html = renderDashboard(c, s);
  const row = html.slice(html.indexOf('data-concept="a"'), html.indexOf('</li>', html.indexOf('data-concept="a"')));
  assert.match(row, /Almost there/);
  assert.match(row, /class="crow-pct">94%</);
  assert.doesNotMatch(row, /crow-pct">95%/);
  fs.writeFileSync(path.join(dir, 'learner.json'), JSON.stringify(learner));
  const status = await cli(['status', '--course', dir, '--now', t(31)]);
  assert.match(status.out, / 94%  Concept A\n/);
});

test('a concept whose prior is already at the threshold counts as mastered everywhere', async () => {
  // Bug: pInit >= 0.95 made the dashboard say "Mastered" while next kept teaching it.
  const dir = brokenCourse('prior', 'map.json', (j) => {
    j.concepts[0].pInit = 0.96;
  });
  const next = await cli(['next', '--course', dir, '--now', '2026-01-05T09:00:00Z', '--json']);
  assert.notEqual(next.json.concept, 'a');
  const st = await cli(['status', '--course', dir, '--now', '2026-01-05T09:00:00Z', '--json']);
  assert.equal(st.json.conceptList.find((x) => x.id === 'a').mastered, true);
});

test('a hand-edited learner.json with a bad event is skipped with a warning, not a crash', async () => {
  // Bug: one null event, or one without a valid time, made every command (record
  // included) fail with E999 "This is a bug", locking the learner out.
  for (const bad of [null, { type: 'answer', item: 'a-mcq', result: 'correct' }, { t: 'yesterday', type: 'answer', item: 'a-mcq', result: 'correct' }]) {
    writeLearner({ schema: 'teachback/learner@1', createdAt: '2026-01-05T08:00:00Z', settings: { utcOffsetMinutes: 0 }, events: [bad] });
    for (const cmd of [['next'], ['status'], ['dashboard'], ['record', 'a-mcq', '--result', 'correct']]) {
      const r = await cli([...cmd, ...at('09:20'), '--json']);
      assert.equal(r.code, 0, `${cmd[0]} with ${JSON.stringify(bad)}: ${r.out}`);
    }
    const st = await cli(['status', ...at('09:21'), '--json']);
    assert.ok(st.json.warnings.some((w) => /no valid time/.test(w)), 'the skipped event is reported');
    const kept = JSON.parse(fs.readFileSync(learnerFile(), 'utf8')).events;
    assert.equal(kept.length, 2, 'the bad event is kept in the file, not silently deleted');
  }
});

test('a learner.json whose events or UTC offset are the wrong type gets a clear error', async () => {
  writeLearner({ schema: 'teachback/learner@1', settings: { utcOffsetMinutes: 0 }, events: { a: 1 } });
  const ev = await cli(['next', ...at('09:30')]);
  assert.match(ev.err, /E003: learner.json: "events" must be a list/);
  assert.match(ev.err, /fix: /);
  writeLearner({ schema: 'teachback/learner@1', settings: { utcOffsetMinutes: 'abc' }, events: [] });
  const off = await cli(['record', 'a-mcq', '--result', 'correct', ...at('09:30')]);
  assert.match(off.err, /E003: learner.json: settings.utcOffsetMinutes/);
  fs.rmSync(learnerFile());
  const saved = process.env.TEACHBACK_UTC_OFFSET;
  process.env.TEACHBACK_UTC_OFFSET = '+05:30';
  try {
    const env = await cli(['record', 'a-mcq', '--result', 'correct', ...at('09:31')]);
    assert.match(env.err, /E901: TEACHBACK_UTC_OFFSET/);
    assert.equal(fs.existsSync(learnerFile()), false, 'nothing is written with an unusable offset');
  } finally {
    process.env.TEACHBACK_UTC_OFFSET = saved;
  }
});

test('concurrent record commands never lose an event', async () => {
  // Bug: each command read, appended and renamed learner.json without a lock, so
  // two at once kept only one event (23 of 25 survived; one crashed with EPERM).
  fs.rmSync(learnerFile(), { force: true });
  const N = 12;
  const env = { ...process.env, TEACHBACK_NOW: '2026-01-05T10:00:00Z', TEACHBACK_UTC_OFFSET: '0' };
  const runs = Array.from({ length: N }, (_, i) =>
    new Promise((resolve) => {
      const p = spawn(process.execPath, [ENTRY, 'record', 'a-mcq', '--result', 'correct', '--note', `n${i}`, '--root', root], { env });
      let err = '';
      p.stderr.on('data', (b) => (err += b));
      p.on('close', (code) => resolve({ code, err }));
    })
  );
  const results = await Promise.all(runs);
  for (const r of results) assert.equal(r.code, 0, r.err);
  const events = JSON.parse(fs.readFileSync(learnerFile(), 'utf8')).events;
  assert.equal(events.length, N);
  assert.deepEqual(new Set(events.map((e) => e.note)).size, N);
  assert.equal(fs.existsSync(`${learnerFile()}.lock`), false, 'the lock is released');
});

test('a system clock that goes backwards cannot reorder the history', async () => {
  // Bug: an answer stamped before the last event was replayed before it, so the
  // newest answer silently stopped being the latest one.
  fs.rmSync(learnerFile(), { force: true });
  const future = await cli(['record', 'a-mcq', '--result', 'correct', '--root', root, '--now', '2099-01-01T09:00:00Z', '--json']);
  assert.equal(future.code, 0);
  const saved = process.env.TEACHBACK_NOW;
  delete process.env.TEACHBACK_NOW;
  try {
    const now = await cli(['record', 'a-mcq', '--result', 'wrong', '--root', root, '--json']);
    assert.equal(now.json.recorded.t, '2099-01-01T09:00:00.000Z');
    assert.match(now.json.warning, /clock .* is behind the last recorded event/);
  } finally {
    if (saved !== undefined) process.env.TEACHBACK_NOW = saved;
  }
  const events = JSON.parse(fs.readFileSync(learnerFile(), 'utf8')).events;
  assert.deepEqual(events.map((e) => e.result), ['correct', 'wrong']);
  const st = await cli(['status', '--root', root, '--now', '2099-01-01T10:00:00Z', '--json']);
  assert.equal(st.json.conceptList.find((c) => c.id === 'a').wrong, 1);
});

test('--timeout is validated, and the timeout message keeps fractions of a second', async () => {
  // Bug: --timeout abc, 0 or -5 ran with a 1 ms timer (Node warnings, an instant TIMEOUT);
  // 1500 ms was reported as "Stopped after 2 s".
  for (const v of ['abc', '0', '50', '9999999999']) {
    const r = await cli(['run', 'py-double', '--timeout', v, ...at('09:40')]);
    assert.match(r.err, /E206/, v);
  }
  const loop = path.join(scratch, 'loop.py');
  fs.writeFileSync(loop, 'while True:\n    pass\n');
  const ex = { ...loadCourse(MINI).exercises.get('py-double') };
  const res = await runExercise(ex, loop, { timeoutMs: 1500 });
  assert.equal(res.status, 'timeout');
  assert.match(res.message, /Stopped after 1\.5 s/);
});

test('a solution that prints megabytes still gets its tests read', async () => {
  // Bug: output was capped at 256 KB from the start, so the result line at the end was
  // lost and a correct solution was reported as "ERROR. The test run ended without a result."
  const big = path.join(scratch, 'big.py');
  fs.writeFileSync(big, 'import sys\nsys.stdout.write("x" * 3000000 + "\\n")\ndef double(x):\n    return 2 * x\n');
  const ex = { ...loadCourse(MINI).exercises.get('py-double') };
  const res = await runExercise(ex, big);
  assert.equal(res.status, 'passed', res.message);
  const wrong = path.join(scratch, 'big-wrong.py');
  fs.writeFileSync(wrong, 'print("y" * 3000000)\ndef double(x):\n    return x\n');
  const bad = await runExercise(ex, wrong);
  assert.equal(bad.status, 'failed');
  assert.ok(bad.output.length < 2000, 'one huge line is cut down in the summary');
});

test('TEACHBACK_PYTHON may be a full path with spaces, quoted or not', () => {
  // Bug: the value was split on spaces, so "C:\Users\Jane Doe\...\python.exe" never worked.
  const dir = path.join(scratch, 'Program Files', 'Python 3');
  fs.mkdirSync(dir, { recursive: true });
  const exe = path.join(dir, 'python.exe');
  fs.writeFileSync(exe, '');
  assert.deepEqual(pythonOverride(exe), [exe]);
  assert.deepEqual(pythonOverride(`"${exe}"`), [exe]);
  assert.deepEqual(pythonOverride(`"${exe}" -X utf8`), [exe, '-X', 'utf8']);
  assert.deepEqual(pythonOverride('py -3'), ['py', '-3']);
  assert.equal(pythonOverride('  '), null);
});

test('rubric coverage credits a plain match even when another synonym sits next to a negation', () => {
  // Bug: the first synonym found decided; "cannot see the future ... later positions" was
  // flagged as negated although "later positions" appears plainly.
  const rubric = { required: [{ id: 'f', idea: 'No peeking', synonyms: ['future', 'later positions'] }] };
  const cv = rubricCoverage(rubric, 'It cannot see the future, so it only attends to later positions masked out');
  assert.equal(cv.required[0].covered, true);
  assert.equal(cv.required[0].negated, false);
  assert.equal(cv.required[0].matched, 'later positions');
  const twice = rubricCoverage(rubric, 'not the future; the future is masked');
  assert.equal(twice.required[0].negated, false, 'a later, plain occurrence of the same phrase counts');
  const onlyNegated = rubricCoverage(rubric, 'it never sees the future');
  assert.equal(onlyNegated.required[0].negated, true);
});

test('check W112: a model answer must meet its own rubric (and the shipped courses do)', async () => {
  // Bug: in both shipped courses some model answers scored "partial" on their own rubric,
  // so a learner answering in the same words was marked down. check did not notice.
  const dir = brokenCourse('w112', 'items.json', (j) => {
    const tb = j.items.find((i) => i.id === 'a-tb');
    tb.modelAnswer = 'Something that never names the idea.';
  });
  const r = await checkCourse(dir, { exercises: false });
  const w = r.warnings.find((p) => p.code === 'W112');
  assert.ok(w, 'W112 reported');
  assert.match(w.message, /"a-tb" does not show rubric idea "core"/);
  for (const course of [EXAMPLE, BLOOM]) {
    const c = loadCourse(course);
    for (const it of c.itemList.filter((i) => i.rubric && i.modelAnswer)) {
      const cv = rubricCoverage(it.rubric, it.modelAnswer);
      assert.equal(cv.covered, cv.total, `${it.id}: model answer covers every idea`);
      assert.ok(!cv.misconceptions.some((m) => m.present && !m.negated), `${it.id}: no misconception fires on the model answer`);
    }
  }
});

test('check catches duplicate exercise ids, a repeated track entry and an exercise with no concepts', async () => {
  const dup = brokenCourse('dup-ex', null, (_, dir) => fs.cpSync(path.join(dir, 'exercises', 'py-double'), path.join(dir, 'exercises', 'py-double-copy'), { recursive: true }));
  const a = await checkCourse(dup, { exercises: false });
  assert.ok(a.errors.some((p) => p.code === 'E043' && /py-double-copy/.test(p.message)));
  const twice = brokenCourse('dup-track', 'course.json', (j) => {
    j.track = ['py-double', 'py-double', 'js-double'];
  });
  const b = await checkCourse(twice, { exercises: false });
  assert.ok(b.errors.some((p) => p.code === 'E044'));
  const none = brokenCourse('no-concepts', path.join('exercises', 'py-double', 'exercise.json'), (j) => {
    j.concepts = [];
  });
  const c = await checkCourse(none, { exercises: false });
  assert.ok(c.warnings.some((p) => p.code === 'W123'));
});

test('check explains a test that always passes', async () => {
  const dir = brokenCourse('always', null, (_, d) =>
    fs.writeFileSync(path.join(d, 'exercises', 'js-double', 'double.test.mjs'), "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('x', () => assert.ok(true));\n")
  );
  const r = await checkCourse(dir, { timeoutMs: 30000 });
  const e = r.errors.find((p) => p.code === 'E051');
  assert.ok(e);
  assert.match(e.hint, /never call the starter or never check its result/);
});

test('the capstone TASK.md says which signatures differ from exercises 2 and 4', () => {
  // Bug: "bring in your own attention and multi_head_attention" led a learner to paste
  // exercise 2 and 4 code, which fails two capstone tests (different return value and arguments).
  const task = fs.readFileSync(path.join(EXAMPLE, 'exercises', '06-encoder-layer', 'TASK.md'), 'utf8');
  assert.match(task, /`attention\(Q, K, V\)` returns only the output matrix/);
  assert.match(task, /`multi_head_attention\(X, params\)` is self-attention/);
});
