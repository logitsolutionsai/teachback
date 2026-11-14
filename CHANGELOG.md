# Changelog

## 0.1.0 (2026-11-14)

First release.

### Skill

- `SKILL.md` with two flows: build a course from a source, and tutor Socratically with a hint ladder, teach-backs and a record for every item.
- Each item is recorded once, when it settles: `correct` first time, `partial` after a hint, `wrong` after the full explanation, when the learner asks for the answer, or when the session ends mid-ladder. A wrong first try is not recorded on its own, so one mistake never counts twice.
- A learner who asks for the answer gets it at once, with its reason. A learner who asks for an exercise's reference before the hint ladder gets the test results and a first hint; a hint names the problem, never the corrected line.
- Teach-backs: the tutor says nothing but "carry on" while the learner pauses, then names one strength and exactly one gap.
- The end-of-session summary names the concepts mastered today, from `status`.
- Course building allows fewer than eight concepts for a short source, and no exercises (`--language none`) when there is nothing to implement.
- References: tutoring protocol, authoring guide with good and bad items, course format, learner model.
- Claude Code plugin and marketplace manifests in `.claude-plugin/`.

### Behaviour Evals

- `evals/`: ten cases for `claude plugin eval` covering a session start, a wrong answer, a right answer after a hint, a request for the answer, a teach-back pause and its feedback, a request for the reference, a short-answer paraphrase, the end of a session, and building a course from a short original source. Each case scaffolds a learner project with real history, sends one scripted learner turn, and grades the commands run, `learner.json`, the files written and the reply; every case also runs without the plugin.
- The suite has not been run yet: it was written on Windows, where `claude plugin eval` refuses shell tools for want of a sandbox. The README gives the commands for macOS, Linux and WSL2.
- `tests/evals.test.mjs` checks the suite without a model: every case loads, every scaffold builds the state its case expects, and every file and regex grader passes on a right tutor action and fails on a wrong one.

### Command-Line Tool

- The entry point is `scripts/teachback.mjs` (claude.ai and Cowork do not install a plugin with a top-level `bin/` folder). The npm command is `teachback`.
- `init` (from scratch or `--from` an existing course), `use`, `list`.
- `check` with error codes and fix hints: schemas, a DAG with cycles named, prerequisites, source references, items per concept, rubrics, mcq answers, exercise files, duplicate exercise ids (E043), a track that repeats an exercise (E044), an exercise that practises no concept (W123), and a model answer its own rubric does not credit (W112). `verify-exercises` runs every reference (must pass) and starter (must fail) with a timeout, with a clear hint when tests pass on the starter.
- `next`, `pretest`, `show`, `grade` (mcq and numeric graded; rubric coverage for short answers), `record`, `run` (Python and JavaScript, timeouts, a throwaway working folder).
- Rubric coverage is deterministic and dependency-free. Answer and synonyms are normalised the same way (case, accents, punctuation, symbols, Greek letters, number words, hyphenated compounds) and stemmed by a documented rule set. A required idea matches when its key words appear close together in one clause, in any order; misconceptions match as phrases, so a right answer that shares their words does not trigger them. Negators ("not", "never", "cannot", "without", ...) are scoped, a negator written in the synonym counts as part of it, and an idea may declare `"polarity": "negative"` so that a negation is expected rather than flagged. Each match reports the learner's own words. On the paraphrase table in `tests/fixtures/paraphrases.mjs`, the earlier phrase-only matcher credited 2 of 20 paraphrases and the new one credits 20 of 20; both reject all 8 near-misses and 5 negations; 5 known limits (wrong answers that use the right words) are pinned, of which the phrase-only matcher was fooled by 3.
- `run` on the capstone before every concept is mastered says that a pass is kept but does not make the course Rebuilt yet (`note` and `unmastered` in `--json`).
- `status`, `dashboard` (one offline HTML file: concept map by mastery, progress over time, upcoming reviews, calibration, exercise board, Rebuilt badge; light and dark; phone width), `export --anki`. `status` reports `concepts.masteredToday` and each concept's `firstMasteredAt`.
- Every command takes `--json`, `help` and `--version` included.
- Answers, notes and other values that start with a dash (`--answer -0.5`) are read as values.
- Writes to `learner.json` take a lock, so concurrent `record` and `run` commands do not lose events. A broken event in a hand-edited `learner.json` is skipped with a warning; a wrong-typed `events` or UTC offset, or an invalid `TEACHBACK_UTC_OFFSET`, gives a clear error. If the system clock goes backwards, a new event is stamped at the last event's time, with a warning.
- Mastery shown as a percentage never reads 95% below the threshold; a concept whose prior is at the threshold counts as mastered.
- `record` refuses code items (pass the exercise instead). `show` without an id says so.
- Numbers: a decimal comma (`0,75`) is refused instead of read as 75; infinite values are refused.
- `run`: a solution that prints megabytes does not hide the test results; very long output lines are cut in the summary; `--timeout` is validated; `TEACHBACK_PYTHON` may be a full path with spaces.
- Dashboard: date labels on the progress chart do not overlap; a very large concept map scrolls instead of shrinking until it cannot be read.

### Learner Model

- Bayesian Knowledge Tracing per concept with difficulty-adjusted slip and guess, partial credit, a 0.95 mastery threshold, a 0.99 cap, pretest placement and exercise passes as evidence.
- Spaced review per item (SM-2 lite) on calendar days at a fixed UTC offset.
- Confidence calibration overall, per concept and per confidence level.
- Event-sourced `learner.json`: state is replayed from the event log on every write.
- The course is Rebuilt at the first moment the capstone has passed and every concept is mastered, in either order.

### Examples

- *Attention Is All You Need*: 12 concepts, 46 items, 6 Python exercises from softmax to an encoder-layer forward pass. Every model answer meets its own rubric; the capstone `TASK.md` says which signatures differ from exercises 2 and 4. Three negative-by-nature rubric ideas declare `"polarity": "negative"`.
- *Bloom Filters*: an original explainer, 6 concepts, 22 items, 3 JavaScript exercises. One negative-by-nature rubric idea declares `"polarity": "negative"`.
