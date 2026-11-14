# Contributing

Contributions are welcome, and the most useful one is a course. This guide covers courses first, then code.

## Contributing A Course

A good course is one a learner can trust: every fact matches the source, every question tests understanding, and every exercise works.

### 1. Pick A Source

- A paper, chapter or explainer with a clear structure and something to rebuild.
- You may cite and summarise it, but not copy it. Check its licence. Never commit the PDF or long quotations; formulas and short phrases are fine.
- An original explainer you write yourself also works: put it in the course folder as `SOURCE.md`, as `examples/bloom-filters/` does.

### 2. Build It

Follow [references/authoring-guide.md](references/authoring-guide.md). In short:

```
node scripts/teachback.mjs init my-paper --title "..." --source https://arxiv.org/abs/...
```

Then write `map.json` (8 to 20 concepts), `items.json` (at least 3 items of 2 types per concept, each concept with a teach-back) and `exercises/` (3 to 6 steps ending in a capstone). [references/format.md](references/format.md) describes every field.

### 3. Check It

```
node scripts/teachback.mjs check .teachback/my-paper
```

It must print `OK: no errors.` with no warnings. Then take the course yourself for at least one session: `next`, answer items with `grade` and `record`, `run` each exercise with the reference, and open the dashboard.

### 4. Review The Facts

Read every concept summary against the source, number by number, and say in your pull request that you did. `check` cannot catch a wrong fact.

### 5. Open A Pull Request

Move the course to `examples/<slug>/` without `learner.json`, `work/` or `dashboard.html`. `npm test` checks every course in `examples/`, exercises included, so run it before you push. In the pull request, say what the source is, its licence, and how you checked the facts.

## Contributing Code

```
git clone https://github.com/logitsolutionsai/teachback
cd teachback
npm install          # playwright-core only, for the browser test; it downloads no browser
                     # the tests need Node 22 or newer; the CLI itself runs on Node 20.11 or newer
npm test             # unit and integration tests
npm run test:e2e     # dashboard in an installed Chrome, Edge or Chromium
```

A change to `SKILL.md` or `references/tutoring-protocol.md` changes how the tutor behaves, which `npm test` cannot see. Run the behaviour evals in `evals/` before and after (README, "Proof"), and report both scores in the pull request.

- No runtime dependencies. Use the Node standard library.
- Keep the learner model deterministic. Never read the real date outside `resolveNow()`; take `now` as a parameter.
- Every change to the model, the planner or `check` needs a test, with hand-worked numbers where there is maths.
- New `check` problems get a code in `CODES`, a message that names the file and the item, and a fix hint.
- Keep `SKILL.md` short; put detail in `references/`.

## Writing Style For Docs

Title Case headings. Plain words, short sentences, no contractions, no exclamation marks. Explain what the user sees, with an example, before the mechanism. No invented numbers or testimonials.
