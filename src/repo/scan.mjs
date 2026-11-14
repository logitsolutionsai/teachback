// repo scan: a deterministic, bounded inventory of a local repository. It reads
// files and nothing else: no build scripts, package scripts, hooks or tests run,
// and the only process it may start is read-only git introspection through
// src/repo/git.mjs (and only when the scanned folder has its own .git).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { TeachbackError, slugify } from '../util.mjs';
import { checkRelPath, staysInside, toPosix } from './paths.mjs';
import { compileList, matchRules, defaultExcluded } from './ignore.mjs';
import { extractSymbols, extractImports } from './symbols.mjs';
import * as git from './git.mjs';

export const SCANNER_VERSION = '1';
export const LIMITS = Object.freeze({ maxFiles: 20000, hardMaxFiles: 200000, maxTotalBytes: 25 * 1024 * 1024, maxFileBytes: 512 * 1024 });
export const HASH_BASIS = 'sha256 of the file with CRLF line endings read as LF (text); raw bytes (binary)';

const LANG_BY_EXT = {
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescript', '.mts': 'typescript', '.cts': 'typescript',
  '.py': 'python', '.go': 'go', '.rs': 'rust',
  '.md': 'markdown', '.rst': 'text', '.txt': 'text', '.json': 'json', '.toml': 'toml', '.yaml': 'yaml', '.yml': 'yaml'
};
export const SYMBOL_LANGUAGES = Object.freeze(['javascript', 'typescript', 'python', 'go', 'rust']);
const UNSUPPORTED_CODE = new Set(['.java', '.kt', '.rb', '.c', '.h', '.cc', '.cpp', '.hpp', '.cs', '.php', '.swift', '.scala', '.m', '.ex', '.exs', '.hs', '.lua', '.dart', '.zig']);
const CONFIG_NAMES = new Set(['package.json', 'tsconfig.json', 'jsconfig.json', 'go.mod', 'Cargo.toml', 'pyproject.toml', 'setup.cfg', 'setup.py', 'Makefile', '.gitignore', '.gitattributes', '.editorconfig', 'tox.ini']);

export function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// Canonical JSON: keys sorted at every level, no whitespace.
export function canonicalJson(v) {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

export function digestOf(value) {
  return `sha256:${sha256Hex(canonicalJson(value))}`;
}

// Reads one file the way every RepoQuest command reads it: text as LF, binary as bytes.
export function readSource(abs) {
  const buf = fs.readFileSync(abs);
  const head = buf.subarray(0, 8192);
  let text = null;
  if (!head.includes(0)) {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, '').replace(/\r\n/g, '\n');
    } catch {
      text = null;
    }
  }
  if (text === null) return { binary: true, bytes: buf.length, sha256: sha256Hex(buf), text: null, lineCount: null };
  const lineCount = text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
  return { binary: false, bytes: buf.length, sha256: sha256Hex(text), text, lineCount };
}

export function languageOf(rel) {
  return LANG_BY_EXT[path.posix.extname(rel).toLowerCase()] ?? null;
}

export function roleOf(rel) {
  const base = path.posix.basename(rel);
  const lower = base.toLowerCase();
  const segs = rel.split('/');
  if (/^(licen[cs]e|copying|unlicense)(\.|-|$)/i.test(base)) return 'license';
  if (segs.slice(0, -1).some((s) => ['test', 'tests', '__tests__', 'spec', 'testdata'].includes(s.toLowerCase())) || /\.(test|spec)\.[a-z]+$/.test(lower) || /^test_.*\.py$/.test(lower) || /_test\.(py|go)$/.test(lower)) return 'test';
  if (CONFIG_NAMES.has(base) || /\.(toml|ya?ml|ini|cfg)$/.test(lower) || /^tsconfig.*\.json$/.test(lower)) return 'config';
  if (/\.(md|rst|txt|adoc)$/.test(lower) || segs[0].toLowerCase() === 'docs') return 'doc';
  if (SYMBOL_LANGUAGES.includes(languageOf(rel))) return 'source';
  return 'other';
}

