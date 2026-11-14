// What a scan leaves out: built-in exclusions (secrets, dependencies, build
// output, generated files, datasets, .git and .teachback), the repository's
// .gitignore files, and --include / --exclude patterns. Patterns use the
// .gitignore syntax: *, ?, [abc], **, a leading / to anchor, a trailing / for
// folders only, and ! to re-include.

export const DEFAULT_EXCLUDED_DIRS = Object.freeze([
  '.git', '.hg', '.svn', '.teachback', 'node_modules', 'vendor', 'dist', 'build', 'out', 'target', 'coverage',
  '__pycache__', '.venv', 'venv', '.tox', '.mypy_cache', '.pytest_cache', '.next', '.nuxt', '.cache', '.gradle',
  'secrets', '.secrets', 'datasets', '.idea', '.vscode'
]);

export const DEFAULT_EXCLUDED_FILES = Object.freeze([
  '.env', '.env.*', '*.env', '*.pem', '*.key', '*.p12', '*.pfx', '*.keystore', '*.jks', 'id_rsa*', 'id_dsa*', 'id_ecdsa*', 'id_ed25519*',
  '.npmrc', '.pypirc', '.netrc', '.git-credentials', 'credentials', 'credentials.*', '*.kdbx',
  '*.min.js', '*.min.css', '*.map', '*.pb.go', '*_pb2.py', '*.generated.*', '*_generated.*',
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'Cargo.lock', 'go.sum', 'poetry.lock',
  '*.parquet', '*.csv', '*.tsv', '*.sqlite', '*.db', '*.npy', '*.npz', '*.pkl', '*.h5', '*.ckpt', '*.safetensors'
]);

function escapeRe(s) {
  return s.replace(/[.+^${}()|\\]/g, '\\$&');
}

// One glob (no slash handling) to a regex source matching within a path.
function globBody(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        const slashAfter = glob[i + 2] === '/';
        re += slashAfter ? '(?:.*/)?' : '.*';
        i += slashAfter ? 2 : 1;
      } else re += '[^/]*';
    } else if (ch === '?') re += '[^/]';
    else if (ch === '[') {
      const end = glob.indexOf(']', i + 1);
      if (end < 0) re += '\\[';
      else {
        let cls = glob.slice(i + 1, end).replace(/\\/g, '\\\\');
        if (cls.startsWith('!')) cls = `^${cls.slice(1)}`;
        re += `[${cls}]`;
        i = end;
      }
    } else re += escapeRe(ch);
  }
  return re;
}

// Compile a .gitignore-style pattern, relative to base (a folder path, '' for the root).
export function compilePattern(raw, base = '') {
  let p = raw.replace(/\s+$/, '');
  if (!p || p.startsWith('#')) return null;
  let negate = false;
  if (p.startsWith('!')) {
    negate = true;
    p = p.slice(1);
  }
  if (p.startsWith('\\')) p = p.slice(1);
  let dirOnly = false;
  if (p.endsWith('/')) {
    dirOnly = true;
    p = p.slice(0, -1);
  }
  const anchored = p.startsWith('/') || p.includes('/');
  if (p.startsWith('/')) p = p.slice(1);
  const prefix = base ? `${escapeRe(base)}/` : '';
  const body = globBody(p);
  const source = anchored ? `^${prefix}${body}$` : `^${prefix}(?:.*/)?${body}$`;
  return { raw, negate, dirOnly, re: new RegExp(source) };
}

export function compileList(patterns, base = '') {
  return patterns.map((p) => compilePattern(p, base)).filter(Boolean);
}

// Last matching rule wins, as in git. Returns true, false or undefined (no rule matched).
export function matchRules(rules, relPath, isDir) {
  let verdict;
  for (const r of rules) {
    if (r.dirOnly && !isDir) continue;
    if (r.re.test(relPath)) verdict = !r.negate;
  }
  return verdict;
}

export function defaultExcluded(name, isDir) {
  if (isDir) return DEFAULT_EXCLUDED_DIRS.includes(name);
  return DEFAULT_RULES.some((r) => r.re.test(name));
}

const DEFAULT_RULES = compileList(DEFAULT_EXCLUDED_FILES);
