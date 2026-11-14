// Scratch workspaces for patch and reproduce quests. The learner edits a copy,
// never their own branch. The default (and tested) strategy copies the locked
// files, after checking each one still has its locked hash, into
// .teachback/workspaces/<course>--<quest>/. A git worktree is used only when
// asked for with --worktree, the lock is a clean commit and git is available;
// otherwise the copy is made and the reason is reported.
//
// A workspace carries a marker file. Only a folder with that marker is ever
// removed, and only on an explicit --reset.
import fs from 'node:fs';
import path from 'node:path';
import { TeachbackError, writeJsonAtomic, readJson, exists } from '../util.mjs';
import { teachbackRoot } from '../course.mjs';
import { loadLock, compareFiles, repoRootFor, contentDigest } from '../repo/source-lock.mjs';
import { readSource } from '../repo/scan.mjs';
import { compilePattern, matchRules } from '../repo/ignore.mjs';
import { toPosix } from '../repo/paths.mjs';
import * as git from '../repo/git.mjs';

export const MARKER = '.teachback-workspace.json';
const SKIP_DIRS = new Set(['.git', 'node_modules', '.teachback-home', '__pycache__']);

export function workspaceDir(courseData, questId, root) {
  return path.join(teachbackRoot(root), 'workspaces', `${courseData.slug}--${questId}`);
}

export function readMarker(dir) {
  const m = readJson(path.join(dir, MARKER));
  return m && m.tool === 'teachback' ? m : null;
}

export function startWorkspace(courseData, quest, { root, repo, worktree = false, reset = false, now }) {
  const lock = loadLock(courseData.dir);
  const repoRoot = repoRootFor(courseData.dir, repo);
  const dir = workspaceDir(courseData, quest.id, root);
  if (exists(dir)) {
    const marker = readMarker(dir);
    if (!marker) throw new TeachbackError('E640', `${dir} exists but is not a teachback workspace.`, 'Move it away; teachback never deletes a folder it did not create.', 4);
    if (!reset) return { dir, created: false, strategy: marker.strategy, marker };
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
  const cmp = compareFiles(lock, repoRoot);
  const changed = lock.files.filter((f) => cmp.get(f.id).status !== 'match');
  let strategy = 'scratch-copy';
  let note = null;
  if (worktree) {
    if (lock.repo.ref.kind !== 'git') note = 'The lock is a folder digest, not a git commit, so a copy was made instead of a worktree.';
    else if (lock.repo.dirty || changed.length) note = 'The checkout differs from the locked commit, so a copy of the locked files was made instead of a worktree.';
    else {
      fs.mkdirSync(path.dirname(dir), { recursive: true });
      const r = git.addWorktree(repoRoot, dir, lock.repo.ref.sha);
      if (r.ok) strategy = 'scratch-worktree';
      else note = `git worktree add did not work (${r.error}), so a copy was made.`;
    }
  }
  if (strategy === 'scratch-copy') {
    if (changed.length) {
      throw new TeachbackError('E641', `The checkout no longer matches the lock: ${changed.map((f) => `${f.path} (${cmp.get(f.id).status})`).join(', ')}.`, 'A quest workspace is built from the locked source. Run "teachback repo rebase <course> --dry-run" and apply the proposal first.', 2);
    }
    for (const f of lock.files) {
      const dest = path.join(dir, f.path);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(repoRoot, f.path), dest);
    }
  }
  const marker = { tool: 'teachback', course: courseData.slug, quest: quest.id, strategy, sourceManifestDigest: lock.manifestDigest, baseline: contentDigest(lock.files), createdAt: now.toISOString() };
  writeJsonAtomic(path.join(dir, MARKER), marker);
  return { dir, created: true, strategy, marker, ...(note ? { note } : {}) };
}

function walkFiles(dir, rel = '', out = []) {
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walkFiles(dir, r, out);
    } else if (e.isFile() && r !== MARKER) out.push(r);
  }
  return out;
}

// What the learner changed in the workspace, and whether it stays inside allowedPaths.
export function workspaceChanges(dir, lock, allowedPaths = []) {
  const rules = allowedPaths.map((p) => compilePattern(p)).filter(Boolean);
  const locked = new Map(lock.files.map((f) => [f.path, f]));
  const present = walkFiles(dir);
  const files = [];
  const changed = [];
  for (const rel of present) {
    const src = readSource(path.join(dir, rel));
    files.push({ path: toPosix(rel), sha256: src.sha256 });
    const was = locked.get(rel);
    if (!was) changed.push({ path: rel, change: 'added' });
    else if (was.sha256 !== src.sha256) changed.push({ path: rel, change: 'modified' });
  }
  const presentSet = new Set(present);
  for (const p of locked.keys()) if (!presentSet.has(p)) changed.push({ path: p, change: 'deleted' });
  const outside = changed.filter((c) => matchRules(rules, c.path, false) !== true);
  return { changed, outside, digest: contentDigest(files) };
}
