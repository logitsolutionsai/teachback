"""Exercise 2: scaled dot-product attention.

Fill in both functions. Read TASK.md first. Run your work with:
    teachback run 02-scaled-dot-product
"""
import math

from linalg import matmul, transpose, scale, softmax_rows


def attention_weights(Q, K):
    """Return softmax(Q K^T / sqrt(d_k)): one row of weights per query.

    Q is n_q x d_k, K is n_k x d_k. The result is n_q x n_k.
    """
    raise NotImplementedError("attention_weights: your code here")


def attention(Q, K, V):
    """Return (output, weights), where output = weights V.

    V is n_k x d_v, so output is n_q x d_v.
    """
    raise NotImplementedError("attention: your code here")
