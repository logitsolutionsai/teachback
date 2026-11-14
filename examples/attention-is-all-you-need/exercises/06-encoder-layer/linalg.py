"""Small matrix helpers on plain lists. Provided: you do not need to edit this file.

A matrix is a list of rows, for example [[1, 2], [3, 4]]. Softmax is not here on
purpose: the capstone asks you to bring your own.
"""


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


def add_bias(a, bias):
    return [[x + b for x, b in zip(row, bias)] for row in a]
