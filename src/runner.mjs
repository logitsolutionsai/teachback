// Runs an exercise's tests against a solution file, in a throwaway folder that
// holds only the tests, any support files and the solution, with a timeout.
// This confines the working folder; it is not a security sandbox.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TeachbackError } from './util.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PY_HARNESS = path.join(HERE, 'harness', 'py_harness.py');
const JS_REPORTER = path.join(HERE, 'harness', 'js_reporter.mjs');
const MARK = '@@TEACHBACK_RESULT@@';
const MAX_OUTPUT = 256 * 1024;
const TAIL_OUTPUT = 64 * 1024;
const MAX_LINE = 300;
export const DEFAULT_TIMEOUT_MS = 20000;

let pythonCache;

// TEACHBACK_PYTHON as a command and arguments. A full path to the interpreter may
// contain spaces (C:\Users\Jane Doe\...\python.exe), with or without quotes;
// otherwise it is a command followed by arguments, such as "py -3".
export function pythonOverride(value) {
  const s = String(value ?? '').trim();
  if (!s) return null;
  if (fs.existsSync(s)) return [s];
  const quoted = s.match(/^"([^"]+)"\s*(.*)$/);
  if (quoted) return [quoted[1], ...quoted[2].split(/\s+/).filter(Boolean)];
  return s.split(/\s+/).filter(Boolean);
}

// Finds a Python 3 interpreter. TEACHBACK_PYTHON overrides (for example "py -3").
export function detectPython() {
  if (pythonCache !== undefined) return pythonCache;
  const candidates = [];
  const override = pythonOverride(process.env.TEACHBACK_PYTHON);
  if (override) candidates.push(override);
  if (process.platform === 'win32') candidates.push(['python'], ['py', '-3'], ['python3']);
  else candidates.push(['python3'], ['python']);
  for (const [cmd, ...args] of candidates) {
    try {
      const r = spawnSync(cmd, [...args, '--version'], { encoding: 'utf8', timeout: 8000, windowsHide: true });
      const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
      const m = out.match(/Python (3)\.(\d+)/);
      if (r.status === 0 && m) {
        pythonCache = { cmd, args, version: out.trim().split('\n')[0] };
        return pythonCache;
      }
    } catch {
      // try the next candidate
    }
  }
  pythonCache = null;
  return null;
}

function nodeIsolationFlag() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major >= 23) return ['--test-isolation=none'];
  if (major === 22 && minor >= 8) return ['--experimental-test-isolation=none'];
  return [];
}

function childEnv() {
  const keep = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'SystemDrive', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'LANG', 'LC_ALL', 'COMSPEC', 'PATHEXT', 'WINDIR'];
  const env = {};
  for (const k of keep) if (process.env[k] !== undefined) env[k] = process.env[k];
  env.PYTHONIOENCODING = 'utf-8';
  env.PYTHONUTF8 = '1';
  env.PYTHONDONTWRITEBYTECODE = '1';
  env.NO_COLOR = '1';
  return env;
}

function killTree(child) {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } else {
      process.kill(-child.pid, 'SIGKILL');
    }
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      // already gone
    }
  }
}

function runProcess(cmd, args, { cwd, timeoutMs }) {
  return new Promise((resolve) => {
    const started = Date.now();
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let child;
    try {
      child = spawn(cmd, args, { cwd, env: childEnv(), windowsHide: true, detached: process.platform !== 'win32' });
    } catch (err) {
      resolve({ code: null, stdout, stderr: String(err), timedOut, durationMs: 0, spawnError: err });
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);
    // Keep the start of the output and a rolling tail. The result line comes last,
    // so a solution that prints megabytes must not push it out of the buffer.
    let outTail = '';
    let outSeen = 0;
    child.stdout.setEncoding('utf8'); // decodes characters split across chunks
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (s) => {
      outSeen += s.length;
      if (stdout.length < MAX_OUTPUT) stdout += s;
      outTail = (outTail + s).slice(-TAIL_OUTPUT);
    });
    child.stderr.on('data', (s) => {
      if (stderr.length < MAX_OUTPUT) stderr += s;
    });
    const collected = () => (outSeen <= stdout.length ? stdout : `${stdout.slice(0, MAX_OUTPUT)}\n[... output cut ...]\n${outTail}`);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: null, stdout: collected(), stderr: `${stderr}${err.message}`, timedOut, durationMs: Date.now() - started, spawnError: err });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: collected(), stderr, timedOut, durationMs: Date.now() - started });
    });
  });
}

function listOf(v) {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

// The last lines of some output, each cut to MAX_LINE characters, so one huge
// line cannot flood the terminal (or the tutor's context).
function tail(text, lines = 12) {
  return String(text ?? '')
    .trimEnd()
    .split('\n')
    .slice(-lines)
    .map((l) => (l.length > MAX_LINE ? `${l.slice(0, MAX_LINE)}… (${l.length} characters)` : l))
    .join('\n');
}

function removeDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // best effort: a killed process on Windows can hold a handle briefly
  }
}