// Best-effort SPDX guess from licence text. Never legal advice and never
// "verified": verifiedByHuman stays false whatever this returns.
export function detectSpdx(text) {
  const t = String(text ?? '').replace(/\s+/g, ' ');
  if (/\bproprietary\b|\ball rights reserved\b(?![\s\S]*permission is hereby granted)/i.test(t) && !/permission is hereby granted, free of charge/i.test(t)) return null;
  if (/permission is hereby granted, free of charge, to any person obtaining a copy/i.test(t)) return 'MIT';
  if (/apache license/i.test(t) && /version 2\.0/i.test(t)) return 'Apache-2.0';
  if (/mozilla public license,? version 2\.0/i.test(t)) return 'MPL-2.0';
  if (/gnu affero general public license/i.test(t)) return 'AGPL-3.0';
  if (/gnu lesser general public license/i.test(t)) return 'LGPL';
  if (/gnu general public license/i.test(t)) return /version 2\b/i.test(t) && !/version 3/i.test(t) ? 'GPL-2.0' : 'GPL-3.0';
  if (/permission to use, copy, modify, and\/or distribute this software for any purpose/i.test(t)) return 'ISC';
  if (/redistribution and use in source and binary forms/i.test(t)) return /neither the name/i.test(t) ? 'BSD-3-Clause' : 'BSD-2-Clause';
  if (/this is free and unencumbered software released into the public domain/i.test(t)) return 'Unlicense';
  return null;
}

function fileIdFor(rel, used) {
  const base = slugify(rel) || 'file';
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  used.add(id);
  return id;
}

