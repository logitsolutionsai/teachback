# A Tutoring Exchange

An example session on the attention course, a few answers in. The dialogue is written for the README; the commands are real and their output is shown as printed (the command is `node scripts/teachback.mjs`, written `teachback` here).

```
$ teachback next
Learn "Scaled dot-product attention" (mastery estimate 20%). Activity: socratic.
  Source: section 3.2.1, 3.2.1 footnote 4
  Item sdpa-formula (mcq): Which expression is the paper's scaled dot-product attention?
  ...
  Why: New concept: open with a Socratic question before any explanation, then use the suggested item.
```

> **Claude:** Section 3.2.1 divides the attention scores by √d_k. Before we look at why: if every component of a query q and a key k has mean 0 and variance 1, and d_k is 64, what is the variance of q·k?
>
> **You:** 1. Each part has variance 1.
>
> **Claude:** Each product has variance 1, yes. But q·k adds up 64 of those products. What happens to variances when you add independent things?
>
> **You:** They add. So 64.
>
> **Claude:** How sure are you, from 1 to 4?
>
> **You:** 3.

You got there after one hint, so Claude records a partial result:

```
$ teachback record sdpa-variance --result partial --confidence 3 --note "needed one nudge: variances add"
Recorded partial on sdpa-variance (learn).
  Scaled dot-product attention: mastery estimate 20% -> 51%
  next review of this item: 2026-03-03 (in 1 day)
```

One multiple-choice question later, the plan moves to a teach-back:

```
$ teachback next
Learn "Scaled dot-product attention" (mastery estimate 79%). Activity: teachback.
  Item sdpa-teachback (teachback): Explain to a friend why we divide by √d_k in scaled dot-product attention. Use the variance argument.
```

> **Claude:** Explain to a friend why we divide by √d_k. Use the variance argument.
>
> **You:** Each dot product adds up d_k terms, so its variance is d_k and the scores get bigger as d_k grows. Big scores push softmax towards one-hot, where the gradients are tiny. Dividing by the square root of d_k brings the variance back to 1.

Claude checks the answer against the rubric, reads it, and decides:

```
$ teachback grade sdpa-teachback --answer "Each dot product adds up d_k terms, ..."
Rubric coverage 3/3 required ideas (needs 2). Suggestion only: correct.
  [x] A dot product of d_k unit-variance components has variance d_k  (matched "variance dk" in "variance is dk")
  [x] Dividing by √d_k brings the variance back to 1  (matched "variance 1" in "variance back to 1")
  [x] Otherwise softmax saturates and gradients become tiny  (matched "tiny gradient" in "gradients are tiny")

$ teachback record sdpa-teachback --result correct --confidence 3
Recorded correct on sdpa-teachback (learn).
  Scaled dot-product attention: mastery estimate 79% -> 99%  (mastered)

$ teachback next
Rebuild: exercise 02-scaled-dot-product, "Scaled dot-product attention".
  Read exercises/02-scaled-dot-product/TASK.md, edit work/02-scaled-dot-product/attention.py, then: teachback run 02-scaled-dot-product
```

Now you write the code.

Back to the [README](../README.md).
