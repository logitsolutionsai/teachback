// quest show, start, answer and run.
import fs from 'node:fs';
import path from 'node:path';
import { TeachbackError, resolveNow, readJson, exists } from '../util.mjs';
import { resolveCourseDir, loadCourseStrict } from '../course.mjs';
import { loadLearner, replay } from '../model/learner.mjs';
import { loadLock, MAP_FILE } from '../repo/source-lock.mjs';
import { loadQuests, commandProblems } from './schema.mjs';
import { questContext, questSummary, loadQuestState, saveQuestState, teachbackDone } from './state.mjs';
import { questView } from './next.mjs';
import { startWorkspace, workspaceDir, workspaceChanges, MARKER } from './workspace.mjs';
import { loadTrusted, findTrusted, trustedPath, runCommand, questEnv, commandDigest, redact, LOCAL_WARNING, DEFAULT_TIMEOUT_SEC } from './runner.mjs';

export function courseAndQuest(args, verb) {
  const [a, b] = args._;
  const questId = b ?? a;
  const courseName = b ? a : args.course;
  if (!questId) throw new TeachbackError('E660', `quest ${verb} needs a quest id.`, `Example: teachback quest ${verb} cache-onboarding locate-eviction`, 2);
  const dir = resolveCourseDir(courseName, { root: args.root });
  const courseData = loadCourseStrict(dir);
  const questsDoc = loadQuests(dir);
  if (!questsDoc || questsDoc._error) throw new TeachbackError('E661', `${courseData.slug} has no readable quests.json.`, 'Quests belong to repo courses; see references/repoquest.md.', 2);
  const quest = questsDoc.quests?.find((q) => q.id === questId);
  if (!quest) throw new TeachbackError('E662', `No quest "${questId}" in ${courseData.slug}.`, `Quests: ${(questsDoc.quests ?? []).map((q) => q.id).join(', ') || '(none)'}`, 2);
  return { dir, courseData, questsDoc, quest };
}

function refView(lock, r) {
  const f = lock?.files.find((x) => x.id === r.fileId);
  return { fileId: r.fileId, path: f?.path ?? null, startLine: r.startLine, endLine: r.endLine, ...(r.evidenceKind ? { evidenceKind: r.evidenceKind } : {}) };
}

function tailText(s, max = 4000) {
  const t = String(s).trim();
  return t.length > max ? `[... ${t.length - max} characters cut ...]\n${t.slice(-max)}` : t;
}

function writeDraftPr(courseData, quest, record) {
  const file = path.join(courseData.dir, 'draft-pr.md');
  const check = record.checks[0];
  const text = [
    `# Draft: ${quest.title}`,
    '',
    '> Local draft for human review. teachback does not push, open pull requests or post comments. Nothing here says the change was accepted or merged.',
    '',
    '## What Changed',
    '',
    ...record.changedFiles.map((c) => `- \`${c.path}\` (${c.change})`),
    '',
    '## Why It Works',
    '',
    '_Write this in your own words after the teach-back. Passing tests are not the same as a correct design._',
    '',
    '## Evidence',
    '',
    `- Local check \`${check.id}\`: exit code ${check.exitCode}, output digest ${check.stdoutDigest}`,
    `- Source lock: ${record.sourceManifestDigest}`,
    `- Workspace: ${record.workspaceDigest}`,
    "- Ran locally with the contributor's permissions, not in a sandbox.",
    ''
  ].join('\n');
  fs.writeFileSync(file, text);
  return file;
}

