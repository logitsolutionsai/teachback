// Contributor Quest Packs: export, check and import.
//
// A pack holds course definitions and source pointers only: course.json,
// map.json, items.json, quests.json, source-lock.json, repo-map.json and
// exercise starters and tests. It never holds learner.json, quest-state.json,
// .local-source.json, trusted-commands.json, workspaces, work copies, draft PR
// text, dashboards, hidden .reference solutions, or repository code. Export
// refuses a course that does not verify, any absolute path or credential, and
// text copied from the source beyond a short quote, unless reviewed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TeachbackError, writeJsonAtomic, exists, slugify, resolveNow, readJson } from '../util.mjs';
import { resolveCourseDir, loadCourse, loadCourseStrict, teachbackRoot } from '../course.mjs';
import { validateFile } from '../schema.mjs';
import { checkStatic } from '../check.mjs';
import { sha256Hex, digestOf, readSource } from '../repo/scan.mjs';
import { loadLock, writeLocal, repoRootFor, LOCK_FILE, MAP_FILE } from '../repo/source-lock.mjs';
import { verifyCourse } from '../repo/verify.mjs';
import { ABSOLUTE_PATH_PATTERN } from '../repo/paths.mjs';
import { checkQuests, commandProblems, QUESTS_FILE } from '../quest/schema.mjs';
import { redact } from '../quest/runner.mjs';
import { writeZip, readZip, parseJsonStrict, ZipError } from './zip.mjs';

export const PACK_VERSION = 1;
const PACKAGE_VERSION = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
const COURSE_FILES = ['course.json', 'map.json', 'items.json', QUESTS_FILE, LOCK_FILE, MAP_FILE, 'diff-summary.json'];
const FORBIDDEN = /(^|\/)(learner\.json|learner\.json\.lock|quest-state\.json|\.local-source\.json|trusted-commands\.json|draft-pr\.md|dashboard\.html|certificate\.(html|json)|authoring-plan\.md|\.env(\..*)?|id_rsa.*|.*\.pem|.*\.key)$|(^|\/)(work|workspaces|\.reference|node_modules|\.git)(\/|$)/;
const NOTICE = 'Course definitions and source pointers only. No learner data, no repository code, no hidden reference solutions. Each contributor gets the source under its own licence. A detected licence is a guess, not legal permission.';
const SECRET_PATTERN = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,})\b/;

function packFiles(courseData) {
  const files = COURSE_FILES.filter((f) => exists(path.join(courseData.dir, f)));
  for (const ex of [...courseData.exercises.values()].sort((a, b) => (a.folder < b.folder ? -1 : 1))) {
    for (const f of ['exercise.json', 'TASK.md', ex.starter, ...[].concat(ex.tests ?? []), ...(ex.support ?? [])]) {
      if (f && exists(path.join(ex.dir, f))) files.push(`exercises/${ex.folder}/${f}`);
    }
  }
  return [...new Set(files)];
}

