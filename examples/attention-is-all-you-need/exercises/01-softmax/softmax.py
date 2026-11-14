"""Exercise 1: softmax.

Fill in both functions. Read TASK.md first. Run your work with:
    teachback run 01-softmax
"""
import math


def softmax(scores):
    """Turn a list of scores into weights.

    The weights are non-negative, sum to 1, and keep the order of the scores.
    Must not overflow for large scores such as [1000.0, 1001.0], and must give
    a weight of exactly 0 to a score of float("-inf") (exercise 3 relies on it).
    """
    raise NotImplementedError("softmax: your code here")


def softmax_rows(matrix):
    """Apply softmax to each row of a matrix (a list of lists)."""
    raise NotImplementedError("softmax_rows: your code here")
