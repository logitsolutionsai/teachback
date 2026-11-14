// Exercise 2: a Bloom filter. Read TASK.md, then run: teachback run 02-bloom-filter
import { BitArray } from './bit-array.mjs';
import { positions } from './hash.mjs';

export class BloomFilter {
  // m bits, k hash functions. Keep the bits in this.bits (a BitArray).
  constructor(m, k) {
    throw new Error('BloomFilter: your code here');
  }

  // Set the k bits for this item.
  add(item) {
    throw new Error('add: your code here');
  }

  // false means "definitely not added"; true means "probably added".
  mightContain(item) {
    throw new Error('mightContain: your code here');
  }
}
