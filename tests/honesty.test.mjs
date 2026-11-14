// What the CLI says matches what it does: help honours --json like every other
// command, and running the capstone before every concept is mastered says that
// a pass will not make the course Rebuilt yet.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cli, tempDir, rmDir, BLOOM } from './helpers/cli.mjs';

const root = tempDir('teachback-honesty-');
after(() => rmDir(root));

test('help --json, --help --json on a command, and --version --json print JSON', async () => {
  for (const args of [['help', '--json'], ['--help', '--json'], ['next', '--help', '--json'], ['--json']]) {
    const r = await cli(args);
    assert.equal(r.code, 0, args.join(' '));
    assert.ok(r.json, `${args.join(' ')} prints JSON`);
    const commands = r.json.sections.flatMap((s) => s.commands.map((c) => c.command));
    for (const c of ['init', 'next', 'grade', 'record', 'run', 'dashboard']) assert.ok(commands.includes(c), `${c} listed`);
    assert.ok(r.json.sections.every((s) => s.commands.every((c) => c.usage && c.description)), 'every command has a usage and a description');
  }
  const v = await cli(['--version', '--json']);
  assert.deepEqual(Object.keys(v.json), ['name', 'version']);
  const text = await cli(['help']);
  assert.match(text.out, /^ {2}next \[course\] +What to do now/m);
  assert.match(text.out, /^Global options$/m);
});

test('the capstone runs early for practice, and says it will not count toward Rebuilt until every concept is mastered', async () => {
  const base = ['--root', root, '--json'];
  assert.equal((await cli(['init', 'bloom', '--from', BLOOM, ...base])).code, 0);
  const course = path.join(root, '.teachback', 'bloom');
  const capstone = JSON.parse(fs.readFileSync(path.join(course, 'course.json'), 'utf8')).track.at(-1);
  const manifest = JSON.parse(fs.readFileSync(path.join(course, 'exercises', capstone, 'exercise.json'), 'utf8'));
  assert.equal(manifest.capstone, true);

  const created = await cli(['run', capstone, ...base]);
  assert.equal(created.json.status, 'created');
  assert.match(created.json.note, /counts as Rebuilt only once every concept is mastered/);
  const concepts = JSON.parse(fs.readFileSync(path.join(course, 'map.json'), 'utf8')).concepts;
  assert.equal(created.json.unmastered.length, concepts.length);

  fs.copyFileSync(path.join(course, 'exercises', capstone, '.reference', manifest.starter), path.join(course, 'work', capstone, manifest.starter));
  const passed = await cli(['run', capstone, ...base]);
  assert.equal(passed.json.status, 'passed');
  assert.equal(passed.json.firstPass, true);
  assert.equal(passed.json.rebuilt, false);
  assert.ok(passed.json.note, 'a passing capstone still carries the note');
  const textRun = await cli(['run', capstone, '--root', root]);
  assert.match(textRun.out, /^Note: This is the capstone\./m);

  // Place out of every concept; the early pass then makes the course Rebuilt.
  const items = JSON.parse(fs.readFileSync(path.join(course, 'items.json'), 'utf8')).items;
  for (const c of concepts) {
    const item = items.find((i) => i.concept === c.id && i.type !== 'code');
    assert.equal((await cli(['record', item.id, '--result', 'correct', '--confidence', '4', '--pretest', ...base])).code, 0);
  }
  const status = await cli(['status', ...base]);
  assert.equal(status.json.rebuilt, true, 'the kept pass counts once every concept is mastered');
  const again = await cli(['run', capstone, ...base]);
  assert.equal(again.json.note, undefined, 'no note once the course is Rebuilt');
  assert.equal(again.json.unmastered, undefined);

  const first = JSON.parse(fs.readFileSync(path.join(course, 'course.json'), 'utf8')).track[0];
  const other = await cli(['run', first, ...base]);
  assert.equal(other.json.note, undefined, 'other exercises carry no note');
});

test('status lists the concepts mastered today, for the end-of-session summary', async () => {
  const r = tempDir('teachback-today-');
  try {
    const base = ['--root', r, '--json'];
    await cli(['init', 'bloom', '--from', BLOOM, ...base]);
    const items = JSON.parse(fs.readFileSync(path.join(r, '.teachback', 'bloom', 'items.json'), 'utf8')).items;
    const [first, second] = JSON.parse(fs.readFileSync(path.join(r, '.teachback', 'bloom', 'map.json'), 'utf8')).concepts;
    const place = (concept, now) => cli(['record', items.find((i) => i.concept === concept.id && i.type !== 'code').id, '--result', 'correct', '--confidence', '4', '--pretest', ...base, '--now', now]);
    await place(first, '2026-03-02T09:00:00Z');
    await place(second, '2026-03-03T09:00:00Z');
    const s = await cli(['status', ...base, '--now', '2026-03-03T18:00:00Z']);
    assert.deepEqual(s.json.concepts.masteredToday, [second.id]);
    assert.equal(s.json.conceptList.find((c) => c.id === first.id).firstMasteredAt, '2026-03-02T09:00:00.000Z');
    const text = await cli(['status', '--root', r, '--now', '2026-03-03T18:00:00Z']);
    const line = text.out.split('\n').find((l) => l.startsWith('Mastered today'));
    assert.equal(line?.replace(/^Mastered today\s+/, ''), second.name);
  } finally {
    rmDir(r);
  }
});
