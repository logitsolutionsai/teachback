// check: validates a course folder and (optionally) verifies its exercises.
// Every problem has a code, the file it is in, a message and a fix hint.
import fs from 'node:fs';
import path from 'node:path';
import { loadCourse } from './course.mjs';
import { validateFile } from './schema.mjs';
import { findCycles, layers } from './graph.mjs';
import { runExercise, detectPython, formatRun } from './runner.mjs';
import { rubricCoverage } from './grade.mjs';

export const MIN_ITEMS_PER_CONCEPT = 3;
export const MIN_TYPES_PER_CONCEPT = 2;
export const MAX_SUMMARY_WORDS = 160;

// The full list of codes, for docs and for `teachback check --codes`.
export const CODES = {
  E001: 'A required file is missing',
  E002: 'A file is not valid JSON',
  E003: 'A field has the wrong shape (schema)',
  E010: 'The map has no concepts',
  E011: 'Two concepts share an id',
  E012: 'A prerequisite names a concept that does not exist',
  E013: 'The prerequisites form a cycle',
  E014: 'A concept has no source references',
  E015: 'A concept has fewer than 3 items',
  E016: 'A concept has items of only one type',
  E020: 'Two items share an id',
  E021: 'An item names a concept that does not exist',
  E022: 'A short or teachback item has an empty rubric',
  E023: 'A rubric idea or misconception has no synonyms',
  E024: 'An mcq answer index is out of range',
  E025: 'An mcq item has fewer than 2 options',
  E026: 'An mcq option has no rationale',
  E027: 'A numeric item has no numeric answer or a negative tolerance',
  E028: 'A code item names an exercise that does not exist',
  E029: 'A rubric asks for more ideas than it lists',
  E040: 'An exercise file is missing',
  E041: 'An exercise names a concept that does not exist',
  E042: 'The track names an exercise that does not exist',
  E043: 'Two exercises share an id',
  E044: 'The track lists an exercise more than once',
  E050: 'The reference solution fails its tests',
  E051: 'The starter passes its tests (it should fail)',
  E052: 'An exercise run timed out',
  E053: 'No runtime available to verify exercises',
  E054: 'No tests ran',
  W101: 'A concept summary is longer than one paragraph',
  W110: 'A concept has no teachback item',
  W111: 'A concept has no misconceptions listed',
  W112: 'A model answer does not meet its own rubric',
  W120: 'The capstone is not last on the track, or there are several',
  W121: 'The track has exercises but no capstone',
  W122: 'An exercise is not on the track',
  W123: 'An exercise practises no concept',
  W130: 'The starter timed out instead of failing fast'
};

function problem(level, code, file, message, hint, where) {
  return { level, code, file, ...(where ? { where } : {}), message, hint };
}

