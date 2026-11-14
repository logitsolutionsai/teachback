// The learner record. The event log is the source of truth; mastery, review
// schedules and exercise status are recomputed from it by replay(), so the
// same events always give the same state.
import fs from 'node:fs';
import path from 'node:path';
import { TeachbackError, readJson, writeJsonAtomic, dayKey, round } from '../util.mjs';
import { DEFAULT_BKT, RESULT_SCORE, itemParams, bktUpdate, isMastered } from './bkt.mjs';
import { DEFAULT_SCHEDULE, nextSchedule } from './schedule.mjs';

export const LEARNER_SCHEMA = 'teachback/learner@1';
export const RESULTS = ['correct', 'partial', 'wrong'];

export function modelParams(courseData, learner) {
  const bkt = { ...DEFAULT_BKT, ...(courseData.course.model?.bkt ?? {}), ...(learner?.settings?.model?.bkt ?? {}) };
  const schedule = { ...DEFAULT_SCHEDULE, ...(courseData.course.model?.schedule ?? {}), ...(learner?.settings?.model?.schedule ?? {}) };
  return { bkt, schedule };
}

// A UTC offset in whole minutes east of UTC, within the range real time zones use.
export function validOffset(v) {
  return Number.isInteger(v) && v >= -840 && v <= 840;
}

export function defaultOffsetMinutes(now) {
  const env = process.env.TEACHBACK_UTC_OFFSET;
  if (env !== undefined && env !== '') {
    const n = Number(env);
    if (!validOffset(n)) {
      throw new TeachbackError('E901', `TEACHBACK_UTC_OFFSET is "${env}", not a whole number of minutes between -840 and 840.`, 'Give minutes east of UTC: 0 for UTC, 330 for UTC+05:30, -300 for UTC-05:00. Or unset it to use the time zone of this machine.');
    }
    return n;
  }
  return -now.getTimezoneOffset();
}

export function newLearner(slug, now) {
  return {
    schema: LEARNER_SCHEMA,
    course: slug,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    settings: { utcOffsetMinutes: defaultOffsetMinutes(now) },
    mastery: {},
    reviews: {},
    exercises: {},
    history: [],
    rebuiltAt: null,
    events: []
  };
}

export function learnerPath(dir) {
  return path.join(dir, 'learner.json');
}

const LEARNER_FIX = 'learner.json is written by the CLI; do not edit it by hand. Restore it from a backup, fix the field, or delete it to start over (the course is untouched).';

export function loadLearner(courseData, now) {
  const existing = readJson(learnerPath(courseData.dir));
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    existing.events ??= [];
    if (!Array.isArray(existing.events)) throw new TeachbackError('E003', 'learner.json: "events" must be a list.', LEARNER_FIX);
    if (!existing.settings || typeof existing.settings !== 'object') existing.settings = {};
    existing.settings.utcOffsetMinutes ??= 0;
    if (!validOffset(existing.settings.utcOffsetMinutes)) {
      throw new TeachbackError('E003', `learner.json: settings.utcOffsetMinutes is ${JSON.stringify(existing.settings.utcOffsetMinutes)}, not a whole number of minutes between -840 and 840.`, LEARNER_FIX);
    }
    return existing;
  }
  return newLearner(courseData.slug, now);
}

// The latest event time in the record, or null.
export function lastEventTime(learner) {
  let best = null;
  for (const ev of learner.events ?? []) if (validEventTime(ev) && (best === null || Date.parse(ev.t) > best)) best = Date.parse(ev.t);
  return best === null ? null : new Date(best);
}

function validEventTime(ev) {
  return Boolean(ev) && typeof ev.t === 'string' && !Number.isNaN(Date.parse(ev.t));
}

const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Runs fn (synchronous: load, append, save) while holding learner.json.lock, so
// two commands recording at the same moment cannot overwrite each other's events.
export function withLearnerLock(courseData, fn, { timeoutMs = 10000, staleMs = 30000 } = {}) {
  const lock = `${learnerPath(courseData.dir)}.lock`;
  const started = Date.now();
  for (;;) {
    try {
      fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let age = 0;
      try {
        age = Date.now() - fs.statSync(lock).mtimeMs;
      } catch {
        continue; // released between our attempt and the stat
      }
      if (age > staleMs) {
        fs.rmSync(lock, { force: true }); // left behind by a crashed command
        continue;
      }
      if (Date.now() - started > timeoutMs) {
        throw new TeachbackError('E004', 'learner.json is locked by another teachback command.', `Wait for it to finish and try again. If no teachback command is running, delete ${lock}.`);
      }
      sleepMs(20);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lock, { force: true });
  }
}

export function saveLearner(courseData, learner, now) {
  const derived = replay(courseData, learner);
  const out = {
    schema: LEARNER_SCHEMA,
    course: learner.course ?? courseData.slug,
    createdAt: learner.createdAt,
    updatedAt: now.toISOString(),
    settings: learner.settings,
    mastery: derived.mastery,
    reviews: derived.reviews,
    exercises: derived.exercises,
    history: derived.history,
    rebuiltAt: derived.rebuiltAt,
    events: learner.events
  };
  writeJsonAtomic(learnerPath(courseData.dir), out);
  return { learner: out, derived };
}

function emptyConcept(pInit) {
  return { pL: pInit, mastered: false, attempts: 0, correct: 0, partial: 0, wrong: 0, lastSeen: null, firstMasteredAt: null, teachbackPassed: false };
}

