// The behaviour eval suite in evals/ runs the tutor through `claude plugin eval`,
// which costs model calls and needs a sandbox. These tests check the suite
// without a model: every case loads, every regex compiles, every scaffold builds
// the learner state its case expects, and every grader that reads files or
// replies passes on what a right tutor would leave and fails on what a wrong
// one would.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { cli, tempDir, rmDir, REPO } from './helpers/cli.mjs';

const EVALS = path.join(REPO, 'evals');
const CASES = fs
  .readdirSync(EVALS, { withFileTypes: true })
  .filter((d) => d.isDirectory() && (fs.existsSync(path.join(EVALS, d.name, 'prompt.md')) || fs.existsSync(path.join(EVALS, d.name, 'case.yaml'))))
  .map((d) => d.name)
  .sort();

// ---------- a small YAML reader for the flat frontmatter these files use ----------
function scalar(v) {
  v = v.trim();
  if (v.startsWith('{')) return flow(v.slice(1, -1), true);
  if (v.startsWith('[')) return flow(v.slice(1, -1), false);
  if (v.startsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
  if (v.startsWith('"')) return JSON.parse(v);
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}
function flow(body, isMap) {
  const parts = [];
  let cur = '';
  let quote = null;
  let depth = 0;
  for (const ch of body) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      cur += ch;
    } else if (ch === '{' || ch === '[') {
      depth += 1;
      cur += ch;
    } else if (ch === '}' || ch === ']') {
      depth -= 1;
      cur += ch;
    } else if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  if (!isMap) return parts.map(scalar);
  return Object.fromEntries(parts.map((p) => [p.slice(0, p.indexOf(':')).trim(), scalar(p.slice(p.indexOf(':') + 1))]));
}
function yaml(text) {
  const out = {};
  let parent = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const m = line.match(/^(\s*)([\w-]+):\s*(.*)$/);
    assert.ok(m, `unreadable YAML line: ${line}`);
    if (m[1] && parent) out[parent][m[2]] = scalar(m[3]);
    else if (m[3] === '') {
      parent = m[2];
      out[parent] = {};
    } else {
      parent = null;
      out[m[2]] = scalar(m[3]);
    }
  }
  return out;
}
function markdown(file) {
  const text = fs.readFileSync(file, 'utf8');
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  assert.ok(m, `${file} has frontmatter`);
  return { front: yaml(m[1]), body: m[2].trim() };
}

function loadCase(name) {
  const dir = path.join(EVALS, name);
  const prompt = markdown(path.join(dir, 'prompt.md'));
  const caseYaml = yaml(fs.readFileSync(path.join(dir, 'case.yaml'), 'utf8'));
  const graders = Object.fromEntries(
    fs.readdirSync(path.join(dir, 'graders')).map((f) => [f.replace(/\.md$/, ''), markdown(path.join(dir, 'graders', f))])
  );
  return { name, dir, prompt, caseYaml, graders };
}
const LOADED = Object.fromEntries(CASES.map((c) => [c, loadCase(c)]));

// What a regex grader concludes about a target text.
function regexVerdict(g, text) {
  if (text === undefined) return false; // a missing file fails the grader
  const flags = g.flags ?? '';
  const match = g.match ?? 'contains';
  if (match === 'not_contains') return !new RegExp(g.pattern, flags).test(text);
  if (String(match).startsWith('count:')) return (text.match(new RegExp(g.pattern, flags.includes('g') ? flags : `${flags}g`)) ?? []).length === Number(match.slice(6));
  return new RegExp(g.pattern, flags).test(text);
}

