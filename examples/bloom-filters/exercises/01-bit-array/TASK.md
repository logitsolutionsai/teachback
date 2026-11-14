# Exercise 1: A Bit Array

Explainer: Section 3.

## Goal

A Bloom filter is m bits. Build the bit array first: `new BitArray(size)` with `set(i)`, `get(i)` and `count()`, stored in a `Uint8Array` of `Math.ceil(size / 8)` bytes (expose it as `this.bytes`).

## What The Tests Expect

- 10 bits need 2 bytes; 17 bits need 3.
- Bits that share a byte stay independent.
- Setting a bit twice counts once.
- `set` and `get` throw a `RangeError` outside `0 .. size - 1`.

## Run It

```
teachback run 01-bit-array
```

Stuck? Ask your tutor for a hint before asking for the answer.
