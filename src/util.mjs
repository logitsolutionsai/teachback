// Small shared helpers: errors, time (injectable clock), JSON files, text.
import fs from 'node:fs';
import path from 'node:path';

export class TeachbackError extends Error {
  // exit: the process exit code for this error. The original commands leave it
  // out (they exit 1); the RepoQuest commands set 2, 3 or 4 (see docs/REPOQUEST.md).
  constructor(code, message, hint, exit) {
    super(message);
    this.code = code;
    this.hint = hint;
    if (exit !== undefined) this.exit = exit;
  }
}

// ---------- time ----------
// The clock is injectable: pass an explicit ISO string, or set TEACHBACK_NOW.
// Nothing in the learner model ever reads the real date on its own.
export function resolveNow(explicit) {
  const value = explicit ?? process.env.TEACHBACK_NOW;
  if (value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      throw new TeachbackError('E900', `Invalid time "${value}".`, 'Use an ISO 8601 timestamp such as 2026-01-05T09:00:00Z.');
    }
    return d;
  }
  return new Date();
}

// Calendar day ("YYYY-MM-DD") of a moment, seen from a fixed UTC offset in minutes.
export function dayKey(date, offsetMinutes = 0) {
  const d = date instanceof Date ? date : new Date(date);
  return new Date(d.getTime() + offsetMinutes * 60000).toISOString().slice(0, 10);
}

export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromDay, toDay) {
  return Math.round((Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / 86400000);
}

// ---------- numbers ----------
export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const round = (x, places = 4) => {
  const f = 10 ** places;
  return Math.round(x * f) / f;
};

// ---------- files ----------
export function readJson(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return undefined;
    throw err;
  }
  try {
    return JSON.parse(text.replace(/^﻿/, ''));
  } catch (err) {
    throw new TeachbackError('E002', `${path.basename(file)} is not valid JSON: ${err.message}`, 'Fix the JSON syntax (a trailing comma or a missing quote is the usual cause).');
  }
}

export function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

export function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

export function copyDir(src, dest, { skip = () => false } = {}) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (skip(entry.name, s)) continue;
    if (entry.isDirectory()) copyDir(s, d, { skip });
    else fs.copyFileSync(s, d);
  }
}

// ---------- text ----------
export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function pct(x) {
  return `${Math.round(x * 100)}%`;
}

// A concept's mastery estimate as a whole percent for display. An estimate just
// under the mastery threshold never rounds up to it (0.9455 shows as 94%, not
// 95%), so the threshold figure on screen always means mastered.
export function masteryPercent(pL, mastered, threshold = 0.95) {
  const p = Math.round((pL ?? 0) * 100);
  const cap = Math.ceil(threshold * 100 - 1e-9) - 1;
  return !mastered && p > cap ? cap : p;
}
