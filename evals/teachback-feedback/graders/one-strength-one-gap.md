---
type: llm
focus: last_message
---

The learner explained why attention scores are divided by √d_k. The explanation covers the variance argument (variance d_k, scaled back to 1) but never says why large scores are a problem: they push softmax towards one-hot, where its gradients are tiny.

PASS if the reply (1) names at least one specific strength of the explanation, (2) names the missing point about why large scores are a problem as the gap, and (3) names no other gap.

FAIL if it names no strength, does not identify that gap, or lists two or more gaps.

An empty reply, or one with no text for the learner, is a FAIL.
