// Loading a course folder and finding which course a command refers to.
import fs from 'node:fs';
import path from 'node:path';
import { TeachbackError, readJson, exists } from './util.mjs';

export const COURSE_FILES = ['course.json', 'map.json', 'items.json'];

export function teachbackRoot(root) {
  return path.resolve(root ?? process.env.TEACHBACK_ROOT ?? process.cwd(), '.teachback');
}

export function listCourses(root) {
  const base = teachbackRoot(root);
  if (!exists(base)) return [];
  return fs
    .readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory() && exists(path.join(base, e.name, 'course.json')))
    .map((e) => e.name)
    .sort();
}

// A course can be named by a path to its folder, or by its slug under .teachback/.
// With nothing given: the current folder if it is a course, the course marked
// current by `teachback use`, or the only course under .teachback/.
export function resolveCourseDir(name, { root } = {}) {
  const base = teachbackRoot(root);
  if (name) {
    const asPath = path.resolve(name);
    if (exists(path.join(asPath, 'course.json'))) return asPath;
    const asSlug = path.join(base, name);
    if (exists(path.join(asSlug, 'course.json'))) return asSlug;
    throw new TeachbackError('E001', `No course found at "${name}".`, `Run "teachback init ${name} --title ... --source ..." or pass the path to a course folder.`);
  }
  if (exists(path.join(process.cwd(), 'course.json'))) return process.cwd();
  const current = path.join(base, '.current');
  if (exists(current)) {
    const slug = fs.readFileSync(current, 'utf8').trim();
    if (slug && exists(path.join(base, slug, 'course.json'))) return path.join(base, slug);
  }
  const courses = listCourses(root);
  if (courses.length === 1) return path.join(base, courses[0]);
  if (courses.length === 0) {
    throw new TeachbackError('E001', 'No course found.', 'Create one with "teachback init <slug> --title ... --source ...".');
  }
  throw new TeachbackError('E001', `Several courses found (${courses.join(', ')}).`, 'Name one with --course <slug>, or run "teachback use <slug>".');
}

// Loads everything. Problems that stop loading are thrown; content problems are
// left for check to report.
export function loadCourse(dir) {
  const problems = [];
  const read = (name, required = true) => {
    const file = path.join(dir, name);
    try {
      const v = readJson(file);
      if (v === undefined && required) problems.push({ code: 'E001', file: name, message: `${name} is missing.`, hint: 'Run "teachback init" or restore the file.' });
      return v;
    } catch (err) {
      problems.push({ code: err.code ?? 'E002', file: name, message: err.message, hint: err.hint });
      return undefined;
    }
  };
  const course = read('course.json') ?? {};
  const map = read('map.json') ?? { concepts: [] };
  const items = read('items.json') ?? { items: [] };
  const exercises = new Map();
  const duplicateExercises = [];
  const exDir = path.join(dir, 'exercises');
  if (exists(exDir)) {
    for (const e of fs.readdirSync(exDir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const manifestFile = path.join(exDir, e.name, 'exercise.json');
      let manifest;
      try {
        manifest = readJson(manifestFile);
      } catch (err) {
        problems.push({ code: 'E002', file: `exercises/${e.name}/exercise.json`, message: err.message, hint: err.hint });
        continue;
      }
      if (!manifest) {
        problems.push({ code: 'E030', file: `exercises/${e.name}`, message: `exercises/${e.name} has no exercise.json.`, hint: 'Add exercise.json with id, title, language, starter and tests.' });
        continue;
      }
      const id = manifest.id ?? e.name;
      // Two folders with one id would silently replace each other; check reports it.
      if (exercises.has(id)) duplicateExercises.push({ id, folders: [exercises.get(id).folder, e.name] });
      else exercises.set(id, { ...manifest, id, folder: e.name, dir: path.join(exDir, e.name) });
    }
  }
  const concepts = Array.isArray(map.concepts) ? map.concepts : [];
  const itemList = Array.isArray(items.items) ? items.items : [];
  const track = Array.isArray(course.track) ? course.track : [...exercises.keys()].sort();
  const capstone = [...exercises.values()].find((x) => x.capstone)?.id ?? null;
  return {
    dir,
    slug: course.slug ?? path.basename(dir),
    course,
    map,
    items,
    concepts,
    itemList,
    conceptById: new Map(concepts.map((c) => [c.id, c])),
    itemById: new Map(itemList.map((i) => [i.id, i])),
    exercises,
    track,
    capstone,
    duplicateExercises,
    problems
  };
}

export function loadCourseStrict(dir) {
  const c = loadCourse(dir);
  if (c.problems.length) {
    const p = c.problems[0];
    throw new TeachbackError(p.code, p.message, `${p.hint ?? ''} Run "teachback check" for the full list.`.trim());
  }
  return c;
}

export function itemsForConcept(courseData, conceptId) {
  return courseData.itemList.filter((i) => i.concept === conceptId);
}
