"""Reference solution for exercise 2. The tutor shows this only on request."""
import math

from linalg import matmul, transpose, scale, softmax_rows


def attention_weights(Q, K):
    d_k = len(K[0])
    scores = scale(matmul(Q, transpose(K)), 1.0 / math.sqrt(d_k))
    return softmax_rows(scores)


def attention(Q, K, V):
    weights = attention_weights(Q, K)
    return matmul(weights, V), weights
