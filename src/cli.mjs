// Command-line interface. Every command prints plain text by default and JSON
// with --json (the form the tutor reads).
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { TeachbackError, resolveNow, dayKey, writeJsonAtomic, copyDir, exists, slugify, round, masteryPercent } from './util.mjs';
import { resolveCourseDir, loadCourseStrict, teachbackRoot, listCourses } from './course.mjs';
import { loadLearner, saveLearner, replay, RESULTS, appendEvent, withLearnerLock, lastEventTime } from './model/learner.mjs';
import { planNext, itemView } from './model/next.mjs';
import { topoOrder } from './graph.mjs';
import { gradeItem } from './grade.mjs';
import { checkCourse, verifyExercises, CODES } from './check.mjs';
import { runExercise, formatRun } from './runner.mjs';
import { computeStatus, formatStatus } from './status.mjs';
import { renderDashboard } from './dashboard.mjs';
import { exportAnki } from './export.mjs';

const VERSION = '0.1.0';

const DEFAULT_IO = { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) };
let IO = DEFAULT_IO;
let EXIT = 0;

const GLOBAL = {
  course: { type: 'string', short: 'c' },
  root: { type: 'string' },
  now: { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' }
};

// The command list, kept as data so "help" can print it as text or as JSON.
const HELP_DATA = {
  name: 'teachback',
  version: VERSION,
  description: 'Socratic tutoring with a learner model, spaced review and a rebuild track.',
  usage: 'teachback <command> [options]',
  sections: [
    {
      title: 'Course',
      commands: [
        ['init', 'init <slug> --title T --source URL|CITATION [--language python|javascript|none]', 'Scaffold a new course'],
        ['init', 'init <slug> --from <course-folder>', 'Copy an existing course (for example an example course)'],
        ['use', 'use <slug>', 'Make a course the default'],
        ['list', 'list', 'List courses under .teachback/'],
        ['check', 'check [course] [--skip-exercises]', 'Validate everything; exit code 1 on errors'],
        ['verify-exercises', 'verify-exercises [course]', 'Reference must pass, starter must fail']
      ]
    },
    {
      title: 'Tutoring',
      commands: [
        ['next', 'next [course]', 'What to do now (reviews, frontier concept, exercise)'],
        ['pretest', 'pretest [course]', 'One placement item per untouched concept'],
        ['show', 'show <item> [--answer]', 'Print an item (the answer only with --answer)'],
        ['grade', 'grade <item> --answer A [--confidence N] [--record]', 'mcq/numeric: graded; short/teachback: rubric coverage'],
        ['record', 'record <item> --result correct|partial|wrong [--confidence 1-4] [--note TEXT] [--pretest]', "Record the tutor's judgement of an answer"],
        ['run', 'run <exercise> [file] [--timeout MS] [--no-record]', 'Create the work copy, or run its tests and record the result']
      ]
    },
    {
      title: 'Progress',
      commands: [
        ['status', 'status [course]', 'Summary (same numbers as the dashboard)'],
        ['dashboard', 'dashboard [course] [--out FILE]', 'Write a standalone offline HTML dashboard'],
        ['export', 'export --anki [--out FILE]', 'Export the question bank as CSV for Anki']
      ]
    }
  ].map((sec) => ({ title: sec.title, commands: sec.commands.map(([command, usage, description]) => ({ command, usage, description })) })),
  globalOptions: [
    ['--course, -c <slug|path>', 'Which course (default: current folder, "use", or the only one)'],
    ['--root <dir>', 'Folder that holds .teachback/ (default: current folder)'],
    ['--now <ISO time>', 'Pretend it is this time (also TEACHBACK_NOW); for tests and demos'],
    ['--json', 'Machine-readable output (every command, help and --version included)']
  ].map(([option, description]) => ({ option, description }))
};

function helpText() {
  const lines = [`${HELP_DATA.name} ${VERSION}: ${HELP_DATA.description}`, '', `Usage: ${HELP_DATA.usage}`];
  for (const sec of HELP_DATA.sections) {
    lines.push('', sec.title);
    for (const c of sec.commands) {
      const usage = `  ${c.usage}`;
      if (usage.length < 43) lines.push(`${usage.padEnd(43)}${c.description}`);
      else lines.push(usage, `${' '.repeat(43)}${c.description}`);
    }
  }
  lines.push('', 'Global options');
  for (const o of HELP_DATA.globalOptions) lines.push(`  ${o.option.padEnd(27)}${o.description}`);
  return `${lines.join('\n')}\n`;
}

function out(args, json, text) {
  if (args.json) IO.out(`${JSON.stringify(json, null, 2)}\n`);
  else IO.out(`${typeof text === 'function' ? text() : text}\n`);
}

function parse(argv, options = {}) {
  const all = { ...GLOBAL, ...options };
  const { values, positionals } = parseArgs({ args: joinDashValues(argv, all), options: all, allowPositionals: true, strict: true });
  return { ...values, _: positionals };
}

// parseArgs refuses an option value that starts with a dash, so a negative
// number (--answer -0.5) or an answer such as "-inf before the softmax" would
// fail. An option that takes a value always takes the next word, so join the
// two as --name=value first, unless that word is itself one of our options.
export function joinDashValues(argv, options) {
  const flags = new Set();
  const longOf = new Map();
  for (const [name, o] of Object.entries(options)) {
    flags.add(`--${name}`);
    if (o.short) flags.add(`-${o.short}`);
    if (o.type === 'string') {
      longOf.set(`--${name}`, name);
      if (o.short) longOf.set(`-${o.short}`, name);
    }
  }
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const name = longOf.get(argv[i]);
    const next = argv[i + 1];
    if (name && typeof next === 'string' && next.startsWith('-') && next !== '--' && !flags.has(next.split('=')[0])) {
      out.push(`--${name}=${next}`);
      i += 1;
    } else out.push(argv[i]);
  }
  return out;
}

