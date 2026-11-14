# Architecture

teachback is two things: a skill (`SKILL.md` and `references/`) that tells an assistant how to build courses and tutor, and a command-line tool (`scripts/teachback.mjs`) that does everything that should be deterministic. The assistant judges and talks; the tool stores, schedules, grades what can be graded, runs tests and draws the dashboard.

Node.js 20.11 or newer, ES modules, no runtime dependencies. The only development dependency is `playwright-core`, used by the dashboard end-to-end test with an installed Chrome.

## Layout

```
scripts/teachback.mjs    entry point: calls main() and sets the exit code
src/
  cli.mjs                argument parsing (node:util parseArgs) and the commands
  course.mjs             finding a course folder and loading its files
  check.mjs              validation and exercise verification, with error codes and fix hints
  schema.mjs             a small JSON Schema validator for the schemas in schema/
  graph.mjs              cycles, topological order, layers, and the layered map layout
  grade.mjs              mcq and numeric grading; rubric coverage for short answers (normalising,
                         stemming, key words in a window, negation and polarity; see references/format.md)
  runner.mjs             running exercise tests in a throwaway folder with a timeout
  harness/
    py_harness.py        unittest runner that prints one JSON result line
    js_reporter.mjs      node:test reporter that prints one JSON result line
  model/
    bkt.mjs              Bayesian Knowledge Tracing
    schedule.mjs         spaced review (SM-2 lite)
    calibration.mjs      confidence against accuracy
    learner.mjs          the learner record: replay of the event log
    next.mjs             what to do now
  status.mjs             the one status object behind `status --json` and the dashboard
  dashboard.mjs          the standalone HTML dashboard
  export.mjs             Anki CSV export
  util.mjs               errors, the injectable clock, JSON files, text helpers
  fluid.js               spring motion helper (brand kit), inlined into the dashboard and certificate
  repoquest-cli.mjs      the repo, quest and pack commands (RepoQuest; see docs/REPOQUEST.md)
  repo/
    git.mjs              the only git access, behind a replaceable runner (tests stub it)
    paths.mjs            relative-path rules for locks, refs, quests and pack entries
    ignore.mjs           default exclusions and .gitignore-style patterns
    symbols.mjs          lexical symbols and imports for JS/TS, Python, Go and Rust
    scan.mjs             the bounded scan, hashing, roles, links and licence guess
    source-lock.mjs      source-lock.json and .local-source.json
    verify.mjs           checking every sourceRef against the locked source
    rebase.mjs           drift proposals and confirmed application
    diff.mjs             unified diff parsing for review mode
  quest/
    schema.mjs           quests.json rules, the shared DAG, the argv command check
    state.mjs            quest-state.json, source state, suspended claims
    next.mjs             next with quests (wraps model/next.mjs, which is unchanged)
    workspace.mjs        scratch copies (and the optional git worktree)
    runner.mjs           the allowlist, --trust-local, timeout, output cap, environment
    commands.mjs         quest show, start, answer and run
    certificate.mjs      the evidence card
  pack/
    zip.mjs              deterministic ZIP writer and defensive reader (Node core only)
    pack.mjs             pack export, check and import
schema/                  JSON Schemas for course, map, items, exercise and learner files
references/              documents the skill loads when it needs them
examples/                shipped courses
tests/                   node:test suites; tests/e2e/ for the browser test
evals/                   behaviour cases for `claude plugin eval`: scaffolds, scripted learner turns, graders
evals/repoquest/         RepoQuest behaviour cases (same format; not run yet)
```

## Data Flow

```
course files ──┐
               ├─> replay() ──> derived state ──┬─> next (plan)
learner events ┘                                ├─> status ──> dashboard
                                                └─> written back into learner.json
```

**The event log is the source of truth.** `record`, `grade --record` and `run` append one event to `learner.json` and then call `replay()`, which recomputes every concept's P(L), every item's review schedule, exercise status, the per-day history and the Rebuilt time from scratch, and writes them next to the events. Consequences:

- The same events always give the same state; tests can build any state from a list of events.
- Changing a model parameter or editing a course changes the derived state on the next write, without migrating anything.
- Events for items that were removed from the course are skipped with a warning, not an error.

