# Learner Model

The learner model answers three questions: how likely is it that the learner knows each concept, which items should be reviewed today, and does the learner's confidence match their accuracy. It is deterministic: the same event log always gives the same state, and nothing reads the real date except through an injectable clock (`--now`, `TEACHBACK_NOW`). Code: `src/model/`. Tests with hand-worked numbers: `tests/model.test.mjs`.

## Mastery: Bayesian Knowledge Tracing

Each concept has one hidden state, known or not known, and the model tracks P(L), the probability it is known.

| Parameter | Default | Meaning |
| --- | --- | --- |
| `pInit` | 0.2 | P(L) before any evidence (per concept override: `pInit` in map.json) |
| `pLearn` | 0.15 | Chance of learning the concept at each practice opportunity |
| `pSlip` | 0.1 | Base chance of answering wrongly while knowing it |
| guess | by type | Chance of answering correctly without knowing it |
| `masteryThreshold` | 0.95 | P(L) at or above this counts as mastered |
| `pMax` | 0.99 | P(L) never goes above this |

Base guess rates: mcq `1 / number of options`, numeric 0.05, short 0.1, teachback 0.05, code 0.02.

### Item Difficulty

Difficulty runs from 1 (easy) to 5 (hard), with 3 neutral. With `f = (difficulty - 3) / 2`:

```
slip  = clamp(pSlip * (1 + f/2), 0.01, 0.3)
guess = clamp(baseGuess * (1 - f/2), 0.01, 0.5)
```

Hard items slip more and are guessed less; easy items the reverse. A four-option mcq at difficulty 5 has slip 0.15 and guess 0.125; at difficulty 1, slip 0.05 and guess 0.375. An item can set `pSlip` and `pGuess` directly.

### The Update

For a result with score `s` (correct 1, partial 0.5, wrong 0):

```
P(L | correct) = P(L)(1 - slip) / [P(L)(1 - slip) + (1 - P(L)) guess]
P(L | wrong)   = P(L) slip / [P(L) slip + (1 - P(L))(1 - guess)]
posterior      = s * P(L | correct) + (1 - s) * P(L | wrong)
P(L) next      = min(pMax, posterior + (1 - posterior) * pLearn)
```

Partial credit is the score-weighted mix of the two classic posteriors.

### Worked Example

A four-option mcq at difficulty 3 (slip 0.1, guess 0.25), starting from P(L) = 0.2:

- Correct: 0.18 / (0.18 + 0.2) = 0.4737, then 0.4737 + 0.5263 × 0.15 = **0.5526**.
- Wrong: 0.02 / (0.02 + 0.6) = 0.0323, then 0.0323 + 0.9677 × 0.15 = **0.1774**.
- Partial: 0.5 × 0.4737 + 0.5 × 0.0323 = 0.2530, then 0.2530 + 0.7470 × 0.15 = **0.3650**.

Two correct teach-backs (slip 0.1, guess 0.05) from 0.2 give 0.8455 and then 0.9915, capped to 0.99: mastered on the second.

### Why The Cap

Without a cap, P(L) creeps toward 1 after a run of correct answers, and then a failed review barely moves it: from 0.999 it takes three straight wrong answers on a four-option mcq to drop below 0.95, and from 0.9999 it takes four. Capping at 0.99 keeps one percent of doubt, so one clear failure on a review is noticed (0.99 drops to about 0.94 after a wrong mcq) and one correct answer restores it. This is a deliberate departure from textbook BKT.

### Pretest Placement

A pretest answer is measurement, not teaching, so it uses no learning transition (`pLearn = 0`). A correct pretest answer given with confidence 3 or 4 places the learner out of the concept: P(L) is set to 0.95 (`placementMastery`), which counts as mastered. The item is still scheduled for review, so the placement is re-checked within days.

### Exercises As Evidence

Failing runs are practice and change nothing. The first passing run of an exercise counts once as a correct answer for every `code` item that points at it. Code items are not scheduled for review.

## Spaced Review: SM-2 Lite

Every non-code item that has been answered has a schedule: `reps`, `ease` (start 2.5, range 1.3 to 3.0), `interval` in days, `lapses` and `dueDay`. Days are calendar days at the learner's fixed UTC offset; an item is due when today is on or after `dueDay`.

