#!/usr/bin/env bash
# Softmax is mastered, so the plan is exercise 01-softmax. The learner's work copy
# has a classic bug: no max subtraction, so exp() overflows on large scores.
source "$(dirname "${BASH_SOURCE[0]//\//}")/../_shared/fixture.sh"
init_attention
answer_item softmax-weights 0.75
answer_item softmax-scale B
judge_item softmax-teachback correct
node "$PLUGIN_DIR/scripts/teachback.mjs" run 01-softmax >/dev/null   # creates the work copy, records nothing
cat > "$COURSE/work/01-softmax/softmax.py" <<'PY'
"""Exercise 1: softmax. My attempt."""
import math


def softmax(scores):
    exps = [math.exp(s) for s in scores]
    total = sum(exps)
    return [e / total for e in exps]


def softmax_rows(matrix):
    return [softmax(row) for row in matrix]
PY
