// check: one test per class of broken course. Each case copies the valid
// fixture course (tests/fixtures/mini), applies one named breakage, and expects
// the matching error code with a fix hint.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { checkCourse, CODES } from '../src/check.mjs';
import { copyDir } from '../src/util.mjs';
import { cli, tempDir, rmDir, FIXTURES } from './helpers/cli.mjs';

const MINI = path.join(FIXTURES, 'mini');
const made = [];
after(() => made.forEach(rmDir));

function brokenCopy(mutate) {
  const dir = tempDir('teachback-check-');
  made.push(dir);
  copyDir(MINI, dir);
  const edit = (file, fn) => {
    const p = path.join(dir, file);
    const v = JSON.parse(fs.readFileSync(p, 'utf8'));
    fn(v);
    fs.writeFileSync(p, JSON.stringify(v, null, 2));
  };
  mutate({ dir, edit, write: (file, text) => fs.writeFileSync(path.join(dir, file), text) });
  return dir;
}

async function codesFor(dir, opts) {
  const r = await checkCourse(dir, opts);
  for (const p of r.errors) assert.ok(p.hint && p.hint.length > 5, `${p.code} has a fix hint`);
  return { r, codes: r.errors.map((e) => e.code) };
}

test('the fixture course is clean, exercises included', async () => {
  const r = await checkCourse(MINI);
  assert.equal(r.ok, true, JSON.stringify(r.errors, null, 2));
  assert.deepEqual(r.warnings, []);
  assert.equal(r.exercisesVerified, true);
  assert.deepEqual(r.exercises.map((e) => [e.id, e.reference.status, e.starter.status]), [
    ['py-double', 'passed', 'failed'],
    ['js-double', 'passed', 'failed']
  ]);
  assert.equal(r.stats.layers, 3);
});

test('a prerequisite cycle is reported with its path (E013)', async () => {
  const dir = brokenCopy(({ edit }) => edit('map.json', (m) => (m.concepts[0].prerequisites = ['c'])));
  const { r, codes } = await codesFor(dir, { exercises: false });
  assert.ok(codes.includes('E013'));
  const msg = r.errors.find((e) => e.code === 'E013').message;
  assert.match(msg, /cycle: (a -> b -> c -> a|b -> c -> a -> b|c -> a -> b -> c)/);
});

test('a missing prerequisite (E012)', async () => {
  const dir = brokenCopy(({ edit }) => edit('map.json', (m) => m.concepts[1].prerequisites.push('ghost')));
  const { r, codes } = await codesFor(dir, { exercises: false });
  assert.deepEqual(codes, ['E012']);
  assert.match(r.errors[0].message, /"b" lists prerequisite "ghost"/);
});

test('a concept with too few items (E015) and with only one item type (E016)', async () => {
  const few = brokenCopy(({ edit }) => edit('items.json', (f) => (f.items = f.items.filter((i) => i.id !== 'a-num'))));
  assert.deepEqual((await codesFor(few, { exercises: false })).codes, ['E015']);
  const oneType = brokenCopy(({ edit }) =>
    edit('items.json', (f) => {
      for (const i of f.items.filter((x) => x.concept === 'a')) {
        i.type = 'numeric';
        i.answer = 1;
        delete i.options;
        delete i.rubric;
      }
    })
  );
  assert.ok((await codesFor(oneType, { exercises: false })).codes.includes('E016'));
});

test('a bad MCQ answer index (E024) and an option without a rationale (E026)', async () => {
  const dir = brokenCopy(({ edit }) =>
    edit('items.json', (f) => {
      f.items.find((i) => i.id === 'a-mcq').answer = 3;
      f.items.find((i) => i.id === 'b-mcq').options[1].rationale = ' ';
    })
  );
  const { r, codes } = await codesFor(dir, { exercises: false });
  assert.deepEqual(codes.sort(), ['E024', 'E026']);
  assert.match(r.errors.find((e) => e.code === 'E024').message, /answer 3, but options run 0-2/);
});

