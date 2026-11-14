"""Reference solution for the capstone. The tutor shows this only on request."""
import math

from linalg import matmul, transpose, scale, add, add_bias


def softmax_rows(matrix):
    out = []
    for row in matrix:
        top = max(row)
        exps = [math.exp(x - top) for x in row]
        total = sum(exps)
        out.append([e / total for e in exps])
    return out


def attention(Q, K, V):
    d_k = len(K[0])
    weights = softmax_rows(scale(matmul(Q, transpose(K)), 1.0 / math.sqrt(d_k)))
    return matmul(weights, V)


def multi_head_attention(X, params):
    heads = [attention(matmul(X, WQ), matmul(X, WK), matmul(X, WV)) for WQ, WK, WV in zip(params["WQ"], params["WK"], params["WV"])]
    concat = [sum((head[r] for head in heads), []) for r in range(len(X))]
    return matmul(concat, params["WO"])


def layer_norm(X, eps=1e-6):
    out = []
    for row in X:
        mean = sum(row) / len(row)
        var = sum((x - mean) ** 2 for x in row) / len(row)
        out.append([(x - mean) / math.sqrt(var + eps) for x in row])
    return out


def feed_forward(X, W1, b1, W2, b2):
    hidden = [[max(0.0, x) for x in row] for row in add_bias(matmul(X, W1), b1)]
    return add_bias(matmul(hidden, W2), b2)


def encoder_layer(X, params):
    h = layer_norm(add(X, multi_head_attention(X, params)))
    return layer_norm(add(h, feed_forward(h, params["W1"], params["b1"], params["W2"], params["b2"])))
