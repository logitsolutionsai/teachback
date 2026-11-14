import { test } from 'node:test';
import assert from 'node:assert/strict';
import { falsePositiveRate, optimalK, bitsFor, measuredRate } from './sizing.mjs';

const near = (got, want, eps, msg) => assert.ok(Math.abs(got - want) <= eps, `${msg ?? ''} expected ${want}, got ${got}`);

test('false-positive rate, hand-computed', () => {
  // m = 1000, n = 100, k = 7: e^-0.7 = 0.496585, 1 - that = 0.503415, to the 7th = 0.008194
  near(falsePositiveRate(1000, 100, 7), 0.008194, 1e-6);
  // An empty filter never gives a false positive.
  assert.equal(falsePositiveRate(1000, 0, 7), 0);
});

test('the rate grows as the filter fills', () => {
  assert.ok(falsePositiveRate(1000, 200, 7) > falsePositiveRate(1000, 100, 7));
});

test('optimal k is (m / n) ln 2, rounded, at least 1', () => {
  assert.equal(optimalK(1000, 100), 7); // 10 * 0.6931 = 6.93
  assert.equal(optimalK(800, 100), 6); // 8 * 0.6931 = 5.55
  assert.equal(optimalK(10, 100), 1);
});

test('optimal k gives a lower rate than its neighbours', () => {
  const k = optimalK(1000, 100);
  assert.ok(falsePositiveRate(1000, 100, k) < falsePositiveRate(1000, 100, k - 2));
  assert.ok(falsePositiveRate(1000, 100, k) < falsePositiveRate(1000, 100, k + 3));
});

test('bits needed for 1000 items at 1% is about 9.6 per item', () => {
  // -1000 * ln(0.01) / (ln 2)^2 = 4605.17 / 0.480453 = 9585.06 -> 9586
  assert.equal(bitsFor(1000, 0.01), 9586);
  near(bitsFor(1000, 0.01) / 1000, 9.6, 0.05);
});

test('a real filter sized this way lands near its target rate', () => {
  const added = Array.from({ length: 1000 }, (_, i) => `member-${i}`);
  const probes = Array.from({ length: 10000 }, (_, i) => `stranger-${i}`);
  const rate = measuredRate(0.01, added, probes);
  assert.ok(rate > 0.004 && rate < 0.02, `measured ${rate}`);
});
