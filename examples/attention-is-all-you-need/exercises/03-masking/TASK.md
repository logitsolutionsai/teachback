# Exercise 3: Masking Future Positions

Paper: Section 3.1 (decoder) and Section 3.2.3 (masking inside scaled dot-product attention).

## Goal

The decoder must not let position `i` look at positions after it. The paper does this by setting the scores of those illegal connections to minus infinity before the softmax.

- `causal_mask(n)` returns an `n x n` matrix with `0.0` where key `j <= i` and `float("-inf")` where `j > i`.
- `masked_attention(Q, K, V, mask)` is exercise 2 with one extra step: add the mask to the scaled scores, then apply softmax.

`linalg.py` gives you `matmul`, `transpose`, `scale`, `add` and a working `softmax_rows`.

## What The Tests Expect

- The first position attends only to itself, so its output equals the first value row.
- Masked weights are exactly `0.0`, and every row of weights still sums to 1.
- Changing a later value row cannot change earlier outputs.
- With an all-zero mask you get ordinary attention.

## Run It

```
teachback run 03-masking
```

Stuck? Ask your tutor for a hint before asking for the answer.
