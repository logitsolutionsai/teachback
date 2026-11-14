// Exercise 1: a bit array. Read TASK.md, then run: teachback run 01-bit-array

export class BitArray {
  constructor(size) {
    // Store the bits in a Uint8Array of Math.ceil(size / 8) bytes, as this.bytes.
    throw new Error('BitArray: your code here');
  }

  // Set bit i to 1. Throw a RangeError if i is outside 0 .. size - 1.
  set(i) {
    throw new Error('set: your code here');
  }

  // Return true if bit i is 1. Throw a RangeError if i is out of range.
  get(i) {
    throw new Error('get: your code here');
  }

  // Return how many bits are 1.
  count() {
    throw new Error('count: your code here');
  }
}
