// Path rules for everything RepoQuest reads, writes or unpacks. A path in a
// source lock, a sourceRef, a quest or a pack entry is relative, uses forward
// slashes, and never leaves its root.
import fs from 'node:fs';
import path from 'node:path';

const URI = /^[A-Za-z][A-Za-z0-9+.-]*:/;

// { ok: true, path } or { ok: false, reason }.
export function checkRelPath(p) {
  if (typeof p !== 'string' || !p.length) return { ok: false, reason: 'empty path' };
  if (p.length > 1024) return { ok: false, reason: 'path longer than 1024 characters' };
  if (p.includes('\0')) return { ok: false, reason: 'path contains a NUL character' };
  if (p.includes('\\')) return { ok: false, reason: 'path uses a backslash; use forward slashes' };
  if (p.startsWith('/')) return { ok: false, reason: 'absolute path' };
  if (/^[A-Za-z]:/.test(p)) return { ok: false, reason: 'drive-letter path' };
  if (URI.test(p)) return { ok: false, reason: 'URI, not a relative path' };
  for (const s of p.split('/')) {
    if (s === '..') return { ok: false, reason: 'path climbs out with ".."' };
    if (s === '' || s === '.') return { ok: false, reason: 'empty or "." path segment' };
    if (/[<>:"|?*]/.test(s)) return { ok: false, reason: `segment "${s}" has a character Windows cannot store` };
  }
  return { ok: true, path: p };
}

export function isSafeRelPath(p) {
  return checkRelPath(p).ok;
}

// The real location of root/rel stays inside root (symlinks followed).
export function staysInside(root, rel) {
  const base = fs.realpathSync(root);
  let real;
  try {
    real = fs.realpathSync(path.join(root, rel));
  } catch {
    real = path.resolve(base, rel);
  }
  const r = path.relative(base, real);
  return r === '' || (!r.startsWith('..') && !path.isAbsolute(r));
}

export function toPosix(p) {
  return p.split(path.sep).join('/');
}

// Machine-specific absolute paths that must never reach a shared pack.
export const ABSOLUTE_PATH_PATTERN = /(?:^|["'\s(=])(?:[A-Za-z]:[\\/]|\\\\[A-Za-z0-9]|\/(?:Users|home|root|var|tmp|private|mnt|opt|etc)\/)/;
