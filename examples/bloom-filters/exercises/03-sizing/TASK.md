# Capstone: Size A Filter

Explainer: Sections 4 and 5.

## Goal

Turn the explainer's formulas into code, then check them against a real filter.

- `falsePositiveRate(m, n, k)` returns `(1 - e^(-k n / m))^k`.
- `optimalK(m, n)` returns the whole number closest to `(m / n) ln 2`, and at least 1.
- `bitsFor(n, p)` returns `ceil(-n ln p / (ln 2)^2)`.
- `measuredRate(p, added, probes)` sizes a `BloomFilter` (provided in `bloom.mjs`) for `added.length` items at rate `p`, adds them, and returns the fraction of `probes` it wrongly reports as present.

## What The Tests Expect

- `falsePositiveRate(1000, 100, 7)` is about 0.008194. Work it out by hand first.
- The optimal k beats nearby values of k.
- 1000 items at 1% need 9586 bits, about 9.6 per item.
- A real filter sized for 1% lands between 0.4% and 2% on 10,000 strangers.

When this passes and every concept is mastered, the course is Rebuilt.

## Run It

```
teachback run 03-sizing
```

Stuck? Ask your tutor for a hint before asking for the answer.
