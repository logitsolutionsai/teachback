// Review mode: read a unified diff (a .patch file) and say, with evidence from
// the scan, which files, lexical symbols and tests it touches. The diff is
// read as data. Nothing in it is applied or run. The scan should be of the
// checkout with the change in it (the "new" side of the diff).
import { checkRelPath } from './paths.mjs';
import { TeachbackError } from '../util.mjs';

const MAX_PATCH = 4 * 1024 * 1024;

function cleanPath(p) {
  if (!p || p === '/dev/null') return null;
  const s = p.replace(/^"|"$/g, '').replace(/\t.*$/, '').replace(/^[ab]\//, '');
  const c = checkRelPath(s);
  if (!c.ok) throw new TeachbackError('E740', `The diff names a path that is refused: "${s}" (${c.reason}).`, 'Review diffs may only name relative paths inside the repository.', 2);
  return c.path;
}

// [{ oldPath, newPath, status, hunks: [{ oldStart, oldLines, newStart, newLines, added: [newLine], removedAt: [newLine] }] }]
export function parseUnifiedDiff(text) {
  if (text.length > MAX_PATCH) throw new TeachbackError('E741', `The diff is ${text.length} bytes; the limit is ${MAX_PATCH}.`, 'Review a smaller change.', 2);
  const files = [];
  let cur = null;
  let hunk = null;
  let newLine = 0;
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('diff --git ')) {
      cur = { oldPath: null, newPath: null, status: 'modified', hunks: [] };
      files.push(cur);
      hunk = null;
      continue;
    }
    if (l.startsWith('--- ') && lines[i + 1]?.startsWith('+++ ')) {
      if (!cur || cur.hunks.length) {
        cur = { oldPath: null, newPath: null, status: 'modified', hunks: [] };
        files.push(cur);
      }
      cur.oldPath = cleanPath(l.slice(4));
      cur.newPath = cleanPath(lines[i + 1].slice(4));
      if (!cur.oldPath) cur.status = 'added';
      else if (!cur.newPath) cur.status = 'deleted';
      else if (cur.oldPath !== cur.newPath) cur.status = 'renamed';
      i += 1;
      hunk = null;
      continue;
    }
    if (cur && l.startsWith('rename from ')) cur.oldPath = cleanPath(l.slice(12));
    if (cur && l.startsWith('rename to ')) {
      cur.newPath = cleanPath(l.slice(10));
      cur.status = 'renamed';
    }
    const m = l.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (m && cur) {
      hunk = { oldStart: Number(m[1]), oldLines: m[2] === undefined ? 1 : Number(m[2]), newStart: Number(m[3]), newLines: m[4] === undefined ? 1 : Number(m[4]), added: [], removedAt: [] };
      cur.hunks.push(hunk);
      newLine = hunk.newStart;
      continue;
    }
    if (!hunk) continue;
    if (l.startsWith('+')) hunk.added.push(newLine++);
    else if (l.startsWith('-')) hunk.removedAt.push(newLine);
    else if (l.startsWith(' ')) newLine += 1;
  }
  return files.filter((f) => f.oldPath || f.newPath);
}

// Changed files, the lexical symbols whose lines the change touches, and the
// tests linked to changed sources, each with its evidence.
export function diffSummary(text, scan) {
  const files = parseUnifiedDiff(text);
  const byPath = new Map(scan.files.map((f) => [f.path, f]));
  const changedSymbols = [];
  const out = [];
  const changedIds = new Set();
  for (const f of files) {
    const p = f.newPath ?? f.oldPath;
    const sf = byPath.get(p);
    const touched = [...new Set(f.hunks.flatMap((h) => [...h.added, ...h.removedAt]))].sort((a, b) => a - b);
    out.push({ path: p, ...(f.oldPath && f.oldPath !== p ? { oldPath: f.oldPath } : {}), status: f.status, fileId: sf?.id ?? null, inScan: Boolean(sf), linesAdded: f.hunks.reduce((s, h) => s + h.added.length, 0), linesRemoved: f.hunks.reduce((s, h) => s + h.removedAt.length, 0), hunks: f.hunks.map((h) => ({ newStart: h.newStart, newLines: h.newLines })) });
    if (!sf) continue;
    changedIds.add(sf.id);
    for (const s of scan.symbols.filter((x) => x.fileId === sf.id)) {
      const end = s.endLine ?? s.startLine;
      const hits = touched.filter((n) => n >= s.startLine && n <= end);
      if (hits.length) changedSymbols.push({ symbolId: s.id, name: s.name, fileId: sf.id, path: p, startLine: s.startLine, endLine: s.endLine, certainty: s.certainty, changedLines: hits, basis: 'diff hunk lines inside the symbol range' });
    }
  }
  // Keep only the innermost symbols when a method and its class both match.
  const inner = changedSymbols.filter((s) => !changedSymbols.some((o) => o !== s && o.fileId === s.fileId && o.startLine >= s.startLine && (o.endLine ?? o.startLine) <= (s.endLine ?? s.startLine) && (o.startLine !== s.startLine || o.endLine !== s.endLine)));
  const relatedTests = [];
  for (const l of scan.links) {
    if (changedIds.has(l.to) && (l.kind === 'tests' || l.kind === 'tests_candidate')) {
      const t = scan.files.find((f) => f.id === l.from);
      relatedTests.push({ path: t.path, fileId: t.id, covers: scan.files.find((f) => f.id === l.to).path, basis: l.basis, certainty: l.certainty });
    }
  }
  for (const f of out) if (f.inScan && byPath.get(f.path)?.role === 'test' && !relatedTests.some((t) => t.path === f.path)) relatedTests.push({ path: f.path, fileId: f.fileId, covers: null, basis: 'changed in this diff', certainty: 'direct' });
  return {
    files: out,
    changedSymbols: inner,
    relatedTests,
    note: 'From a unified diff and lexical symbols. Nothing in the diff was applied or run. Symbols are matched by line ranges, not by parsing.'
  };
}
