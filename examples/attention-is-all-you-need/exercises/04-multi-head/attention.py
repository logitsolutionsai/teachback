"""Scaled dot-product attention (the answer to exercise 2), provided so this exercise stands alone."""
import math

from linalg import matmul, transpose, scale, softmax_rows


def attention(Q, K, V):
    d_k = len(K[0])
    weights = softmax_rows(scale(matmul(Q, transpose(K)), 1.0 / math.sqrt(d_k)))
    return matmul(weights, V), weights