function courseFrom(args, positional) {
  const dir = resolveCourseDir(args.course ?? positional, { root: args.root });
  return loadCourseStrict(dir);
}

function needItem(courseData, id) {
  const item = courseData.itemById.get(id);
  if (!item) {
    const close = courseData.itemList.map((i) => i.id).filter((x) => x.includes(id) || id.includes(x)).slice(0, 5);
    throw new TeachbackError('E201', `No item "${id}" in this course.`, close.length ? `Did you mean: ${close.join(', ')}?` : 'Run "teachback next --json" or look in items.json for item ids.');
  }
  return item;
}

function parseConfidence(v) {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 4) throw new TeachbackError('E202', `Confidence must be 1, 2, 3 or 4 (got "${v}").`, '1 = guessing, 2 = unsure, 3 = fairly sure, 4 = certain.');
  return n;
}

function parseTimeout(v) {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 100 || n > 600000) {
    throw new TeachbackError('E206', `--timeout must be a whole number of milliseconds from 100 to 600000 (got "${v}").`, 'Example: --timeout 30000 for 30 seconds. Leave it out to use the exercise default.');
  }
  return n;
}

// ---------------------------------------------------------------- commands

async function cmdInit(argv) {
  const args = parse(argv, { title: { type: 'string' }, source: { type: 'string' }, language: { type: 'string' }, from: { type: 'string' }, force: { type: 'boolean' } });
  const slug = args._[0] ? slugify(args._[0]) : null;
  if (!slug) throw new TeachbackError('E210', 'init needs a slug.', 'Example: teachback init attention --title "Attention Is All You Need" --source https://arxiv.org/abs/1706.03762');
  const base = teachbackRoot(args.root);
  const dir = path.join(base, slug);
  if (exists(path.join(dir, 'course.json')) && !args.force) {
    throw new TeachbackError('E211', `A course "${slug}" already exists at ${dir}.`, 'Pick another slug, or pass --force to overwrite its course files (learner.json is kept).');
  }
  const now = resolveNow(args.now);
  if (args.from) {
    const src = path.resolve(args.from);
    if (!exists(path.join(src, 'course.json'))) throw new TeachbackError('E212', `No course.json in ${src}.`, 'Point --from at a course folder, such as examples/attention-is-all-you-need.');
    copyDir(src, dir, { skip: (name) => ['learner.json', 'work', 'dashboard.html', '__pycache__'].includes(name) });
    const cj = JSON.parse(fs.readFileSync(path.join(dir, 'course.json'), 'utf8'));
    cj.slug = slug;
    writeJsonAtomic(path.join(dir, 'course.json'), cj);
  } else {
    if (!args.title || !args.source) throw new TeachbackError('E213', 'init needs --title and --source.', 'Example: teachback init attention --title "Attention Is All You Need" --source https://arxiv.org/abs/1706.03762');
    const isUrl = /^https?:\/\//i.test(args.source);
    const language = args.language ?? 'python';
    if (!['python', 'javascript', 'none'].includes(language)) throw new TeachbackError('E214', `Unknown language "${language}".`, 'Use python, javascript or none.');
    writeJsonAtomic(path.join(dir, 'course.json'), {
      schema: 'teachback/course@1',
      slug,
      title: args.title,
      source: isUrl ? { title: args.title, url: args.source } : { title: args.title, citation: args.source },
      licence: 'Fill in the source licence. This course cites sections of the source and does not reproduce its text.',
      language,
      track: [],
      createdAt: now.toISOString()
    });
    if (!exists(path.join(dir, 'map.json')) || args.force) writeJsonAtomic(path.join(dir, 'map.json'), { schema: 'teachback/map@1', concepts: [] });
    if (!exists(path.join(dir, 'items.json')) || args.force) writeJsonAtomic(path.join(dir, 'items.json'), { schema: 'teachback/items@1', items: [] });
    fs.mkdirSync(path.join(dir, 'exercises'), { recursive: true });
  }
  fs.mkdirSync(base, { recursive: true });
  fs.writeFileSync(path.join(base, '.current'), `${slug}\n`);
  out(args, { created: dir, slug, from: args.from ?? null }, () =>
    [
      `Created course "${slug}" at ${dir}`,
      args.from ? 'Copied from ' + path.resolve(args.from) : 'Next: draft map.json, items.json and exercises/, then run "teachback check" until it is clean.',
      `It is now the default course (teachback use ${slug}).`
    ].join('\n')
  );
}

