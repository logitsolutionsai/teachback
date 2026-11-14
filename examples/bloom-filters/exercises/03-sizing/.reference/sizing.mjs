// Reference solution for the capstone. The tutor shows this only on request.
import { BloomFilter } from './bloom.mjs';

export function falsePositiveRate(m, n, k) {
  return (1 - Math.exp((-k * n) / m)) ** k;
}

export function optimalK(m, n) {
  return Math.max(1, Math.round((m / n) * Math.LN2));
}

export function bitsFor(n, p) {
  return Math.ceil((-n * Math.log(p)) / Math.LN2 ** 2);
}

export function measuredRate(p, added, probes) {
  const m = bitsFor(added.length, p);
  const f = new BloomFilter(m, optimalK(m, added.length));
  for (const item of added) f.add(item);
  return probes.filter((q) => f.mightContain(q)).length / probes.length;
}