// Recompute everything from the event log.
export function replay(courseData, learner) {
  const { bkt, schedule } = modelParams(courseData, learner);
  const offset = learner.settings?.utcOffsetMinutes ?? 0;
  const mastery = {};
  for (const c of courseData.concepts) {
    mastery[c.id] = emptyConcept(c.pInit ?? bkt.pInit);
    // A prior at or above the threshold counts as mastered before any evidence.
    mastery[c.id].mastered = isMastered(mastery[c.id].pL, bkt);
  }
  const reviews = {};
  const exercises = {};
  for (const id of courseData.exercises.keys()) {
    exercises[id] = { runs: 0, passed: false, lastStatus: null, lastPassed: 0, lastTotal: 0, lastRunAt: null, firstPassedAt: null };
  }
  const warnings = [];
  const history = [];
  const answers = []; // for calibration: { concept, item, score, confidence, t }
  let rebuiltAt = null;
  const capstone = courseData.capstone;

  const conceptIds = courseData.concepts.map((c) => c.id);
  const allMastered = () => conceptIds.length > 0 && conceptIds.every((id) => mastery[id].mastered);

  const applyAnswer = (item, result, ev, { pretest = false, schedule: doSchedule = true } = {}) => {
    const concept = mastery[item.concept];
    if (!concept) {
      warnings.push(`Event at ${ev.t} refers to unknown concept "${item.concept}"; skipped.`);
      return;
    }
    const score = RESULT_SCORE[result];
    const { slip, guess } = itemParams(item, bkt);
    if (pretest && result === 'correct' && (ev.confidence ?? 0) >= bkt.placementMinConfidence) {
      concept.pL = Math.max(concept.pL, bkt.placementMastery);
    } else {
      concept.pL = bktUpdate(concept.pL, score, { slip, guess, pLearn: pretest ? 0 : bkt.pLearn });
    }
    concept.pL = Math.min(bkt.pMax, concept.pL);
    concept.attempts += 1;
    concept[result] += 1;
    concept.lastSeen = ev.t;
    if (item.type === 'teachback' && result === 'correct') concept.teachbackPassed = true;
    const wasMastered = concept.mastered;
    concept.mastered = isMastered(concept.pL, bkt);
    if (concept.mastered && !wasMastered && !concept.firstMasteredAt) concept.firstMasteredAt = ev.t;

    const r = (reviews[item.id] ??= { attempts: 0, lastResult: null, lastSeen: null, schedule: null });
    r.attempts += 1;
    r.lastResult = result;
    r.lastSeen = ev.t;
    if (doSchedule && item.type !== 'code') {
      r.schedule = nextSchedule(r.schedule, result, dayKey(ev.t, offset), { confidence: ev.confidence, params: schedule });
    }
    if (ev.confidence) answers.push({ concept: item.concept, item: item.id, score, confidence: ev.confidence, t: ev.t });
  };

  const events = [];
  for (const ev of learner.events ?? []) {
    if (validEventTime(ev)) events.push(ev);
    else warnings.push(`An event in learner.json has no valid time ("t"); skipped: ${JSON.stringify(ev)?.slice(0, 120)}`);
  }
  events.sort((a, b) => Date.parse(a.t) - Date.parse(b.t)); // stable: equal times keep log order
  let currentDay = null;
  const closeDay = () => {
    if (!currentDay) return;
    const ps = conceptIds.map((id) => mastery[id].pL);
    history.push({
      day: currentDay,
      mastered: conceptIds.filter((id) => mastery[id].mastered).length,
      meanMastery: ps.length ? round(ps.reduce((s, x) => s + x, 0) / ps.length) : 0
    });
  };

  for (const ev of events) {
    const day = dayKey(ev.t, offset);
    if (day !== currentDay) {
      closeDay();
      currentDay = day;
    }
    if (ev.type === 'answer') {
      const item = courseData.itemById.get(ev.item);
      if (!item) {
        warnings.push(`Event at ${ev.t} refers to item "${ev.item}", which is no longer in items.json; skipped.`);
        continue;
      }
      if (!RESULTS.includes(ev.result)) {
        warnings.push(`Event at ${ev.t} has unknown result "${ev.result}"; skipped.`);
        continue;
      }
      applyAnswer(item, ev.result, ev, { pretest: ev.mode === 'pretest' });
    } else if (ev.type === 'run') {
      const ex = exercises[ev.exercise];
      if (!ex) {
        warnings.push(`Run at ${ev.t} refers to exercise "${ev.exercise}", which is not in this course; skipped.`);
        continue;
      }
      ex.runs += 1;
      ex.lastStatus = ev.status;
      ex.lastPassed = ev.passed ?? 0;
      ex.lastTotal = ev.total ?? 0;
      ex.lastRunAt = ev.t;
      if (ev.status === 'passed' && !ex.passed) {
        ex.passed = true;
        ex.firstPassedAt = ev.t;
        // A passing exercise is evidence, once, for every code item that points at it.
        for (const item of courseData.itemList) {
          if (item.type === 'code' && item.exercise === ev.exercise) applyAnswer(item, 'correct', ev, { schedule: false });
        }
      }
    }
    if (!rebuiltAt && capstone && exercises[capstone]?.passed && allMastered()) rebuiltAt = ev.t;
  }
  closeDay();

  for (const c of Object.values(mastery)) c.pL = round(c.pL, 6);
  const flatReviews = {};
  for (const [id, r] of Object.entries(reviews)) {
    flatReviews[id] = { attempts: r.attempts, lastResult: r.lastResult, lastSeen: r.lastSeen, ...(r.schedule ?? {}) };
  }
  return { mastery, reviews: flatReviews, exercises, history, rebuiltAt, warnings, answers, params: { bkt, schedule } };
}

export function appendEvent(learner, event) {
  learner.events.push(event);
  return learner;
}