async function cmdUse(argv) {
  const args = parse(argv);
  const slug = args._[0];
  if (!slug) throw new TeachbackError('E215', 'use needs a slug.', `Courses: ${listCourses(args.root).join(', ') || '(none)'}`);
  const dir = resolveCourseDir(slug, { root: args.root });
  const base = teachbackRoot(args.root);
  if (path.dirname(dir) !== base) throw new TeachbackError('E216', `"${slug}" is not under ${base}.`, 'use only works for courses inside .teachback/.');
  fs.writeFileSync(path.join(base, '.current'), `${path.basename(dir)}\n`);
  out(args, { current: path.basename(dir) }, `Default course is now "${path.basename(dir)}".`);
}

async function cmdList(argv) {
  const args = parse(argv);
  const courses = listCourses(args.root);
  out(args, { root: teachbackRoot(args.root), courses }, courses.length ? courses.join('\n') : 'No courses yet. Create one with "teachback init".');
}

function formatProblems(result) {
  const lines = [];
  for (const p of [...result.errors, ...result.warnings]) {
    lines.push(`${p.level === 'error' ? 'ERROR' : 'warn '} ${p.code} ${p.file}${p.where ? ` ${p.where}` : ''}: ${p.message}`);
    if (p.hint) lines.push(`      fix: ${p.hint}`);
  }
  return lines;
}

async function cmdCheck(argv) {
  const args = parse(argv, { 'skip-exercises': { type: 'boolean' }, timeout: { type: 'string' }, codes: { type: 'boolean' } });
  if (args.codes) return out(args, CODES, Object.entries(CODES).map(([k, v]) => `${k}  ${v}`).join('\n'));
  const dir = resolveCourseDir(args.course ?? args._[0], { root: args.root });
  const progress = args.json ? undefined : (id, ref, st) => IO.err(`  verified ${id}: reference ${ref.status} (${ref.passed}/${ref.total}), starter ${st.status}\n`);
  const result = await checkCourse(dir, { exercises: !args['skip-exercises'], timeoutMs: parseTimeout(args.timeout), onProgress: progress });
  out(args, result, () => {
    const s = result.stats;
    const lines = [`Checked ${dir}`, `  ${s.concepts} concepts in ${s.layers} layers, ${s.items} items (${Object.entries(s.itemTypes).map(([k, v]) => `${v} ${k}`).join(', ') || 'none'}), ${s.exercises} exercises${s.capstone ? `, capstone ${s.capstone}` : ''}`];
    if (result.exercisesVerified) lines.push(`  exercises verified: ${result.exercises.length}`);
    else if (args['skip-exercises']) lines.push('  exercises not verified (--skip-exercises)');
    lines.push(...formatProblems(result));
    lines.push(result.ok ? `OK: no errors${result.warnings.length ? `, ${result.warnings.length} warning${result.warnings.length === 1 ? '' : 's'}` : ''}.` : `FAILED: ${result.errors.length} error${result.errors.length === 1 ? '' : 's'}, ${result.warnings.length} warning${result.warnings.length === 1 ? '' : 's'}.`);
    return lines.join('\n');
  });
  if (!result.ok) EXIT = 1;
}

