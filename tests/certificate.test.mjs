// The Quest Certificate states each piece of local evidence separately, shows
// no answers, grades or confidence by default, never claims a maintainer
// review without --confirm, and always carries the disclaimer. Its HTML uses
// the Ink palette: status by weight, no red, green or yellow.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cli, rmDir, tempDir } from './helpers/cli.mjs';
import { guardGit, cacheCourse, finishCacheCourse } from './helpers/repoquest.mjs';
import { DISCLAIMER } from '../src/quest/certificate.mjs';

guardGit();
const made = [];
const keep = (d) => (made.push(d), d);
after(() => made.forEach(rmDir));

const INK = new Set(['#f7f7f5', '#ffffff', '#f0f0ed', '#e3e3df', '#c9c9c3', '#111110', '#3a3a37', '#6f6f69', '#a3a39c', '#0065fd', '#0654c8', '#0e0e0d', '#171716', '#1f1f1d', '#2b2b29', '#3d3d3a', '#f4f4f2', '#d6d6d2', '#9a9a94', '#6a6a65', '#5b9cff', '#3f86ff']);

test('mid-course: only what is true is marked, and the card says what it is not', async () => {
  const c = await cacheCourse(keep);
  await c.answer('rec-which-ops');
  const out = path.join(c.root, 'cert.html');
  const r = await cli(['quest', 'certificate', 'cache', '--out', out, ...c.base]);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.json.statuses, { source_verified: true, concepts_mastered_by_local_model: false, tests_passed: false, teachback_recorded: false, rehearsal_complete: false, reviewed_by_maintainer: false });
  assert.match(r.json.learner, /^learner-[0-9a-f]{8}$/, 'a pseudonymous label by default');
  const html = fs.readFileSync(out, 'utf8');
  assert.ok(html.includes(DISCLAIMER));
  assert.equal(DISCLAIMER, 'Self-reported/local test evidence; not a credential or a merged contribution.');
  const json = fs.readFileSync(path.join(c.root, 'cert.json'), 'utf8');
  for (const text of [html, json]) {
    assert.ok(!text.includes('private note'), 'no notes');
    assert.ok(!/confidence/i.test(text), 'no confidence');
    assert.ok(!/"answer"|"events"/.test(text), 'no answers or event log');
    assert.ok(!text.includes(c.repo), 'no local path');
  }
  const colours = [...html.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0].toLowerCase());
  assert.ok(colours.length > 0);
  for (const col of colours) assert.ok(INK.has(col), `${col} is an Ink palette colour`);
  assert.ok(!/\b(red|green|yellow|orange|purple)\b/i.test(html.replace(/<script>[\s\S]*?<\/script>/g, '')), 'no hue names in the styles');
  assert.match(html, /var Fluid = \(function/, 'the shared fluid.js is inlined');
  assert.ok(!/<link|https?:\/\/(?!github\.com)/.test(html.replace(/<script>[\s\S]*?<\/script>/g, '')), 'offline: no external requests');
});

test('a finished course is rehearsed; a maintainer review needs --confirm and is shown as asserted, not checked', async () => {
  const c = await cacheCourse(keep);
  const plan = await finishCacheCourse(c);
  assert.equal(plan.kind, 'rehearsed');
  const r = await cli(['quest', 'certificate', 'cache', ...c.base]);
  assert.deepEqual(r.json.statuses, { source_verified: true, concepts_mastered_by_local_model: true, tests_passed: true, teachback_recorded: true, rehearsal_complete: true, reviewed_by_maintainer: false });
  assert.ok(fs.existsSync(path.join(c.dir, 'certificate.html')));
  assert.match(fs.readFileSync(path.join(c.dir, 'certificate.html'), 'utf8'), /data-rehearsed="true"/);
  const no = await cli(['quest', 'certificate', 'cache', '--maintainer-review', 'Ada', ...c.base]);
  assert.equal(no.code, 2);
  const yes = await cli(['quest', 'certificate', 'cache', '--maintainer-review', 'Ada', '--confirm', ...c.base]);
  assert.equal(yes.json.statuses.reviewed_by_maintainer, true);
  assert.equal(yes.json.maintainerReview.checkedByTeachback, false);
  const detail = await cli(['quest', 'certificate', 'cache', '--include-details', '--label', 'Sam', ...c.base]);
  assert.equal(detail.json.learner, 'Sam');
  assert.equal(detail.json.details.concepts.length, 3);
  // The dashboard of the same course shows the source state and the quest checklist.
  const dash = await cli(['dashboard', ...c.base]);
  const html = fs.readFileSync(dash.json.path, 'utf8');
  assert.match(html, /data-repoquest/);
  assert.match(html, /data-quest="fix-eviction" data-status="passed"/);
  assert.match(html, /data-source="current"/);
});

test('without a verified capstone there is no rehearsal: the source changed after the pass', async () => {
  const c = await cacheCourse(keep);
  await finishCacheCourse(c);
  const lru = path.join(c.repo, 'src', 'cache', 'lru.js');
  fs.writeFileSync(lru, `${fs.readFileSync(lru, 'utf8')}// changed later\n`);
  const r = await cli(['quest', 'certificate', 'cache', ...c.base]);
  assert.equal(r.json.statuses.source_verified, false);
  assert.equal(r.json.statuses.rehearsal_complete, false);
  const status = await cli(['status', ...c.base]);
  assert.equal(status.json.repoQuest.source.status, 'source_stale');
  assert.equal(status.json.repoQuest.rehearsed, false);
});

test('a paper course has no certificate, and its status and dashboard are unchanged', async () => {
  const root = keep(tempDir());
  const { BLOOM } = await import('./helpers/cli.mjs');
  await cli(['init', 'bloom', '--from', BLOOM, '--root', root, '--json']);
  const r = await cli(['quest', 'certificate', 'bloom', '--root', root, '--json']);
  assert.equal(r.code, 2);
  const s = await cli(['status', '--root', root, '--json']);
  assert.equal(s.json.repoQuest, undefined);
  const d = await cli(['dashboard', '--root', root, '--json']);
  assert.doesNotMatch(fs.readFileSync(d.json.path, 'utf8'), /data-repoquest/);
});
