"""Exercise 3: masking future positions.

Fill in both functions. Read TASK.md first. Run your work with:
    teachback run 03-masking
"""
import math

from linalg import matmul, transpose, scale, add, softmax_rows

NEG_INF = float("-inf")


def causal_mask(n):
    """Return an n x n mask: 0.0 where query i may attend to key j (j <= i), NEG_INF where j > i."""
    raise NotImplementedError("causal_mask: your code here")


def masked_attention(Q, K, V, mask):
    """Scaled dot-product attention with the mask added to the scaled scores before softmax.

    Return (output, weights), like exercise 2.
    """
    raise NotImplementedError("masked_attention: your code here")
