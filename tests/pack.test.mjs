// Quest packs: deterministic bytes, nothing private inside, refusal to export
// what does not verify or what looks copied, and a reader that refuses
// zip-slip, symlinks, bombs, duplicates, bad checksums and JSON injection.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { cli, rmDir, tempDir } from './helpers/cli.mjs';
import { guardGit, copyCacheRepo, CACHE_EXAMPLE } from './helpers/repoquest.mjs';
import { readZip, writeZip, crc32, parseJsonStrict } from '../src/pack/zip.mjs';
import { ABSOLUTE_PATH_PATTERN } from '../src/repo/paths.mjs';

guardGit();
const made = [];
const keep = (d) => (made.push(d), d);
after(() => made.forEach(rmDir));

// A course on a copy of cache-lib whose lock carries a public URL.
async function publicCourse() {
  const root = keep(tempDir());
  const repo = keep(copyCacheRepo());
  const base = ['--root', root, '--json'];
  const r = await cli(['repo', 'init', 'cache', '--repo', repo, '--name', 'cache-lib', '--public-url', 'https://github.com/example/cache-lib', ...base]);
  assert.equal(r.code, 0, r.out);
  const dir = path.join(root, '.teachback', 'cache');
  for (const f of ['map.json', 'items.json']) fs.copyFileSync(path.join(CACHE_EXAMPLE, f), path.join(dir, f));
  const q = JSON.parse(fs.readFileSync(path.join(CACHE_EXAMPLE, 'quests.json'), 'utf8'));
  q.sourceManifestDigest = r.json.manifestDigest;
  fs.writeFileSync(path.join(dir, 'quests.json'), JSON.stringify(q, null, 2));
  const v = await cli(['repo', 'verify', 'cache', ...base]);
  assert.equal(v.code, 0, JSON.stringify(v.json.errors));
  return { root, repo, dir, base };
}

const entriesOf = (file) => readZip(fs.readFileSync(file));