// Every string in a JSON value, with where it is.
function strings(v, at = '', out = []) {
  if (typeof v === 'string') out.push({ at, s: v });
  else if (Array.isArray(v)) v.forEach((x, i) => strings(x, `${at}[${i}]`, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) strings(x, at ? `${at}.${k}` : k, out);
  return out;
}

// Source lines of 40 or more characters that appear word for word in course text.
function copiedText(courseData, lock, repoRoot) {
  const lines = new Set();
  for (const f of lock.files) {
    if (f.binary || f.role === 'license') continue;
    try {
      const src = readSource(path.join(repoRoot, f.path));
      for (const l of src.text?.split('\n') ?? []) if (l.trim().length >= 40) lines.add(l.trim());
    } catch {
      // a missing file is reported by verify
    }
  }
  const hits = [];
  for (const name of ['map.json', 'items.json', QUESTS_FILE]) {
    const doc = readJson(path.join(courseData.dir, name));
    for (const { at, s } of strings(doc)) {
      if (s.length < 40) continue;
      for (const l of lines) if (s.includes(l)) hits.push({ file: name, at, line: l.slice(0, 80) });
    }
  }
  return hits;
}

export function exportPack(dir, { out, allowPrivate = false, reviewedCopies = false, repo } = {}) {
  const courseData = loadCourseStrict(dir);
  const lock = loadLock(dir);
  const v = verifyCourse(dir, { repo });
  if (v.status !== 'verified') {
    throw new TeachbackError('E701', `${courseData.slug} does not verify (${v.status}): ${v.errors.slice(0, 3).map((e) => e.message).join(' ')}`, 'A pack is exported only from a course whose every reference verifies. Run "teachback repo verify" and fix what it reports.', v.exitCode || 1);
  }
  const files = packFiles(courseData);
  const inventory = files.map((f) => ({ path: f, bytes: fs.statSync(path.join(dir, f)).size }));
  const isPrivate = !lock.repo.publicUrl;
  if (isPrivate && !allowPrivate) {
    const err = new TeachbackError('E702', `The source lock has no public URL, so this is treated as a private repository and nothing was exported. The pack would contain: ${files.join(', ')}.`, 'If you may share these course files, pass --allow-private-pack. To mark the repository public, re-create the lock with --public-url https://github.com/<owner>/<repo>.', 3);
    err.inventory = inventory;
    throw err;
  }
  const problems = [];
  const entries = [];
  for (const f of files) {
    const data = fs.readFileSync(path.join(dir, f));
    const text = data.toString('utf8');
    if (ABSOLUTE_PATH_PATTERN.test(text)) problems.push(`${f} contains an absolute path (${text.match(ABSOLUTE_PATH_PATTERN)[0].trim()}...)`);
    if (SECRET_PATTERN.test(text)) problems.push(`${f} contains something that looks like a credential`);
    entries.push({ name: `course/${f}`, data, sha256: sha256Hex(data) });
  }
  if (problems.length) throw new TeachbackError('E703', `Refusing to export: ${problems.join('; ')}.`, 'Remove machine paths and credentials from the course files; a pack is meant to be shared.', 2);
  const copies = copiedText(courseData, lock, repoRootFor(dir, repo));
  if (copies.length && !reviewedCopies) {
    throw new TeachbackError('E704', `The course copies ${copies.length} source line${copies.length === 1 ? '' : 's'} word for word, for example in ${copies[0].file} ${copies[0].at}: "${copies[0].line}".`, 'Rewrite it in your own words and keep quotes to a short needle. If a longer quote is necessary and allowed by the licence, review it and pass --reviewed-copies.', 2);
  }
  const manifest = {
    schemaVersion: PACK_VERSION,
    kind: 'teachback-quest-pack',
    slug: courseData.slug,
    title: courseData.course.title,
    repo: { name: lock.repo.name, ...(lock.repo.publicUrl ? { publicUrl: lock.repo.publicUrl } : {}), ref: lock.repo.ref, scope: lock.repo.scope },
    sourceManifestDigest: lock.manifestDigest,
    license: { detectedSpdx: lock.license.detectedSpdx, verifiedByHuman: false, note: 'A keyword guess from the licence file. Not legal permission.' },
    private: isPrivate,
    teachbackVersion: PACKAGE_VERSION,
    files: entries.map((e) => ({ path: e.name, sha256: e.sha256, bytes: e.data.length })),
    excluded: ['learner.json', 'quest-state.json', '.local-source.json', 'trusted-commands.json', 'work/', 'workspaces/', 'quests/*/.reference/', 'exercises/*/.reference/', 'draft-pr.md', 'dashboard.html', 'certificate.*', 'repository source files'],
    notice: NOTICE
  };
  manifest.packDigest = digestOf(manifest);
  const zip = writeZip([{ name: 'quest-pack.json', data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) }, ...entries.map((e) => ({ name: e.name, data: e.data }))]);
  const file = path.resolve(out ?? `${courseData.slug}.teachback-pack.zip`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, zip);
  return { path: file, bytes: zip.length, sha256: sha256Hex(zip), packDigest: manifest.packDigest, private: isPrivate, inventory, copiedLines: copies.length, files: manifest.files.length };
}

