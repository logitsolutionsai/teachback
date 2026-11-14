// Reference solution for exercise 2. The tutor shows this only on request.
import { BitArray } from './bit-array.mjs';
import { positions } from './hash.mjs';

export class BloomFilter {
  constructor(m, k) {
    this.m = m;
    this.k = k;
    this.bits = new BitArray(m);
  }

  add(item) {
    for (const p of positions(item, this.k, this.m)) this.bits.set(p);
  }

  mightContain(item) {
    return positions(item, this.k, this.m).every((p) => this.bits.get(p));
  }
}