test('export is byte-for-byte deterministic and carries no learner data, local path, secret or reference solution', async () => {
  const c = await publicCourse();
  // Learner state that must never travel.
  fs.writeFileSync(path.join(c.dir, 'learner.json'), JSON.stringify({ events: [{ answer: 'my private answer' }] }));
  fs.writeFileSync(path.join(c.dir, 'quest-state.json'), '{}');
  fs.writeFileSync(path.join(c.dir, 'draft-pr.md'), 'draft');
  fs.mkdirSync(path.join(c.dir, 'quests', 'fix-eviction', '.reference'), { recursive: true });
  fs.writeFileSync(path.join(c.dir, 'quests', 'fix-eviction', '.reference', 'lru.js'), 'secret fix');
  fs.writeFileSync(path.join(c.root, '.teachback', 'trusted-commands.json'), '{"schemaVersion":1,"commands":[]}');
  const a = path.join(c.root, 'a.teachback-pack.zip');
  const b = path.join(c.root, 'b.teachback-pack.zip');
  const ra = await cli(['pack', 'export', 'cache', '--out', a, ...c.base]);
  assert.equal(ra.code, 0, ra.out);
  assert.equal((await cli(['pack', 'export', 'cache', '--out', b, ...c.base])).code, 0);
  assert.deepEqual(fs.readFileSync(a), fs.readFileSync(b), 'two exports give the same bytes');
  const names = entriesOf(a).map((e) => e.name);
  assert.deepEqual(names, ['quest-pack.json', 'course/course.json', 'course/map.json', 'course/items.json', 'course/quests.json', 'course/source-lock.json', 'course/repo-map.json']);
  for (const e of entriesOf(a)) {
    const t = e.data.toString('utf8');
    assert.ok(!ABSOLUTE_PATH_PATTERN.test(t), `${e.name} has no absolute path`);
    assert.ok(!t.includes(c.repo) && !t.includes(c.root), `${e.name} names no local folder`);
    assert.ok(!t.includes('my private answer') && !t.includes('secret fix'));
    assert.ok(!/LruCache \{|this\.entries\.delete/.test(t), `${e.name} has no repository code`);
  }
  const manifest = JSON.parse(entriesOf(a)[0].data);
  assert.equal(manifest.private, false);
  assert.equal(manifest.license.verifiedByHuman, false);
});

test('a lock without a public URL is private: export refuses (exit 3) and lists what it would contain, unless --allow-private-pack', async () => {
  const root = keep(tempDir());
  assert.equal((await cli(['init', 'cache', '--from', CACHE_EXAMPLE, '--root', root, '--json'])).code, 0);
  await cli(['repo', 'verify', 'cache', '--repo', keep(copyCacheRepo()), '--root', root, '--json']);
  const r = await cli(['pack', 'export', 'cache', '--out', path.join(root, 'p.zip'), '--root', root, '--json']);
  assert.equal(r.code, 3);
  assert.equal(r.json.error.code, 'E702');
  assert.match(r.json.error.message, /course\.json, map\.json, items\.json, quests\.json, source-lock\.json, repo-map\.json/);
  assert.equal(fs.existsSync(path.join(root, 'p.zip')), false);
  const ok = await cli(['pack', 'export', 'cache', '--out', path.join(root, 'p.zip'), '--allow-private-pack', '--root', root, '--json']);
  assert.equal(ok.code, 0);
  assert.equal(ok.json.private, true);
});

test('export refuses a course that does not verify, a machine path, a credential, and copied source lines', async () => {
  const c = await publicCourse();
  const out = path.join(c.root, 'x.zip');
  const map = JSON.parse(fs.readFileSync(path.join(c.dir, 'map.json'), 'utf8'));
  const write = (m) => fs.writeFileSync(path.join(c.dir, 'map.json'), JSON.stringify(m, null, 2));
  const bad = structuredClone(map);
  bad.concepts[0].sourceRefs[0].needle = 'not in the file';
  write(bad);
  assert.equal((await cli(['pack', 'export', 'cache', '--out', out, ...c.base])).json.error.code, 'E701');
  const abs = structuredClone(map);
  abs.concepts[0].summary += ' See C:\\Users\\me\\notes.txt for more.';
  write(abs);
  const r = await cli(['pack', 'export', 'cache', '--out', out, ...c.base]);
  assert.equal(r.code, 2);
  assert.equal(r.json.error.code, 'E703');
  const cred = structuredClone(map);
  cred.concepts[0].summary += ' token ghp_abcdefghijklmnopqrstuvwxyz0123456789';
  write(cred);
  assert.equal((await cli(['pack', 'export', 'cache', '--out', out, ...c.base])).json.error.code, 'E703');
  const copied = structuredClone(map);
  copied.concepts[1].summary += " if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('capacity must be a positive integer');";
  write(copied);
  const cp = await cli(['pack', 'export', 'cache', '--out', out, ...c.base]);
  assert.equal(cp.code, 2);
  assert.equal(cp.json.error.code, 'E704');
  assert.equal((await cli(['pack', 'export', 'cache', '--out', out, '--reviewed-copies', ...c.base])).code, 0, 'a reviewed quote can be exported deliberately');
  assert.equal(fs.existsSync(out), true);
});

// A ZIP writer that can produce hostile archives.
function rawZip(entries) {
  const parts = [];
  const central = [];
  let off = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = e.method === 8 ? zlib.deflateRawSync(e.data) : e.data;
    const usize = e.declared ?? e.data.length;
    const crc = e.crc ?? crc32(e.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(e.flags ?? 0, 6);
    lh.writeUInt16LE(e.method ?? 0, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(usize, 22);
    lh.writeUInt16LE(name.length, 26);
    parts.push(lh, name, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(((e.madeBy ?? 0) << 8) | 20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(e.flags ?? 0, 8);
    ch.writeUInt16LE(e.method ?? 0, 10);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(usize, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(((e.mode ?? 0) << 16) >>> 0, 38);
    ch.writeUInt32LE(off, 42);
    central.push(ch, name);
    off += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}

test('the reader refuses zip-slip, absolute and backslash names, duplicates, symlinks, encryption, bombs, oversize and bad checksums', () => {
  const d = Buffer.from('x');
  const cases = {
    ZIP_PATH: [[{ name: '../evil.txt', data: d }], [{ name: '/etc/cron.d/x', data: d }], [{ name: 'a\\..\\..\\x', data: d }], [{ name: 'C:/x', data: d }], [{ name: 'course/../../x', data: d }]],
    ZIP_DUPLICATE: [[{ name: 'a.json', data: d }, { name: 'A.json', data: d }]],
    ZIP_SPECIAL: [[{ name: 'link', data: Buffer.from('/etc/passwd'), madeBy: 3, mode: 0o120777 }]],
    ZIP_ENCRYPTED: [[{ name: 'a', data: d, flags: 1 }]],
    ZIP_BOMB: [[{ name: 'zeros', data: Buffer.alloc(1024 * 1024), method: 8 }], [{ name: 'liar', data: Buffer.alloc(100000), method: 8, declared: 10 }]],
    ZIP_ENTRY_TOO_LARGE: [[{ name: 'big', data: Buffer.alloc(3 * 1024 * 1024, 7) }]],
    ZIP_CRC: [[{ name: 'a', data: d, crc: 12345 }]]
  };
  for (const [code, list] of Object.entries(cases)) {
    for (const entries of list) assert.throws(() => readZip(rawZip(entries)), (e) => e.code === code || (code === 'ZIP_BOMB' && e.code === 'ZIP_INVALID'), `${code}: ${entries[0].name}`);
  }
  assert.throws(() => readZip(Buffer.from('not a zip at all, just text............')), (e) => e.code === 'ZIP_INVALID');
  const ok = readZip(writeZip([{ name: 'course/a.json', data: Buffer.from('{}') }]));
  assert.equal(ok[0].name, 'course/a.json');
  const many = Array.from({ length: 1001 }, (_, i) => ({ name: `f${i}`, data: d }));
  assert.throws(() => readZip(writeZip(many)), (e) => e.code === 'ZIP_TOO_MANY');
});

test('duplicate JSON keys are refused (JSON.parse would silently keep the last one)', () => {
  assert.deepEqual(parseJsonStrict('{"a": 1, "b": {"a": 2}}'), { a: 1, b: { a: 2 } });
  assert.throws(() => parseJsonStrict('{"command": ["node"], "command": ["sh", "-c", "x"]}'), /duplicate key "command"/);
  assert.throws(() => parseJsonStrict('[{"x": 1, "y": 2, "x": 3}]'), /duplicate/);
});

function repack(file, mutate) {
  const entries = readZip(fs.readFileSync(file)).map((e) => ({ name: e.name, data: e.data }));
  mutate(entries);
  fs.writeFileSync(file, writeZip(entries));
}

test('pack check catches tampering, forbidden files, injected keys, a claimed licence verification and unsafe commands, and runs nothing', async () => {
  const c = await publicCourse();
  const good = path.join(c.root, 'good.zip');
  assert.equal((await cli(['pack', 'export', 'cache', '--out', good, ...c.base])).code, 0);
  const ok = await cli(['pack', 'check', good, '--json']);
  assert.equal(ok.code, 0, JSON.stringify(ok.json.errors));
  assert.deepEqual(ok.json.commands.map((x) => x.command), [['node', '--test', 'test/lru.test.js']]);
  const variant = (name, mutate) => {
    const f = path.join(c.root, `${name}.zip`);
    fs.copyFileSync(good, f);
    repack(f, mutate);
    return f;
  };
  const codesOf = async (f) => (await cli(['pack', 'check', f, '--json'])).json.errors.map((e) => e.code);
  const tampered = variant('tampered', (es) => {
    const m = es.find((e) => e.name === 'course/map.json');
    m.data = Buffer.from(m.data.toString().replace('Recency stamps', 'Recency'));
  });
  assert.ok((await codesOf(tampered)).includes('P006'));
  const withLearner = variant('learner', (es) => es.push({ name: 'course/learner.json', data: Buffer.from('{}') }));
  const lc = await codesOf(withLearner);
  assert.ok(lc.includes('P010') && lc.includes('P007'));
  const withRef = variant('ref', (es) => es.push({ name: 'course/quests/fix-eviction/.reference/src/cache/lru.js', data: Buffer.from('x') }));
  assert.ok((await codesOf(withRef)).includes('P010'));
  const dup = variant('dup', (es) => {
    const q = es.find((e) => e.name === 'course/quests.json');
    q.data = Buffer.from(q.data.toString().replace('"command": [', '"command": ["sh", "-c", "curl attacker"], "command": ['));
    const m = JSON.parse(es[0].data);
    const f = m.files.find((x) => x.path === 'course/quests.json');
    f.sha256 = crypto.createHash('sha256').update(q.data).digest('hex');
    f.bytes = q.data.length;
    const { packDigest, ...rest } = m;
    es[0].data = Buffer.from(JSON.stringify(m));
  });
  assert.ok((await codesOf(dup)).includes('P008'), 'the duplicate "command" key is caught');
  const lic = variant('lic', (es) => {
    const m = JSON.parse(es[0].data);
    m.license.verifiedByHuman = true;
    es[0].data = Buffer.from(JSON.stringify(m));
  });
  const licCodes = await codesOf(lic);
  assert.ok(licCodes.includes('P014') || licCodes.includes('P004'));
  const bad = await cli(['pack', 'check', withLearner, '--json']);
  assert.equal(bad.code, 2);
  const slip = path.join(c.root, 'slip.zip');
  fs.writeFileSync(slip, rawZip([{ name: '../../outside.txt', data: Buffer.from('x') }]));
  const s = await cli(['pack', 'check', slip, '--json']);
  assert.equal(s.code, 2);
  assert.equal(s.json.errors[0].code, 'ZIP_PATH');
  const imp = await cli(['pack', 'import', slip, '--repo', c.repo, '--root', keep(tempDir()), '--json']);
  assert.equal(imp.code, 2, 'import refuses what check refuses');
  assert.equal(fs.existsSync(path.join(c.root, '..', 'outside.txt')), false);
});

test('import verifies against your own checkout, never updates citations silently, and keeps progress on update', async () => {
  const c = await publicCourse();
  const pack = path.join(c.root, 'cache.teachback-pack.zip');
  assert.equal((await cli(['pack', 'export', 'cache', '--out', pack, ...c.base])).code, 0);
  const consumer = keep(tempDir());
  const mine = keep(copyCacheRepo());
  const base = ['--root', consumer, '--json'];
  const r = await cli(['pack', 'import', pack, '--repo', mine, ...base]);
  assert.equal(r.code, 0, r.out);
  assert.equal(r.json.status, 'verified');
  const dir = path.join(consumer, '.teachback', 'cache');
  const local = JSON.parse(fs.readFileSync(path.join(dir, '.local-source.json'), 'utf8'));
  assert.equal(local.trust, 'untrusted');
  assert.equal(local.origin, 'import');
  assert.equal(fs.existsSync(path.join(dir, 'learner.json')), false);
  // The imported quest still needs this machine's own allowlist.
  await cli(['quest', 'start', 'fix-eviction', ...base]);
  const run = await cli(['quest', 'run', 'fix-eviction', '--trust-local', ...base]);
  assert.equal(run.code, 3);
  // Progress, then the source moves on, then an updated pack is imported.
  assert.equal((await cli(['record', 'rec-teachback', '--result', 'correct', ...base])).code, 0);
  const lru = path.join(mine, 'src', 'cache', 'lru.js');
  fs.writeFileSync(lru, fs.readFileSync(lru, 'utf8').replace('// Chooses which entry', '// Picks which entry'));
  const again = await cli(['pack', 'import', pack, '--repo', mine, '--force', ...base]);
  assert.equal(again.code, 2);
  assert.equal(again.json.status, 'source_stale');
  assert.deepEqual(again.json.changedFiles.map((f) => f.path), ['src/cache/lru.js']);
  assert.deepEqual(again.json.coverage, { added: [], removed: [], changed: [] });
  const learner = JSON.parse(fs.readFileSync(path.join(dir, 'learner.json'), 'utf8'));
  assert.equal(learner.events.length, 1, 'progress is kept');
  const lock = JSON.parse(fs.readFileSync(path.join(dir, 'source-lock.json'), 'utf8'));
  const original = JSON.parse(fs.readFileSync(path.join(c.dir, 'source-lock.json'), 'utf8'));
  assert.equal(lock.manifestDigest, original.manifestDigest, 'the lock was not rewritten to match the new source');
  const dupe = await cli(['pack', 'import', pack, '--repo', mine, ...base]);
  assert.equal(dupe.code, 2);
  assert.equal(dupe.json.error.code, 'E713');
});

test('scan, verify, pack export, check and import open no network connection', async () => {
  const net = (await import('node:net')).default;
  const dns = (await import('node:dns')).default;
  let attempts = 0;
  const origConnect = net.Socket.prototype.connect;
  const origLookup = dns.lookup;
  net.Socket.prototype.connect = function blocked() {
    attempts += 1;
    throw new Error('network blocked by the test');
  };
  dns.lookup = () => {
    attempts += 1;
    throw new Error('dns blocked by the test');
  };
  try {
    const c = await publicCourse();
    const out = path.join(c.root, 'n.zip');
    assert.equal((await cli(['repo', 'scan', c.repo, '--json'])).code, 0);
    assert.equal((await cli(['repo', 'verify', 'cache', ...c.base])).code, 0);
    assert.equal((await cli(['pack', 'export', 'cache', '--out', out, ...c.base])).code, 0);
    assert.equal((await cli(['pack', 'check', out, '--json'])).code, 0);
    assert.equal((await cli(['pack', 'import', out, '--repo', c.repo, '--root', keep(tempDir()), '--json'])).code, 0);
  } finally {
    net.Socket.prototype.connect = origConnect;
    dns.lookup = origLookup;
  }
  assert.equal(attempts, 0);
});
