"""Exercise 5: sinusoidal positional encoding.

Fill in both functions. Read TASK.md first. Run your work with:
    teachback run 05-positional-encoding
"""
import math


def positional_encoding(n_positions, d_model):
    """Return an n_positions x d_model matrix with
        PE[pos][2i]     = sin(pos / 10000 ** (2i / d_model))
        PE[pos][2i + 1] = cos(pos / 10000 ** (2i / d_model))
    Raise ValueError if d_model is odd.
    """
    raise NotImplementedError("positional_encoding: your code here")


def add_positional_encoding(X):
    """Return X + PE for an n x d_model matrix X (a new matrix; X is not changed)."""
    raise NotImplementedError("add_positional_encoding: your code here")