async function cmdVerify(argv) {
  const args = parse(argv, { timeout: { type: 'string' } });
  const courseData = courseFrom(args, args._[0]);
  const res = await verifyExercises(courseData, { timeoutMs: parseTimeout(args.timeout) });
  const errors = res.problems.filter((p) => p.level === 'error');
  out(args, { ok: errors.length === 0, ...res }, () => {
    const lines = res.results.map((r) => `  ${r.id}: reference ${r.reference.status} (${r.reference.passed}/${r.reference.total}), starter ${r.starter.status} (${r.starter.passed}/${r.starter.total})`);
    lines.push(...formatProblems({ errors, warnings: res.problems.filter((p) => p.level === 'warning') }));
    lines.push(errors.length ? `FAILED: ${errors.length} error${errors.length === 1 ? '' : 's'}.` : 'OK: every reference passes and every starter fails.');
    return lines.join('\n');
  });
  if (errors.length) EXIT = 1;
}

// The time to stamp on a new event. The log is replayed in time order, so an
// event stamped before the last one would be replayed before answers given
// earlier. If this machine's clock has gone backwards, stamp the last event's
// time instead. An explicit --now or TEACHBACK_NOW is always honoured.
function eventTime(learner, nowArg) {
  const now = resolveNow(nowArg);
  if (nowArg ?? process.env.TEACHBACK_NOW) return { now, clockNote: null };
  const last = lastEventTime(learner);
  if (last && now < last) {
    return { now: last, clockNote: `This machine's clock (${now.toISOString()}) is behind the last recorded event, so this one is stamped ${last.toISOString()} to keep the history in order. Check the system clock.` };
  }
  return { now, clockNote: null };
}

function recordAnswer(courseData, item, opts) {
  return withLearnerLock(courseData, () => recordAnswerLocked(courseData, item, opts));
}

function recordAnswerLocked(courseData, item, { result, confidence, note, pretest, answer, nowArg }) {
  const learner = loadLearner(courseData, resolveNow(nowArg));
  const { now, clockNote } = eventTime(learner, nowArg);
  const before = replay(courseData, learner);
  const today = dayKey(now, learner.settings.utcOffsetMinutes);
  const prevReview = before.reviews[item.id];
  const mode = pretest ? 'pretest' : prevReview?.dueDay && prevReview.dueDay <= today ? 'review' : 'learn';
  const event = {
    t: now.toISOString(),
    type: 'answer',
    item: item.id,
    concept: item.concept,
    result,
    mode,
    ...(confidence ? { confidence } : {}),
    ...(note ? { note } : {}),
    ...(answer !== undefined ? { answer: String(answer).slice(0, 2000) } : {})
  };
  appendEvent(learner, event);
  const { derived } = saveLearner(courseData, learner, now);
  const b = before.mastery[item.concept];
  const a = derived.mastery[item.concept];
  const r = derived.reviews[item.id];
  return {
    recorded: event,
    concept: {
      id: item.concept,
      name: courseData.conceptById.get(item.concept)?.name,
      before: round(b.pL, 4),
      after: round(a.pL, 4),
      mastered: a.mastered,
      threshold: derived.params.bkt.masteryThreshold,
      change: !b.mastered && a.mastered ? 'mastered' : b.mastered && !a.mastered ? 'lost mastery' : null
    },
    review: r?.dueDay ? { dueDay: r.dueDay, interval: r.interval, reps: r.reps, ease: r.ease, lapses: r.lapses } : null,
    rebuilt: Boolean(derived.rebuiltAt),
    ...(clockNote ? { warning: clockNote } : {})
  };
}

function formatRecord(res) {
  const c = res.concept;
  const lines = [`Recorded ${res.recorded.result} on ${res.recorded.item} (${res.recorded.mode}).`];
  const wasMastered = c.change === 'mastered' ? false : c.change === 'lost mastery' ? true : c.mastered;
  lines.push(`  ${c.name}: mastery estimate ${masteryPercent(c.before, wasMastered, c.threshold)}% -> ${masteryPercent(c.after, c.mastered, c.threshold)}%${c.change ? `  (${c.change})` : ''}`);
  if (res.review) lines.push(`  next review of this item: ${res.review.dueDay} (in ${res.review.interval} day${res.review.interval === 1 ? '' : 's'})`);
  if (res.rebuilt) lines.push('  Rebuilt.');
  if (res.warning) lines.push(`  warning: ${res.warning}`);
  return lines.join('\n');
}

