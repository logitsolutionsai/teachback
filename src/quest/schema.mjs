// quests.json: loading and validation. Quests share one id namespace and one
// prerequisite DAG with the concepts in map.json. Commands are checked here,
// statically, before anything could run them.
import path from 'node:path';
import { readJson } from '../util.mjs';
import { validateFile } from '../schema.mjs';
import { checkRelPath } from '../repo/paths.mjs';

export const QUESTS_FILE = 'quests.json';
export const ACCEPTANCE_FOR = { navigate: ['source-location'], predict: ['item'], review: ['item'], reproduce: ['tests'], patch: ['tests'] };
const SHELLS = new Set(['sh', 'bash', 'zsh', 'fish', 'dash', 'ksh', 'csh', 'tcsh', 'cmd', 'cmd.exe', 'powershell', 'powershell.exe', 'pwsh', 'pwsh.exe', 'env', 'sudo', 'su', 'doas', 'xargs', 'eval', 'exec', 'nohup', 'time', 'watch', 'curl', 'wget', 'nc', 'ncat', 'ssh', 'scp']);
const META = /[|&;<>`\n\r]|\$\(|\$\{|\$[A-Za-z_]|%[A-Za-z_]+%/;
const GLOB = /[*?[\]{}]/;

// Problems with one argv array, as plain sentences (empty when it is acceptable).
export function commandProblems(argv) {
  const out = [];
  if (!Array.isArray(argv) || !argv.length || argv.some((a) => typeof a !== 'string' || !a.length)) return ['the command must be a non-empty array of non-empty strings'];
  const exe = argv[0];
  const base = path.posix.basename(exe.replace(/\\/g, '/')).toLowerCase();
  if (SHELLS.has(base)) out.push(`"${exe}" is a shell, a wrapper or a network tool, which is never allowed`);
  if (exe.includes('/') || exe.includes('\\')) out.push(`the executable "${exe}" must be a bare name such as node or python, not a path`);
  argv.forEach((a, i) => {
    if (META.test(a)) out.push(`argument ${i} ("${a.slice(0, 40)}") contains a shell operator, a substitution or an environment variable`);
    if (i > 0 && GLOB.test(a)) out.push(`argument ${i} ("${a.slice(0, 40)}") contains a glob character`);
    if (i === 1 && /^(-c|\/c)$/i.test(a)) out.push('"-c" style inline-command arguments are not allowed');
    if (i > 0 && /^node(\.exe)?$/.test(base) && /^(-e|--eval|-p|--print)(=|$)/.test(a)) out.push('inline code (node -e or -p) is not allowed; run a file in the repository');
    if (i > 0 && /^(python3?|py)(\.exe)?$/.test(base) && /^-c$/.test(a)) out.push('inline code (python -c) is not allowed; run a file in the repository');
    if (i > 0 && !a.startsWith('-')) {
      if (/^[A-Za-z]:[\\/]/.test(a) || a.startsWith('/') || a.startsWith('\\')) out.push(`argument ${i} ("${a.slice(0, 40)}") is an absolute path`);
      else if (a.split(/[\\/]/).includes('..')) out.push(`argument ${i} ("${a.slice(0, 40)}") climbs out with ".."`);
      if (/^[a-z]+:\/\//i.test(a) || /^file:/i.test(a)) out.push(`argument ${i} ("${a.slice(0, 40)}") is a URL`);
    }
  });
  return out;
}

export function loadQuests(courseDir) {
  try {
    return readJson(path.join(courseDir, QUESTS_FILE)) ?? null;
  } catch (err) {
    return { _error: err };
  }
}

// Validates quests.json against the course and the source lock.
// Returns problems shaped like check's: { level, code, file, message, hint }.
export function checkQuests(courseData, questsDoc, { lock, repoMap } = {}) {
  const problems = [];
  const err = (code, message, hint, where) => problems.push({ level: 'error', code, file: QUESTS_FILE, ...(where ? { where } : {}), message, hint });
  const warn = (code, message, hint, where) => problems.push({ level: 'warning', code, file: QUESTS_FILE, ...(where ? { where } : {}), message, hint });
  if (!questsDoc) {
    err('Q001', 'quests.json is missing.', 'A repo course needs quests.json (see references/repoquest.md).');
    return problems;
  }
  if (questsDoc._error) {
    err('Q002', questsDoc._error.message, questsDoc._error.hint);
    return problems;
  }
  for (const e of validateFile(questsDoc, 'quests.v1')) err('Q003', `${e.path} ${e.message}.`, 'Compare the field with references/repoquest.md.', e.path);
  if (problems.length) return problems;
  if (lock && questsDoc.sourceManifestDigest !== lock.manifestDigest) {
    err('Q004', 'quests.json was written against a different source lock.', 'Set sourceManifestDigest to the manifestDigest in source-lock.json after checking every quest against the current source, or run "teachback repo rebase".');
  }
  const conceptIds = new Set(courseData.concepts.map((c) => c.id));
  const questIds = new Set();
  questsDoc.quests.forEach((q, i) => {
    const where = `quests[${i}]`;
    if (questIds.has(q.id)) err('Q010', `Quest id "${q.id}" is used twice.`, 'Give every quest a unique id.', where);
    if (conceptIds.has(q.id)) err('Q011', `Quest id "${q.id}" is also a concept id.`, 'Quests and concepts share one namespace; rename the quest.', where);
    questIds.add(q.id);
  });
  const fileIds = new Set((lock?.files ?? []).map((f) => f.id));
  const symbolById = new Map((repoMap?.symbols ?? []).map((s) => [s.id, s]));
  const items = courseData.itemById;
  let capstones = 0;
  questsDoc.quests.forEach((q, i) => {
    const where = `quests[${i}]`;
    for (const p of q.prerequisites) {
      if (!conceptIds.has(p) && !questIds.has(p)) err('Q012', `Quest "${q.id}" lists prerequisite "${p}", which is neither a concept nor a quest.`, 'Use a concept id from map.json or a quest id from quests.json.', where);
    }
    const okKinds = ACCEPTANCE_FOR[q.kind];
    if (!q.acceptance) err('Q020', `Quest "${q.id}" has no acceptance.`, `A ${q.kind} quest needs acceptance.kind ${okKinds.join(' or ')}.`, where);
    else if (!okKinds.includes(q.acceptance.kind)) err('Q021', `Quest "${q.id}" (${q.kind}) has acceptance "${q.acceptance.kind}".`, `Use ${okKinds.join(' or ')}.`, where);
    if (q.acceptance?.kind === 'source-location') {
      if (!q.acceptance.fileId || !q.acceptance.symbolId) err('Q022', `Navigate quest "${q.id}" needs acceptance.fileId and acceptance.symbolId.`, 'A file name alone is never enough when several symbols could match.', where);
      if (lock && q.acceptance.fileId && !fileIds.has(q.acceptance.fileId)) err('Q023', `Quest "${q.id}" accepts file "${q.acceptance.fileId}", which is not in the source lock.`, 'Use a file id from source-lock.json.', where);
      if (repoMap && q.acceptance.symbolId) {
        const s = symbolById.get(q.acceptance.symbolId);
        if (!s) err('Q024', `Quest "${q.id}" accepts symbol "${q.acceptance.symbolId}", which is not in repo-map.json.`, 'Use a symbol id from repo-map.json.', where);
        else if (s.fileId !== q.acceptance.fileId) err('Q024', `Symbol "${s.id}" is in file "${s.fileId}", not "${q.acceptance.fileId}".`, 'Make acceptance.fileId the file that holds the symbol.', where);
        else if (!s.endLine) warn('Q025', `Symbol "${s.id}" has no known end line (certainty unknown).`, 'The learner must then name the symbol, not just a line in it.', where);
      }
      if (!q.sourceRefs?.length) err('Q026', `Navigate quest "${q.id}" has no sourceRefs.`, 'Point at the lines the answer is in.', where);
    }
    if (q.acceptance?.kind === 'item') {
      const it = items.get(q.acceptance.item);
      if (!it) err('Q027', `Quest "${q.id}" is judged by item "${q.acceptance.item}", which does not exist.`, 'Use a short or teachback item id from items.json.', where);
      else if (!['short', 'teachback'].includes(it.type)) err('Q027', `Quest "${q.id}" is judged by ${it.type} item "${it.id}".`, 'Predict and review quests are judged by a short or teachback item with a rubric.', where);
    }
    if (q.acceptance?.kind === 'tests') {
      if (!q.verification) err('Q030', `Quest "${q.id}" has no verification command.`, 'Add verification.command as an argv array.', where);
      else {
        for (const p of commandProblems(q.verification.command)) err('Q031', `Quest "${q.id}": ${p}.`, 'Commands are argv arrays run without a shell. Put a wrapper script in the repository if you need more.', where);
        if ((q.verification.timeoutSec ?? 20) > 30) warn('Q032', `Quest "${q.id}" allows ${q.verification.timeoutSec} s.`, 'Keep quest checks under 30 seconds.', where);
      }
      if (!q.workspace) err('Q033', `Quest "${q.id}" has no workspace.`, 'Add workspace.strategy and workspace.allowedPaths.', where);
      for (const ap of q.workspace?.allowedPaths ?? []) {
        const c = checkRelPath(ap.replace(/\/\*\*$/, '').replace(/\/\*$/, '') || 'x');
        if (!c.ok) err('Q034', `Quest "${q.id}" allows path "${ap}": ${c.reason}.`, 'allowedPaths are relative patterns inside the repository.', where);
      }
    }
    if (q.requiresTeachback) {
      const it = items.get(q.teachbackItem);
      if (!it || it.type !== 'teachback') err('Q040', `Quest "${q.id}" requires a teach-back but teachbackItem "${q.teachbackItem ?? ''}" is not a teachback item.`, 'Name a teachback item from items.json in teachbackItem.', where);
    }
    if (q.capstone) capstones += 1;
    if (q.capstone && q.kind !== 'patch' && q.kind !== 'reproduce') err('Q041', `Capstone quest "${q.id}" is a ${q.kind} quest.`, 'The capstone is a patch or reproduce quest with trusted tests.', where);
  });
  if (capstones > 1) err('Q042', `${capstones} quests are marked capstone.`, 'Mark one.');
  // One DAG over concepts and quests.
  const edges = new Map();
  for (const c of courseData.concepts) edges.set(c.id, c.prerequisites ?? []);
  for (const q of questsDoc.quests) edges.set(q.id, q.prerequisites);
  const state = new Map();
  const cycles = [];
  const visit = (id, stack) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) {
      cycles.push([...stack.slice(stack.indexOf(id)), id]);
      return;
    }
    state.set(id, 1);
    for (const p of edges.get(id) ?? []) visit(p, [...stack, id]);
    state.set(id, 2);
  };
  for (const id of [...edges.keys()].sort()) visit(id, []);
  for (const c of cycles) err('Q013', `Prerequisite cycle across concepts and quests: ${c.join(' -> ')}.`, 'Remove one prerequisite link so concepts and quests form a DAG.');
  return problems;
}