// Static inspection of a pack: nothing in it runs.
export function checkPack(file) {
  const errors = [];
  const warnings = [];
  const err = (code, message) => errors.push({ code, message });
  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch {
    throw new TeachbackError('E710', `Cannot read ${file}.`, 'Pass the path to a .teachback-pack.zip file.', 4);
  }
  let entries;
  try {
    entries = readZip(buf);
  } catch (e) {
    if (e instanceof ZipError) return { ok: false, errors: [{ code: e.code, message: e.message }], warnings, manifest: null, entries: [] };
    throw e;
  }
  const byName = new Map(entries.map((e) => [e.name, e]));
  for (const e of entries) if (FORBIDDEN.test(e.name)) err('P010', `The pack contains ${e.name}, which a pack must never carry.`);
  const mEntry = byName.get('quest-pack.json');
  if (!mEntry) {
    err('P001', 'quest-pack.json is missing.');
    return { ok: false, errors, warnings, manifest: null, entries };
  }
  let manifest;
  const parsed = new Map();
  try {
    manifest = parseJsonStrict(mEntry.data.toString('utf8'));
  } catch (e) {
    err('P002', `quest-pack.json is not valid JSON: ${e.message}.`);
    return { ok: false, errors, warnings, manifest: null, entries };
  }
  const schemaErrors = validateFile(manifest, 'quest-pack.v1');
  for (const e of schemaErrors) err('P003', `quest-pack.json ${e.path} ${e.message}.`);
  if (schemaErrors.length) return { ok: false, errors, warnings, manifest, entries };
  const { packDigest, ...rest } = manifest;
  if (digestOf(rest) !== packDigest) err('P004', 'quest-pack.json does not match its own packDigest.');
  const listed = new Set(manifest.files.map((f) => f.path));
  for (const f of manifest.files) {
    const e = byName.get(f.path);
    if (!f.path.startsWith('course/')) err('P011', `${f.path} is outside course/.`);
    if (!e) err('P005', `${f.path} is listed but missing.`);
    else if (sha256Hex(e.data) !== f.sha256 || e.data.length !== f.bytes) err('P006', `${f.path} does not match its listed hash.`);
  }
  for (const e of entries) if (e.name !== 'quest-pack.json' && !listed.has(e.name)) err('P007', `${e.name} is in the archive but not in the manifest.`);
  for (const e of entries) {
    const text = e.data.toString('utf8');
    if (e.name.endsWith('.json')) {
      try {
        parsed.set(e.name, parseJsonStrict(text));
      } catch (x) {
        err('P008', `${e.name}: ${x.message}.`);
      }
    }
    if (ABSOLUTE_PATH_PATTERN.test(text)) err('P012', `${e.name} contains an absolute path.`);
    if (SECRET_PATTERN.test(text)) err('P013', `${e.name} contains something that looks like a credential.`);
  }
  if (manifest.license?.verifiedByHuman !== false) err('P014', 'The pack claims a human-verified licence; packs never carry that claim.');
  const lock = parsed.get(`course/${LOCK_FILE}`);
  if (!lock) err('P020', 'The pack has no source-lock.json.');
  else {
    for (const e of validateFile(lock, 'source-lock.v1')) err('P021', `source-lock.json ${e.path} ${e.message}.`);
    if (lock.manifestDigest !== manifest.sourceManifestDigest) err('P022', 'The manifest names a different source lock than the one inside.');
  }
  // Commands, statically. They are shown so a reader can decide; none runs.
  const quests = parsed.get(`course/${QUESTS_FILE}`)?.quests ?? [];
  const commands = [];
  for (const q of quests) {
    if (!q.verification) continue;
    const p = commandProblems(q.verification.command);
    commands.push({ quest: q.id, command: q.verification.command, allowedPaths: q.workspace?.allowedPaths ?? [], problems: p });
    for (const x of p) err('P030', `Quest "${q.id}": ${x}.`);
  }
  // The course itself, written to a scratch folder and checked like any course.
  if (!errors.length) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'teachback-pack-check-'));
    try {
      for (const e of entries) {
        if (!e.name.startsWith('course/')) continue;
        const dest = path.join(tmp, ...e.name.slice('course/'.length).split('/'));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, e.data);
      }
      const stat = checkStatic(tmp);
      for (const p of stat.problems) (p.level === 'error' ? errors : warnings).push({ code: p.code, message: `${p.file}: ${p.message}` });
      const courseData = loadCourse(tmp);
      const repoMap = parsed.get(`course/${MAP_FILE}`);
      for (const p of checkQuests(courseData, parsed.get(`course/${QUESTS_FILE}`), { lock, repoMap })) (p.level === 'error' ? errors : warnings).push({ code: p.code, message: `${p.file}: ${p.message}` });
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  if (!manifest.repo?.publicUrl) warnings.push({ code: 'P040', message: 'The pack names no public repository URL; get the source from its maintainer.' });
  return { ok: errors.length === 0, errors, warnings, manifest, entries, commands };
}

