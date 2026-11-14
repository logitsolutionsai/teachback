import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BitArray } from './bit-array.mjs';

test('stores bits in ceil(size / 8) bytes', () => {
  assert.equal(new BitArray(10).bytes.length, 2);
  assert.equal(new BitArray(16).bytes.length, 2);
  assert.equal(new BitArray(17).bytes.length, 3);
});

test('a new array is all zeros', () => {
  const b = new BitArray(12);
  for (let i = 0; i < 12; i++) assert.equal(b.get(i), false);
  assert.equal(b.count(), 0);
});

test('set and get, including both ends', () => {
  const b = new BitArray(10);
  b.set(0);
  b.set(9);
  assert.equal(b.get(0), true);
  assert.equal(b.get(9), true);
  assert.equal(b.get(5), false);
  assert.equal(b.count(), 2);
});

test('bits in the same byte do not disturb each other', () => {
  const b = new BitArray(8);
  b.set(3);
  b.set(4);
  assert.deepEqual([...Array(8).keys()].map((i) => b.get(i)), [false, false, false, true, true, false, false, false]);
});

test('setting a bit twice counts once', () => {
  const b = new BitArray(8);
  b.set(2);
  b.set(2);
  assert.equal(b.count(), 1);
});

test('out-of-range positions throw a RangeError', () => {
  const b = new BitArray(10);
  assert.throws(() => b.set(10), RangeError);
  assert.throws(() => b.get(-1), RangeError);
});
