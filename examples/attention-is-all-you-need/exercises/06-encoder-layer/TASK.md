# Capstone: One Encoder Layer

Paper: Section 3.1 (encoder stack, residual connections, layer normalisation), Section 3.2 (attention), Section 3.3 (feed-forward network).

## Goal

Rebuild one complete Transformer encoder layer, forward pass only:

```
h   = LayerNorm(X + MultiHeadSelfAttention(X))
out = LayerNorm(h + FFN(h))
FFN(x) = max(0, x W1 + b1) W2 + b2
```

Bring in your own `softmax_rows`, `attention` and `multi_head_attention` from exercises 1, 2 and 4 (this file does not import them). Two signatures are simpler here, so adapt them as you paste:

- `attention(Q, K, V)` returns only the output matrix, not `(output, weights)` as in exercise 2.
- `multi_head_attention(X, params)` is self-attention: it takes `X` once and computes queries, keys and values all from it, instead of taking `Xq` and `Xkv` as in exercise 4.

Then write:

- `layer_norm(X, eps=1e-6)`: each row becomes `(x - mean) / sqrt(var + eps)`, using the population variance (divide by `d_model`). The paper's layer normalisation also has a learned gain and bias; they are left out here so the numbers stay hand-checkable.
- `feed_forward(X, W1, b1, W2, b2)`: two linear maps with a ReLU between, applied to every row.
- `encoder_layer(X, params)`: the two sub-layers, each wrapped as `LayerNorm(x + Sublayer(x))`.

`fixture_params.py` holds small fixed weights: `d_model = 4`, two heads of size 2, `d_ff = 8`. The paper's base model uses `d_model = 512`, 8 heads of size 64 and `d_ff = 2048`. Dropout is a training-time step and is left out.

## What The Tests Expect

- Each piece on a hand-checkable example.
- With all sub-layer weights set to zero, only the residual path is left, so the layer equals `LayerNorm(X)`.
- Every output row has mean 0 and variance 1.
- Swapping two input rows only swaps the output rows: the layer has no sense of order by itself.
- A full forward pass on the fixed weights matches the expected numbers.

When this passes and every concept is mastered, the course is Rebuilt.

## Run It

```
teachback run 06-encoder-layer
```

Stuck? Ask your tutor for a hint before asking for the answer.