export function importPack(file, { repo, slug: slugArg, root, force = false, now }) {
  const res = checkPack(path.resolve(file));
  if (!res.ok) {
    const e = new TeachbackError('E711', `The pack failed its check: ${res.errors.slice(0, 3).map((x) => x.message).join(' ')}`, 'Nothing was imported. Run "teachback pack check" for the full list.', 2);
    e.details = res.errors;
    throw e;
  }
  if (!repo) throw new TeachbackError('E712', 'pack import needs --repo <your checkout>.', 'The pack carries no source code; point it at your own copy of the repository.', 2);
  const slug = slugify(slugArg ?? res.manifest.slug);
  const dir = path.join(teachbackRoot(root), slug);
  const existed = exists(path.join(dir, 'course.json'));
  if (existed && !force) throw new TeachbackError('E713', `A course "${slug}" already exists.`, 'Pass --slug <new name>, or --force to update its course files (your learner record and quest progress are kept).', 2);
  const before = existed ? loadCourse(dir) : null;
  fs.mkdirSync(dir, { recursive: true });
  for (const e of res.entries) {
    if (!e.name.startsWith('course/')) continue;
    const rel = e.name.slice('course/'.length);
    const dest = path.join(dir, ...rel.split('/'));
    if (!path.resolve(dest).startsWith(path.resolve(dir) + path.sep)) throw new TeachbackError('E714', `Refused to write ${e.name} outside the course folder.`, 'The pack is malformed.', 2);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, e.data);
  }
  const cj = readJson(path.join(dir, 'course.json'));
  cj.slug = slug;
  writeJsonAtomic(path.join(dir, 'course.json'), cj);
  writeLocal(dir, { repoPath: path.resolve(repo), trust: 'untrusted', origin: 'import', pack: res.manifest.packDigest, importedAt: now.toISOString() });
  fs.writeFileSync(path.join(teachbackRoot(root), '.current'), `${slug}\n`);
  const verify = verifyCourse(dir, { repo });
  let coverage = null;
  if (before) {
    const after = loadCourse(dir);
    const ids = (c) => new Map(c.concepts.map((k) => [k.id, JSON.stringify(k)]));
    const b = ids(before);
    const a = ids(after);
    coverage = { added: [...a.keys()].filter((k) => !b.has(k)), removed: [...b.keys()].filter((k) => !a.has(k)), changed: [...a.keys()].filter((k) => b.has(k) && b.get(k) !== a.get(k)) };
  }
  return { imported: dir, slug, packDigest: res.manifest.packDigest, status: verify.status, refs: verify.refs, changedFiles: verify.changedFiles, warnings: res.warnings, commands: res.commands, coverage, exitCode: verify.status === 'verified' ? 0 : verify.exitCode };
}