test('the suite has about eight cases, each with a prompt, a scaffold and a skill-fired indicator', () => {
  assert.ok(CASES.length >= 6 && CASES.length <= 10, `${CASES.length} cases`);
  for (const c of Object.values(LOADED)) {
    assert.equal(c.caseYaml.schema_version, '1.1', c.name);
    assert.equal(c.caseYaml.name, c.name);
    assert.ok(fs.existsSync(path.join(c.dir, c.caseYaml.context.scaffold_script)), `${c.name}: scaffold exists`);
    assert.ok(c.prompt.body.length > 20, `${c.name}: prompt body`);
    assert.ok(c.prompt.front.description, `${c.name}: description`);
    assert.ok(['tutor', 'authoring'].includes(c.prompt.front.tags[0]), `${c.name}: tagged tutor or authoring`);
    assert.ok(c.prompt.front.allowed_tools.includes('Bash') && c.prompt.front.allowed_tools.includes('Skill'));
    assert.ok(c.prompt.front.max_turns >= 8);
    assert.ok(c.graders['skill-fired'], `${c.name}: skill-fired indicator`);
    const scored = Object.entries(c.graders).filter(([n, g]) => n !== 'skill-fired' && g.front.arm !== 'with-only');
    assert.ok(scored.length >= 2, `${c.name}: at least two scored graders`);
  }
});

test('every grader is well formed: known type, compiling regexes, tight LLM rubrics', () => {
  const TYPES = new Set(['regex', 'tool_used', 'tool_order', 'file_exists', 'llm']);
  for (const c of Object.values(LOADED)) {
    for (const [name, g] of Object.entries(c.graders)) {
      const where = `${c.name}/${name}`;
      assert.ok(TYPES.has(g.front.type), `${where}: type ${g.front.type}`);
      if (g.front.type === 'regex') {
        assert.doesNotThrow(() => new RegExp(g.front.pattern, g.front.flags ?? ''), where);
        assert.ok(!/\(\?i\)/.test(g.front.pattern), `${where}: case-insensitivity goes in flags`);
      }
      if (g.front.input_match) assert.doesNotThrow(() => new RegExp(g.front.input_match), where);
      for (const side of ['before', 'after']) if (g.front[side]) assert.doesNotThrow(() => new RegExp(g.front[side].input_match), where);
      if (g.front.type === 'llm') {
        assert.match(g.body, /^PASS if /m, `${where}: a PASS condition`);
        assert.match(g.body, /^FAIL if /m, `${where}: a FAIL condition`);
        assert.match(g.body, /An empty reply.*is a FAIL\./, `${where}: an empty reply fails`);
        assert.ok(g.body.split(/\s+/).length < 160, `${where}: rubric stays short`);
      }
      if (g.front.type === 'tool_used' && g.front.tool === 'Bash') assert.equal(g.front.arm, 'with-only', `${where}: CLI calls cannot happen without the plugin`);
    }
  }
});

test('CLI-call patterns match the commands the skill tells Claude to run, as JSON-encoded tool input', () => {
  const input = (cmd) => JSON.stringify({ command: cmd, description: 'x' });
  const skill = '/home/me/teachback';
  const pattern = (c, g) => new RegExp(LOADED[c].graders[g].front.input_match);
  assert.ok(pattern('start-session', 'ran-next').test(input(`node "${skill}/scripts/teachback.mjs" next --json`)));
  assert.ok(pattern('start-session', 'ran-next').test(input('teachback next')));
  assert.ok(!pattern('start-session', 'ran-next').test(input(`node "${skill}/scripts/teachback.mjs" status --json`)));
  assert.ok(pattern('teachback-feedback', 'graded-as-evidence').test(input(`node "${skill}/scripts/teachback.mjs" grade sdpa-teachback --answer "x" --json`)));
  const order = LOADED['short-answer-own-judgement'].graders['grade-then-record'].front;
  assert.ok(new RegExp(order.before.input_match).test(input(`node "${skill}/scripts/teachback.mjs" grade qkv-roles --answer "x" --json`)));
  assert.ok(new RegExp(order.after.input_match).test(input(`node "${skill}/scripts/teachback.mjs" record qkv-roles --result correct --confidence 3 --json`)));
  assert.ok(pattern('build-course-from-source', 'ran-check').test(input(`node "${skill}/scripts/teachback.mjs" check ema`)));
  assert.ok(new RegExp(LOADED['start-session'].graders['skill-fired'].front.input_match).test(JSON.stringify({ skill: 'teachback:teachback' })));
});