export function checkStatic(dir) {
  const c = loadCourse(dir);
  const out = [];
  const err = (...a) => out.push(problem('error', ...a));
  const warn = (...a) => out.push(problem('warning', ...a));
  for (const p of c.problems) err(p.code, p.file, p.message, p.hint);

  // ---- schemas ----
  const schemaPass = (value, name, file) => {
    if (value === undefined) return;
    for (const e of validateFile(value, name)) err('E003', file, `${e.path} ${e.message}.`, 'Compare the field with references/format.md.', e.path);
  };
  if (!c.problems.some((p) => p.file === 'course.json')) schemaPass(c.course, 'course', 'course.json');
  if (!c.problems.some((p) => p.file === 'map.json')) schemaPass(c.map, 'map', 'map.json');
  if (!c.problems.some((p) => p.file === 'items.json')) schemaPass(c.items, 'items', 'items.json');
  for (const ex of c.exercises.values()) {
    const { folder, dir: _d, ...manifest } = ex;
    schemaPass(manifest, 'exercise', `exercises/${folder}/exercise.json`);
  }

  // ---- map ----
  const concepts = c.concepts;
  if (!concepts.length) err('E010', 'map.json', 'The concept map has no concepts.', 'Add 8-20 concepts, each with a summary, source references and prerequisites.');
  const seen = new Set();
  for (const k of concepts) {
    if (seen.has(k.id)) err('E011', 'map.json', `Concept id "${k.id}" is used twice.`, 'Give every concept a unique id.');
    seen.add(k.id);
  }
  for (const k of concepts) {
    for (const p of k.prerequisites ?? []) {
      if (!c.conceptById.has(p)) err('E012', 'map.json', `Concept "${k.id}" lists prerequisite "${p}", which does not exist.`, `Add a concept "${p}" or remove it from ${k.id}.prerequisites.`);
    }
    if (!Array.isArray(k.sources) || !k.sources.length) err('E014', 'map.json', `Concept "${k.id}" has no source references.`, 'Cite at least one section, table or equation of the source in "sources".');
    const words = String(k.summary ?? '').trim().split(/\s+/).filter(Boolean).length;
    if (words > MAX_SUMMARY_WORDS) warn('W101', 'map.json', `Concept "${k.id}" has a ${words}-word summary.`, `Keep summaries to one paragraph (under ${MAX_SUMMARY_WORDS} words), in your own words.`);
    if (!k.misconceptions?.length) warn('W111', 'map.json', `Concept "${k.id}" lists no misconceptions.`, 'Name the mistakes learners commonly make, so the tutor can name them plainly.');
  }
  for (const cycle of findCycles(concepts)) {
    err('E013', 'map.json', `Prerequisite cycle: ${cycle.join(' -> ')}.`, `Remove one of these prerequisite links so the map is a DAG (for example drop "${cycle[0]}" from ${cycle[1]}.prerequisites).`);
  }

  // ---- items ----
  const items = c.itemList;
  const itemIds = new Set();
  const perConcept = new Map(concepts.map((k) => [k.id, []]));
  items.forEach((it, i) => {
    const where = `items[${i}]`;
    const label = it.id ?? where;
    if (itemIds.has(it.id)) err('E020', 'items.json', `Item id "${it.id}" is used twice.`, 'Give every item a unique id.', where);
    itemIds.add(it.id);
    if (!c.conceptById.has(it.concept)) err('E021', 'items.json', `Item "${label}" names concept "${it.concept}", which does not exist.`, 'Use an id from map.json.', where);
    else perConcept.get(it.concept).push(it);
    if (it.type === 'mcq') {
      const n = Array.isArray(it.options) ? it.options.length : 0;
      if (n < 2) err('E025', 'items.json', `MCQ "${label}" has ${n} option${n === 1 ? '' : 's'}.`, 'Give at least 2 options (3-4 is better), each with a rationale.', where);
      if (!Number.isInteger(it.answer) || it.answer < 0 || it.answer >= n) {
        err('E024', 'items.json', `MCQ "${label}" has answer ${JSON.stringify(it.answer)}, but options run 0-${Math.max(0, n - 1)}.`, '"answer" is the 0-based index of the correct option.', where);
      }
      (it.options ?? []).forEach((o, j) => {
        if (!String(o?.rationale ?? '').trim()) err('E026', 'items.json', `MCQ "${label}" option ${String.fromCharCode(65 + j)} has no rationale.`, 'Explain why each option is right or wrong; the tutor reads it back after the learner answers.', where);
      });
    }
    if (it.type === 'numeric') {
      if (typeof it.answer !== 'number' || !Number.isFinite(it.answer)) err('E027', 'items.json', `Numeric item "${label}" has no numeric answer.`, 'Set "answer" to a number.', where);
      if (it.tolerance !== undefined && !(it.tolerance >= 0)) err('E027', 'items.json', `Numeric item "${label}" has tolerance ${it.tolerance}.`, 'Use a tolerance of 0 or more.', where);
    }
    if (it.type === 'short' || it.type === 'teachback') {
      const req = it.rubric?.required ?? [];
      if (!req.length) err('E022', 'items.json', `${it.type} item "${label}" has an empty rubric.`, 'List the required ideas, each with synonyms, in rubric.required.', where);
      for (const idea of req) {
        if (!idea.synonyms?.length) err('E023', 'items.json', `Rubric idea "${idea.id}" in "${label}" has no synonyms.`, 'List the phrases that show the idea is present (several wordings).', where);
      }
      for (const m of it.rubric?.misconceptions ?? []) {
        if (!m.synonyms?.length) err('E023', 'items.json', `Misconception "${m.id}" in "${label}" has no synonyms.`, 'List phrases that signal the misconception.', where);
      }
      if (it.rubric?.minRequired > req.length) err('E029', 'items.json', `"${label}" asks for ${it.rubric.minRequired} ideas but lists ${req.length}.`, 'Lower minRequired or add ideas.', where);
      // The model answer is the clearest right answer there is: if the rubric
      // cannot see every idea in it, learners who say the same will be marked down.
      if (req.length && String(it.modelAnswer ?? '').trim()) {
        const cv = rubricCoverage(it.rubric, it.modelAnswer);
        const missing = cv.required.filter((r) => !r.covered || r.negated).map((r) => `"${r.id}"${r.negated ? ` (matched "${r.matched}" next to a negation)` : ''}`);
        const misc = cv.misconceptions.filter((m) => m.present && !m.negated).map((m) => `"${m.id}" (matched "${m.matched}")`);
        if (missing.length) warn('W112', 'items.json', `The model answer of "${label}" does not show rubric idea${missing.length === 1 ? '' : 's'} ${missing.join(', ')}.`, 'Add the wording the model answer uses to those synonyms, so a learner who answers the same way is credited.', where);
        if (misc.length) warn('W112', 'items.json', `The model answer of "${label}" matches misconception ${misc.join(', ')}.`, 'Make the misconception synonyms more specific, so a right answer does not trigger them.', where);
      }
    }
    if (it.type === 'code' && !c.exercises.has(it.exercise)) {
      err('E028', 'items.json', `Code item "${label}" names exercise "${it.exercise}", which does not exist.`, 'Use an exercise id from exercises/<id>/exercise.json.', where);
    }
  });
  for (const [cid, list] of perConcept) {
    if (list.length < MIN_ITEMS_PER_CONCEPT) err('E015', 'items.json', `Concept "${cid}" has ${list.length} item${list.length === 1 ? '' : 's'}.`, `Write at least ${MIN_ITEMS_PER_CONCEPT} items for every concept.`);
    const types = new Set(list.map((i) => i.type));
    if (list.length && types.size < MIN_TYPES_PER_CONCEPT) err('E016', 'items.json', `Concept "${cid}" only has ${[...types][0]} items.`, `Mix at least ${MIN_TYPES_PER_CONCEPT} item types (mcq, numeric, short, teachback, code).`);
    if (list.length && !types.has('teachback')) warn('W110', 'items.json', `Concept "${cid}" has no teachback item.`, 'Add one: every concept should end with the learner explaining it back.');
  }

  // ---- exercises ----
  const track = Array.isArray(c.course.track) ? c.course.track : null;
  for (const ex of c.exercises.values()) {
    const rel = (f) => `exercises/${ex.folder}/${f}`;
    const need = ['TASK.md', ex.starter, ...[].concat(ex.tests ?? []), ...(ex.support ?? []), `.reference/${ex.starter}`];
    for (const f of need) {
      if (!f) continue;
      if (!fs.existsSync(path.join(ex.dir, f))) err('E040', rel(f), `Exercise "${ex.id}" is missing ${f}.`, f.startsWith('.reference') ? 'Put a working solution at .reference/<starter>; the tutor only shows it on request.' : `Create ${rel(f)}.`);
    }
    for (const cid of ex.concepts ?? []) {
      if (!c.conceptById.has(cid)) err('E041', rel('exercise.json'), `Exercise "${ex.id}" names concept "${cid}", which does not exist.`, 'Use concept ids from map.json.');
    }
    if (track && !track.includes(ex.id)) warn('W122', 'course.json', `Exercise "${ex.id}" is not on the track.`, 'Add it to course.json "track" or remove the folder.');
    if (!(ex.concepts ?? []).length) warn('W123', rel('exercise.json'), `Exercise "${ex.id}" lists no concepts.`, 'Name the concepts it rebuilds in "concepts". With none, next offers it before anything is taught and passing it is evidence for nothing.');
  }
  for (const d of c.duplicateExercises) {
    err('E043', `exercises/${d.folders[1]}/exercise.json`, `Exercises in ${d.folders.map((f) => `exercises/${f}`).join(' and ')} both have id "${d.id}"; only the first is used.`, 'Give every exercise a unique id (usually the folder name).');
  }
  const seenOnTrack = new Set();
  for (const id of track ?? []) {
    if (seenOnTrack.has(id)) err('E044', 'course.json', `The track lists exercise "${id}" more than once.`, 'List each exercise once, in the order to rebuild them.');
    seenOnTrack.add(id);
    if (!c.exercises.has(id)) err('E042', 'course.json', `The track names exercise "${id}", which does not exist.`, `Create exercises/${id}/ or remove it from "track".`);
  }
  const capstones = [...c.exercises.values()].filter((x) => x.capstone);
  if (c.exercises.size && !capstones.length) warn('W121', 'course.json', 'The track has no capstone exercise.', 'Mark the final exercise with "capstone": true; "Rebuilt" needs it.');
  if (capstones.length > 1) warn('W120', 'course.json', `${capstones.length} exercises are marked as capstone.`, 'Mark only the final exercise as the capstone.');
  if (capstones.length === 1 && track?.length && track[track.length - 1] !== capstones[0].id) {
    warn('W120', 'course.json', `The capstone "${capstones[0].id}" is not last on the track.`, 'Move it to the end of "track".');
  }

  const depth = layers(concepts);
  const typeCounts = {};
  for (const it of items) typeCounts[it.type] = (typeCounts[it.type] ?? 0) + 1;
  const stats = {
    concepts: concepts.length,
    items: items.length,
    itemTypes: typeCounts,
    exercises: c.exercises.size,
    capstone: capstones[0]?.id ?? null,
    layers: concepts.length ? Math.max(...Object.values(depth)) + 1 : 0
  };
  return { course: c, problems: out, stats };
}