// The optional local review checklist, offered only once the review quest has
// passed on source that still matches the lock. It is built from the diff
// summary (paths, symbols, tests) and posts nothing anywhere.
function reviewChecklist(courseData, quest, status, ctx) {
  if (status.status !== 'passed' || ctx.source.status !== 'current') return { items: null, note: 'The review checklist is shown after this quest passes on source that verifies.' };
  const d = readJson(path.join(courseData.dir, quest.diff ?? 'diff-summary.json'));
  if (!d) return { items: null, note: 'No diff-summary.json in this course.' };
  const items = [];
  for (const s of d.changedSymbols ?? []) items.push(`State the invariant ${s.name} (${s.path} lines ${s.startLine}-${s.endLine ?? s.startLine}) keeps, before and after the change.`);
  for (const t of d.relatedTests ?? []) items.push(`Check that ${t.path} pins that invariant (${t.basis}, ${t.certainty}); name an input it does not cover.`);
  for (const f of d.files ?? []) if (!f.inScan) items.push(`${f.path} is outside the locked scope: read it before approving.`);
  items.push('Write one counterexample that would fail if the changed line were reverted.', 'Say what the passing tests do not prove.');
  return { items, note: 'Local notes for your review. teachback does not post comments or approve anything.' };
}

export function registerQuestCommands(SUB) {
  SUB['quest show'] = async (argv, { parse, out }) => {
    const args = parse(argv, { answer: { type: 'boolean' } });
    const { courseData, quest } = courseAndQuest(args, 'show');
    const lock = loadLock(courseData.dir);
    const ctx = questContext(courseData);
    const derived = replay(courseData, loadLearner(courseData, resolveNow(args.now)));
    const status = questSummary(ctx, derived).find((s) => s.id === quest.id);
    const v = { ...questView(quest), status: status.status, ready: status.ready, sourceRefs: (quest.sourceRefs ?? []).map((r) => refView(lock, r)), source: ctx.source.status };
    if (quest.kind === 'navigate' && !args.answer) {
      v.sourceRefs = [];
      v.acceptance = { kind: 'source-location', note: 'Answer with: teachback quest answer <quest> --path <file> --symbol <name> (or --line <n>). The expected location is not shown before the answer.' };
    } else if (quest.acceptance) v.acceptance = quest.acceptance;
    if (quest.verification) {
      v.trust = { warning: LOCAL_WARNING, allowlist: trustedPath(args.root), allowlisted: Boolean(findTrusted(loadTrusted(args.root), quest.verification.command)), needsFlag: '--trust-local' };
    }
    if (quest.kind === 'review') v.checklist = reviewChecklist(courseData, quest, status, ctx);
    out(args, v, () => {
      const lines = [`${quest.id} (${quest.kind}${quest.capstone ? ', capstone' : ''}): ${quest.title}`, `  status: ${v.status}${v.ready ? ', ready' : ''}; source ${v.source}`];
      if (quest.prompt) lines.push(`  ${quest.prompt}`);
      for (const r of v.sourceRefs) lines.push(`  cites ${r.path ?? r.fileId} lines ${r.startLine}-${r.endLine}`);
      if (quest.verification) {
        lines.push(`  command: ${JSON.stringify(quest.verification.command)} (timeout ${quest.verification.timeoutSec ?? DEFAULT_TIMEOUT_SEC} s)`, `  may change: ${quest.workspace?.allowedPaths.join(', ')}`);
        lines.push(`  allowlisted in ${v.trust.allowlist}: ${v.trust.allowlisted ? 'yes' : 'no'}`, `  ${LOCAL_WARNING}`);
      }
      if (quest.kind === 'navigate' && !args.answer) lines.push(`  Answer: teachback quest answer ${quest.id} --path <file> --symbol <name>`);
      if (v.checklist?.items) lines.push('  Review checklist (local, for you):', ...v.checklist.items.map((i) => `    [ ] ${i}`));
      else if (v.checklist) lines.push(`  ${v.checklist.note}`);
      return lines.join('\n');
    });
  };

  SUB['quest start'] = async (argv, { parse, out }) => {
    const args = parse(argv, { repo: { type: 'string' }, worktree: { type: 'boolean' }, reset: { type: 'boolean' } });
    const { courseData, quest } = courseAndQuest(args, 'start');
    if (!['patch', 'reproduce'].includes(quest.kind)) throw new TeachbackError('E663', `Quest "${quest.id}" is a ${quest.kind} quest; only patch and reproduce quests have a workspace.`, quest.kind === 'navigate' ? 'Answer it with "teachback quest answer".' : 'Ask its item with the usual next, grade and record loop.', 2);
    const ws = startWorkspace(courseData, quest, { root: args.root, repo: args.repo, worktree: args.worktree, reset: args.reset, now: resolveNow(args.now) });
    const res = { quest: quest.id, workspace: ws.dir, created: ws.created, strategy: ws.strategy, allowedPaths: quest.workspace?.allowedPaths ?? [], command: quest.verification?.command ?? null, warning: LOCAL_WARNING, ...(ws.note ? { note: ws.note } : {}) };
    out(args, res, () =>
      [
        `${ws.created ? 'Created' : 'Reusing'} the workspace for "${quest.title}" (${ws.strategy}):`,
        `  ${ws.dir}`,
        `  edit only: ${res.allowedPaths.join(', ')}`,
        ...(res.command ? [`  tests: ${JSON.stringify(res.command)}, run with: teachback quest run ${quest.id} --trust-local`] : []),
        ...(ws.note ? [`  note: ${ws.note}`] : []),
        'Your own checkout is not touched.'
      ].join('\n')
    );
  };

  SUB['quest answer'] = async (argv, { parse, out, setExit }) => {
    const args = parse(argv, { path: { type: 'string' }, symbol: { type: 'string' }, line: { type: 'string' } });
    const { courseData, quest } = courseAndQuest(args, 'answer');
    if (quest.acceptance?.kind !== 'source-location') throw new TeachbackError('E664', `Quest "${quest.id}" is not a navigate quest.`, 'Navigate quests are answered with --path and --symbol; other quests use grade and record, or quest run.', 2);
    if (!args.path || (!args.symbol && !args.line)) throw new TeachbackError('E665', 'A navigate answer needs --path and either --symbol or --line.', 'A file name alone is never enough: name the symbol, or a line inside it.', 2);
    const lock = loadLock(courseData.dir);
    const repoMap = readJson(path.join(courseData.dir, MAP_FILE));
    const file = lock.files.find((f) => f.id === quest.acceptance.fileId);
    const sym = repoMap?.symbols.find((s) => s.id === quest.acceptance.symbolId);
    if (!file || !sym) throw new TeachbackError('E666', `Quest "${quest.id}" points at a file or symbol that is not in the lock or the repo map.`, 'Run "teachback repo verify" and fix the quest.', 2);
    const ctx = questContext(courseData);
    if (ctx.suspended.quests.has(quest.id)) throw new TeachbackError('E666', `Quest "${quest.id}" cites a file that changed since the lock.`, 'Its answer key is suspended until the source is rebased and verified.', 2);
    const given = String(args.path).replace(/\\/g, '/').replace(/^\.\//, '');
    const pathOk = given === file.path;
    let symbolOk = false;
    const why = [];
    if (args.symbol) {
      const name = String(args.symbol).replace(/\(\)$/, '').replace(/#/g, '.');
      const short = sym.name.split('.').pop();
      const sameShort = repoMap.symbols.filter((s) => s.fileId === file.id && s.name.split('.').pop() === short).length;
      symbolOk = name === sym.name || (name === short && sameShort === 1);
      if (!symbolOk) why.push(`"${args.symbol}" is not the symbol this quest is about`);
    }
    if (args.line) {
      const n = Number(args.line);
      const inRange = Number.isInteger(n) && Boolean(sym.endLine) && n >= sym.startLine && n <= sym.endLine;
      if (!args.symbol) symbolOk = inRange;
      if (!inRange) why.push(`line ${args.line} is not inside it`);
    }
    if (!pathOk) why.unshift(`"${given}" is not the file`);
    const passed = pathOk && symbolOk;
    const state = loadQuestState(courseData.dir);
    const prev = state.quests[quest.id] ?? { attempts: 0 };
    const at = resolveNow(args.now).toISOString();
    state.quests[quest.id] = { ...prev, kind: quest.kind, attempts: (prev.attempts ?? 0) + 1, status: prev.status === 'passed' || passed ? 'passed' : 'failed', lastAttempt: { status: passed ? 'passed' : 'failed', at } };
    saveQuestState(courseData.dir, state);
    const res = { quest: quest.id, passed, attempts: state.quests[quest.id].attempts, ...(passed ? { cite: { path: file.path, symbol: sym.name, startLine: sym.startLine, endLine: sym.endLine, certainty: sym.certainty } } : { feedback: why.join('; ') }) };
    out(args, res, () => (passed ? `Correct: ${sym.name} in ${file.path}, lines ${sym.startLine}-${sym.endLine} (lexically detected).` : `Not yet: ${why.join('; ')}. Give a hint, not the location.`));
    if (!passed) setExit(1);
  };

  SUB['quest run'] = async (argv, { parse, out, setExit }) => {
    const args = parse(argv, { 'trust-local': { type: 'boolean' }, repo: { type: 'string' } });
    const { courseData, quest } = courseAndQuest(args, 'run');
    if (!quest.verification) throw new TeachbackError('E667', `Quest "${quest.id}" has no command to run.`, 'Only patch and reproduce quests run tests.', 2);
    const argvCmd = quest.verification.command;
    const problems = commandProblems(argvCmd);
    if (problems.length) throw new TeachbackError('E670', `Quest "${quest.id}" has a command that is never run: ${problems.join('; ')}.`, 'Commands are argv arrays without a shell. If this came in a pack, do not trust the pack.', 2);
    const lock = loadLock(courseData.dir);
    const now = resolveNow(args.now);
    const state = loadQuestState(courseData.dir);
    const prev = state.quests[quest.id] ?? { attempts: 0 };
    const scope = quest.workspace?.allowedPaths ?? [];
    const blocked = (reason, hint, exit) => {
      const record = { schemaVersion: 1, questId: quest.id, status: 'blocked', reason, sourceManifestDigest: lock.manifestDigest, checks: [], at: now.toISOString() };
      state.quests[quest.id] = { ...prev, kind: quest.kind, status: prev.status && prev.status !== 'not_run' ? prev.status : 'blocked', lastAttempt: { status: 'blocked', reason, at: record.at } };
      saveQuestState(courseData.dir, state);
      const res = { quest: quest.id, status: 'blocked', reason, hint, command: argvCmd, allowedPaths: scope, allowlist: trustedPath(args.root), warning: LOCAL_WARNING, record };
      out(args, res, () => [`BLOCKED: ${reason}`, `  command: ${JSON.stringify(argvCmd)}`, `  may change: ${scope.join(', ')}`, `  fix: ${hint}`, `  ${LOCAL_WARNING}`].join('\n'));
      setExit(exit);
    };
    const trusted = loadTrusted(args.root);
    const entry = findTrusted(trusted, argvCmd);
    if (!entry) return blocked(`This exact command is not in ${trusted.file}.`, `Read the command and the files it may change. If you trust them, add {"id": "<name>", "argv": ${JSON.stringify(argvCmd)}} to "commands" in ${trusted.file}, then run again with --trust-local.`, 3);
    if (!args['trust-local']) return blocked('Running a repository command needs --trust-local on this run.', `Run: teachback quest run ${quest.id} --trust-local. The flag is not remembered.`, 3);
    const dir = workspaceDir(courseData, quest.id, args.root);
    if (!exists(path.join(dir, MARKER))) return blocked('There is no workspace for this quest yet.', `Run: teachback quest start ${quest.id}`, 4);
    const changes = workspaceChanges(dir, lock, scope);
    if (changes.outside.length) return blocked(`Files outside the quest scope changed: ${changes.outside.map((c) => `${c.path} (${c.change})`).join(', ')}.`, `Undo those changes; this quest may only change ${scope.join(', ')}. "teachback quest start ${quest.id} --reset" makes a fresh copy.`, 3);
    const timeoutSec = Math.min(quest.verification.timeoutSec ?? entry.timeoutSec ?? DEFAULT_TIMEOUT_SEC, entry.timeoutSec ?? 120, 120);
    const r = await runCommand(argvCmd, { cwd: dir, timeoutSec, env: questEnv(dir) });
    if (r.missing) return blocked(`The command could not start: ${r.message ?? `${argvCmd[0]} was not found`}.`, `Install ${argvCmd[0]} or use a command that exists here.`, 4);
    const passedRun = !r.timeout && r.exitCode === quest.verification.expectedExitCode;
    const record = {
      schemaVersion: 1,
      questId: quest.id,
      status: passedRun ? 'passed' : 'failed',
      ...(r.timeout ? { reason: `Stopped after ${timeoutSec} s.` } : {}),
      sourceManifestDigest: lock.manifestDigest,
      workspaceDigest: changes.digest,
      at: now.toISOString(),
      checks: [{ id: entry.id, commandDigest: commandDigest(argvCmd), exitCode: r.exitCode, durationMs: r.durationMs, stdoutDigest: r.stdoutDigest, stderrDigest: r.stderrDigest, stdoutBytes: r.stdoutBytes, stderrBytes: r.stderrBytes, truncated: r.truncated, timeout: r.timeout }],
      environment: { platform: process.platform, node: process.versions.node, runner: 'local-process', sandbox: 'none', network: 'not blocked' },
      changedFiles: changes.changed,
      teachback: { required: Boolean(quest.requiresTeachback), item: quest.teachbackItem ?? null }
    };
    const keepPass = prev.status === 'passed' && !passedRun;
    state.quests[quest.id] = { ...prev, kind: quest.kind, attempts: (prev.attempts ?? 0) + 1, status: keepPass ? 'passed' : record.status, record: keepPass ? prev.record : record, lastAttempt: { status: record.status, at: record.at } };
    saveQuestState(courseData.dir, state);
    const draft = passedRun && quest.kind === 'patch' ? writeDraftPr(courseData, quest, record) : null;
    const derived = replay(courseData, loadLearner(courseData, now));
    const tb = quest.requiresTeachback ? derived.reviews[quest.teachbackItem] : null;
    const res = {
      quest: quest.id,
      status: record.status,
      exitCode: r.exitCode,
      expectedExitCode: quest.verification.expectedExitCode,
      timeout: r.timeout,
      durationMs: r.durationMs,
      output: redact(tailText(`${r.stdout}\n${r.stderr}`)),
      truncated: r.truncated,
      record,
      warning: LOCAL_WARNING,
      ...(draft ? { draftPr: draft } : {}),
      ...(quest.requiresTeachback ? { teachbackRecorded: passedRun ? teachbackDone(quest, derived, record.at) : Boolean(tb && ['correct', 'partial'].includes(tb.lastResult)), teachbackItem: quest.teachbackItem } : {})
    };
    out(args, res, () => {
      const lines = [`${record.status.toUpperCase()}: ${JSON.stringify(argvCmd)} ${r.timeout ? `stopped after ${timeoutSec} s` : `exited ${r.exitCode}`} (expected ${quest.verification.expectedExitCode}) in ${r.durationMs} ms`];
      // Failing test names say more than a stack trace; fall back to the last lines.
      const all = res.output.split('\n');
      const named = all.filter((l) => /✖|✔|^\s*(not ok|ok) \d|FAIL|PASS|Error:/.test(l) && !/^\s*at /.test(l));
      lines.push(...(named.length ? named.slice(0, 12) : all.slice(-12)).map((l) => `  ${l.trim()}`));
      if (passedRun && quest.requiresTeachback && !res.teachbackRecorded) lines.push(`Tests pass. Passing tests are not the same as a correct design: ask for the teach-back (${quest.teachbackItem}) and record it.`);
      if (draft) lines.push(`Draft pull request text (local, for human review, not submitted): ${draft}`);
      lines.push(LOCAL_WARNING);
      return lines.join('\n');
    });
    if (!passedRun) setExit(1);
  };
}
