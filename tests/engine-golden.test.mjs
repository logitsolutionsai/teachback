// RepoQuest is added beside the teaching engine, not inside it. This golden test
// replays a fixed history on each shipped paper course and compares mastery,
// review dates, exercise status, Rebuilt and the next plan with values captured
// from the engine before RepoQuest existed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { goldenSnapshot } from './helpers/golden.mjs';
import { EXAMPLE, BLOOM, FIXTURES } from './helpers/cli.mjs';
import { loadCourseStrict } from '../src/course.mjs';
import { planNext } from '../src/model/next.mjs';
import { planWithQuests } from '../src/quest/next.mjs';
import { replay, newLearner } from '../src/model/learner.mjs';
import { goldenEvents } from './helpers/golden.mjs';

const GOLDEN = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'golden', 'engine-golden.json'), 'utf8'));

for (const [name, dir] of [['attention-is-all-you-need', EXAMPLE], ['bloom-filters', BLOOM]]) {
  test(`${name}: mastery, review dates, Rebuilt and next are identical to the pre-RepoQuest engine`, () => {
    const now = goldenSnapshot(dir);
    const want = GOLDEN.courses[name];
    assert.deepEqual(now.mastery, want.mastery);
    assert.deepEqual(now.reviews, want.reviews);
    assert.deepEqual(now.exercises, want.exercises);
    assert.deepEqual(now.history, want.history);
    assert.equal(now.rebuiltAt, want.rebuiltAt);
    assert.deepEqual(now.plans, want.plans);
    assert.deepEqual(now.midMastery, want.midMastery);
    assert.deepEqual(now.midPlan, want.midPlan);
  });

  test(`${name}: the quest-aware planner returns the old plan unchanged for a course without quests`, () => {
    const courseData = loadCourseStrict(dir);
    const learner = newLearner(courseData.slug, new Date('2026-03-01T00:00:00Z'));
    learner.settings.utcOffsetMinutes = 0;
    learner.events = goldenEvents(courseData);
    for (let n = 0; n <= learner.events.length; n += 7) {
      const derived = replay(courseData, { ...learner, events: learner.events.slice(0, n) });
      for (const day of ['2026-03-02', '2026-03-05', '2026-03-20']) {
        assert.deepEqual(planWithQuests(courseData, derived, day, null), planNext(courseData, derived, day));
      }
    }
  });
}
