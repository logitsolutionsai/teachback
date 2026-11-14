import { Entry } from './entry.js';

// A fixed-capacity cache. When it is full, adding a new key drops one entry.
export class LruCache {
  constructor(capacity, clock = () => Date.now()) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('capacity must be a positive integer');
    this.capacity = capacity;
    this.clock = clock;
    this.entries = new Map();
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    entry.touch(this.clock());
    return entry.value;
  }

  set(key, value) {
    const existing = this.entries.get(key);
    if (existing) {
      existing.value = value;
      existing.touch(this.clock());
      return;
    }
    if (this.entries.size >= this.capacity) this.evict();
    this.entries.set(key, new Entry(key, value, this.clock()));
  }

  // Chooses which entry to drop and removes it.
  evict() {
    let victim = null;
    for (const entry of this.entries.values()) {
      if (victim === null || entry.lastUsed < victim.lastUsed) victim = entry;
    }
    if (victim) this.entries.delete(victim.key);
    return victim ? victim.key : undefined;
  }

  get size() {
    return this.entries.size;
  }
}