async function cmdRecord(argv) {
  const args = parse(argv, { result: { type: 'string', short: 'r' }, confidence: { type: 'string' }, note: { type: 'string' }, pretest: { type: 'boolean' } });
  const courseData = courseFrom(args);
  const id = args._[0];
  if (!id) throw new TeachbackError('E203', 'record needs an item id.', 'Example: teachback record sdpa-why-scale --result correct --confidence 3');
  const item = needItem(courseData, id);
  if (item.type === 'code') {
    throw new TeachbackError('E103', `Item "${item.id}" is a code item.`, `A code item is answered by passing its exercise, which records itself: teachback run ${item.exercise}`);
  }
  if (!RESULTS.includes(args.result)) throw new TeachbackError('E204', `--result must be correct, partial or wrong (got "${args.result ?? ''}").`, 'Judge the answer, then record it.');
  const res = recordAnswer(courseData, item, { result: args.result, confidence: parseConfidence(args.confidence), note: args.note, pretest: args.pretest, nowArg: args.now });
  out(args, res, () => formatRecord(res));
}

async function cmdGrade(argv) {
  const args = parse(argv, { answer: { type: 'string', short: 'a' }, confidence: { type: 'string' }, record: { type: 'boolean' }, note: { type: 'string' }, pretest: { type: 'boolean' } });
  const courseData = courseFrom(args);
  const id = args._[0];
  if (!id) throw new TeachbackError('E203', 'grade needs an item id.', 'Example: teachback grade sdpa-dk --answer 64');
  if (args.answer === undefined) throw new TeachbackError('E205', 'grade needs --answer.', 'Pass the learner\'s answer in quotes.');
  const item = needItem(courseData, id);
  const graded = gradeItem(item, args.answer);
  let recorded = null;
  if (args.record) {
    if (!graded.deterministic) {
      throw new TeachbackError('E105', `${item.type} answers are judged by the tutor, not by grade.`, `Read the rubric coverage, decide, then run: teachback record ${item.id} --result correct|partial|wrong`);
    }
    recorded = recordAnswer(courseData, item, { result: graded.result, confidence: parseConfidence(args.confidence), note: args.note, pretest: args.pretest, answer: args.answer, nowArg: args.now });
  }
  const res = { item: item.id, concept: item.concept, ...graded, recorded };
  out(args, res, () => {
    const lines = [];
    if (graded.type === 'mcq') {
      lines.push(`${graded.result.toUpperCase()}: chose ${graded.chosen}, correct is ${graded.correctOption}.`, `  why ${graded.chosen}: ${graded.rationale}`);
      if (graded.correctRationale) lines.push(`  why ${graded.correctOption}: ${graded.correctRationale}`);
    } else if (graded.type === 'numeric') {
      lines.push(`${graded.result.toUpperCase()}: read ${graded.value}, expected ${graded.expected}${graded.tolerance ? ` (tolerance ${graded.tolerance})` : ''}.`);
      if (graded.explanation) lines.push(`  ${graded.explanation}`);
    } else {
      const cv = graded.coverage;
      lines.push(`Rubric coverage ${cv.covered}/${cv.total} required ideas (needs ${cv.minRequired}). Suggestion only: ${cv.suggestion}.`);
      // "matched" names the synonym; the answer's own words follow when they differ.
      const how = (x) => `  (matched "${x.matched}"${x.evidence && x.evidence !== x.matched.toLowerCase() ? ` in "${x.evidence}"` : ''}${x.negated ? ', next to a negation' : ''})`;
      for (const r of cv.required) lines.push(`  ${r.covered && !r.negated ? '[x]' : r.negated ? '[?]' : '[ ]'} ${r.idea}${r.matched ? how(r) : ''}`);
      for (const m of cv.misconceptions.filter((x) => x.present)) lines.push(`  [!] misconception: ${m.description}${how(m)}`);
      lines.push(...cv.caution.map((c) => `  note: ${c}`));
      lines.push(`  Then record your judgement: teachback record ${item.id} --result correct|partial|wrong`);
    }
    if (recorded) lines.push(formatRecord(recorded));
    else if (graded.deterministic) lines.push(`  Not recorded. Add --record, or run: teachback record ${item.id} --result ${graded.result}`);
    return lines.join('\n');
  });
}

