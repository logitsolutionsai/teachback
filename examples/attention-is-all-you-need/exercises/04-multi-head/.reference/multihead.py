"""Reference solution for exercise 4. The tutor shows this only on request."""
from linalg import matmul
from attention import attention


def concat_heads(heads):
    return [sum((head[r] for head in heads), []) for r in range(len(heads[0]))]


def multi_head_attention(Xq, Xkv, params):
    heads = []
    for WQ, WK, WV in zip(params["WQ"], params["WK"], params["WV"]):
        out, _ = attention(matmul(Xq, WQ), matmul(Xkv, WK), matmul(Xkv, WV))
        heads.append(out)
    return matmul(concat_heads(heads), params["WO"])
