# Exercise 4: Multi-Head Attention

Paper: Section 3.2.2.

## Goal

Run several attention heads, each with its own projections, then join and project the results:

```
head_i    = Attention(Xq WQ[i], Xkv WK[i], Xkv WV[i])
MultiHead = Concat(head_1, ..., head_h) WO
```

- `concat_heads(heads)` joins `h` matrices of shape `n x d_v` side by side into `n x (h * d_v)`.
- `multi_head_attention(Xq, Xkv, params)` returns an `n_q x d_model` matrix. `params` holds lists `WQ`, `WK`, `WV` (one matrix per head) and the output matrix `WO`.

`Xq` and `Xkv` are separate so the same function works for self-attention (`Xq = Xkv`) and for encoder-decoder attention (queries from the decoder, keys and values from the encoder).

`attention.py` gives you working scaled dot-product attention (the answer to exercise 2) and `linalg.py` gives you `matmul`.

## What The Tests Expect

- A two-head example where head 1 sees the first two coordinates and head 2 sees the last two. Work out one row by hand before you code.
- `WO` is really applied.
- With one head and identity projections you get plain attention.
- Queries and memory can have different numbers of rows.

In the paper's base model, `d_model = 512`, `h = 8` and `d_k = d_v = 64`. Here `d_model = 4`, `h = 2` and `d_k = d_v = 2`, so you can check the numbers by hand.

## Run It

```
teachback run 04-multi-head
```

Stuck? Ask your tutor for a hint before asking for the answer.
