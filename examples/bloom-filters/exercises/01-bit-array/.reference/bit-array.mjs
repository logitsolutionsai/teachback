// Reference solution for exercise 1. The tutor shows this only on request.
export class BitArray {
  constructor(size) {
    this.size = size;
    this.bytes = new Uint8Array(Math.ceil(size / 8));
  }

  #check(i) {
    if (!Number.isInteger(i) || i < 0 || i >= this.size) throw new RangeError(`bit ${i} is outside 0..${this.size - 1}`);
  }

  set(i) {
    this.#check(i);
    this.bytes[i >> 3] |= 1 << (i & 7);
  }

  get(i) {
    this.#check(i);
    return (this.bytes[i >> 3] & (1 << (i & 7))) !== 0;
  }

  count() {
    let n = 0;
    for (const b of this.bytes) for (let v = b; v; v &= v - 1) n += 1;
    return n;
  }
}