**The clock is injectable.** Every command takes `--now`, and `TEACHBACK_NOW` sets it for a whole process. Calendar days for reviews use a UTC offset fixed in `learner.json` when it is created (`TEACHBACK_UTC_OFFSET` overrides it). No code reads the real date for anything else, so every test is deterministic.

## Planning

`planNext()` in `src/model/next.mjs` is a pure function of the course, the derived state and today's date. It returns the kind of step (`review`, `learn`, `exercise`, `rebuilt`, `complete`), the activity, the concept, an item view without the answer, an exercise view with paths, and a reason in plain words. The assistant calls it after every recorded result.

## Running Exercises

`runExercise()` creates a temporary folder, copies in the test files, support files and the solution under the starter's name, and runs:

- Python: `python -I -B _teachback_harness.py <test modules> <starter>`. `-I` ignores user site-packages and environment variables; the harness adds the folder to `sys.path`, runs `unittest`, and prints one JSON line with every test's outcome and, for failures, the message and the line in the learner's file.
- JavaScript: `node --test --test-isolation=none --test-reporter=<reporter> <tests>`. The reporter prints the same JSON line.

A timer kills the whole process tree (`taskkill /T` on Windows, a process group elsewhere) when the timeout passes. The folder is removed afterwards, so the course folder is never written to. This confines the working folder; it is not a security sandbox.

Python is found by trying `python3` and `python` (`python`, `py -3` and `python3` on Windows) and accepting the first that reports Python 3. `TEACHBACK_PYTHON` overrides: a command with arguments (`py -3`) or a full path to the interpreter, which may contain spaces.

## The Dashboard

`renderDashboard()` returns one HTML string with inline CSS and script and a content security policy of `default-src 'none'`, so the page cannot load anything from the network. The concept map is a layered layout computed in Node (longest-path layers, dummy nodes on long edges, barycentre ordering) and written as static SVG with one link per concept; selecting a concept opens a details popover anchored to its node, animated by the inlined spring helper `src/fluid.js`. The three small charts are drawn by an inline script at the width of their container and redrawn on resize and on a colour-scheme change. Every number also appears as static HTML, in stat tiles, lists and table views, so the page is readable without script and the end-to-end test can compare the page with `status --json`.

Light and dark themes are CSS custom properties switched by `prefers-color-scheme`. The mastery colours are one blue ramp, ordered by mastery, with separate steps chosen for each theme.

## Testing

- `npm test` runs `tests/*.test.mjs`: the learner model with hand-computed values, `next` on a crafted map plus a property test over random histories, `check` against one breakage per error class, grading, the runner for both languages with timeouts, the shipped examples including exercise verification, the CLI, a simulated learner over three study days, the rubric paraphrase table, and the eval suite in `evals/` checked without a model (scaffolds and file and regex graders).
- `claude plugin eval` runs the eval suite against a real model, with and without the plugin; the README section "Proof" has the commands. It needs macOS, Linux or WSL2, because it refuses shell tools where there is no sandbox.
- `npm run test:e2e` renders the dashboard for the simulated learner in an installed Chrome, Edge or Chromium (`TEACHBACK_CHROME` overrides the path) with every request routed to abort, then checks for console errors, compares the numbers with `status --json`, checks layout at 1280×800 and 390×844 in both themes, and saves screenshots to `tests/output/`.

## Design Choices Worth Knowing

- **P(L) is capped at 0.99** so a failed review is visible. Textbook BKT would need several straight misses.
- **A passing exercise counts once.** Failing runs are practice and do not lower mastery.
- **The capstone is last on the plan**: `next` offers it only when every other concept is mastered. `run` does not block it earlier, because practice is fine, but it says that a pass alone does not make the course Rebuilt; the course is Rebuilt at the first moment the capstone has passed and every concept is mastered.
- **Early correct answers do not stretch review intervals**, so answering the same item three times in one sitting does not schedule it a month out.
- **The tool never judges explanations.** Rubric coverage is reported as evidence, and `grade --record` refuses short and teach-back items.
