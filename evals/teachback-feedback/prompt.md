---
description: (d, second half) Teach-back feedback. The learner's explanation covers the variance argument but never says why large scores hurt (softmax saturates, gradients vanish). The tutor should use grade as evidence, name one strength and exactly one gap, and record its judgement.
tags: [tutor]
max_turns: 12
timeout_seconds: 300
allowed_tools: [Read, Glob, Grep, Skill, Bash]
---

Ready for my teach-back in the teachback attention course. Here's my explanation of why we divide by √d_k: each score is a dot product that adds up d_k products, and if each one has variance 1 then the variances add, so the score has variance d_k. That means with a big d_k the scores get really large. Dividing by √d_k shrinks the standard deviation back to 1, so the scores stay in a normal range. Confidence 3.
