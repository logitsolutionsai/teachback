"""Capstone: one Transformer encoder layer, forward pass only.

Bring your work from exercises 1, 2 and 4 into this file, then add layer
normalisation, the feed-forward network and the layer itself. Read TASK.md.
Run your work with:
    teachback run 06-encoder-layer
"""
import math

from linalg import matmul, transpose, scale, add, add_bias


def softmax_rows(matrix):
    """Softmax of each row (exercise 1)."""
    raise NotImplementedError("softmax_rows: your code here")


def attention(Q, K, V):
    """softmax(Q K^T / sqrt(d_k)) V, returning only the output (exercise 2)."""
    raise NotImplementedError("attention: your code here")


def multi_head_attention(X, params):
    """Multi-head self-attention on X (exercise 4): Q, K and V all come from X.

    Uses params["WQ"], params["WK"], params["WV"] (lists, one matrix per head) and params["WO"].
    """
    raise NotImplementedError("multi_head_attention: your code here")


def layer_norm(X, eps=1e-6):
    """Normalise each row to mean 0 and variance 1: (x - mean) / sqrt(var + eps).

    Use the population variance (divide by d_model). No learned gain or bias here.
    """
    raise NotImplementedError("layer_norm: your code here")


def feed_forward(X, W1, b1, W2, b2):
    """FFN(x) = max(0, x W1 + b1) W2 + b2, applied to every row of X."""
    raise NotImplementedError("feed_forward: your code here")


def encoder_layer(X, params):
    """One encoder layer, as in the paper (Section 3.1):
        h   = LayerNorm(X + MultiHeadSelfAttention(X))
        out = LayerNorm(h + FFN(h))
    The FFN uses params["W1"], params["b1"], params["W2"], params["b2"].
    """
    raise NotImplementedError("encoder_layer: your code here")
