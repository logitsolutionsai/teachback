// CLI behaviour: init, course resolution, errors with codes and hints,
// pretest placement, show, grade --record, status, dashboard, Anki export,
// learner.json against its schema, and the real entry point (scripts/teachback.mjs).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cli, tempDir, rmDir, EXAMPLE, FIXTURES, REPO } from './helpers/cli.mjs';
import { validateFile } from '../src/schema.mjs';

const MINI = path.join(FIXTURES, 'mini');
let root;
const at = (time) => ['--root', root, '--now', `2026-01-05T${time}:00Z`];

before(async () => {
  root = tempDir('teachback-cli-');
  const r = await cli(['init', 'mini', '--from', MINI, '--root', root, '--json']);
  assert.equal(r.code, 0, r.err);
});
after(() => rmDir(root));

test('init scaffolds an empty course that check reports as unfinished', async () => {
  const r = await cli(['init', 'Attention Paper!', '--title', 'Attention Is All You Need', '--source', 'https://arxiv.org/abs/1706.03762', '--root', root, '--json']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.slug, 'attention-paper');
  const dir = r.json.created;
  const course = JSON.parse(fs.readFileSync(path.join(dir, 'course.json'), 'utf8'));
  assert.deepEqual(course.source, { title: 'Attention Is All You Need', url: 'https://arxiv.org/abs/1706.03762' });
  assert.deepEqual(validateFile(course, 'course'), []);
  const check = await cli(['check', dir, '--json']);
  assert.equal(check.code, 1);
  assert.deepEqual(check.json.errors.map((e) => e.code), ['E010']);
  const again = await cli(['init', 'attention-paper', '--title', 'x', '--source', 'y', '--root', root]);
  assert.equal(again.code, 1);
  assert.match(again.err, /E211/);
  assert.match(again.err, /fix: /);
  const missing = await cli(['init', 'z', '--root', root]);
  assert.match(missing.err, /E213/);
  // Two courses now exist: commands need to know which, and "use" chooses.
  const list = await cli(['list', '--root', root, '--json']);
  assert.deepEqual(list.json.courses, ['attention-paper', 'mini']);
  const use = await cli(['use', 'mini', '--root', root, '--json']);
  assert.equal(use.json.current, 'mini');
});

test('errors carry a code and a fix hint, in text and in JSON', async () => {
  const unknownItem = await cli(['record', 'a-mc', '--result', 'correct', ...at('09:00')]);
  assert.equal(unknownItem.code, 1);
  assert.match(unknownItem.err, /error E201: No item "a-mc"/);
  assert.match(unknownItem.err, /Did you mean: a-mcq/);
  const badResult = await cli(['record', 'a-mcq', '--result', 'maybe', ...at('09:00'), '--json']);
  assert.equal(badResult.json.error.code, 'E204');
  const badConfidence = await cli(['record', 'a-mcq', '--result', 'correct', '--confidence', '5', ...at('09:00')]);
  assert.match(badConfidence.err, /E202/);
  const typo = await cli(['record', 'a-mcq', '--reslt', 'correct', ...at('09:00')]);
  assert.equal(typo.code, 2, 'unknown options are usage errors');
  const unknownCmd = await cli(['teach']);
  assert.match(unknownCmd.err, /E200/);
  const empty = tempDir('teachback-empty-');
  const noCourse = await cli(['status', '--root', empty]);
  rmDir(empty);
  assert.match(noCourse.err, /E001: No course found/);
  const badTime = await cli(['status', '--root', root, '--now', 'yesterday']);
  assert.match(badTime.err, /E900/);
});

test('grade --record handles mcq and numeric, refuses short and teach-back answers', async () => {
  const mcq = await cli(['grade', 'a-mcq', '--answer', 'A', '--confidence', '3', '--record', ...at('09:01'), '--json']);
  assert.equal(mcq.json.result, 'correct');
  assert.equal(mcq.json.recorded.recorded.answer, 'A');
  assert.equal(mcq.json.recorded.concept.id, 'a');
  const num = await cli(['grade', 'a-num', '--answer', '2.004', ...at('09:02'), '--json']);
  assert.equal(num.json.result, 'correct');
  assert.equal(num.json.recorded, null, 'without --record nothing is stored');
  const tb = await cli(['grade', 'a-tb', '--answer', 'the heart of a is this', '--record', ...at('09:03')]);
  assert.equal(tb.code, 1);
  assert.match(tb.err, /E105/);
  const evidence = await cli(['grade', 'a-tb', '--answer', 'the heart of a is this, a is magic', ...at('09:03')]);
  assert.match(evidence.out, /Rubric coverage 1\/1/);
  assert.match(evidence.out, /\[!\] misconception/);
  assert.match(evidence.out, /teachback record a-tb --result/);
});