test('items: unknown concept (E021), empty rubric (E022), idea without synonyms (E023), unknown exercise (E028)', async () => {
  const dir = brokenCopy(({ edit }) =>
    edit('items.json', (f) => {
      f.items.push({ id: 'stray', concept: 'zzz', type: 'numeric', prompt: '?', answer: 1 });
      f.items.find((i) => i.id === 'a-tb').rubric.required = [];
      f.items.find((i) => i.id === 'b-tb').rubric.required[0].synonyms = [];
      f.items.find((i) => i.id === 'b-code').exercise = 'nope';
    })
  );
  const { codes } = await codesFor(dir, { exercises: false });
  for (const c of ['E021', 'E022', 'E023', 'E028']) assert.ok(codes.includes(c), `${c} in ${codes}`);
});

test('duplicate ids (E011, E020), missing sources (E014) and schema shape errors (E003)', async () => {
  const dir = brokenCopy(({ edit }) => {
    edit('map.json', (m) => {
      m.concepts[2].sources = [];
      m.concepts[1].difficulty = 9;
    });
    edit('items.json', (f) => (f.items.find((i) => i.id === 'c-num').id = 'c-mcq'));
  });
  const { r, codes } = await codesFor(dir, { exercises: false });
  for (const c of ['E014', 'E020', 'E003']) assert.ok(codes.includes(c), `${c} in ${codes}`);
  assert.match(r.errors.find((e) => e.code === 'E003').message, /concepts\[1\]\.difficulty must be at most 5/);
  const dup = brokenCopy(({ edit }) => edit('map.json', (m) => m.concepts.push({ ...m.concepts[0] })));
  assert.ok((await codesFor(dup, { exercises: false })).codes.includes('E011'));
});

test('invalid JSON is reported, not thrown (E002)', async () => {
  const dir = brokenCopy(({ write }) => write('items.json', '{ "schema": "teachback/items@1", "items": [ }'));
  const { codes } = await codesFor(dir, { exercises: false });
  assert.ok(codes.includes('E002'));
});

test('an exercise whose reference fails (E050), a starter that passes (E051), a missing file (E040)', async () => {
  const refFails = brokenCopy(({ write }) => write('exercises/py-double/.reference/double.py', 'def double(x):\n    return x + x if x else 1\n'));
  const a = await codesFor(refFails);
  assert.deepEqual(a.codes, ['E050']);
  assert.match(a.r.errors[0].message, /reference solution for "py-double" fails/);
  assert.match(a.r.errors[0].message, /FAILED 2\/3/);
  const starterPasses = brokenCopy(({ write }) => write('exercises/js-double/double.mjs', 'export function double(x) { return 2 * x; }\n'));
  assert.deepEqual((await codesFor(starterPasses)).codes, ['E051']);
  const missing = brokenCopy(({ dir }) => fs.rmSync(path.join(dir, 'exercises', 'py-double', 'TASK.md')));
  assert.deepEqual((await codesFor(missing)).codes, ['E040']);
});

test('the CLI exits 1 on errors and prints codes with fix hints; --json gives the same data', async () => {
  const dir = brokenCopy(({ edit }) => edit('map.json', (m) => m.concepts[1].prerequisites.push('ghost')));
  const text = await cli(['check', dir, '--skip-exercises']);
  assert.equal(text.code, 1);
  assert.match(text.out, /ERROR E012 map\.json/);
  assert.match(text.out, /fix: Add a concept "ghost"/);
  assert.match(text.out, /FAILED: 1 error/);
  const json = await cli(['check', dir, '--skip-exercises', '--json']);
  assert.equal(json.json.ok, false);
  assert.equal(json.json.errors[0].code, 'E012');
  const codes = await cli(['check', '--codes', '--json']);
  assert.deepEqual(codes.json, CODES);
});
