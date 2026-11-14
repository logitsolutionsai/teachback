// The shipped example courses pass check, including verify-exercises, and the
// attention course states the paper's facts correctly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { checkCourse } from '../src/check.mjs';
import { EXAMPLE, BLOOM, REPO } from './helpers/cli.mjs';

test('examples/attention-is-all-you-need passes check, exercises included', async () => {
  const r = await checkCourse(EXAMPLE, { timeoutMs: 30000 });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.stats.concepts, 12);
  assert.ok(r.stats.items >= 40, `${r.stats.items} items`);
  assert.equal(r.stats.exercises, 6);
  assert.equal(r.stats.capstone, '06-encoder-layer');
  assert.equal(r.exercises.length, 6);
  for (const e of r.exercises) {
    assert.equal(e.reference.status, 'passed', `${e.id} reference`);
    assert.equal(e.reference.passed, e.reference.total);
    assert.notEqual(e.starter.status, 'passed', `${e.id} starter`);
  }
});

test('examples/bloom-filters (JavaScript) passes check, exercises included', async () => {
  const r = await checkCourse(BLOOM, { timeoutMs: 30000 });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.stats.capstone, '03-sizing');
  assert.equal(r.exercises.length, 3);
});

test('every course in examples/ passes check (new contributed courses are picked up automatically)', async () => {
  const root = path.join(REPO, 'examples');
  const dirs = fs.readdirSync(root).filter((d) => fs.existsSync(path.join(root, d, 'course.json')));
  assert.ok(dirs.length >= 2);
  for (const d of dirs) {
    const r = await checkCourse(path.join(root, d), { timeoutMs: 30000 });
    assert.deepEqual(r.errors, [], d);
    assert.deepEqual(r.warnings, [], d);
  }
});

test('the attention summaries state the paper facts the course depends on', () => {
  const map = JSON.parse(fs.readFileSync(path.join(EXAMPLE, 'map.json'), 'utf8'));
  const text = map.concepts.map((c) => c.summary).join('\n');
  const facts = [
    /d_model = 512/,
    /h = 8 heads/,
    /d_k = d_v = d_model \/ h = 64/,
    /softmax\(QKᵀ \/ √d_k\) V/,
    /d_ff = 2048/,
    /N = 6/,
    /ε_ls = 0\.1/,
    /P_drop = 0\.1/,
    /warmup_steps = 4000/,
    /β₁ = 0\.9, β₂ = 0\.98, ε = 10⁻⁹/,
    /PE\(pos, 2i\) = sin\(pos \/ 10000\^\(2i\/d_model\)\)/,
    /PE\(pos, 2i\+1\) = cos\(pos \/ 10000\^\(2i\/d_model\)\)/,
    /2π to 10000·2π/,
    /LayerNorm\(x \+ Sublayer\(x\)\)/,
    /100,000 steps, about 12 hours/,
    /8 NVIDIA P100 GPUs/
  ];
  for (const f of facts) assert.match(text, f);
  // No concept copies long passages: every summary is one paragraph of original writing.
  for (const c of map.concepts) assert.ok(c.summary.split(/\s+/).length <= 160, `${c.id} summary is one paragraph`);
});

test('the attention items agree with the paper on the key numbers', () => {
  const items = new Map(JSON.parse(fs.readFileSync(path.join(EXAMPLE, 'items.json'), 'utf8')).items.map((i) => [i.id, i]));
  assert.equal(items.get('mh-dk').answer, 64);
  assert.equal(items.get('emb-dmodel').answer, 512);
  assert.equal(items.get('ffn-dff').answer, 2048);
  assert.equal(items.get('sdpa-variance').answer, 64);
  assert.equal(items.get('res-dropout').answer, 0.1);
  assert.equal(items.get('ed-sublayers').answer, 3);
  assert.equal(items.get('train-peak').answer, 4000);
  assert.equal(items.get('sdpa-formula').options[items.get('sdpa-formula').answer].text, 'softmax(QKᵀ / √d_k) V');
  assert.equal(items.get('train-ls').options[items.get('train-ls').answer].text, 'It hurts perplexity but improves accuracy and BLEU');
});

test('no example ships learner data, work copies or the source PDF', () => {
  for (const dir of [EXAMPLE, BLOOM]) {
    for (const f of ['learner.json', 'work', 'dashboard.html']) assert.equal(fs.existsSync(path.join(dir, f)), false, `${dir}/${f}`);
    const pdfs = fs.readdirSync(dir, { recursive: true }).filter((f) => String(f).toLowerCase().endsWith('.pdf'));
    assert.deepEqual(pdfs, []);
  }
});
