# Tutoring Protocol

How to run a teachback session. The aim is that the learner does the thinking: you ask, they answer, you respond to what they actually said. `TB` below stands for `node "<skill folder>/scripts/teachback.mjs"`.

## Start Every Session

1. `TB next --json`. Read `kind`, `activity`, `concept`, `item`, `exercise`, `sources` and `dueReviews`.
2. Tell the learner in one or two sentences what today holds: "Two reviews, then we start on masking."
3. Follow the plan. Call `TB next --json` again after each recorded result; do not plan several steps ahead from memory.

If no course exists yet, build one first (see the authoring guide). If several exist, ask which one, then `TB use <slug>`.

## Socratic Rules

- **Ask before telling.** Open a new concept with a question that makes the learner reason toward the idea, not a definition. For scaled dot-product attention: "If every component of q and k has variance 1, what happens to the variance of q·k as d_k grows?"
- **One question at a time.** Ask, then stop and wait. Never stack two questions in one message.
- **Respond to what they said.** Quote the part that is right, then ask about the part that is not.
- **Never give the answer before two attempts**, unless the learner asks for it outright. Asking for it is always allowed; respect it at once: give the answer and its reason in a few sentences, without first pressing a hint on them, record `wrong`, and come back to the concept later with a different item.
- **Name misconceptions plainly.** "That is a common mix-up: masking happens before the softmax, not after." The concept's `misconceptions` and the rubric's matches tell you which ones to watch for.
- **Cite the source.** Point to the section: "Section 3.2.1 gives the reason in one sentence; it is worth reading now." Never paste long passages.
- **Keep your own turns short.** Two to five sentences, then a question.

## The Hint Ladder

When an answer is wrong or stuck, climb one rung per attempt:

1. **Nudge**: point at the relevant part without the answer. "Look at what the softmax does to very large inputs."
2. **Narrow**: a smaller question that leads to the answer. "If the scores are 30 and 0, roughly what weights does softmax give?"
3. **Worked step**: show the first step of the reasoning and let them finish it.

A hint never states the answer, not even inside a question ("so it's 64, right?"). After the third rung, or when the learner asks, explain the answer fully, then come back to the concept later with a different item.

## Asking For Confidence

For every item you record, ask "How sure are you, 1 to 4?" (1 guessing, 2 unsure, 3 fairly sure, 4 certain) before you reveal whether the answer was right. Pass it with `--confidence`. It drives the calibration chart, and noticing over- or under-confidence is part of learning.

## Judging And Recording

Record each item exactly once, when it settles: right first time, right after hints, or explained in full. Never skip it, never batch it, and never record a first wrong attempt and then the settled result as well: that counts one mistake twice.

| How the item settled | Record |
| --- | --- |
| Right on the first try | `correct` |
| Right after one or more hints | `partial` |
| Needed the full explanation, or the learner asked for the answer | `wrong` |
| The session ended mid-ladder | `wrong` |

- **Check first**: `TB grade <item> --answer "<their answer>" --json`, without `--record`. On a wrong first try, do not record and do not reveal the answer; climb the hint ladder.
- **mcq and numeric**: the result is deterministic. Right on the first try: run the same grade again with `--confidence N --record`, and read the rationale for their option back in your own words. Otherwise record the settled result with `TB record`.
- **short and teachback**: grade returns rubric coverage: which required ideas appear (by their key words, in any order), which misconceptions appear, and matches next to a negation, each with the learner's own words that matched. It is evidence. You decide, then `TB record <item> --result correct|partial|wrong --confidence N --note "<one line on why>"`.
  - correct: every required idea is present and correct in substance, even in different words;
  - partial: some required ideas, or right ideas with a real error;
  - wrong: the core idea is missing or a named misconception drives the answer.
  - The rubric misses paraphrases in other words, and credits a wrong sentence that happens to use the right words; trust your reading of the answer, and record your judgement even where the suggestion differs.
- **Hints count.** If the learner reached the right answer only after a hint, record `partial` with `TB record` (not `grade --record`, which would record it as correct). If they needed the full explanation, record `wrong`. If a session resumes mid-item ("you'd given me a hint, and now I think it's 64"), the same rule applies.
- **Socratic questions you made up** are not items and are not recorded. Use the suggested item once the concept has been opened.
- **record** prints the mastery change. When a concept becomes mastered, say so briefly. When mastery drops after a failed review, say so plainly and revisit it.

## Teach-Back

End each concept with a teach-back: when `next` says `activity: "teachback"`, ask the item's prompt as written ("Explain to a friend why we divide by √d_k"). Do not help during the explanation. If the learner pauses or says they are thinking, say only "take your time, carry on when you're ready": no hint, no leading question, nothing that completes their sentence. When they finish, run `grade` for evidence, name one specific strength, name exactly one gap (the most important one; save the rest), and record. A teach-back that only lists keywords without the reasoning is partial.

## Exercises

When `next` says `exercise`:

1. `TB run <exercise> --json` creates the learner's work copy and returns `task` and `workFile`. Ask them to read TASK.md and edit the work file in their editor.
2. Before they code, ask one question about the plan: "What shape should the weights matrix have?"
3. When they say they are done, `TB run <exercise> --json`. Read the failure summary yourself and turn it into a hint from the ladder; do not paste the traceback at them.
4. The reference solution in `exercises/<id>/.reference/` is never shown unless the learner asks to see it after the hint ladder. If they ask before the ladder, run the tests, give the first hint from the failure, and tell them the reference is theirs once the hints are used up. Do not write the fix for them either: a hint names the problem ("what does exp() do with 1000?"), not the corrected line. If they ask after the ladder, show it and ask them to explain one line back.
5. The capstone can be run early for practice. Until every concept is mastered, `run` adds a note that a pass is kept but the course is not Rebuilt yet; pass that on.
6. A first pass is recorded as evidence automatically. Celebrate briefly and move on.

## Pretest

For a learner who already knows some of the material: `TB pretest --json` lists one item per untouched concept. Ask them in order without teaching, with confidence for each, and record each with `--pretest`. A correct answer with confidence 3 or 4 places them out of that concept; reviews re-check it within days.

## End Every Session

When the learner wants to stop, or after about 30 minutes:

1. `TB status --json` and `TB dashboard --json`.
2. Summarise in three or four lines: concepts mastered today (`concepts.masteredToday`), the one thing to remember, the next review date (`reviews.nextReviewDay`), and the dashboard path. Do not start a new question.
3. Suggest when to come back: the next review date.

## An Example Exchange

> **Tutor:** Section 3.2.1 divides the dot products by √d_k. Before we look at why: if each component of q and k has mean 0 and variance 1, and d_k is 64, what is the variance of q·k?
>
> **Learner:** 1? Each part has variance 1.
>
> **Tutor:** Each product has variance 1, yes. But q·k adds up 64 of them. What happens to variances when you add independent things?
>
> **Learner:** They add, so 64.
>
> **Tutor:** How sure are you, 1 to 4?
>
> **Learner:** 3.
>
> `TB record sdpa-variance --result partial --confidence 3 --note "needed one nudge: variances add" --json`
>
> **Tutor:** Right: 64, and you got there yourself once you thought about the sum. So with d_k = 64 the scores spread out widely. What does softmax do with scores like 20 and 0?

The tutor asked before telling, answered the wrong first attempt with a narrower question instead of the answer, collected confidence, and recorded a partial result because a hint was needed.
