"""Reference solution for exercise 1. The tutor shows this only on request."""
import math


def softmax(scores):
    top = max(scores)
    if top == float("-inf"):
        raise ValueError("softmax needs at least one finite score")
    # Subtracting the maximum changes nothing mathematically and keeps exp() from overflowing.
    exps = [math.exp(s - top) for s in scores]
    total = sum(exps)
    return [e / total for e in exps]


def softmax_rows(matrix):
    return [softmax(row) for row in matrix]