test('reply graders: right replies pass, wrong or empty replies fail', () => {
  const g = (c, n) => LOADED[c].graders[n].front;
  const v = (c, n, text) => regexVerdict(g(c, n), text);
  assert.ok(v('start-session', 'asks-due-review', 'Six reviews today. First: every score is multiplied by 10 before softmax. What happens to the weights?\nA. ...'));
  assert.ok(v('start-session', 'asks-due-review', 'If you scale all the scores by 10, what does softmax do?'));
  assert.ok(!v('start-session', 'asks-due-review', "Let's start with scaled dot-product attention."));
  assert.ok(v('teachback-waits', 'short-reply', 'Take your time; carry on when you are ready.'));
  assert.ok(!v('teachback-waits', 'short-reply', 'x'.repeat(501)));
  assert.ok(!v('teachback-waits', 'short-reply', ''));
  const reference = fs.readFileSync(path.join(REPO, 'examples', 'attention-is-all-you-need', 'exercises', '01-softmax', '.reference', 'softmax.py'), 'utf8');
  assert.ok(v('exercise-hides-reference', 'no-solution-code', 'One test fails: large scores overflow exp(). What could you subtract from every score first without changing the result?'));
  assert.ok(!v('exercise-hides-reference', 'no-solution-code', `Here is the reference:\n${reference}`));
  assert.ok(!v('exercise-hides-reference', 'no-solution-code', 'Fix: exps = [math.exp(s - m) for s in scores]'));
  assert.ok(!v('exercise-hides-reference', 'no-solution-code', ''));
  for (const date of ['Next review: 2026-11-15.', 'Come back tomorrow.', 'next review on Nov 15', 'on 15th November']) assert.ok(v('end-session-summary', 'gives-review-date', date), date);
  assert.ok(!v('end-session-summary', 'gives-review-date', 'Come back soon.'));
  assert.ok(v('end-session-summary', 'gives-dashboard-path', 'Dashboard: /w/.teachback/attention/dashboard.html'));
  assert.ok(v('end-session-summary', 'names-mastered', 'Today you mastered Softmax.'));
});

test('the authoring graders: check output counts, the skill text quoting it does not, copied sentences fail', () => {
  const g = LOADED['build-course-from-source'].graders;
  const traceLine = (content) => JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content }] } });
  assert.ok(regexVerdict(g['check-passed'].front, traceLine('Checked /w/.teachback/ema\n  7 concepts in 3 layers, 24 items\nOK: no errors, 2 warnings.')));
  assert.ok(regexVerdict(g['check-passed'].front, traceLine('{\n  "ok": true,\n  "dir": "/w/.teachback/ema"')));
  assert.ok(!regexVerdict(g['check-passed'].front, traceLine('Checked /w/.teachback/ema\nFAILED: 2 errors, 0 warnings.')));
  const skillText = fs.readFileSync(path.join(REPO, 'SKILL.md'), 'utf8');
  assert.ok(!regexVerdict(g['check-passed'].front, traceLine(skillText)), 'SKILL.md quoting "OK: no errors." does not pass the grader');
  assert.ok(!regexVerdict(g['check-passed'].front, traceLine(fs.readFileSync(path.join(REPO, 'references', 'authoring-guide.md'), 'utf8'))));
  const map = (summary) => JSON.stringify({ schema: 'teachback/map@1', concepts: [{ id: 'x', summary }] }, null, 2);
  assert.ok(regexVerdict(g['no-copied-text'].front, map('An EMA keeps one running number and discounts older readings.')));
  assert.ok(!regexVerdict(g['no-copied-text'].front, map('Think of it as a running summary that forgets gracefully.')));
  assert.ok(!regexVerdict(g['no-copied-text'].front, undefined), 'no map.json fails');
  const source = fs.readFileSync(path.join(EVALS, 'build-course-from-source', 'source.md'), 'utf8');
  for (const phrase of ['forgets gracefully', 'fades by the same factor at every step', 'never quite arrives']) assert.ok(source.includes(phrase), `source.md contains "${phrase}"`);
});

