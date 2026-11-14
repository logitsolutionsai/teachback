import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BloomFilter } from './bloom.mjs';
import { positions } from './hash.mjs';

const words = Array.from({ length: 50 }, (_, i) => `word-${i}`);

test('an empty filter says "definitely not" to everything', () => {
  const f = new BloomFilter(64, 3);
  assert.equal(f.mightContain('apple'), false);
  assert.equal(f.bits.count(), 0);
});

test('add sets exactly the k positions of the item', () => {
  const f = new BloomFilter(64, 3);
  f.add('apple');
  const want = new Set(positions('apple', 3, 64));
  for (let i = 0; i < 64; i++) assert.equal(f.bits.get(i), want.has(i), `bit ${i}`);
});

test('no false negatives: every added item is reported', () => {
  const f = new BloomFilter(256, 4);
  for (const w of words) f.add(w);
  for (const w of words) assert.equal(f.mightContain(w), true, w);
});

test('a query says "probably yes" only when all k bits are set', () => {
  const f = new BloomFilter(64, 3);
  for (const w of words.slice(0, 6)) f.add(w);
  for (const q of ['pear', 'plum', 'fig', 'kiwi', 'lime']) {
    const allSet = positions(q, 3, 64).every((p) => f.bits.get(p));
    assert.equal(f.mightContain(q), allSet, q);
  }
});

test('a full filter says "probably yes" to anything: a false positive', () => {
  const f = new BloomFilter(8, 1);
  for (let i = 0; i < 200; i++) f.add(`filler-${i}`);
  assert.equal(f.bits.count(), 8);
  assert.equal(f.mightContain('never-added'), true);
});
