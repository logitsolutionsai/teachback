// Hashing helpers, provided. FNV-1a (32-bit) and double hashing.

export function fnv1a(text, seed = 0x811c9dc5) {
  let h = seed >>> 0;
  for (const byte of new TextEncoder().encode(String(text))) {
    h ^= byte;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// The k positions for an item in an m-bit filter: (h1 + i * h2) mod m.
export function positions(item, k, m) {
  const h1 = fnv1a(item);
  const h2 = (fnv1a(item, 0x5bd1e995) | 1) >>> 0; // odd, and kept unsigned
  const out = [];
  for (let i = 0; i < k; i++) out.push((h1 + i * h2) % m);
  return out;
}
