// One cached value and the clock reading of its last use.
export class Entry {
  constructor(key, value, now) {
    this.key = key;
    this.value = value;
    this.lastUsed = now;
  }

  touch(now) {
    this.lastUsed = now;
  }
}