async function cmdNext(argv) {
  const args = parse(argv);
  const courseData = courseFrom(args, args._[0]);
  const now = resolveNow(args.now);
  const learner = loadLearner(courseData, now);
  const derived = replay(courseData, learner);
  const today = dayKey(now, learner.settings.utcOffsetMinutes);
  const plan = planNext(courseData, derived, today);
  plan.dueReviews = plan.dueReviews.map((d) => ({ ...d, prompt: courseData.itemById.get(d.item)?.prompt }));
  plan.courseDir = courseData.dir;
  out(args, plan, () => {
    const lines = [];
    if (plan.kind === 'review') {
      lines.push(`Review (${plan.dueReviews.length} due today). Start with ${plan.item.id} on "${plan.conceptName}":`, `  ${plan.item.prompt}`);
      if (plan.item.options) lines.push(...plan.item.options.map((o) => `    ${o}`));
    } else if (plan.kind === 'learn') {
      lines.push(`Learn "${plan.conceptName}" (mastery estimate ${masteryPercent(plan.mastery, false, derived.params.bkt.masteryThreshold)}%). Activity: ${plan.activity}.`);
      if (plan.sources?.length) lines.push(`  Source: section ${plan.sources.map((s) => s.section).join(', ')}`);
      if (plan.item) {
        lines.push(`  Item ${plan.item.id} (${plan.item.type}): ${plan.item.prompt}`);
        if (plan.item.options) lines.push(...plan.item.options.map((o) => `    ${o}`));
      }
      if (plan.exercise) lines.push(`  Exercise ${plan.exercise.id}: read ${plan.exercise.task}, edit ${plan.exercise.workFile}, then: teachback run ${plan.exercise.id}`);
    } else if (plan.kind === 'exercise') {
      lines.push(`Rebuild: exercise ${plan.exercise.id}, "${plan.exercise.title}"${plan.exercise.capstone ? ' (capstone)' : ''}.`, `  Read ${plan.exercise.task}, edit ${plan.exercise.workFile}, then: teachback run ${plan.exercise.id}`);
    } else {
      lines.push(plan.kind === 'rebuilt' ? 'Rebuilt. Nothing new to learn.' : 'Complete. Nothing new to learn.');
    }
    lines.push(`  Why: ${plan.reason}`);
    if (plan.nextReviewDay) lines.push(`  Next review after today: ${plan.nextReviewDay}`);
    return lines.join('\n');
  });
}

async function cmdPretest(argv) {
  const args = parse(argv);
  const courseData = courseFrom(args, args._[0]);
  const now = resolveNow(args.now);
  const learner = loadLearner(courseData, now);
  const derived = replay(courseData, learner);
  const typeRank = { numeric: 0, mcq: 1, short: 2 };
  const items = [];
  for (const cid of topoOrder(courseData.concepts)) {
    if (derived.mastery[cid].attempts > 0) continue;
    const pool = courseData.itemList.filter((i) => i.concept === cid && i.type in typeRank);
    pool.sort((a, b) => typeRank[a.type] - typeRank[b.type] || (b.difficulty ?? 3) - (a.difficulty ?? 3) || (a.id < b.id ? -1 : 1));
    if (pool[0]) items.push({ ...itemView(pool[0]), conceptName: courseData.conceptById.get(cid).name });
  }
  const res = {
    instructions:
      'Ask each question in order without teaching or hinting. Ask for confidence (1-4) with every answer. Record each with --pretest. A correct answer given with confidence 3 or 4 places the learner out of that concept (mastery estimate 95%); anything else is ordinary evidence. Reviews will re-check placed concepts within days.',
    items
  };
  out(args, res, () =>
    [
      `Pretest: ${items.length} question${items.length === 1 ? '' : 's'}, one per untouched concept.`,
      ...items.map((i, n) => `  ${n + 1}. [${i.id}] (${i.conceptName}, ${i.type}) ${i.prompt}${i.options ? `\n       ${i.options.join('\n       ')}` : ''}`),
      `Record each: teachback grade <item> --answer "..." --confidence N --record --pretest   (mcq, numeric)`,
      `         or: teachback record <item> --result correct|partial|wrong --confidence N --pretest   (short)`
    ].join('\n')
  );
}

async function cmdShow(argv) {
  const args = parse(argv, { answer: { type: 'boolean' } });
  const courseData = courseFrom(args);
  if (!args._[0]) throw new TeachbackError('E203', 'show needs an item id.', 'Example: teachback show sdpa-formula. "teachback next --json" names the item to ask.');
  const item = needItem(courseData, args._[0]);
  const v = itemView(item, { withAnswer: args.answer });
  v.conceptName = courseData.conceptById.get(item.concept)?.name;
  out(args, v, () => {
    const lines = [`${item.id} (${item.type}, difficulty ${v.difficulty}) on "${v.conceptName}"${item.source ? `, section ${item.source}` : ''}`, `  ${item.prompt}`];
    if (v.options) lines.push(...v.options.map((o) => `    ${o}`));
    if (args.answer) {
      if (v.answer !== undefined) lines.push(`  answer: ${v.answer}${v.tolerance ? ` (tolerance ${v.tolerance})` : ''}`);
      if (v.rubric) lines.push(...v.rubric.required.map((r) => `  required: ${r.idea}  [${r.synonyms.join(' | ')}]`), ...(v.rubric.misconceptions ?? []).map((m) => `  misconception: ${m.description}`));
      if (v.modelAnswer) lines.push(`  model answer: ${v.modelAnswer}`);
    }
    return lines.join('\n');
  });
}

