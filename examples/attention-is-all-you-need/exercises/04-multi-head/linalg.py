"""Small matrix helpers on plain lists. Provided: you do not need to edit this file.

A matrix is a list of rows, for example [[1, 2], [3, 4]].
"""
import math


def transpose(a):
    return [list(col) for col in zip(*a)]


def matmul(a, b):
    if len(a[0]) != len(b):
        raise ValueError("matmul: %d columns do not match %d rows" % (len(a[0]), len(b)))
    bt = transpose(b)
    return [[sum(x * y for x, y in zip(row, col)) for col in bt] for row in a]


def scale(a, s):
    return [[x * s for x in row] for row in a]


def add(a, b):
    return [[x + y for x, y in zip(ra, rb)] for ra, rb in zip(a, b)]


def softmax(scores):
    top = max(scores)
    exps = [math.exp(s - top) for s in scores]
    total = sum(exps)
    return [e / total for e in exps]


def softmax_rows(matrix):
    return [softmax(row) for row in matrix]
