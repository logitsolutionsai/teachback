# Exercise 2: Scaled Dot-Product Attention

Paper: Section 3.2.1, Equation 1.

## Goal

Implement `Attention(Q, K, V) = softmax(Q K^T / sqrt(d_k)) V` on small matrices.

- `attention_weights(Q, K)` returns the softmax weights, one row per query.
- `attention(Q, K, V)` returns `(output, weights)`.

`linalg.py` gives you `matmul`, `transpose`, `scale` and a working `softmax_rows`, so this exercise is only about attention.

## What The Tests Expect

- A hand-computed example: one query `[1, 0]`, keys `[1, 0]` and `[0, 1]`. Work it out on paper first: the scores are `1/sqrt(2)` and `0`.
- The scores really are divided by `sqrt(d_k)`, where `d_k` is the length of a key.
- When every key is the same, the output is the plain average of the values.
- Shapes: `n_q x n_k` weights and `n_q x d_v` output.

## Run It

```
teachback run 02-scaled-dot-product
```

Stuck? Ask your tutor for a hint before asking for the answer.