// exercise: loaded manifest (with .dir). solutionFile: absolute path.
export async function runExercise(exercise, solutionFile, { timeoutMs } = {}) {
  const limit = timeoutMs ?? exercise.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const language = exercise.language ?? (String(exercise.starter).endsWith('.py') ? 'python' : 'javascript');
  if (!fs.existsSync(solutionFile)) {
    throw new TeachbackError('E301', `Solution file not found: ${solutionFile}`, 'Pass the path to your solution, or run without a file to use your work copy.');
  }
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'teachback-run-'));
  try {
    const tests = listOf(exercise.tests);
    for (const f of [...tests, ...listOf(exercise.support)]) {
      const src = path.join(exercise.dir, f);
      const dest = path.join(sandbox, f);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
    fs.copyFileSync(solutionFile, path.join(sandbox, exercise.starter));

    let proc;
    let runtime;
    if (language === 'python') {
      const py = detectPython();
      if (!py) {
        return {
          status: 'error',
          language,
          passed: 0,
          failed: 0,
          errors: 0,
          total: 0,
          tests: [],
          durationMs: 0,
          message: 'No Python 3 interpreter found (tried python3, python and py -3).',
          hint: 'Install Python 3 or set TEACHBACK_PYTHON to its command.'
        };
      }
      fs.copyFileSync(PY_HARNESS, path.join(sandbox, '_teachback_harness.py'));
      const modules = tests.map((t) => path.basename(t, '.py'));
      runtime = py.version;
      proc = await runProcess(py.cmd, [...py.args, '-I', '-B', '_teachback_harness.py', modules.join(','), exercise.starter], { cwd: sandbox, timeoutMs: limit });
      // The harness takes one module name; several test files are joined with commas.
    } else if (language === 'javascript') {
      fs.copyFileSync(JS_REPORTER, path.join(sandbox, '_teachback_reporter.mjs'));
      runtime = `Node ${process.versions.node}`;
      proc = await runProcess(
        process.execPath,
        ['--test', ...nodeIsolationFlag(), `--test-reporter=${pathToFileURL(path.join(sandbox, '_teachback_reporter.mjs')).href}`, '--test-reporter-destination=stdout', ...tests],
        { cwd: sandbox, timeoutMs: limit }
      );
    } else {
      throw new TeachbackError('E302', `Exercise "${exercise.id}" has unsupported language "${language}".`, 'Use "python" or "javascript".');
    }
    return summarise(proc, { language, runtime, limit });
  } finally {
    removeDir(sandbox);
  }
}

function summarise(proc, { language, runtime, limit }) {
  const base = { language, runtime, durationMs: proc.durationMs, passed: 0, failed: 0, errors: 0, total: 0, tests: [] };
  if (proc.timedOut) {
    return { ...base, status: 'timeout', message: `Stopped after ${Number((limit / 1000).toFixed(1))} s. Look for an infinite loop or very slow code.`, output: tail(proc.stdout) };
  }
  const at = proc.stdout.lastIndexOf(MARK);
  if (at < 0) {
    return { ...base, status: 'error', message: 'The test run ended without a result.', output: tail(`${proc.stdout}\n${proc.stderr}`) };
  }
  let parsed;
  try {
    parsed = JSON.parse(proc.stdout.slice(at + MARK.length).split('\n')[0]);
  } catch {
    return { ...base, status: 'error', message: 'Could not read the test results.', output: tail(proc.stdout) };
  }
  const tests = parsed.tests ?? [];
  const passed = tests.filter((t) => t.status === 'pass').length;
  const failed = tests.filter((t) => t.status === 'fail').length;
  const errors = tests.filter((t) => t.status === 'error').length;
  const total = tests.filter((t) => t.status !== 'skip').length;
  const learnerOutput = proc.stdout.slice(0, at).trim();
  const status = total > 0 && passed === total ? 'passed' : 'failed';
  return {
    ...base,
    status,
    passed,
    failed,
    errors,
    total,
    tests,
    ...(total === 0 ? { message: 'No tests ran.' } : {}),
    ...(learnerOutput ? { output: tail(learnerOutput) } : {}),
    ...(proc.stderr.trim() && status !== 'passed' ? { stderr: tail(proc.stderr, 8) } : {})
  };
}

// Compact text summary for the terminal.
export function formatRun(res, { title } = {}) {
  const lines = [];
  const head = title ? `${title}: ` : '';
  if (res.status === 'passed') lines.push(`${head}PASSED ${res.passed}/${res.total} tests (${res.durationMs} ms)`);
  else if (res.status === 'timeout') lines.push(`${head}TIMEOUT. ${res.message}`);
  else if (res.status === 'error') lines.push(`${head}ERROR. ${res.message}${res.hint ? ` ${res.hint}` : ''}`);
  else lines.push(`${head}FAILED ${res.passed}/${res.total} tests passed (${res.durationMs} ms)`);
  const bad = (res.tests ?? []).filter((t) => t.status === 'fail' || t.status === 'error');
  for (const t of bad.slice(0, 6)) {
    const msg = String(t.message ?? '').split('\n').slice(-2).join(' / ');
    lines.push(`  x ${t.name}${t.where ? ` (${t.where})` : ''}: ${msg}`);
  }
  if (bad.length > 6) lines.push(`  ... and ${bad.length - 6} more`);
  if (res.status !== 'passed' && res.output) lines.push('  output:', ...res.output.split('\n').slice(-6).map((l) => `    ${l}`));
  return lines.join('\n');
}