// Runs each exercise's tests against the reference (must pass) and the starter (must fail).
export async function verifyExercises(courseData, { timeoutMs, onProgress } = {}) {
  const out = [];
  const results = [];
  const needsPython = [...courseData.exercises.values()].some((x) => x.language === 'python');
  if (needsPython && !detectPython()) {
    out.push(problem('error', 'E053', 'exercises/', 'No Python 3 interpreter found, so Python exercises cannot be verified.', 'Install Python 3, set TEACHBACK_PYTHON, or run check with --skip-exercises.'));
    return { problems: out, results };
  }
  const order = [...courseData.track.filter((id) => courseData.exercises.has(id)), ...[...courseData.exercises.keys()].filter((id) => !courseData.track.includes(id))];
  for (const id of order) {
    const ex = courseData.exercises.get(id);
    const rel = `exercises/${ex.folder}`;
    const refFile = path.join(ex.dir, '.reference', ex.starter);
    const starterFile = path.join(ex.dir, ex.starter);
    if (!fs.existsSync(refFile) || !fs.existsSync(starterFile)) continue; // reported by checkStatic
    let ref;
    let starter;
    try {
      ref = await runExercise(ex, refFile, { timeoutMs });
      starter = await runExercise(ex, starterFile, { timeoutMs });
    } catch (e) {
      out.push(problem('error', e.code ?? 'E040', rel, e.message, e.hint));
      continue;
    }
    results.push({ id, reference: slim(ref), starter: slim(starter) });
    onProgress?.(id, ref, starter);
    if (ref.status === 'timeout') out.push(problem('error', 'E052', rel, `The reference for "${id}" timed out.`, 'Make the reference and tests fast (well under the timeout).'));
    else if (ref.total === 0) out.push(problem('error', 'E054', rel, `No tests ran for "${id}".`, 'Check the test file name in exercise.json and that it defines test cases.'));
    else if (ref.status !== 'passed') out.push(problem('error', 'E050', rel, `The reference solution for "${id}" fails its tests.\n${formatRun(ref)}`, 'Fix the reference or the tests; the reference must pass every test.'));
    if (starter.status === 'passed') out.push(problem('error', 'E051', rel, `The starter for "${id}" passes its tests.`, 'The starter must leave the work undone (for example raise NotImplementedError) so the tests fail. If it already does, the tests never call the starter or never check its result: make every test call the code and compare the answer.'));
    else if (starter.status === 'timeout') out.push(problem('warning', 'W130', rel, `The starter for "${id}" timed out instead of failing.`, 'Make starter stubs raise immediately.'));
  }
  return { problems: out, results };
}

function slim(r) {
  return { status: r.status, passed: r.passed, total: r.total, durationMs: r.durationMs };
}

export async function checkCourse(dir, { exercises = true, timeoutMs, onProgress } = {}) {
  const { course, problems, stats } = checkStatic(dir);
  let verified = null;
  const hasStaticExerciseErrors = problems.some((p) => p.level === 'error' && /^E04/.test(p.code));
  if (exercises && course.exercises.size && !course.problems.length && !hasStaticExerciseErrors) {
    verified = await verifyExercises(course, { timeoutMs, onProgress });
    problems.push(...verified.problems);
  }
  const errors = problems.filter((p) => p.level === 'error');
  const warnings = problems.filter((p) => p.level === 'warning');
  return { ok: errors.length === 0, dir, errors, warnings, stats, exercises: verified?.results ?? null, exercisesVerified: Boolean(verified) };
}
