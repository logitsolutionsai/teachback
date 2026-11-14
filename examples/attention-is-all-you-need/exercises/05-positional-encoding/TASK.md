# Exercise 5: Sinusoidal Positional Encoding

Paper: Section 3.5.

## Goal

Attention ignores word order, so the paper adds a position signal to each embedding:

```
PE(pos, 2i)     = sin(pos / 10000^(2i / d_model))
PE(pos, 2i + 1) = cos(pos / 10000^(2i / d_model))
```

- `positional_encoding(n_positions, d_model)` returns the `n_positions x d_model` matrix. Raise `ValueError` for an odd `d_model`.
- `add_positional_encoding(X)` returns `X + PE` as a new matrix.

## What The Tests Expect

- Position 0 is `[0, 1, 0, 1, ...]`.
- With `d_model = 4`, position 1 is `[sin 1, cos 1, sin 0.01, cos 0.01]`. Check why the second pair uses `0.01`.
- Each (sin, cos) pair lies on the unit circle.
- Shifting by a fixed offset `k` is a rotation of each pair, that is, a linear function of `PE(pos)`. This is the property the paper gives for choosing sinusoids.

## Run It

```
teachback run 05-positional-encoding
```

Stuck? Ask your tutor for a hint before asking for the answer.
