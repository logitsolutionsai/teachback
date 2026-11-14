# Authoring Guide

How to turn a source (a paper, a chapter, a long explainer) into a teachback course that passes `teachback check`. `TB` stands for `node "<skill folder>/scripts/teachback.mjs"`. `examples/attention-is-all-you-need/` is the reference course; copy its patterns.

## 1. Read The Source First

Read the whole source before writing anything. Note, with section numbers: the problem it solves, each mechanism, the key equations, the numbers that matter (sizes, hyperparameters, results), the stated reasons for design choices, and what the authors compare against. Note the licence: arXiv papers are usually readable but not redistributable, so the course cites sections and never copies text. Formulas and short phrases are fine; paragraphs are not.

## 2. Scaffold

```
TB init <slug> --title "<title>" --source <url or citation> --language python
```

Then edit `course.json`: add `authors`, `year`, `venue` and a `licence` note that says the source is not included and the course cites sections.

## 3. The Concept Map

Draft 8 to 20 concepts for a paper. A short source (a blog post, a few pages of notes) may hold only four to seven; never pad a map to reach eight. A concept is one idea a learner can be tested on and can explain in a few sentences. Good: "Scaled dot-product attention", "Masking future positions". Too big: "The Transformer". Too small: "The value of d_k".

- **Prerequisites** are hard requirements: B lists A only if B cannot be understood without A. Keep the map shallow and wide; long chains make the learner wait. `check` rejects cycles and names the loop.
- **Summaries** are one paragraph, under 160 words, in your own words, with every number checked against the source. A wrong number in a summary teaches a wrong number.
- **Sources** cite the exact section, table, figure or equation for every concept.
- **Misconceptions** list the mistakes learners really make. Write them as the wrong belief plus the correction: "Divides by d_k instead of its square root."
- **Names** stay short (about 40 characters): they label the dashboard map.

## 4. Items

At least 3 items per concept, at least 2 types, and one teach-back. Aim for 3 to 5. Mix difficulty 1 to 4.

### Multiple Choice (`mcq`)

Good options are plausible mistakes, each tied to a misconception, each with a rationale.

Good:

```json
{ "prompt": "To stop position 2 attending to position 4 in decoder self-attention, what does the paper do?",
  "options": [
    { "text": "Set that weight to 0 after the softmax", "rationale": "The other weights would no longer sum to 1; the paper masks the score before the softmax." },
    { "text": "Set that score to minus infinity before the softmax", "rationale": "Correct. exp(-inf) = 0, so the weight is exactly 0 (Section 3.2.3)." },
    { "text": "Set that score to 0 before the softmax", "rationale": "A score of 0 still gets weight." }
  ], "answer": 1 }
```

Bad: `"Which is true about masking? A. It is important B. It is used in Transformers C. All of the above"`. The options test reading, not understanding, and "all of the above" is guessable.

### Numeric (`numeric`)

Ask for a number the learner computes or must know, with a tolerance that accepts rounding but not a wrong method.

Good: "With d_model = 4, compute PE(pos = 1, dimension 2) = sin(1 / 10000^(2/4)). Give 4 decimal places." (answer 0.01, tolerance 0.0001)

Bad: "How many authors does the paper have?" Trivia is not a concept.

### Short Answer (`short`)

One focused question with 1 to 3 required ideas.

Good: "Why does the paper divide the dot products by √d_k?" with required ideas "dot products grow with d_k" and "softmax saturates, gradients become tiny", and the misconception "the scaling is for speed".

Bad: "Explain attention." Too broad for a short answer; that is a teach-back.

### Teach-Back (`teachback`)

"Explain to a friend ..." prompts that ask for the whole idea and its reason. Two to four required ideas, `minRequired` one or two below the total for partial credit, and a `modelAnswer` in plain words.

### Rubric Synonyms

A required idea matches when the key words of one of its synonyms appear close together in one clause of the answer, in any order, with word endings ignored (the full rules are in `format.md`, "How Rubric Matching Works"). So list different *wordings*, not different word orders or endings:

Good: `["grow large", "variance dk", "too big", "magnitude grows"]`. One entry covers "grows large", "growing very large" and "large growth".

Wasted: `["gradients are tiny", "gradients become tiny", "tiny gradients", "gradient is tiny"]`. These are one synonym, `"tiny gradient"`, four times.

- Keep each synonym to its two or three telling words. Every key word must appear, so `"the weights are decided by comparing each key"` is harder to hit than `"decide weights"`.
- Avoid one-word synonyms that also turn up in wrong answers. `"content"` alone matches any answer that says "content".
- Write `d_k` as `dk` or `d_k`, `√` as `√` or `sqrt`, numbers as digits or words: they normalise the same.
- **Negative ideas.** If the idea is itself a negative statement ("the decoder must not see later positions", "a Bloom filter never gives a false negative", "only attention moves information between positions"), add `"polarity": "negative"`. Learners say these with "not", "never" or "cannot", and by default a negator next to a match flags it. With the polarity set, the negation is expected and the match counts. Give such ideas synonyms that carry the sense ("future", "later positions", "peek").
- **Misconceptions** match as exact phrases (after normalising and stemming), never by scattered key words, so a right answer that shares their words does not trigger them. Make them specific ("for speed", "divided by dk"); generic words ("faster") also appear in correct answers.

The tutor reads every match as evidence, not a verdict. `check` warns (W112) when a model answer does not meet its own rubric: fix the synonyms until it does.

## 5. The Rebuild Track

3 to 6 exercises, each rebuilding one mechanism, ending in a capstone that assembles them. If the source has nothing to implement, or the learner asks for no exercises, scaffold with `--language none` and skip this section: the course is then complete when every concept is mastered.

- **Standard library only** for shipped courses: Python `unittest` and plain lists, or JavaScript `node:test`.
- **Hand-checkable tests**: small inputs whose answers a learner can work out on paper, such as softmax of `[0, ln 3]` is `[0.25, 0.75]`. Add property tests that teach (rows sum to 1, masked weights are exactly 0, swapping inputs only swaps outputs).
- **Starters** define every function with a docstring and raise `NotImplementedError` (or throw), so they import cleanly and fail fast.
- **Support files** hold helpers that are not the point of the exercise (matrix multiply, a working answer from an earlier step) so each exercise stands alone.
- **TASK.md** says what to build, cites the section, lists what the tests expect in plain words, and ends with the run command.
- **The reference** goes in `.reference/<starter>`. `check` runs it (must pass) and the starter (must fail).
- Mark the capstone with `"capstone": true` and list the exercises in order in `course.json` `track`.
- Add one `code` item per exercise, on the concept it practises.

## 6. Check Until Clean

```
TB check <slug>
```

Fix every error; each comes with a code and a fix hint. Warnings (no teach-back item, no misconceptions, long summary, a model answer its own rubric does not credit) are worth fixing too. `TB check --codes` lists every code. Then dry-run a session yourself: `TB next`, answer a few items with `TB grade`, `TB run` an exercise, `TB dashboard`.

## Checklist

- [ ] Every number in every summary matches the source.
- [ ] No passage of the source is copied; formulas and short phrases only.
- [ ] 8 to 20 concepts (fewer for a short source), a DAG, each with sources and misconceptions.
- [ ] At least 3 items and 2 types per concept, including a teach-back.
- [ ] Every mcq option has a rationale; every rubric idea has synonyms in different wordings; negative ideas have `"polarity": "negative"`.
- [ ] 3 to 6 exercises ending in a capstone, or none with `--language none`; references pass, starters fail.
- [ ] `TB check` prints `OK: no errors.`
