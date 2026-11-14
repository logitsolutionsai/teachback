"""Reference solution for exercise 3. The tutor shows this only on request."""
import math

from linalg import matmul, transpose, scale, add, softmax_rows

NEG_INF = float("-inf")


def causal_mask(n):
    return [[0.0 if j <= i else NEG_INF for j in range(n)] for i in range(n)]


def masked_attention(Q, K, V, mask):
    d_k = len(K[0])
    scores = scale(matmul(Q, transpose(K)), 1.0 / math.sqrt(d_k))
    weights = softmax_rows(add(scores, mask))
    return matmul(weights, V), weights