test('record reports the mastery change and the next review', async () => {
  const r = await cli(['record', 'a-tb', '--result', 'correct', '--confidence', '4', '--note', 'clear explanation', ...at('09:04'), '--json']);
  assert.equal(r.code, 0);
  assert.ok(r.json.concept.after > r.json.concept.before);
  assert.equal(r.json.review.dueDay, '2026-01-06');
  assert.equal(r.json.recorded.note, 'clear explanation');
  const text = await cli(['record', 'a-num', '--result', 'correct', ...at('09:05')]);
  assert.match(text.out, /Recorded correct on a-num \(learn\)\./);
  assert.match(text.out, /mastery estimate \d+% -> \d+%/);
});

test('pretest offers one item per untouched concept and confident answers place out', async () => {
  const dir = tempDir('teachback-pretest-');
  try {
    await cli(['init', 'mini', '--from', MINI, '--root', dir]);
    const p = await cli(['pretest', '--root', dir, '--json']);
    assert.deepEqual(p.json.items.map((i) => [i.concept, i.type]), [
      ['a', 'numeric'],
      ['b', 'numeric'],
      ['c', 'numeric']
    ]);
    assert.equal(p.json.items[0].answer, undefined, 'pretest never shows answers');
    await cli(['grade', 'a-num', '--answer', '2', '--confidence', '4', '--record', '--pretest', '--root', dir, '--now', '2026-01-05T09:00:00Z']);
    await cli(['grade', 'b-num', '--answer', '2', '--confidence', '2', '--record', '--pretest', '--root', dir, '--now', '2026-01-05T09:01:00Z']);
    const s = (await cli(['status', '--root', dir, '--now', '2026-01-05T09:02:00Z', '--json'])).json;
    assert.equal(s.conceptList.find((c) => c.id === 'a').mastered, true, 'confident and right: placed out');
    assert.equal(s.conceptList.find((c) => c.id === 'b').mastered, false, 'unsure: ordinary evidence');
    const again = await cli(['pretest', '--root', dir, '--json']);
    assert.deepEqual(again.json.items.map((i) => i.concept), ['c'], 'only untouched concepts remain');
    const next = (await cli(['next', '--root', dir, '--now', '2026-01-05T09:03:00Z', '--json'])).json;
    assert.equal(next.concept, 'b', 'the learner skips what they know');
  } finally {
    rmDir(dir);
  }
});

test('show hides answers unless asked', async () => {
  const plain = await cli(['show', 'a-mcq', ...at('09:06'), '--json']);
  assert.deepEqual(plain.json.options, ['A. Right', 'B. Wrong', 'C. Also wrong']);
  assert.equal(plain.json.answer, undefined);
  const revealed = await cli(['show', 'a-tb', '--answer', ...at('09:06'), '--json']);
  assert.equal(revealed.json.rubric.required[0].id, 'core');
});

test('learner.json validates against its schema and keeps the full event log', async () => {
  const learner = JSON.parse(fs.readFileSync(path.join(root, '.teachback', 'mini', 'learner.json'), 'utf8'));
  assert.deepEqual(validateFile(learner, 'learner'), []);
  assert.equal(learner.settings.utcOffsetMinutes, 0);
  assert.ok(learner.events.length >= 3);
  assert.ok(learner.events.every((e) => e.t && e.type));
  assert.ok(learner.mastery.a.pL > 0.2);
  assert.ok(learner.reviews['a-mcq'].dueDay);
});

test('status --json and text agree', async () => {
  const s = (await cli(['status', ...at('10:00'), '--json'])).json;
  assert.equal(s.concepts.total, 3);
  assert.equal(s.exercises.total, 2);
  assert.equal(s.capstone, 'js-double');
  const text = (await cli(['status', ...at('10:00')])).out;
  assert.match(text, new RegExp(`Concepts mastered\\s+${s.concepts.mastered}/3`));
  assert.match(text, new RegExp(`Exercises passed\\s+${s.exercises.passed}/2`));
});

