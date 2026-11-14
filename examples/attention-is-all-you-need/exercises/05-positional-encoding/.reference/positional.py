"""Reference solution for exercise 5. The tutor shows this only on request."""
import math


def positional_encoding(n_positions, d_model):
    if d_model % 2:
        raise ValueError("d_model must be even")
    pe = []
    for pos in range(n_positions):
        row = []
        for i in range(d_model // 2):
            angle = pos / 10000 ** (2 * i / d_model)
            row.extend([math.sin(angle), math.cos(angle)])
        pe.append(row)
    return pe


def add_positional_encoding(X):
    pe = positional_encoding(len(X), len(X[0]))
    return [[x + p for x, p in zip(rx, rp)] for rx, rp in zip(X, pe)]