export function registerPackCommands(SUB) {
  SUB['pack export'] = async (argv, { parse, out }) => {
    const args = parse(argv, { out: { type: 'string', short: 'o' }, 'allow-private-pack': { type: 'boolean' }, 'reviewed-copies': { type: 'boolean' }, repo: { type: 'string' } });
    const dir = resolveCourseDir(args.course ?? args._[0], { root: args.root });
    let res;
    try {
      res = exportPack(dir, { out: args.out, allowPrivate: args['allow-private-pack'], reviewedCopies: args['reviewed-copies'], repo: args.repo });
    } catch (e) {
      if (e.inventory && args.json) e.hint = `${e.hint} Inventory: ${e.inventory.map((f) => `${f.path} (${f.bytes} bytes)`).join(', ')}.`;
      throw e;
    }
    out(args, res, () =>
      [
        `Wrote ${res.path} (${res.bytes} bytes, ${res.files} files${res.private ? ', private repository: shared only by your explicit choice' : ''})`,
        ...res.inventory.map((f) => `  ${f.path} (${f.bytes} bytes)`),
        `  pack digest ${res.packDigest}`,
        '  Not included: learner records, quest progress, local paths, trusted commands, reference solutions, repository code.'
      ].join('\n')
    );
  };

  SUB['pack check'] = async (argv, { parse, out, setExit }) => {
    const args = parse(argv);
    if (!args._[0]) throw new TeachbackError('E710', 'pack check needs a pack file.', 'Example: teachback pack check cache-onboarding.teachback-pack.zip', 2);
    const res = checkPack(path.resolve(args._[0]));
    const view = { ok: res.ok, errors: res.errors, warnings: res.warnings, manifest: res.manifest ? { slug: res.manifest.slug, title: res.manifest.title, repo: res.manifest.repo, private: res.manifest.private, license: res.manifest.license, files: res.manifest.files?.length, packDigest: res.manifest.packDigest } : null, commands: res.commands ?? [], note: 'Nothing in the pack was run. Commands run only after you add them to your own .teachback/trusted-commands.json and pass --trust-local.' };
    out(args, view, () => {
      const lines = [`${res.ok ? 'OK' : 'FAILED'}: ${args._[0]}`];
      if (view.manifest) lines.push(`  ${view.manifest.title} (${view.manifest.slug}), ${view.manifest.files} files, licence guess ${view.manifest.license?.detectedSpdx ?? 'none'} (not verified)`);
      for (const c of view.commands) lines.push(`  quest ${c.quest} would run ${JSON.stringify(c.command)} and may change ${c.allowedPaths.join(', ')}`);
      for (const e of res.errors) lines.push(`ERROR ${e.code}: ${e.message}`);
      for (const w of res.warnings) lines.push(`warn  ${w.code}: ${w.message}`);
      lines.push(view.note);
      return lines.join('\n');
    });
    if (!res.ok) setExit(2);
  };

  SUB['pack import'] = async (argv, { parse, out, setExit }) => {
    const args = parse(argv, { repo: { type: 'string' }, slug: { type: 'string' }, force: { type: 'boolean' } });
    if (!args._[0]) throw new TeachbackError('E710', 'pack import needs a pack file.', 'Example: teachback pack import cache-onboarding.teachback-pack.zip --repo .', 2);
    const res = importPack(args._[0], { repo: args.repo, slug: args.slug, root: args.root, force: args.force, now: resolveNow(args.now) });
    out(args, res, () =>
      [
        `Imported "${res.slug}" into ${res.imported}`,
        `  source check against ${path.resolve(args.repo)}: ${res.status.toUpperCase()} (${res.refs.verified} refs verified, ${res.refs.source_stale} stale, ${res.refs.unverified_ref} unverified)`,
        ...(res.changedFiles.length ? [`  changed since the pack was made: ${res.changedFiles.map((f) => f.path).join(', ')}. Citations were not updated; review "teachback repo rebase ${res.slug} --dry-run".`] : []),
        ...(res.coverage ? [`  concepts added: ${res.coverage.added.join(', ') || 'none'}; removed: ${res.coverage.removed.join(', ') || 'none'}; changed: ${res.coverage.changed.join(', ') || 'none'}. Your progress was kept.`] : []),
        ...res.commands.map((c) => `  quest ${c.quest} runs ${JSON.stringify(c.command)} only after you allowlist it and pass --trust-local`),
        '  The pack is untrusted: read its quests before running anything.'
      ].join('\n')
    );
    setExit(res.exitCode);
  };
}