// ---------- scaffolds, run as the harness runs them ----------
const hasBash = (() => {
  const r = spawnSync('bash', ['-c', 'node --version'], { encoding: 'utf8' });
  return r.status === 0 && /^v\d+/.test(r.stdout.trim());
})();
const WORK = tempDir('teachback-evals-');
const BUILT = {};
after(() => rmDir(WORK));

function runScaffold(name) {
  const ws = path.join(WORK, name);
  fs.mkdirSync(ws, { recursive: true });
  return new Promise((resolve) => {
    const p = spawn('bash', [path.join(EVALS, name, LOADED[name].caseYaml.context.scaffold_script)], { cwd: ws, env: { ...process.env, TEACHBACK_NOW: '' } });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => resolve({ ws, code, err }));
  });
}

before(async () => {
  if (!hasBash) return;
  const results = await Promise.all(CASES.map(runScaffold));
  CASES.forEach((c, i) => (BUILT[c] = results[i]));
});

const PLANS = {
  'start-session': { kind: 'review', item: 'softmax-scale', due: 6 },
  'wrong-answer-gets-hint': { kind: 'learn', activity: 'item', item: 'sdpa-variance' },
  'right-after-hint-records-partial': { kind: 'learn', activity: 'item', item: 'sdpa-variance' },
  'asks-for-answer': { kind: 'learn', activity: 'item', item: 'sdpa-variance' },
  'teachback-waits': { kind: 'learn', activity: 'teachback', item: 'sdpa-teachback' },
  'teachback-feedback': { kind: 'learn', activity: 'teachback', item: 'sdpa-teachback' },
  'exercise-hides-reference': { kind: 'exercise', exercise: '01-softmax' },
  'short-answer-own-judgement': { kind: 'learn', activity: 'item', item: 'qkv-roles' },
  'end-session-summary': { kind: 'learn', activity: 'item', item: 'qkv-roles' }
};

test('every scaffold builds the learner state its case is about', { skip: !hasBash && 'bash is not available' }, async () => {
  for (const c of CASES) assert.equal(BUILT[c].code, 0, `${c} scaffold: ${BUILT[c].err}`);
  for (const [c, want] of Object.entries(PLANS)) {
    const plan = (await cli(['next', '--root', BUILT[c].ws, '--json'])).json;
    assert.equal(plan.kind, want.kind, c);
    if (want.activity) assert.equal(plan.activity, want.activity, c);
    if (want.item) assert.equal(plan.item.id, want.item, c);
    if (want.due) assert.equal(plan.dueReviews.length, want.due, c);
    if (want.exercise) assert.equal(plan.exercise.id, want.exercise, c);
  }
  const work = fs.readFileSync(path.join(BUILT['exercise-hides-reference'].ws, '.teachback', 'attention', 'work', '01-softmax', 'softmax.py'), 'utf8');
  assert.match(work, /math\.exp\(s\)/, 'the learner copy has the overflow bug');
  assert.ok(!fs.existsSync(path.join(BUILT['end-session-summary'].ws, '.teachback', 'attention', 'dashboard.html')), 'the tutor must write the dashboard, not the scaffold');
  assert.ok(fs.existsSync(path.join(BUILT['build-course-from-source'].ws, 'source.md')));
  assert.ok(!fs.existsSync(path.join(BUILT['build-course-from-source'].ws, '.teachback')));
});