test('dashboard writes one self-contained file with no external resources', async () => {
  const out = path.join(root, 'dash.html');
  const r = await cli(['dashboard', ...at('10:01'), '--out', out, '--json']);
  assert.equal(r.code, 0, r.err);
  const html = fs.readFileSync(out, 'utf8');
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /Content-Security-Policy" content="default-src 'none'/);
  assert.doesNotMatch(html, /<script[^>]+src=/i);
  assert.doesNotMatch(html, /<link[^>]+rel="?stylesheet/i);
  assert.doesNotMatch(html, /url\(\s*['"]?https?:/i);
  assert.doesNotMatch(html, /<img[^>]+src="?https?:/i);
  assert.match(html, /prefers-color-scheme:dark/);
  assert.match(html, /data-stat="concepts-total">3</);
  // Ink palette only: every colour in the stylesheet is a warm neutral, the one accent
  // blue (with its pressed and soft forms) or the black of a floating layer's shadow.
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  const INK = ['#f7f7f5', '#ffffff', '#f0f0ed', '#e3e3df', '#c9c9c3', '#111110', '#3a3a37', '#6f6f69', '#a3a39c', '#0e0e0d', '#171716', '#1f1f1d', '#2b2b29', '#3d3d3a', '#f4f4f2', '#d6d6d2', '#9a9a94', '#6a6a65', '#0065fd', '#0654c8', '#5b9cff', '#3f86ff'];
  const hexes = [...css.matchAll(/#[0-9a-f]{3,8}\b/gi)].map((m) => m[0].toLowerCase());
  assert.ok(hexes.length >= INK.length, 'the palette is in the stylesheet');
  assert.deepEqual(hexes.filter((x) => !INK.includes(x)), [], 'no colour outside the Ink palette');
  const rgbs = [...css.matchAll(/rgba?\(([^)]*)\)/g)].map((m) => m[1].replace(/\s/g, ''));
  assert.deepEqual(rgbs.filter((x) => !/^0,0,0,/.test(x) && x !== '0,101,253,.10' && x !== '91,156,255,.14'), [], 'rgb colours are shadow black or the accent');
});

test('export --anki writes an importable CSV of every non-code item', async () => {
  const out = path.join(root, 'deck.csv');
  const r = await cli(['export', '--anki', ...at('10:02'), '--out', out, '--json']);
  assert.equal(r.json.cards, 9);
  assert.equal(r.json.skipped, 2);
  const lines = fs.readFileSync(out, 'utf8').trim().split('\n');
  assert.deepEqual(lines.slice(0, 3), ['#separator:comma', '#html:true', '#columns:Front,Back,Tags']);
  assert.match(lines[3], /^#deck:teachback::Mini Course$/);
  assert.equal(lines.length, 4 + 9);
  const mcqRow = lines.find((l) => l.includes('Which is true of a?'));
  assert.match(mcqRow, /<b>A\. Right<\/b>/);
  assert.match(mcqRow, /teachback mini a mcq$/);
  const ex = await cli(['export', ...at('10:02')]);
  assert.match(ex.err, /E401/);
  const real = await cli(['export', '--anki', '--course', EXAMPLE, '--out', path.join(root, 'attention.csv'), '--json']);
  assert.equal(real.json.cards, 38);
});

test('the entry point (scripts/teachback.mjs) runs as a real process with the right exit codes', () => {
  const bin = path.join(REPO, 'scripts', 'teachback.mjs');
  const v = spawnSync(process.execPath, [bin, '--version'], { encoding: 'utf8' });
  assert.equal(v.status, 0);
  assert.equal(v.stdout.trim(), JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).version);
  const help = spawnSync(process.execPath, [bin, 'help'], { encoding: 'utf8' });
  assert.ok(help.stdout.includes('next [course]'), 'help lists next');
  const bad = spawnSync(process.execPath, [bin, 'check', path.join(REPO, 'tests')], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /E001/);
});

test('plugin layout: no top-level bin/ folder (claude.ai and Cowork refuse it); npm bin and SKILL.md point at scripts/', () => {
  assert.equal(fs.existsSync(path.join(REPO, 'bin')), false, 'a top-level bin/ folder blocks plugin install on claude.ai and Cowork');
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  assert.deepEqual(pkg.bin, { teachback: 'scripts/teachback.mjs' });
  assert.ok(pkg.files.includes('scripts/'), 'scripts/ is published');
  assert.ok(!pkg.files.includes('bin/'));
  const skill = fs.readFileSync(path.join(REPO, 'SKILL.md'), 'utf8');
  assert.ok(skill.includes('node "${CLAUDE_SKILL_DIR}/scripts/teachback.mjs"'));
  for (const doc of ['SKILL.md', 'README.md', 'CONTRIBUTING.md', 'docs/ARCHITECTURE.md', 'references/tutoring-protocol.md', 'references/authoring-guide.md']) {
    assert.doesNotMatch(fs.readFileSync(path.join(REPO, doc), 'utf8'), /\bbin\/teachback\.mjs/, `${doc} still names bin/teachback.mjs`);
  }
});
