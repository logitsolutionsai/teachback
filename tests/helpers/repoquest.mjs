// Shared helpers for the RepoQuest tests. No helper here, and no RepoQuest
// test, starts a real git process: guardGit() replaces the git runner with one
// that fails the test if it is ever called, and stubGit() replaces it with
// canned answers.
import fs from 'node:fs';
import path from 'node:path';
import { setGitRunner, gitCalls } from '../../src/repo/git.mjs';
import assert from 'node:assert/strict';
import { REPO, tempDir, cli } from './cli.mjs';

export const CACHE_EXAMPLE = path.join(REPO, 'examples', 'repoquest-cache-lib');
export const CACHE_REPO = path.join(CACHE_EXAMPLE, 'repo');

process.env.TEACHBACK_GIT = 'off'; // belt and braces: the real runner refuses too

export function guardGit() {
  setGitRunner((args) => {
    throw new Error(`a test tried to run git ${args.join(' ')}`);
  });
}

// answers: { 'rev-parse': {ok, stdout}, status: {...}, 'ls-files': {...}, worktree: fn }
export function stubGit(answers) {
  setGitRunner((args, opts) => {
    const a = answers[args[0]];
    if (typeof a === 'function') return a(args, opts);
    return a ?? { ok: false, code: 1, stdout: '', stderr: 'not stubbed' };
  });
  return gitCalls;
}

// Writes { 'rel/path': 'content' | Buffer } under a new temp folder.
export function makeRepo(files, prefix = 'teachback-repo-') {
  const dir = tempDir(prefix);
  writeFiles(dir, files);
  return dir;
}

export function writeFiles(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

export function copyCacheRepo() {
  const dir = tempDir('teachback-cache-');
  fs.cpSync(CACHE_REPO, dir, { recursive: true });
  return dir;
}

// A one-concept course on src/a.js, valid for check and verify.
export function writeMinimalCourse(dir, lock) {
  const fileId = lock.files.find((f) => f.path === 'src/a.js').id;
  const ref = { fileId, startLine: 1, endLine: 3, needle: 'alpha' };
  fs.writeFileSync(path.join(dir, 'map.json'), JSON.stringify({ schema: 'teachback/map@1', concepts: [{ id: 'alpha', name: 'Alpha', summary: 'alpha returns one.', sources: [{ section: 'src/a.js' }], sourceRefs: [ref], prerequisites: [], misconceptions: [{ id: 'm', description: 'Thinks it returns two.' }] }] }));
  const rub = { required: [{ id: 'one', idea: 'returns one', synonyms: ['one', '1'] }] };
  fs.writeFileSync(path.join(dir, 'items.json'), JSON.stringify({ schema: 'teachback/items@1', items: [
    { id: 'a-num', concept: 'alpha', type: 'numeric', prompt: 'What does alpha return?', answer: 1 },
    { id: 'a-short', concept: 'alpha', type: 'short', prompt: 'What does alpha return?', rubric: rub, modelAnswer: 'It returns one.' },
    { id: 'a-tb', concept: 'alpha', type: 'teachback', prompt: 'Explain alpha.', rubric: rub, modelAnswer: 'It returns one.' }
  ] }));
  fs.writeFileSync(path.join(dir, 'quests.json'), JSON.stringify({ schemaVersion: 1, courseKind: 'repo-quest', sourceManifestDigest: lock.manifestDigest, quests: [] }));
}

// The cache-lib example course in a temp root, and a scripted learner who
// answers everything correctly and finishes every quest with the reference fix.
const ITEMS = new Map(JSON.parse(fs.readFileSync(path.join(CACHE_EXAMPLE, 'items.json'), 'utf8')).items.map((i) => [i.id, i]));

export async function cacheCourse(keep = (d) => d) {
  const root = keep(tempDir());
  const repo = keep(copyCacheRepo());
  const base = ['--root', root, '--json'];
  await cli(['init', 'cache', '--from', CACHE_EXAMPLE, ...base]);
  await cli(['repo', 'verify', 'cache', '--repo', repo, ...base]);
  let minute = 0;
  const now = () => new Date(Date.UTC(2026, 10, 14, 9, minute++)).toISOString();
  const answer = async (id) => {
    const it = ITEMS.get(id);
    const args = it.type === 'mcq' || it.type === 'numeric' ? ['grade', id, '--answer', it.type === 'mcq' ? String.fromCharCode(65 + it.answer) : String(it.answer), '--confidence', '4', '--record'] : ['record', id, '--result', 'correct', '--confidence', '4', '--note', 'private note about my answer'];
    assert.equal((await cli([...args, ...base, '--now', now()])).code, 0);
  };
  return { root, repo, base, now, answer, dir: path.join(root, '.teachback', 'cache') };
}

export async function finishCacheCourse(c) {
  for (let i = 0; i < 40; i++) {
    const plan = (await cli(['next', ...c.base, '--now', c.now()])).json;
    if (plan.kind === 'learn' || plan.kind === 'review') await c.answer(plan.item.id);
    else if (plan.kind === 'quest' && plan.quest.kind === 'navigate') await cli(['quest', 'answer', plan.quest.id, '--path', 'src/cache/lru.js', '--symbol', 'evict', ...c.base]);
    else if (plan.kind === 'quest' && plan.quest.kind === 'predict') await c.answer(plan.quest.item);
    else if (plan.kind === 'quest' && plan.quest.status === 'needs_teachback') await c.answer(plan.quest.teachbackItem);
    else if (plan.kind === 'quest' && plan.quest.kind === 'patch') {
      const ws = (await cli(['quest', 'start', plan.quest.id, ...c.base])).json.workspace;
      fs.copyFileSync(path.join(CACHE_EXAMPLE, 'trusted-commands.example.json'), path.join(c.root, '.teachback', 'trusted-commands.json'));
      fs.copyFileSync(path.join(CACHE_EXAMPLE, 'quests', 'fix-eviction', '.reference', 'src', 'cache', 'lru.js'), path.join(ws, 'src', 'cache', 'lru.js'));
      assert.equal((await cli(['quest', 'run', plan.quest.id, '--trust-local', ...c.base, '--now', c.now()])).code, 0);
    } else return plan;
  }
  throw new Error('did not finish');
}