// Options: scope (relative folder), include/exclude (pattern lists),
// followSymlinks, maxFiles, maxTotalBytes, maxFileBytes, useGit (default true).
export function scanRepo(rootArg, opts = {}) {
  const root = path.resolve(rootArg);
  let st;
  try {
    st = fs.statSync(root);
  } catch {
    throw new TeachbackError('E601', `No folder at ${root}.`, 'Pass the path to a local repository checkout.', 4);
  }
  if (!st.isDirectory()) throw new TeachbackError('E601', `${root} is not a folder.`, 'Pass the path to a local repository checkout.', 4);
  let scope = '';
  if (opts.scope && opts.scope !== '.') {
    const s = checkRelPath(String(opts.scope).replace(/\/+$/, ''));
    if (!s.ok) throw new TeachbackError('E602', `--scope "${opts.scope}" is not allowed: ${s.reason}.`, 'Give a folder relative to the repository root, such as src/cache.', 2);
    scope = s.path;
    if (!fs.existsSync(path.join(root, scope)) || !staysInside(root, scope)) throw new TeachbackError('E602', `--scope "${scope}" is not a folder inside ${root}.`, 'Give a folder relative to the repository root.', 2);
  }
  const maxFiles = Math.min(opts.maxFiles ?? LIMITS.maxFiles, LIMITS.hardMaxFiles);
  const maxTotalBytes = opts.maxTotalBytes ?? LIMITS.maxTotalBytes;
  const maxFileBytes = opts.maxFileBytes ?? LIMITS.maxFileBytes;
  const include = compileList(opts.include ?? []);
  const exclude = compileList(opts.exclude ?? []);
  const warnings = [];
  const ignored = { counts: {}, examples: {} };
  const skip = (reason, rel) => {
    ignored.counts[reason] = (ignored.counts[reason] ?? 0) + 1;
    (ignored.examples[reason] ??= []);
    if (ignored.examples[reason].length < 5) ignored.examples[reason].push(rel);
  };

  const found = [];
  let complete = true;
  let stopReason = null;
  // Directories, depth first in sorted order; gitignore rules accumulate down the tree.
  const walk = (relDir, rules) => {
    if (!complete) return;
    const absDir = path.join(root, relDir);
    let local = rules;
    const gi = path.join(absDir, '.gitignore');
    if (fs.existsSync(gi)) {
      try {
        local = [...rules, ...compileList(fs.readFileSync(gi, 'utf8').split(/\r?\n/), relDir)];
      } catch {
        warnings.push({ kind: 'partial_scan', path: toPosix(path.join(relDir, '.gitignore')), message: 'Could not read this .gitignore; its rules were not applied.' });
      }
    }
    let entries;
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      warnings.push({ kind: 'partial_scan', path: relDir || '.', message: 'Could not read this folder.' });
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      if (!complete) return;
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      let isDir = e.isDirectory();
      if (e.isSymbolicLink()) {
        if (!opts.followSymlinks) {
          skip('symlink', rel);
          continue;
        }
        if (!staysInside(root, rel)) {
          skip('symlink-escape', rel);
          warnings.push({ kind: 'partial_scan', path: rel, message: 'This symlink points outside the repository and was refused.' });
          continue;
        }
        isDir = fs.statSync(path.join(root, rel)).isDirectory();
      } else if (!isDir && !e.isFile()) {
        skip('special-file', rel);
        continue;
      }
      if (defaultExcluded(e.name, isDir)) {
        skip(isDir ? 'default-excluded-folder' : 'default-excluded-file', rel);
        continue;
      }
      if (matchRules(local, rel, isDir) === true) {
        skip('gitignore', rel);
        continue;
      }
      if (matchRules(exclude, rel, isDir) === true) {
        skip('exclude', rel);
        continue;
      }
      if (isDir) {
        walk(rel, local);
        continue;
      }
      if (include.length && matchRules(include, rel, false) !== true) {
        skip('not-included', rel);
        continue;
      }
      if (found.length >= maxFiles) {
        complete = false;
        stopReason = `The file cap (${maxFiles}) was reached.`;
        return;
      }
      found.push(rel);
    }
  };
  walk(scope, []);
  // The root .gitignore applies to a scoped scan too.
  if (scope && fs.existsSync(path.join(root, '.gitignore'))) {
    const rootRules = compileList(fs.readFileSync(path.join(root, '.gitignore'), 'utf8').split(/\r?\n/));
    for (let i = found.length - 1; i >= 0; i--) if (matchRules(rootRules, found[i], false) === true) skip('gitignore', found.splice(i, 1)[0]);
  }
  // Licence files at the repository root count even when the scope is a subfolder.
  if (scope) {
    for (const name of fs.readdirSync(root).sort()) {
      if (roleOf(name) === 'license' && fs.statSync(path.join(root, name)).isFile() && !found.includes(name)) found.push(name);
    }
  }
  found.sort();

  // Git state, only when the scanned folder is itself a repository root.
  const useGit = opts.useGit !== false && git.isGitRoot(root);
  let gitInfo = { used: false };
  if (useGit) {
    const head = git.resolveRef(root, opts.ref ?? 'HEAD');
    if (head.ok) {
      const dirty = git.dirtyPaths(root, scope);
      const tracked = git.trackedPaths(root, scope);
      gitInfo = { used: true, sha: head.sha, dirtyPaths: dirty.ok ? dirty.paths : new Map(), tracked: tracked.ok ? tracked.paths : null, statusOk: dirty.ok };
    } else {
      gitInfo = { used: false, error: head.error, unavailable: Boolean(head.unavailable) };
      warnings.push({ kind: 'partial_scan', path: '.', message: `This folder has .git but ${head.error} The lock falls back to a content digest (ref.kind worktree).` });
    }
  }

  const used = new Set();
  const files = [];
  const texts = new Map();
  let totalBytes = 0;
  const languages = new Set();
  for (const rel of found) {
    const abs = path.join(root, rel);
    const size = fs.statSync(abs).size;
    if (size > maxFileBytes) {
      skip('too-large', rel);
      continue;
    }
    if (totalBytes + size > maxTotalBytes) {
      complete = false;
      stopReason = `The byte cap (${maxTotalBytes} bytes) was reached.`;
      skip('byte-cap', rel);
      continue;
    }
    totalBytes += size;
    const src = readSource(abs);
    const language = languageOf(rel);
    const role = roleOf(rel);
    const entry = { id: fileIdFor(rel, used), path: rel, sha256: src.sha256, bytes: src.bytes, language, role, license: role === 'license' ? 'license-text' : 'repo-license' };
    if (src.binary) entry.binary = true;
    else entry.lineCount = src.lineCount;
    if (gitInfo.used) {
      const d = gitInfo.dirtyPaths.get(rel);
      entry.state = d ?? (gitInfo.tracked && !gitInfo.tracked.has(rel) ? 'untracked' : 'committed');
    } else entry.state = 'worktree';
    if (language) languages.add(language);
    if (UNSUPPORTED_CODE.has(path.posix.extname(rel).toLowerCase())) {
      warnings.push({ kind: 'unsupported_language', path: rel, message: 'No symbol scanner for this language; the file is listed and hashed, but its symbols are not extracted.' });
    }
    files.push(entry);
    if (!src.binary) texts.set(entry.id, src.text);
  }
  if (!complete) warnings.push({ kind: 'partial_scan', path: scope || '.', message: `${stopReason} The scan is incomplete. Pass --scope <folder> to scan one module, or narrow it with --include.` });

  // Symbols and links.
  const symbols = [];
  const symIds = new Set();
  const byPath = new Map(files.map((f) => [f.path, f]));
  const links = [];
  for (const f of files) {
    if (!SYMBOL_LANGUAGES.includes(f.language) || !texts.has(f.id)) continue;
    for (const s of extractSymbols(f.language, texts.get(f.id))) {
      let id = `sym-${f.id}-${slugify(s.name.replace(/\./g, '-').replace(/#/g, 'private-'))}`;
      const base = id;
      for (let n = 2; symIds.has(id); n++) id = `${base}-${n}`;
      symIds.add(id);
      symbols.push({ id, fileId: f.id, name: s.name, kind: s.kind, startLine: s.startLine, endLine: s.endLine ?? null, exported: Boolean(s.exported), certainty: s.certainty });
    }
    for (const imp of extractImports(f.language, texts.get(f.id))) {
      const target = resolveImport(f, imp.spec, byPath);
      if (!target) continue;
      links.push({ from: f.id, to: target.id, kind: f.role === 'test' ? 'tests' : 'imports', basis: 'import-path', certainty: 'direct', line: imp.line });
    }
  }
  // Name conventions between tests and sources that no import already connects.
  const direct = new Set(links.map((l) => `${l.from}>${l.to}`));
  const stem = (p) => path.posix.basename(p).replace(/\.(test|spec)(?=\.)/, '').replace(/^test_/, '').replace(/_test(?=\.)/, '').replace(/\.[^.]+$/, '');
  const sourcesByStem = new Map();
  for (const f of files) if (f.role === 'source') (sourcesByStem.get(stem(f.path)) ?? sourcesByStem.set(stem(f.path), []).get(stem(f.path))).push(f);
  for (const t of files.filter((f) => f.role === 'test' && SYMBOL_LANGUAGES.includes(f.language))) {
    for (const s of sourcesByStem.get(stem(t.path)) ?? []) {
      if (!direct.has(`${t.id}>${s.id}`)) links.push({ from: t.id, to: s.id, kind: 'tests_candidate', basis: 'name-convention', certainty: 'candidate' });
    }
  }
  links.sort((a, b) => (a.from + a.to + a.kind < b.from + b.to + b.kind ? -1 : 1));

  // Licence.
  const licenseFiles = files.filter((f) => f.role === 'license');
  let detectedSpdx = null;
  for (const lf of licenseFiles) {
    detectedSpdx = detectSpdx(texts.get(lf.id));
    if (detectedSpdx) break;
  }
  let declared = null;
  const pkg = byPath.get(scope ? `${scope}/package.json` : 'package.json') ?? byPath.get('package.json');
  if (pkg && texts.has(pkg.id)) {
    try {
      const v = JSON.parse(texts.get(pkg.id)).license;
      if (typeof v === 'string' && /^[A-Za-z0-9.+-]{1,40}$/.test(v)) declared = v;
    } catch {
      // not JSON: ignore
    }
  }
  if (!licenseFiles.length || !detectedSpdx) warnings.push({ kind: 'no_license_detected', path: licenseFiles[0]?.path ?? '.', message: licenseFiles.length ? 'A licence file exists, but no known licence was recognised in it.' : 'No licence file was found at the repository root or in the scope.' });

  const dirtyCount = files.filter((f) => f.state === 'dirty' || f.state === 'untracked').length;
  return {
    root,
    scope: scope || '.',
    complete,
    files,
    symbols,
    links,
    warnings,
    ignored,
    languages: [...languages].sort(),
    license: { files: licenseFiles.map((f) => f.path), detectedSpdx, declaredSpdx: declared, detection: 'keyword-heuristic', verifiedByHuman: false },
    git: gitInfo.used ? { sha: gitInfo.sha, dirty: dirtyCount > 0 || !gitInfo.statusOk, statusOk: gitInfo.statusOk } : null,
    stats: { files: files.length, bytes: totalBytes, symbols: symbols.length, links: links.length, ignored: Object.values(ignored.counts).reduce((s, n) => s + n, 0) },
    texts
  };
}

