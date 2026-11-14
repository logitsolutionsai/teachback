// Runs a quest's verification command. A command runs only when all of these hold:
//   1. it is an argv array with no shell, operator, glob, substitution or
//      environment variable (checked statically; see schema.mjs);
//   2. it is listed, argument for argument, in .teachback/trusted-commands.json,
//      a file this machine's user writes and no pack ever contains;
//   3. the user passed --trust-local on this run (nothing persists it);
//   4. the quest workspace exists and the learner's changes stay inside the
//      quest's allowedPaths.
// The command then runs in the workspace with a timeout, an output cap, a
// minimal environment (no tokens or keys from the parent) and CI=1. It runs
// with the user's permissions: this is not a sandbox, and network access is
// not blocked. There is no container runner yet (docs/SECURITY-EXECUTION.md).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { TeachbackError, readJson } from '../util.mjs';
import { teachbackRoot } from '../course.mjs';
import { validateFile } from '../schema.mjs';
import { detectPython } from '../runner.mjs';
import { digestOf } from '../repo/scan.mjs';
import { commandProblems } from './schema.mjs';

export const TRUSTED_FILE = 'trusted-commands.json';
export const OUTPUT_CAP = 64 * 1024;
export const DEFAULT_TIMEOUT_SEC = 20;
export const LOCAL_WARNING = 'Commands execute locally with your permissions; network cannot be reliably blocked. This is not a sandbox.';

export function trustedPath(root) {
  return path.join(teachbackRoot(root), TRUSTED_FILE);
}

export function loadTrusted(root) {
  const file = trustedPath(root);
  const doc = readJson(file);
  if (!doc) return { file, commands: [] };
  const errs = validateFile(doc, 'trusted-commands.v1');
  if (errs.length) throw new TeachbackError('E650', `${file}: ${errs[0].path} ${errs[0].message}.`, 'Fix the allowlist (see references/repoquest.md, "Trusted Commands").', 2);
  for (const c of doc.commands) {
    const p = commandProblems(c.argv);
    if (p.length) throw new TeachbackError('E651', `${file}: command "${c.id}" is refused: ${p[0]}.`, 'The allowlist takes the same argv rules as quests.', 2);
  }
  return { file, commands: doc.commands };
}

export function findTrusted(trusted, argv) {
  return trusted.commands.find((c) => c.argv.length === argv.length && c.argv.every((a, i) => a === argv[i])) ?? null;
}

const SECRET_NAME = /TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|API_?KEY|PRIVATE|AUTH|SESSION|COOKIE|^AWS_|^AZURE_|^GCP_|^GOOGLE_|^GH_|^GITHUB_|^NPM_|^OPENAI|^ANTHROPIC|^SSH_/i;

// The child's environment: an allowlist of harmless variables, never one whose
// name looks like a secret, plus CI=1, and HOME pointed at the workspace.
export function questEnv(workspace) {
  const keep = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'SystemDrive', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'COMSPEC', 'PATHEXT', 'WINDIR', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS'];
  const env = {};
  for (const k of keep) if (process.env[k] !== undefined && !SECRET_NAME.test(k)) env[k] = process.env[k];
  const home = path.join(workspace, '.teachback-home');
  fs.mkdirSync(home, { recursive: true });
  Object.assign(env, { HOME: home, USERPROFILE: home, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0', PYTHONDONTWRITEBYTECODE: '1', NODE_OPTIONS: '' });
  return env;
}

function resolveExecutable(name) {
  const base = name.toLowerCase().replace(/\.exe$/, '');
  if (base === 'node') return { cmd: process.execPath, args: [] };
  if (['python', 'python3', 'py'].includes(base)) {
    const py = detectPython();
    return py ? { cmd: py.cmd, args: py.args } : null;
  }
  return { cmd: name, args: [] };
}

function killTree(child) {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      // already gone
    }
  }
}

// Runs argv in cwd. Keeps the first OUTPUT_CAP bytes of each stream for display
// and hashes the whole stream.
export function runCommand(argv, { cwd, timeoutSec, env }) {
  return new Promise((resolve) => {
    const exe = resolveExecutable(argv[0]);
    if (!exe) {
      resolve({ missing: true, message: `No ${argv[0]} interpreter was found.` });
      return;
    }
    const started = Date.now();
    const streams = { stdout: { keep: [], kept: 0, bytes: 0, hash: crypto.createHash('sha256') }, stderr: { keep: [], kept: 0, bytes: 0, hash: crypto.createHash('sha256') } };
    let timedOut = false;
    let child;
    try {
      child = spawn(exe.cmd, [...exe.args, ...argv.slice(1)], { cwd, env, windowsHide: true, shell: false, detached: process.platform !== 'win32' });
    } catch (err) {
      resolve({ missing: err.code === 'ENOENT', message: String(err.message) });
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutSec * 1000);
    for (const name of ['stdout', 'stderr']) {
      child[name].on('data', (buf) => {
        const s = streams[name];
        s.bytes += buf.length;
        s.hash.update(buf);
        if (s.kept < OUTPUT_CAP) {
          const part = buf.subarray(0, OUTPUT_CAP - s.kept);
          s.keep.push(part);
          s.kept += part.length;
        }
      });
    }
    let settled = false;
    const finish = (code, err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const view = (s) => Buffer.concat(s.keep).toString('utf8');
      resolve({
        missing: Boolean(err && err.code === 'ENOENT'),
        message: err ? String(err.message) : undefined,
        exitCode: err ? null : code,
        timeout: timedOut,
        durationMs: Date.now() - started,
        stdout: view(streams.stdout),
        stderr: view(streams.stderr),
        stdoutBytes: streams.stdout.bytes,
        stderrBytes: streams.stderr.bytes,
        stdoutDigest: `sha256:${streams.stdout.hash.digest('hex')}`,
        stderrDigest: `sha256:${streams.stderr.hash.digest('hex')}`,
        truncated: streams.stdout.bytes > OUTPUT_CAP || streams.stderr.bytes > OUTPUT_CAP
      });
    };
    child.on('error', (err) => finish(null, err));
    child.on('close', (code) => finish(code));
  });
}

export function commandDigest(argv) {
  return digestOf(argv);
}

// Remove anything that looks like a credential from text shown to the user or the agent.
export function redact(text) {
  return String(text ?? '')
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[redacted private key]')
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g, '[redacted token]');
}
