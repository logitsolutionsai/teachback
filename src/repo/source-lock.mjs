// The source lock: which files a repo course was written from, by path and
// content hash, plus the commit (git) or a content digest (a plain folder). It
// proves which text was read, not that a summary of it is correct.
//
// source-lock.json is shareable (relative paths only). The absolute path of the
// checkout and the trust state live in .local-source.json, which never leaves
// the machine.
import fs from 'node:fs';
import path from 'node:path';
import { TeachbackError, readJson, writeJsonAtomic } from '../util.mjs';
import { SCANNER_VERSION, HASH_BASIS, digestOf, readSource } from './scan.mjs';
import { checkRelPath } from './paths.mjs';
import { validateFile } from '../schema.mjs';

export const LOCK_FILE = 'source-lock.json';
export const LOCAL_FILE = '.local-source.json';
export const MAP_FILE = 'repo-map.json';
const GITHUB_URL = /^https:\/\/github\.com\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;

export function validatePublicUrl(url) {
  if (url === undefined || url === null) return null;
  const u = String(url).replace(/\.git$/, '').replace(/\/$/, '');
  if (!GITHUB_URL.test(u) || u.includes('..')) {
    throw new TeachbackError('E610', `--public-url "${url}" is not accepted.`, 'Only https://github.com/<owner>/<repo> is accepted, and only when you supply it; teachback never reads it from a git remote.', 2);
  }
  return u;
}

// Digest of the files themselves: sorted "path sha256" lines.
export function contentDigest(files) {
  return digestOf(files.map((f) => [f.path, f.sha256]));
}

export function buildLock(scan, { name, publicUrl, allowDirty = false, include = [], exclude = [] } = {}) {
  const files = scan.files.map((f) => {
    const e = { id: f.id, path: f.path, sha256: f.sha256, language: f.language, role: f.role, license: f.license, state: f.state };
    if (f.binary) e.binary = true;
    else e.lineCount = f.lineCount;
    return e;
  });
  const dirty = scan.git ? scan.git.dirty : false;
  if (dirty && !allowDirty) {
    const paths = scan.files.filter((f) => f.state === 'dirty' || f.state === 'untracked').map((f) => f.path).slice(0, 10);
    throw new TeachbackError('E611', `The checkout has uncommitted changes in scope: ${paths.join(', ') || '(git status could not be read)'}.`, 'Commit or stash them, or pass --allow-dirty to lock the working-tree content (the lock is then marked dirtySource: true).', 2);
  }
  const ref = scan.git ? { kind: 'git', sha: scan.git.sha } : { kind: 'worktree', digest: contentDigest(files) };
  const lock = {
    schemaVersion: 1,
    sourceKind: scan.git ? 'git-repository' : 'worktree',
    repo: {
      name,
      ...(publicUrl ? { publicUrl } : {}),
      ref,
      dirty,
      ...(dirty ? { dirtySource: true, contentDigest: contentDigest(files) } : {}),
      scope: scan.scope
    },
    provenance: scan.git ? (dirty ? 'git commit plus working-tree changes' : 'git commit') : 'content digest of a folder without git (lower provenance confidence)',
    files,
    languages: scan.languages,
    ignore: { defaults: true, gitignore: true, include, exclude },
    license: scan.license,
    complete: scan.complete,
    scannerVersion: SCANNER_VERSION,
    hashBasis: HASH_BASIS
  };
  lock.manifestDigest = digestOf(lock);
  return lock;
}

export function lockDigest(lock) {
  const { manifestDigest, ...rest } = lock;
  return digestOf(rest);
}

export function loadLock(courseDir) {
  const lock = readJson(path.join(courseDir, LOCK_FILE));
  if (!lock) throw new TeachbackError('E620', `No ${LOCK_FILE} in ${courseDir}.`, 'This is not a repo course. Create one with "teachback repo init <slug> --repo <path>".', 2);
  const errs = validateFile(lock, 'source-lock.v1');
  if (errs.length) throw new TeachbackError('E621', `${LOCK_FILE}: ${errs[0].path} ${errs[0].message}.`, 'Re-create the lock with "teachback repo init" or "teachback repo rebase"; do not edit it by hand.', 2);
  for (const f of lock.files) {
    const c = checkRelPath(f.path);
    if (!c.ok) throw new TeachbackError('E622', `${LOCK_FILE}: file "${f.path}" is refused (${c.reason}).`, 'A lock may only hold relative paths inside the repository.', 2);
  }
  if (lockDigest(lock) !== lock.manifestDigest) throw new TeachbackError('E623', `${LOCK_FILE} does not match its own manifestDigest; it was edited after it was made.`, 'Re-create it with "teachback repo init --force" or apply a rebase proposal.', 2);
  return lock;
}

export function loadLocal(courseDir) {
  return readJson(path.join(courseDir, LOCAL_FILE)) ?? null;
}

export function writeLocal(courseDir, data) {
  writeJsonAtomic(path.join(courseDir, LOCAL_FILE), { schemaVersion: 1, ...data });
}

// Which checkout a command reads: --repo, else the path recorded at init or import.
export function repoRootFor(courseDir, repoArg) {
  if (repoArg) return path.resolve(repoArg);
  const local = loadLocal(courseDir);
  if (local?.repoPath) return local.repoPath;
  throw new TeachbackError('E624', 'This course does not know where its repository checkout is.', 'Pass --repo <path to the checkout>.', 4);
}

// Re-hash every locked file in the checkout.
export function compareFiles(lock, repoRoot) {
  const out = new Map();
  for (const f of lock.files) {
    const abs = path.join(repoRoot, f.path);
    let st;
    try {
      st = fs.lstatSync(abs);
    } catch {
      out.set(f.id, { status: 'missing' });
      continue;
    }
    if (st.isSymbolicLink() || !st.isFile()) {
      out.set(f.id, { status: 'missing', note: 'not a regular file' });
      continue;
    }
    const src = readSource(abs);
    out.set(f.id, { status: src.sha256 === f.sha256 ? 'match' : 'changed', current: src });
  }
  return out;
}