const JS_EXTS = ['', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.mts', '/index.js', '/index.ts', '/index.mjs'];

function resolveImport(from, spec, byPath) {
  const dir = path.posix.dirname(from.path);
  const norm = (p) => {
    const parts = [];
    for (const s of p.split('/')) {
      if (s === '..') {
        if (!parts.length) return null;
        parts.pop();
      } else if (s && s !== '.') parts.push(s);
    }
    return parts.join('/');
  };
  if (from.language === 'javascript' || from.language === 'typescript') {
    if (!spec.startsWith('.')) return null;
    const base = norm(`${dir}/${spec}`);
    if (base === null) return null;
    for (const ext of JS_EXTS) {
      const hit = byPath.get(base + ext) ?? (ext === '' ? null : byPath.get(base.replace(/\.js$/, '') + ext));
      if (hit) return hit;
    }
    return null;
  }
  if (from.language === 'python') {
    let rel;
    if (spec.startsWith('.')) {
      const dots = spec.match(/^\.+/)[0].length;
      let d = dir;
      for (let i = 1; i < dots; i++) d = path.posix.dirname(d);
      rel = norm(`${d}/${spec.slice(dots).replace(/\./g, '/')}`);
    } else rel = spec.replace(/\./g, '/');
    if (rel === null) return null;
    for (const cand of [`${rel}.py`, `${rel}/__init__.py`, `src/${rel}.py`, `src/${rel}/__init__.py`]) if (byPath.has(cand)) return byPath.get(cand);
    return null;
  }
  if (from.language === 'rust') {
    if (spec.startsWith('mod:')) {
      const name = spec.slice(4);
      return byPath.get(norm(`${dir}/${name}.rs`)) ?? byPath.get(norm(`${dir}/${name}/mod.rs`)) ?? null;
    }
    if (spec.startsWith('crate:')) {
      const first = spec.slice(6).split('::')[0];
      return byPath.get(`src/${first}.rs`) ?? byPath.get(`src/${first}/mod.rs`) ?? null;
    }
  }
  if (from.language === 'go') {
    // An import path whose last segments name a folder in this scan: the first Go file there.
    const segs = spec.split('/');
    for (let k = Math.min(3, segs.length); k >= 1; k--) {
      const tail = segs.slice(-k).join('/');
      const hits = [...byPath.values()].filter((f) => f.language === 'go' && path.posix.dirname(f.path) === tail && f.role !== 'test');
      if (hits.length) return hits[0];
    }
  }
  return null;
}

// The repo-map.json document for a scan.
export function repoMapOf(scan, manifestDigest) {
  return {
    schemaVersion: 1,
    sourceManifestDigest: manifestDigest,
    scannerVersion: SCANNER_VERSION,
    complete: scan.complete,
    symbols: scan.symbols,
    links: scan.links,
    warnings: scan.warnings,
    note: 'Symbols and links come from lexical patterns (certainty lexically_detected, candidate or unknown), not from a parser. There is no call graph.'
  };
}