function findExercise(courseData, id) {
  if (!id) throw new TeachbackError('E303', 'run needs an exercise id.', `Exercises: ${courseData.track.join(', ') || '(none)'}`);
  const ex = courseData.exercises.get(id) ?? [...courseData.exercises.values()].find((x) => x.folder === id || x.id.startsWith(`${id}-`));
  if (!ex) throw new TeachbackError('E304', `No exercise "${id}".`, `Exercises: ${courseData.track.join(', ') || '(none)'}`);
  return ex;
}

export function ensureWorkCopy(courseData, ex) {
  const workDir = path.join(courseData.dir, 'work', ex.id);
  const file = path.join(workDir, ex.starter);
  let created = false;
  if (!exists(file)) {
    fs.mkdirSync(workDir, { recursive: true });
    for (const f of ['TASK.md', ex.starter, ...[].concat(ex.tests ?? []), ...(ex.support ?? [])]) {
      const src = path.join(ex.dir, f);
      if (exists(src)) {
        fs.mkdirSync(path.dirname(path.join(workDir, f)), { recursive: true });
        fs.copyFileSync(src, path.join(workDir, f));
      }
    }
    created = true;
  }
  return { file, workDir, created };
}

// The capstone can be run at any time, for practice, but the course becomes
// Rebuilt only when every concept is mastered too. Say so on every capstone run
// before that, so a pass does not look like the finish line.
function capstoneNote(courseData, derived) {
  if (derived.rebuiltAt) return null;
  const open = courseData.concepts.filter((c) => !derived.mastery[c.id]?.mastered);
  if (!open.length) return null;
  const names = open.slice(0, 4).map((c) => c.name).join('; ') + (open.length > 4 ? ` and ${open.length - 4} more` : '');
  return {
    unmastered: open.map((c) => c.id),
    note: `This is the capstone. The course counts as Rebuilt only once every concept is mastered, and ${open.length} ${open.length === 1 ? 'is' : 'are'} not yet: ${names}. Practise it now if you like: a pass is kept, and the course becomes Rebuilt when the last concept is mastered.`
  };
}

async function cmdRun(argv) {
  const args = parse(argv, { timeout: { type: 'string' }, 'no-record': { type: 'boolean' } });
  const timeoutMs = parseTimeout(args.timeout);
  const courseData = courseFrom(args);
  const ex = findExercise(courseData, args._[0]);
  let file;
  if (args._[1]) file = path.resolve(args._[1]);
  else {
    const work = ensureWorkCopy(courseData, ex);
    if (work.created) {
      const pending = ex.capstone ? capstoneNote(courseData, replay(courseData, loadLearner(courseData, resolveNow(args.now)))) : null;
      const res = { status: 'created', exercise: ex.id, workFile: work.file, task: path.join(work.workDir, 'TASK.md'), ...(pending ?? {}) };
      const text = `Created your work copy for "${ex.title}":\n  task: ${res.task}\n  edit: ${res.workFile}\nThen run "teachback run ${ex.id}" again to test it.`;
      return out(args, res, pending ? `${text}\nNote: ${pending.note}` : text);
    }
    file = work.file;
  }
  resolveNow(args.now); // reject a bad --now before spending time on the tests
  const result = await runExercise(ex, file, { timeoutMs });
  let rebuilt = false;
  let firstPass = false;
  let clockNote = null;
  let after = null;
  if (!args['no-record']) withLearnerLock(courseData, () => {
    const learner = loadLearner(courseData, resolveNow(args.now));
    const stamp = eventTime(learner, args.now);
    const now = stamp.now;
    clockNote = stamp.clockNote;
    const before = replay(courseData, learner);
    appendEvent(learner, {
      t: now.toISOString(),
      type: 'run',
      exercise: ex.id,
      status: result.status,
      passed: result.passed,
      failed: result.failed + result.errors,
      total: result.total,
      file: path.relative(courseData.dir, file).split(path.sep).join('/')
    });
    const { derived } = saveLearner(courseData, learner, now);
    after = derived;
    firstPass = result.status === 'passed' && !before.exercises[ex.id]?.passed;
    rebuilt = Boolean(derived.rebuiltAt) && !before.rebuiltAt;
  });
  const pending = ex.capstone ? capstoneNote(courseData, after ?? replay(courseData, loadLearner(courseData, resolveNow(args.now)))) : null;
  const res = { exercise: ex.id, title: ex.title, capstone: Boolean(ex.capstone), file, ...result, recorded: !args['no-record'], firstPass, rebuilt, ...(pending ?? {}), ...(clockNote ? { warning: clockNote } : {}) };
  out(args, res, () => {
    const lines = [formatRun(result, { title: ex.title })];
    if (firstPass) lines.push(ex.capstone ? 'Capstone passed.' : 'First pass recorded as evidence for this exercise\'s concepts.');
    if (rebuilt) lines.push('Rebuilt: every concept mastered and the capstone passes.');
    if (pending) lines.push(`Note: ${pending.note}`);
    if (clockNote) lines.push(`warning: ${clockNote}`);
    return lines.join('\n');
  });
  if (result.status !== 'passed') EXIT = 1;
}

