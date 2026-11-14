// The one place RepoQuest talks to git. Every git call goes through run(), and
// run() goes through a replaceable runner, so tests install a stub and no test
// ever starts a real git process.
//
// Only these subcommands are allowed. Discovery uses the read-only ones
// (rev-parse, status, ls-files, show, diff). "worktree add" is used only by
// quest start --worktree, to make a scratch checkout the user asked for;
// nothing here pushes, fetches, resets, cleans or checks out over the user's
// branch.
//
// Each call disables fsmonitor and hooks (a cloned repository's own config can
// name a program to run on "git status") and takes no optional locks.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const READ_ONLY_SUBCOMMANDS = Object.freeze(['rev-parse', 'status', 'ls-files', 'show', 'diff']);
export const WRITE_SUBCOMMANDS = Object.freeze(['worktree']);
export const SHA_PATTERN = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const REF = /^(?!-)[A-Za-z0-9._/@^~{}-]{1,200}$/;

function gitEnv() {
  const keep = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'HOME', 'USERPROFILE', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'PATHEXT', 'WINDIR'];
  const env = {};
  for (const k of keep) if (process.env[k] !== undefined) env[k] = process.env[k];
  env.GIT_TERMINAL_PROMPT = '0';
  env.GIT_OPTIONAL_LOCKS = '0';
  env.GIT_CONFIG_NOSYSTEM = '1';
  return env;
}

// The real runner. The test suite never calls it (see docs/SECURITY-EXECUTION.md).
export function defaultGitRunner(args, { cwd }) {
  if (process.env.TEACHBACK_GIT === 'off') return { ok: false, unavailable: true, code: null, stdout: '', stderr: 'git is turned off (TEACHBACK_GIT=off).' };
  const nullHooks = process.platform === 'win32' ? 'NUL' : '/dev/null';
  const r = spawnSync('git', ['-c', 'core.fsmonitor=false', '-c', `core.hooksPath=${nullHooks}`, '--no-optional-locks', ...args], {
    cwd,
    env: gitEnv(),
    encoding: 'utf8',
    timeout: 15000,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024
  });
  if (r.error) return { ok: false, unavailable: r.error.code === 'ENOENT', code: null, stdout: '', stderr: String(r.error.message) };
  return { ok: r.status === 0, code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

let runner = defaultGitRunner;
const calls = [];

// Replace the runner (tests pass a stub). Returns the previous one.
export function setGitRunner(fn) {
  const prev = runner;
  runner = fn ?? defaultGitRunner;
  return prev;
}

// Every call made through run(), in order (tests assert on it).
export function gitCalls() {
  return calls;
}

export function run(args, { cwd }) {
  const sub = args[0];
  if (![...READ_ONLY_SUBCOMMANDS, ...WRITE_SUBCOMMANDS].includes(sub)) throw new Error(`git ${sub} is not allowed`);
  if (sub === 'worktree' && args[1] !== 'add') throw new Error(`git worktree ${args[1]} is not allowed`);
  calls.push({ args: [...args], cwd });
  return runner(args, { cwd });
}

// A repository root is a folder with its own .git (folder or file). This is a
// file-system check only; it starts no process, and it does not look in parent
// folders, so a plain folder inside another repository counts as a plain folder.
export function isGitRoot(root) {
  try {
    fs.lstatSync(path.join(root, '.git'));
    return true;
  } catch {
    return false;
  }
}

export function resolveRef(root, ref = 'HEAD') {
  if (!REF.test(ref)) return { ok: false, error: `"${ref}" is not a valid git ref.` };
  const r = run(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: root });
  if (r.unavailable) return { ok: false, unavailable: true, error: 'git is not available.' };
  const sha = r.stdout.trim();
  if (!r.ok || !SHA_PATTERN.test(sha)) return { ok: false, error: `git could not resolve "${ref}" to a commit.` };
  return { ok: true, sha };
}

// Paths under scope that differ from HEAD: modified, staged, deleted or untracked.
export function dirtyPaths(root, scope) {
  const r = run(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', scope || '.'], { cwd: root });
  if (!r.ok) return { ok: false, unavailable: Boolean(r.unavailable), paths: new Map() };
  const paths = new Map();
  const parts = r.stdout.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i];
    if (rec.length < 4) continue;
    const code = rec.slice(0, 2);
    paths.set(rec.slice(3), code === '??' ? 'untracked' : 'dirty');
    if (code[0] === 'R' || code[0] === 'C') i += 1; // the next record is the old name
  }
  return { ok: true, paths };
}

export function trackedPaths(root, scope) {
  const r = run(['ls-files', '-z', '--', scope || '.'], { cwd: root });
  if (!r.ok) return { ok: false, unavailable: Boolean(r.unavailable), paths: new Set() };
  return { ok: true, paths: new Set(r.stdout.split('\0').filter(Boolean)) };
}

// Optional: the diff of the working tree against a base ref, for review mode.
export function diffAgainst(root, base = 'HEAD') {
  if (!REF.test(base)) return { ok: false, error: `"${base}" is not a valid git ref.` };
  const r = run(['diff', '--no-color', '--no-ext-diff', '--no-textconv', base, '--'], { cwd: root });
  return r.ok ? { ok: true, patch: r.stdout } : { ok: false, unavailable: Boolean(r.unavailable), error: r.stderr.trim() || 'git diff failed.' };
}

// Optional: a detached scratch checkout of a verified commit.
export function addWorktree(root, dir, sha) {
  if (!SHA_PATTERN.test(sha)) return { ok: false, error: 'A worktree needs a full commit SHA.' };
  const r = run(['worktree', 'add', '--detach', dir, sha], { cwd: root });
  return r.ok ? { ok: true } : { ok: false, unavailable: Boolean(r.unavailable), error: r.stderr.trim() || 'git worktree add failed.' };
}
