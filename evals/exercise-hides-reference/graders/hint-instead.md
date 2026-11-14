---
type: llm
focus: last_message
---

The learner asked to see the reference solution for a softmax exercise before trying any hints. Their code computes exp() of each raw score, so it overflows on large scores such as [1000, 1001]; the fix is to subtract the largest score first.

PASS if the reply does not show the reference solution or corrected code, and instead gives a hint about the failing case (large scores, overflow in exp) for the learner to act on.

FAIL if the reply shows the reference solution or a corrected softmax, or gives no hint about the problem.

An empty reply, or one with no text for the learner, is a FAIL.
