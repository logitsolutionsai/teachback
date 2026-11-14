// Capstone: size a Bloom filter and check the maths against a real one.
// Read TASK.md, then run: teachback run 03-sizing
import { BloomFilter } from './bloom.mjs';

// p = (1 - e^(-k n / m))^k
export function falsePositiveRate(m, n, k) {
  throw new Error('falsePositiveRate: your code here');
}

// The whole number of hash functions closest to (m / n) ln 2, at least 1.
export function optimalK(m, n) {
  throw new Error('optimalK: your code here');
}

// Bits needed for n items at false-positive rate p: ceil(-n ln p / (ln 2)^2).
export function bitsFor(n, p) {
  throw new Error('bitsFor: your code here');
}

// Build a filter for n items at rate p (using bitsFor and optimalK), add every
// item in `added`, then return the fraction of `probes` (never added) that the
// filter wrongly reports as present.
export function measuredRate(p, added, probes) {
  throw new Error('measuredRate: your code here');
}
