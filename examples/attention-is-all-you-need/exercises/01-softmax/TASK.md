# Exercise 1: Softmax

Paper: Section 3.2.1 (attention weights) and Section 3.4 (output probabilities).

## Goal

Write `softmax(scores)`, which turns a list of scores into weights, and `softmax_rows(matrix)`, which does that for each row of a matrix. Every later exercise builds on this.

## What The Tests Expect

- The weights are non-negative and sum to 1.
- A larger score always gets a larger weight.
- Adding the same number to every score gives the same weights.
- `softmax([1000.0, 1001.0])` works (no overflow).
- A score of `float("-inf")` gets a weight of exactly `0.0`. Exercise 3 uses this for masking.
- The input list is not changed.

## Conventions

Plain Python lists, standard library only (`math` is enough). A matrix is a list of rows.

## Run It

```
teachback run 01-softmax
```

Stuck? Ask your tutor for a hint before asking for the answer.