async function cmdStatus(argv) {
  const args = parse(argv);
  const courseData = courseFrom(args, args._[0]);
  const now = resolveNow(args.now);
  const learner = loadLearner(courseData, now);
  const s = computeStatus(courseData, learner, now);
  out(args, s, () => formatStatus(s));
}

async function cmdDashboard(argv) {
  const args = parse(argv, { out: { type: 'string', short: 'o' } });
  const courseData = courseFrom(args, args._[0]);
  const now = resolveNow(args.now);
  const learner = loadLearner(courseData, now);
  const s = computeStatus(courseData, learner, now);
  const html = renderDashboard(courseData, s);
  const file = path.resolve(args.out ?? path.join(courseData.dir, 'dashboard.html'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
  out(args, { path: file, bytes: Buffer.byteLength(html) }, `Dashboard written to ${file}`);
}

async function cmdExport(argv) {
  const args = parse(argv, { anki: { type: 'boolean' }, out: { type: 'string', short: 'o' } });
  if (!args.anki) throw new TeachbackError('E401', 'export needs a format.', 'Use: teachback export --anki [--out deck.csv]');
  const courseData = courseFrom(args, args._[0]);
  const { csv, count, skipped } = exportAnki(courseData);
  const file = path.resolve(args.out ?? path.join(courseData.dir, `${courseData.slug}-anki.csv`));
  fs.writeFileSync(file, csv);
  out(args, { path: file, cards: count, skipped }, `Wrote ${count} cards to ${file}${skipped ? ` (skipped ${skipped} code items)` : ''}.\nIn Anki: File > Import, choose the file; fields are Front, Back, Tags (separator: comma, HTML allowed).`);
}

const COMMANDS = {
  init: cmdInit,
  use: cmdUse,
  list: cmdList,
  check: cmdCheck,
  'verify-exercises': cmdVerify,
  record: cmdRecord,
  grade: cmdGrade,
  next: cmdNext,
  pretest: cmdPretest,
  show: cmdShow,
  run: cmdRun,
  status: cmdStatus,
  dashboard: cmdDashboard,
  export: cmdExport
};

export async function main(argv, io) {
  IO = io ?? DEFAULT_IO;
  EXIT = 0;
  const [cmd, ...rest] = argv;
  const help = () => IO.out(argv.includes('--json') ? `${JSON.stringify(HELP_DATA, null, 2)}\n` : helpText());
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h' || (cmd === '--json' && !rest.length)) {
    help();
    return 0;
  }
  if (cmd === '--version' || cmd === '-v') {
    IO.out(rest.includes('--json') ? `${JSON.stringify({ name: 'teachback', version: VERSION })}\n` : `${VERSION}\n`);
    return 0;
  }
  const fn = COMMANDS[cmd];
  const wantsJson = rest.includes('--json');
  try {
    if (!fn) throw new TeachbackError('E200', `Unknown command "${cmd}".`, 'Run "teachback help" for the list.');
    if (rest.includes('--help') || rest.includes('-h')) {
      help();
      return 0;
    }
    await fn(rest);
  } catch (err) {
    const isUsage = err.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION' || err.code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE' || err.code === 'ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL';
    const code = err instanceof TeachbackError ? err.code : isUsage ? 'E200' : 'E999';
    const hint = err instanceof TeachbackError ? err.hint : isUsage ? 'Run "teachback help" for the options.' : 'This is a bug; please report it with the command you ran.';
    if (wantsJson) IO.out(`${JSON.stringify({ error: { code, message: err.message, hint } }, null, 2)}\n`);
    else IO.err(`error ${code}: ${err.message}\n${hint ? `  fix: ${hint}\n` : ''}${code === 'E999' && process.env.TEACHBACK_DEBUG ? err.stack + '\n' : ''}`);
    EXIT = isUsage ? 2 : 1;
  }
  return EXIT;
}

