# Exercise 2: Insert And Query

Explainer: Sections 2 and 3.

## Goal

Write `BloomFilter(m, k)` with `add(item)` and `mightContain(item)`. Use the provided `BitArray` (keep it in `this.bits`) and `positions(item, k, m)` from `hash.mjs`, which uses double hashing.

## What The Tests Expect

- An empty filter returns `false` for everything.
- `add` sets exactly the k positions of the item.
- Every added item is reported: no false negatives.
- A query returns `true` only when all k bits are set.
- A tiny, full filter returns `true` for an item that was never added. That is a false positive, and it is expected.

## Run It

```
teachback run 02-bloom-filter
```

Stuck? Ask your tutor for a hint before asking for the answer.
