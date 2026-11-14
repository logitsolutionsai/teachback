// Runs the teachback CLI in-process with captured output.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../../src/cli.mjs';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const EXAMPLE = path.join(REPO, 'examples', 'attention-is-all-you-need');
export const BLOOM = path.join(REPO, 'examples', 'bloom-filters');
export const FIXTURES = path.join(REPO, 'tests', 'fixtures');

// Day boundaries are computed in UTC in every test.
process.env.TEACHBACK_UTC_OFFSET = '0';

export async function cli(args) {
  let out = '';
  let err = '';
  const code = await main(args, { out: (s) => (out += s), err: (s) => (err += s) });
  let json;
  if (args.includes('--json')) {
    try {
      json = JSON.parse(out);
    } catch {
      json = undefined;
    }
  }
  return { code, out, err, json };
}

export function tempDir(prefix = 'teachback-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

// A Date-free clock: minutes after a fixed start, as ISO strings.
export function clockAt(day, hour = 9) {
  let minute = 0;
  return {
    next() {
      const t = new Date(Date.UTC(...day.split('-').map((v, i) => (i === 1 ? Number(v) - 1 : Number(v))), hour, minute));
      minute += 1;
      return t.toISOString();
    }
  };
}
