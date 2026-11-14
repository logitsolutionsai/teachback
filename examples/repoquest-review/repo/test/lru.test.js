import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LruCache } from '../src/cache/lru.js';

// A clock that ticks once per reading, so every use has its own time.
function tickingClock() {
  let t = 0;
  return () => {
    t += 1;
    return t;
  };
}

test('a full cache drops the least recently used key', () => {
  const cache = new LruCache(2, tickingClock());
  cache.set('a', 1);
  cache.set('b', 2);
  cache.get('a');
  cache.set('c', 3);
  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.get('a'), 1);
  assert.equal(cache.get('c'), 3);
});

test('updating a key that is already cached drops nothing', () => {
  const cache = new LruCache(2, tickingClock());
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('a', 10);
  assert.equal(cache.size, 2);
  assert.equal(cache.get('a'), 10);
  assert.equal(cache.get('b'), 2);
});

test('a capacity below one is refused', () => {
  assert.throws(() => new LruCache(0), RangeError);
});
