"""Exercise 4: multi-head attention.

Fill in both functions. Read TASK.md first. Run your work with:
    teachback run 04-multi-head
"""
from linalg import matmul
from attention import attention


def concat_heads(heads):
    """Join a list of h matrices (each n x d_v) side by side into one n x (h * d_v) matrix."""
    raise NotImplementedError("concat_heads: your code here")


def multi_head_attention(Xq, Xkv, params):
    """MultiHead(Q, K, V) = Concat(head_1, ..., head_h) W_O, with
    head_i = Attention(Xq WQ[i], Xkv WK[i], Xkv WV[i]).

    params is a dict with lists "WQ", "WK", "WV" (one d_model x d_k matrix per head)
    and "WO" (an (h * d_v) x d_model matrix). Return an n_q x d_model matrix.
    """
    raise NotImplementedError("multi_head_attention: your code here")