| Result | Rule |
| --- | --- |
| correct | `reps + 1`; interval 1 day after the first success, 3 after the second, then `round(interval × ease)`; ease + 0.1 unless confidence was 1 or 2 |
| correct, but before the due day | No change. Cramming cannot stretch intervals |
| partial | Interval halved (at least 1 day); ease - 0.15; reps unchanged |
| wrong | Interval 1 day; reps reset to 0; ease - 0.2; a lapse is counted if the item had been recalled before |

The interval uses the ease from before the answer. Worked example, first answer on 1 January, all correct and confident: due 2 January (ease 2.6), then 5 January (ease 2.7), then 13 January (`round(3 × 2.7) = 8` days, ease 2.8), then 4 February (`round(8 × 2.8) = 22` days). A wrong answer on 13 January resets to 14 January and counts one lapse.

This differs from classic SM-2 in three ways, all on purpose: the second interval is 3 days instead of 6 (study material is new, not flashcards already learned), partial answers halve the interval instead of passing, and early correct answers are ignored for scheduling.

## Confidence Calibration

Each answer can carry a confidence rating, which claims a probability of being right:

| Rating | Label | Claims |
| --- | --- | --- |
| 1 | Guessing | 0.25 |
| 2 | Unsure | 0.50 |
| 3 | Fairly sure | 0.75 |
| 4 | Certain | 0.95 |

Over a set of rated answers: `bias = mean claimed - mean score` (partial scores 0.5) and `Brier = mean((claimed - score)²)`. With at least 3 rated answers, bias above 0.1 is **overconfident**, below -0.1 is **underconfident**, otherwise **calibrated**; with fewer it is **not enough data**. The model reports this overall, per concept, and per confidence level (for the dashboard chart).

Example: certain three times and right once gives claimed 0.95, accuracy 0.333, bias 0.617 (overconfident), Brier 0.6025.

## What To Do Next

`teachback next` applies these rules in order:

1. **Due reviews**, oldest due day first, then in prerequisite order.
2. **A ready exercise**: the first unpassed exercise on the track whose concepts are all mastered and which is unlocked (every prerequisite of its concepts mastered, every earlier exercise passed). Rebuilding what was just learned comes before new material.
3. **The frontier concept**: the first concept, in prerequisite order, that is not mastered and whose prerequisites all are. The activity depends on its state:
   - never practised: a **Socratic** opening question, then the suggested item;
   - P(L) below 0.7: an **item** (unseen items first, easiest first; then ones last answered wrongly; then the least recently seen);
   - no successful teach-back yet: a **teachback** item;
   - a linked exercise is unlocked: the **exercise**;
   - otherwise one more item.
4. **The rest of the track**, once every concept is mastered.
5. **Rebuilt** (or complete, for a course with no capstone): only reviews remain.

The capstone stays locked until every concept it does not itself practise is mastered, so it is always the last step. A concept with an unmastered prerequisite is never suggested; `tests/next.test.mjs` checks this on 300 random learner histories.

## Rebuilt

The course is **Rebuilt** at the first moment both are true: the capstone has passed and every concept is mastered. The time is stored as `rebuiltAt` and stays, even if a later review drops a concept below the threshold: it records an achievement, and reviews carry on.

The order does not matter. A learner may run the capstone before `next` offers it; until every concept is mastered, `run` adds a note (`note` and `unmastered` in `--json`) that the pass is kept but the course is not Rebuilt yet. When the last concept is mastered later, that answer's time becomes `rebuiltAt`.

`status --json` lists the concepts first mastered today, and still mastered, in `concepts.masteredToday`, and each concept's `firstMasteredAt`, for the end-of-session summary.

## Limits Of The Model

- P(L) is an estimate from a simple model, not a grade or a test score.
- BKT assumes one skill per item and no forgetting between sessions; forgetting is handled by the review schedule instead.
- The default parameters are reasonable starting values, not fitted to data. Courses can override them in `course.json`.
- Short-answer and teach-back results are the tutor's judgement. The rubric coverage that `grade` reports is evidence for that judgement, not the verdict.