// The learner.json graders, before the tutor acts and after a right or a wrong action.
const LEARNER_GRADERS = {
  'start-session': { untouched: { 'nothing-recorded-yet': true }, wrong: [[['record', 'softmax-scale', '--result', 'correct']], { 'nothing-recorded-yet': false }] },
  'wrong-answer-gets-hint': { untouched: { 'not-recorded-yet': true }, wrong: [[['record', 'sdpa-variance', '--result', 'wrong', '--confidence', '3']], { 'not-recorded-yet': false }] },
  'right-after-hint-records-partial': {
    untouched: { 'recorded-partial': false, 'confidence-recorded': false, 'recorded-once': false },
    right: [[['record', 'sdpa-variance', '--result', 'partial', '--confidence', '3']], { 'recorded-partial': true, 'confidence-recorded': true, 'recorded-once': true }],
    wrong: [[['record', 'sdpa-variance', '--result', 'wrong', '--confidence', '3'], ['record', 'sdpa-variance', '--result', 'partial', '--confidence', '3']], { 'recorded-once': false }]
  },
  'asks-for-answer': {
    untouched: { 'recorded-wrong': false, 'recorded-once': false },
    right: [[['record', 'sdpa-variance', '--result', 'wrong']], { 'recorded-wrong': true, 'recorded-once': true }],
    wrong: [[['grade', 'sdpa-variance', '--answer', '64', '--record']], { 'recorded-wrong': false }]
  },
  'teachback-waits': { untouched: { 'nothing-recorded-yet': true }, wrong: [[['record', 'sdpa-teachback', '--result', 'partial']], { 'nothing-recorded-yet': false }] },
  'teachback-feedback': {
    untouched: { 'recorded-judgement': false },
    right: [[['record', 'sdpa-teachback', '--result', 'partial', '--confidence', '3']], { 'recorded-judgement': true }],
    wrong: [[['record', 'sdpa-teachback', '--result', 'wrong', '--confidence', '3']], { 'recorded-judgement': false }]
  },
  'exercise-hides-reference': { untouched: { 'ran-tests': false }, right: [[['run', '01-softmax']], { 'ran-tests': true }] },
  'short-answer-own-judgement': {
    untouched: { 'recorded-correct': false, 'recorded-once': false },
    right: [[['record', 'qkv-roles', '--result', 'correct', '--confidence', '3']], { 'recorded-correct': true, 'recorded-once': true }],
    wrong: [[['record', 'qkv-roles', '--result', 'partial', '--confidence', '3']], { 'recorded-correct': false, 'recorded-once': true }]
  }
};

function fileVerdicts(c, ws, names) {
  const out = {};
  for (const n of names) {
    const g = LOADED[c].graders[n].front;
    const file = path.join(ws, g.target.path);
    out[n] = regexVerdict(g, fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined);
  }
  return out;
}

test('learner.json graders pass on a right tutor action and fail on a wrong one', { skip: !hasBash && 'bash is not available' }, async () => {
  for (const [c, spec] of Object.entries(LEARNER_GRADERS)) {
    const fileGraders = Object.entries(LOADED[c].graders).filter(([, g]) => g.front.type === 'regex' && g.front.target?.source === 'file').map(([n]) => n);
    assert.deepEqual(Object.keys(spec.untouched).sort(), fileGraders.sort(), `${c}: every file grader is covered`);
    assert.deepEqual(fileVerdicts(c, BUILT[c].ws, fileGraders), spec.untouched, `${c}: untouched state`);
    for (const which of ['right', 'wrong']) {
      if (!spec[which]) continue;
      const ws = path.join(WORK, `${c}-${which}`);
      fs.cpSync(BUILT[c].ws, ws, { recursive: true });
      for (const args of spec[which][0]) {
        const r = await cli([...args, '--root', ws, '--json']);
        assert.ok(args[0] === 'run' || r.code === 0, `${c} ${args.join(' ')}: ${r.out}`);
      }
      const got = fileVerdicts(c, ws, Object.keys(spec[which][1]));
      assert.deepEqual(got, spec[which][1], `${c}: after a ${which} action`);
    }
  }
});
