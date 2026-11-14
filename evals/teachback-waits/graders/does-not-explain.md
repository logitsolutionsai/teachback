---
type: llm
focus: last_message
---

The learner is explaining, from memory, why attention scores are divided by √d_k. They have said only that each score adds up d_k products, and have paused to think about what that does to the size of the scores.

PASS if the reply only encourages them to carry on (it may restate what they said so far) and gives none of the rest of the explanation.

FAIL if the reply says or strongly hints at any of these: that the variance or spread of the scores grows with d_k, that large scores make softmax saturate or its gradients small, or that dividing by √d_k brings the variance back to 1.

An empty reply, or one with no text for the learner, is a FAIL.
